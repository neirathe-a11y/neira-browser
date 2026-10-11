'use strict';
const {
    app, BrowserWindow, ipcMain, Menu, session, shell, dialog, clipboard, safeStorage, webContents, protocol
} = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { fileURLToPath, pathToFileURL } = require('url');
const Shortcuts = require('./shortcuts');
const { createStore } = require('./store');
const { assetResponse, VIDEO_EXT, NAME_RE } = require('./assets');

// neira-asset://wallpaper/<file> and neira-asset://dial/<file> let our own pages show the user's wallpaper and
// custom Speed Dial pictures (served by assets.js)
protocol.registerSchemesAsPrivileged([
    { scheme: 'neira-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

// WebGPU runs Local AI (the on-device language model). Windows and macOS have it already; Linux needs these.
app.commandLine.appendSwitch('enable-unsafe-webgpu');
if (process.platform === 'linux') app.commandLine.appendSwitch('enable-features', 'Vulkan');

let store = null;

const ENGINES = [
    'https://www.google.com/search?q=',
    'https://www.bing.com/search?q=',
    'https://duckduckgo.com/?q=',
    'https://search.brave.com/search?q='
];

const STORE_DEFAULTS = {
    settings: {
        theme: 'dark',
        density: 'comfortable',
        engine: ENGINES[0],
        homepage: 'https://www.google.com',
        incognitoStartup: false,
        showBookmarksBar: true,
        tabLayout: 'horizontal',     // horizontal | vertical
        sidebarCollapsed: false,
        newTabPage: 'neira',         // neira | homepage
        wallpaper: 'preset:neon',    // none | preset:<name> | file:<name>
        wallpaperDim: 35,
        wallpaperBlur: 0,
        accent: '#6366f1',           // any #rrggbb colour
        accentTint: 'off',           // off | subtle | strong (how much the accent colours the surfaces)
        localAI: false,              // AI-written summaries and answers that run on this computer's GPU
        localAIModel: 'balanced',    // fast | balanced | smart
        showClock: true,
        offerSave: true,
        offerPasskey: true,
        autoSignin: true
    },
    shortcuts: {},      // only overrides: { actionId: "Ctrl + X" | "" }
    bookmarks: [],
    history: [],
    passwords: [],
    declined: [],
    permissions: {},    // "origin|permission" -> true (allowed) | false (blocked)
    speedDial: [
        { id: 'sd-youtube', title: 'YouTube', url: 'https://www.youtube.com/' },
        { id: 'sd-gmail', title: 'Gmail', url: 'https://mail.google.com/' },
        { id: 'sd-github', title: 'GitHub', url: 'https://github.com/' },
        { id: 'sd-wikipedia', title: 'Wikipedia', url: 'https://www.wikipedia.org/' },
        { id: 'sd-reddit', title: 'Reddit', url: 'https://www.reddit.com/' }
    ]
};
const MAX_SPEED_DIAL = 24;
const DIAL_IMG_RE = /^[a-z0-9-]+\.(jpg|jpeg|png|webp|gif)$/;
let wallpaperDir = '';
let dialDir = '';

function validWallpaper(value) {
    if (typeof value !== 'string') return false;
    if (value === 'none' || /^preset:(neon|aurora|midnight|stars)$/.test(value)) return true;
    if (!value.startsWith('file:') || !NAME_RE.test(value.slice(5))) return false;
    return fs.existsSync(path.join(wallpaperDir, value.slice(5)));
}

function removeWallpaperFile(previous, next) {
    if (typeof previous !== 'string' || !previous.startsWith('file:') || previous === next) return;
    const name = previous.slice(5);
    if (NAME_RE.test(name)) fs.promises.unlink(path.join(wallpaperDir, name)).catch(() => {});
}

function cleanSpeedDial(list) {
    const out = [];
    for (const d of Array.isArray(list) ? list : []) {
        if (out.length >= MAX_SPEED_DIAL) break;
        if (!d || typeof d.url !== 'string') continue;
        let u;
        try { u = new URL(d.url); } catch (_) { continue; }
        if (!/^https?:$/.test(u.protocol)) continue;
        const image = typeof d.image === 'string' && DIAL_IMG_RE.test(d.image) && fs.existsSync(path.join(dialDir, d.image)) ? d.image : '';
        out.push({
            id: typeof d.id === 'string' && /^[\w-]{1,40}$/.test(d.id) ? d.id : crypto.randomUUID(),
            title: String(d.title || '').trim().slice(0, 40) || u.hostname.replace(/^www\./, ''),
            url: u.href,
            ...(image ? { image } : {})
        });
    }
    return out;
}

// Deletes custom Speed Dial pictures that no tile uses any more.
// Recent files are kept: the user may have just picked one in an Add/Edit dialog that is still open.
function pruneDialImages() {
    try {
        const used = new Set(store.data.speedDial.map(d => d.image).filter(Boolean));
        for (const f of fs.readdirSync(dialDir)) {
            if (used.has(f) || !DIAL_IMG_RE.test(f)) continue;
            const file = path.join(dialDir, f);
            if (Date.now() - fs.statSync(file).mtimeMs < 10 * 60 * 1000) continue;
            fs.promises.unlink(file).catch(() => {});
        }
    } catch (_) { /* folder does not exist yet */ }
}

// ---------------------------------------------------------------------------
// Windows (several normal windows + private windows)
// ---------------------------------------------------------------------------
const windows = new Set(); // { win, isPrivate, partitions:Set<string> }

function infoFromContents(contents) {
    if (!contents) return null;
    for (const info of windows) {
        if (info.win.isDestroyed()) continue;
        const host = info.win.webContents;
        if (contents === host || contents.hostWebContents === host) return info;
    }
    return null;
}

function focusedInfo() {
    const focused = BrowserWindow.getFocusedWindow();
    for (const info of windows) if (info.win === focused) return info;
    return [...windows].find(i => !i.win.isDestroyed()) || null;
}

function sendTo(info, channel, ...args) {
    if (info && !info.win.isDestroyed()) info.win.webContents.send(channel, ...args);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isInternalUrl(u) {
    try {
        if (!u || !u.startsWith('file:')) return false;
        const p = path.resolve(fileURLToPath(u)).toLowerCase();
        return p.startsWith(path.resolve(__dirname).toLowerCase());
    } catch (_) {
        return false;
    }
}

// Send to every browser window and every one of our own internal pages.
function broadcast(channel, ...args) {
    for (const wc of webContents.getAllWebContents()) {
        if (wc.isDestroyed()) continue;
        if (isInternalUrl(wc.getURL())) wc.send(channel, ...args);
    }
}

function handle(channel, fn) {
    ipcMain.handle(channel, (event, ...args) => {
        if (!isInternalUrl(event.sender.getURL())) throw new Error('Forbidden');
        return fn(event, ...args);
    });
}

function listen(channel, fn) {
    ipcMain.on(channel, (event, ...args) => {
        if (!isInternalUrl(event.sender.getURL())) return;
        fn(event, ...args);
    });
}

const parentOf = event => {
    const info = infoFromContents(event.sender);
    return info ? info.win : undefined;
};
const box = (win, options) => (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options));

// ---------------------------------------------------------------------------
// Shortcut engine (the only place keystrokes are matched)
// ---------------------------------------------------------------------------
let shortcutMap = {};          // id -> combo ('' = unassigned)
let comboToAction = new Map(); // combo -> id
let recording = null;          // { id, sender, timer }

const REPEATABLE = new Set([
    'zoom_in', 'zoom_out', 'select_next_tab', 'select_prev_tab', 'cycle_tabs', 'cycle_tabs_back',
    'go_back', 'go_forward', 'find_next', 'find_prev', 'focus_next_pane', 'focus_prev_pane'
]);
// Actions that run in this process (they need windows / dialogs)
const MAIN_ACTIONS = new Set(['toggle_fullscreen', 'close_window', 'new_window', 'new_private_window', 'open_file']);
// Actions that move keyboard focus into the browser UI (not the page)
const FOCUS_UI_ACTIONS = new Set([
    'focus_address', 'focus_search_bar', 'focus_bookmarks', 'focus_menu_bar', 'focus_toolbar',
    'focus_next_pane', 'focus_prev_pane', 'show_app_menu', 'show_avatar_menu', 'search_tabs',
    'find_in_page', 'new_tab', 'toggle_assistant', 'summarize_page'
]);
const RELEASE_KEYS = new Set(['Control', 'Alt', 'Meta']);

function rebuildShortcuts() {
    shortcutMap = Object.assign({}, Shortcuts.DEFAULTS, store.data.shortcuts);
    for (const id of Object.keys(shortcutMap)) {
        if (!(id in Shortcuts.DEFAULTS)) delete shortcutMap[id]; // drop stale ids
    }
    comboToAction = new Map();
    for (const [id, combo] of Object.entries(shortcutMap)) {
        if (combo) comboToAction.set(combo, id);
    }
}

function setOverride(id, combo) {
    if (combo === Shortcuts.DEFAULTS[id]) delete store.data.shortcuts[id];
    else store.data.shortcuts[id] = combo;
}

// Assigns a combo to an action and unassigns whichever action had it. Live immediately.
function assignShortcut(id, combo) {
    const previous = shortcutMap[id] || '';
    let displaced = null;
    if (combo) {
        const other = comboToAction.get(combo);
        if (other && other !== id) {
            displaced = other;
            setOverride(other, '');
        }
    }
    setOverride(id, combo);
    rebuildShortcuts();
    store.save();
    broadcast('shortcuts:changed', { map: shortcutMap, displaced });
    return { displaced, previous };
}

function openFileDialog(info) {
    dialog.showOpenDialog(info.win, { properties: ['openFile'] }).then(({ canceled, filePaths }) => {
        if (!canceled && filePaths[0]) sendTo(info, 'open-url', pathToFileURL(filePaths[0]).href, {});
    });
}

function runAction(info, id) {
    if (!info || info.win.isDestroyed()) return;
    switch (id) {
        case 'toggle_fullscreen': info.win.setFullScreen(!info.win.isFullScreen()); return;
        case 'close_window': info.win.close(); return;
        case 'new_window': createWindow({ isPrivate: !!store.data.settings.incognitoStartup }); return;
        case 'new_private_window': createWindow({ isPrivate: true }); return;
        case 'open_file': openFileDialog(info); return;
        default: break;
    }
    if (FOCUS_UI_ACTIONS.has(id)) info.win.webContents.focus();
    sendTo(info, 'shortcut:action', id);
}

function cancelRecording() {
    if (!recording) return;
    const { sender, timer } = recording;
    clearTimeout(timer);
    recording = null;
    if (!sender.isDestroyed()) sender.send('shortcuts:record-cancel');
}

function stopRecording() {
    if (!recording) return;
    clearTimeout(recording.timer);
    recording = null;
}

function handleRecordingInput(event, input) {
    const combo = Shortcuts.normalizeInput(input);
    const { id, sender } = recording;
    if (sender.isDestroyed()) { stopRecording(); return; }

    if (!combo) { // only modifiers so far: show them live
        sender.send('shortcuts:record-preview', Shortcuts.describeModifiers(input));
        return;
    }
    event.preventDefault();
    if (combo === 'Escape') { cancelRecording(); return; }

    let chosen = combo;
    if (combo === 'Backspace' || combo === 'Delete') chosen = '';
    else {
        const check = Shortcuts.validate(combo);
        if (!check.ok) { sender.send('shortcuts:record-invalid', check.reason); return; }
    }

    stopRecording();
    const { displaced, previous } = assignShortcut(id, chosen);
    sender.send('shortcuts:record-done', { id, combo: chosen, displaced, previous });
}

function onBeforeInput(contents, event, input) {
    const info = infoFromContents(contents);
    if (!info) return;

    if (input.type === 'keyUp') {
        if (RELEASE_KEYS.has(input.key)) sendTo(info, 'shortcut:modifier-released');
        return;
    }
    if (input.type !== 'keyDown') return;

    if (recording) { handleRecordingInput(event, input); return; }

    const combo = Shortcuts.normalizeInput(input);
    if (!combo) return;
    const id = comboToAction.get(combo);
    if (!id) return;

    event.preventDefault(); // the page and any menu accelerator must not also see it
    if (input.isAutoRepeat && !REPEATABLE.has(id)) return;
    runAction(info, id);
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------
function createWindow({ isPrivate = false } = {}) {
    const light = store.data.settings.theme === 'light';
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 640,
        minHeight: 420,
        title: isPrivate ? 'Neira Browser (Private)' : 'Neira Browser',
        backgroundColor: isPrivate ? '#2b2140' : (light ? '#e8e8e8' : '#1f1f1f'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webviewTag: true
        }
    });
    const info = { win, isPrivate, partitions: new Set() };
    windows.add(info);

    win.loadFile('index.html', isPrivate ? { query: { private: '1' } } : undefined);
    const wc = win.webContents;
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', e => e.preventDefault());
    wc.on('did-attach-webview', (_e, guest) => setupGuest(info, guest));

    win.on('closed', () => {
        windows.delete(info);
        for (const partition of info.partitions) { // forget everything from a private window
            try {
                const ses = session.fromPartition(partition);
                ses.clearStorageData();
                ses.clearCache();
            } catch (_) { /* ignore */ }
        }
    });
    return info;
}

function guardNavigation(wc, ev, url) {
    const toInternal = isInternalUrl(url);
    const fromUrl = wc.getURL();
    // Web pages can never navigate to local files
    if (url.startsWith('file:') && !toInternal && !fromUrl.startsWith('file:')) { ev.preventDefault(); return; }
    // A page that has our preload API must never navigate to an outside site
    if (isInternalUrl(fromUrl) && !toInternal) {
        ev.preventDefault();
        if (/^https?:/i.test(url)) sendTo(infoFromContents(wc), 'open-url', url, {});
    }
}

// "Ctrl + Shift + T" -> "CommandOrControl+Shift+T" (Electron's accelerator format, used only to *display* a shortcut)
function accelerator(id) {
    const combo = shortcutMap[id];
    if (!combo) return null;
    const { mods, key } = Shortcuts.parseCombo(combo);
    return [...mods.map(m => (m === 'Ctrl' ? 'CommandOrControl' : m)), key === '+' ? 'Plus' : key].join('+');
}

function setupGuest(info, wc) {
    wc.on('will-navigate', (ev, url) => guardNavigation(wc, ev, url));
    wc.on('will-redirect', (ev, url) => guardNavigation(wc, ev, url));

    wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
        if (isMainFrame && code !== -3) console.warn(`[neira] could not load ${url}: ${description} (${code})`);
    });

    // target=_blank and window.open become new tabs
    wc.setWindowOpenHandler(({ url }) => {
        if (/^https?:/i.test(url)) sendTo(info, 'open-url', url, {});
        return { action: 'deny' };
    });

    wc.on('context-menu', (_e, p) => {
        const nav = wc.navigationHistory;
        const canBack = nav ? nav.canGoBack() : wc.canGoBack();
        const canForward = nav ? nav.canGoForward() : wc.canGoForward();
        const internal = isInternalUrl(wc.getURL());
        const hasSelection = !!(p.selectionText && p.selectionText.trim());
        // Everything below runs through the same action ids as the keyboard shortcuts (app.js executes them).
        const act = id => () => sendTo(info, 'shortcut:action', id);

        const template = useAccel => {
            // Shows the user's current shortcut next to the item (display only, it is never registered).
            const key = (item, id) => {
                const a = useAccel ? accelerator(id) : null;
                return a ? { ...item, accelerator: a, registerAccelerator: false } : item;
            };
            const t = [];
            if (p.linkURL) {
                t.push(
                    { label: 'Open link in new tab', click: () => sendTo(info, 'open-url', p.linkURL, { background: true }) },
                    { label: 'Copy link address', click: () => clipboard.writeText(p.linkURL) },
                    { type: 'separator' }
                );
            }
            if (p.mediaType === 'image' && p.srcURL) {
                t.push(
                    { label: 'Open image in new tab', click: () => sendTo(info, 'open-url', p.srcURL, { background: true }) },
                    { label: 'Copy image', click: () => wc.copyImageAt(p.x, p.y) },
                    { type: 'separator' }
                );
            }
            if (p.isEditable) t.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }, { type: 'separator' });
            else if (hasSelection) t.push({ role: 'copy' }, { type: 'separator' });

            t.push(key({ label: 'Back', enabled: canBack, click: () => (nav ? nav.goBack() : wc.goBack()) }, 'go_back'));
            if (canForward) t.push(key({ label: 'Forward', click: () => (nav ? nav.goForward() : wc.goForward()) }, 'go_forward'));
            t.push(key({ label: 'Refresh', click: () => wc.reload() }, 'reload'));

            if (internal) { // our own pages: the page tools below make no sense there
                t.push({ type: 'separator' }, { label: 'Inspect', click: () => wc.inspectElement(p.x, p.y) });
                return t;
            }
            t.push(
                { type: 'separator' },
                key({ label: 'Save as', click: act('save_page') }, 'save_page'),
                key({ label: 'Print', click: act('print') }, 'print'),
                { type: 'separator' },
                // With text selected this summarises just that passage; otherwise the whole page.
                { label: 'Summarise with Neira', click: () => sendTo(info, 'assistant:summarize', hasSelection ? p.selectionText : '') },
                key({ label: hasSelection ? 'Read aloud selection' : 'Read aloud', click: act('read_aloud') }, 'read_aloud'),
                key({ label: 'Translate to English', click: act('translate_page') }, 'translate_page'),
                { type: 'separator' },
                key({ label: 'Screenshot', click: act('screenshot') }, 'screenshot'),
                {
                    label: 'More tools',
                    submenu: [
                        key({ label: 'Find in page', click: act('find_in_page') }, 'find_in_page'),
                        key({ label: 'Bookmark this page', click: act('bookmark_curr') }, 'bookmark_curr'),
                        { label: 'Add to Speed Dial', click: act('add_speed_dial') },
                        key({ label: 'Duplicate tab', click: act('duplicate_tab') }, 'duplicate_tab'),
                        key({ label: 'Copy page address', click: act('copy_url') }, 'copy_url'),
                        { type: 'separator' },
                        key({ label: 'Zoom in', click: act('zoom_in') }, 'zoom_in'),
                        key({ label: 'Zoom out', click: act('zoom_out') }, 'zoom_out'),
                        key({ label: 'Reset zoom', click: act('reset_zoom') }, 'reset_zoom'),
                        key({ label: 'Dark mode for this site', click: act('toggle_dark_mode') }, 'toggle_dark_mode'),
                        { type: 'separator' },
                        key({ label: 'Developer tools', click: act('devtools_toggle') }, 'devtools_toggle'),
                        key({ label: 'JavaScript console', click: act('devtools_console') }, 'devtools_console')
                    ]
                },
                { label: 'Send to your device', click: act('send_to_device') },
                { type: 'separator' },
                key({ label: 'View page source', click: act('view_source') }, 'view_source'),
                { label: 'Inspect', click: () => wc.inspectElement(p.x, p.y) }
            );
            return t;
        };

        let menu;
        try { menu = Menu.buildFromTemplate(template(true)); } // an unusual custom shortcut can be an invalid accelerator
        catch (_) { menu = Menu.buildFromTemplate(template(false)); }
        menu.popup({ window: info.win });
    });
}

// Webview hardening: only our own pages get the preload API; everything else is sandboxed.
app.on('web-contents-created', (_e, contents) => {
    contents.on('before-input-event', (event, input) => onBeforeInput(contents, event, input));

    contents.on('will-attach-webview', (event, webPreferences, params) => {
        delete webPreferences.preload;
        delete webPreferences.preloadURL;
        webPreferences.nodeIntegration = false;
        webPreferences.nodeIntegrationInSubFrames = false;
        webPreferences.contextIsolation = true;
        webPreferences.sandbox = true;
        webPreferences.webSecurity = true;
        webPreferences.allowRunningInsecureContent = false;
        delete params.allowpopups;

        const src = params.src || '';
        const internal = isInternalUrl(src);
        if (internal) {
            webPreferences.preload = path.join(__dirname, 'preload.js');
            delete params.partition;
        } else if (!/^(https?:|about:blank|data:|file:)/i.test(src)) {
            event.preventDefault();
            return;
        }

        // Private windows use an in-memory partition that is wiped when the window closes
        const part = params.partition || '';
        if (!internal && /^private-[a-z0-9-]{8,}$/.test(part)) {
            const info = infoFromContents(contents);
            if (info) info.partitions.add(part);
            setupSession(session.fromPartition(part), true);
        } else if (!internal && profilePartition()) {
            // normal windows: each profile keeps its own cookies and site data
            params.partition = profilePartition();
            setupSession(session.fromPartition(params.partition));
        } else {
            delete params.partition;
        }
    });
});

function cleanUserAgent() {
    try {
        let ua = app.userAgentFallback;
        if (!ua) return null;
        ua = ua.replace(/\s*Electron\/\S+/i, '');
        const name = typeof app.getName === 'function' ? app.getName() : '';
        if (name) ua = ua.replace(new RegExp('\\s*' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\/\\S+', 'i'), '');
        return ua;
    } catch (_) {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Sessions: permissions + downloads
// ---------------------------------------------------------------------------
const downloads = [];
const downloadItems = new Map();
let downloadTimer = null;
const configuredSessions = new WeakSet();

function notifyDownloads(immediate) {
    if (immediate) { clearTimeout(downloadTimer); downloadTimer = null; }
    if (downloadTimer) return;
    const fire = () => { downloadTimer = null; broadcast('downloads:changed', downloads); };
    if (immediate) fire();
    else downloadTimer = setTimeout(fire, 250);
}

function uniquePath(file) {
    if (!fs.existsSync(file)) return file;
    const { dir, name, ext } = path.parse(file);
    for (let i = 1; i < 1000; i++) {
        const candidate = path.join(dir, `${name} (${i})${ext}`);
        if (!fs.existsSync(candidate)) return candidate;
    }
    return file;
}

function setupSession(ses, isPrivate = false) {
    if (configuredSessions.has(ses)) return;
    configuredSessions.add(ses);

    // Electron has no location backend unless the app ships a Google API key, so a location prompt can
    // never succeed. Blocking it silently stops Google (and others) from nagging on every page load.
    const AUTO_ALLOW = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock']);
    const AUTO_BLOCK = new Set(['geolocation']);
    const ASK = {
        media: 'use your camera or microphone',
        notifications: 'show notifications'
    };
    const ua = cleanUserAgent();
    if (ua && typeof ses.setUserAgent === 'function') ses.setUserAgent(ua);

    ses.setPermissionRequestHandler(async (wc, permission, callback, details) => {
        if (AUTO_ALLOW.has(permission)) return callback(true);
        if (AUTO_BLOCK.has(permission) || !ASK[permission]) return callback(false);

        let origin = '';
        let host = 'This site';
        try {
            const u = new URL(details.requestingUrl);
            origin = u.origin;
            host = u.host || host;
        } catch (_) { /* unknown origin: ask every time */ }

        const key = origin + '|' + permission;
        const remembered = store.data.permissions;
        if (!isPrivate && origin && typeof remembered[key] === 'boolean') return callback(remembered[key]);

        const info = infoFromContents(wc);
        const { response, checkboxChecked } = await box(info ? info.win : undefined, {
            type: 'question',
            buttons: ['Block', 'Allow'],
            defaultId: 0,
            cancelId: 0,
            message: `${host} wants to ${ASK[permission]}`,
            ...(isPrivate || !origin ? {} : { checkboxLabel: 'Remember my choice for this site', checkboxChecked: true })
        });
        const allow = response === 1;
        if (!isPrivate && origin && checkboxChecked) {
            remembered[key] = allow;
            store.save();
        }
        callback(allow);
    });

    ses.on('will-download', (_e, item) => {
        const savePath = uniquePath(path.join(app.getPath('downloads'), path.basename(item.getFilename())));
        item.setSavePath(savePath);
        const d = {
            id: crypto.randomUUID(),
            name: path.basename(savePath),
            url: item.getURL(),
            path: savePath,
            total: item.getTotalBytes(),
            received: 0,
            state: 'progressing',
            time: Date.now()
        };
        downloads.unshift(d);
        downloadItems.set(d.id, item);
        notifyDownloads(true);

        item.on('updated', (_ev, state) => {
            d.received = item.getReceivedBytes();
            d.total = item.getTotalBytes();
            d.state = state === 'interrupted' ? 'interrupted' : (item.isPaused() ? 'paused' : 'progressing');
            notifyDownloads(false);
        });
        item.once('done', (_ev, state) => {
            d.received = item.getReceivedBytes();
            d.state = state; // completed | cancelled | interrupted
            downloadItems.delete(d.id);
            notifyDownloads(true);
        });
    });
}

// ---------------------------------------------------------------------------
// Passwords (encrypted with the OS keychain via safeStorage)
// ---------------------------------------------------------------------------
function encrypt(text) {
    if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(text).toString('base64');
    return 'plain:' + Buffer.from(text, 'utf8').toString('base64');
}

function decrypt(blob) {
    if (blob.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(blob.slice(4), 'base64'));
    return Buffer.from(blob.slice(6), 'base64').toString('utf8');
}

function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quoted) {
            if (c === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
            } else field += c;
        } else if (c === '"') quoted = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n') i++;
            row.push(field); rows.push(row); row = []; field = '';
        } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(cell => cell.trim() !== ''));
}

const csvCell = s => '"' + String(s).replace(/"/g, '""') + '"';

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function registerIpc() {
    // --- shortcuts ---
    handle('shortcuts:get', () => ({
        categories: Shortcuts.CATEGORIES.map(c => ({
            category: c.category,
            items: c.items.map(([id, name]) => ({ id, name }))
        })),
        map: shortcutMap,
        defaults: Shortcuts.DEFAULTS,
        names: Shortcuts.NAMES
    }));

    handle('shortcuts:set', (_e, id, combo) => {
        if (!(id in Shortcuts.DEFAULTS)) throw new Error('Unknown action');
        if (combo) {
            const check = Shortcuts.validate(combo);
            if (!check.ok) return { ok: false, reason: check.reason };
        }
        return { ok: true, ...assignShortcut(id, combo || '') };
    });

    handle('shortcuts:reset-one', (_e, id) => {
        if (!(id in Shortcuts.DEFAULTS)) throw new Error('Unknown action');
        return { ok: true, ...assignShortcut(id, Shortcuts.DEFAULTS[id]) };
    });

    handle('shortcuts:reset', () => {
        store.data.shortcuts = {};
        rebuildShortcuts();
        store.save();
        broadcast('shortcuts:changed', { map: shortcutMap, displaced: null });
        return { ok: true };
    });

    handle('shortcuts:export', async event => {
        const win = parentOf(event);
        const { canceled, filePath } = await (win ? dialog.showSaveDialog(win, saveOpts()) : dialog.showSaveDialog(saveOpts()));
        if (canceled || !filePath) return { ok: false, cancelled: true };
        fs.writeFileSync(filePath, JSON.stringify({ app: 'neira-browser', version: 1, shortcuts: shortcutMap }, null, 2));
        return { ok: true };
        function saveOpts() {
            return { defaultPath: path.join(app.getPath('documents'), 'neira-shortcuts.json'), filters: [{ name: 'JSON', extensions: ['json'] }] };
        }
    });

    handle('shortcuts:import', async event => {
        const win = parentOf(event);
        const opts = { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] };
        const { canceled, filePaths } = await (win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts));
        if (canceled || !filePaths[0]) return { ok: false, cancelled: true };
        let incoming;
        try {
            const parsed = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
            incoming = parsed && typeof parsed === 'object' ? (parsed.shortcuts || parsed) : null;
        } catch (_) { incoming = null; }
        if (!incoming || typeof incoming !== 'object') return { ok: false, reason: 'That file is not a shortcuts export.' };

        const next = Object.assign({}, Shortcuts.DEFAULTS);
        const used = new Set();
        let count = 0;
        for (const [id, combo] of Object.entries(incoming)) {
            if (!(id in Shortcuts.DEFAULTS) || typeof combo !== 'string') continue;
            if (combo && (!Shortcuts.validate(combo).ok || used.has(combo))) { next[id] = ''; continue; }
            next[id] = combo;
            if (combo) used.add(combo);
            count++;
        }
        // Defaults that an imported binding stole stay unassigned instead of clashing
        for (const id of Object.keys(next)) {
            if (id in incoming) continue;
            if (next[id] && used.has(next[id])) next[id] = '';
            else if (next[id]) used.add(next[id]);
        }
        store.data.shortcuts = {};
        for (const id of Object.keys(next)) if (next[id] !== Shortcuts.DEFAULTS[id]) store.data.shortcuts[id] = next[id];
        rebuildShortcuts();
        store.save();
        broadcast('shortcuts:changed', { map: shortcutMap, displaced: null });
        return { ok: true, count };
    });

    listen('shortcuts:record-start', (event, id) => {
        if (!(id in Shortcuts.DEFAULTS)) return;
        stopRecording(); // replaces any earlier recording without telling the page it was cancelled
        recording = {
            id,
            sender: event.sender,
            // Safety net: never leave the keyboard captured if the page is left alone
            timer: setTimeout(cancelRecording, 12000)
        };
    });
    listen('shortcuts:record-stop', () => stopRecording());

    listen('action:run', (event, id) => {
        if (MAIN_ACTIONS.has(id)) runAction(infoFromContents(event.sender), id);
    });

    // --- settings ---
    handle('settings:get', () => store.data.settings);
    handle('settings:set', (_e, key, value) => {
        const s = store.data.settings;
        if (!(key in STORE_DEFAULTS.settings)) throw new Error('Unknown setting');
        if (key === 'theme' && !['dark', 'light'].includes(value)) return s;
        if (key === 'density' && !['comfortable', 'compact'].includes(value)) return s;
        if (key === 'engine' && !ENGINES.includes(value)) return s;
        if (key === 'tabLayout' && !['horizontal', 'vertical'].includes(value)) return s;
        if (key === 'newTabPage' && !['neira', 'homepage'].includes(value)) return s;
        if (key === 'wallpaper' && !validWallpaper(value)) return s;
        if (key === 'accent') {
            if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) return s;
            value = value.toLowerCase();
        }
        if (key === 'accentTint' && !['off', 'subtle', 'strong'].includes(value)) return s;
        if (key === 'localAIModel' && !['fast', 'balanced', 'smart'].includes(value)) return s;
        if (key === 'wallpaperDim' || key === 'wallpaperBlur') {
            const max = key === 'wallpaperDim' ? 80 : 20;
            value = Math.max(0, Math.min(max, Math.round(Number(value)) || 0));
        }
        if (key === 'homepage') {
            try {
                const u = new URL(String(value));
                if (!/^https?:$/.test(u.protocol)) return s;
                value = u.href;
            } catch (_) { return s; }
        }
        if (typeof STORE_DEFAULTS.settings[key] === 'boolean') value = !!value;
        const previous = s[key];
        s[key] = value;
        if (key === 'wallpaper') removeWallpaperFile(previous, value);
        store.save();
        broadcast('settings:changed', s);
        return s;
    });

    // --- bookmarks ---
    handle('bookmarks:get', () => store.data.bookmarks);
    handle('bookmarks:toggle', (_e, { url, title }) => {
        const list = store.data.bookmarks;
        const i = list.findIndex(b => b.url === url);
        let bookmarked;
        if (i > -1) { list.splice(i, 1); bookmarked = false; }
        else { list.push({ url: String(url), title: String(title || url) }); bookmarked = true; }
        store.save();
        broadcast('bookmarks:changed', list);
        return { bookmarked };
    });
    handle('bookmarks:add-many', (_e, entries) => {
        let added = 0;
        for (const e of Array.isArray(entries) ? entries : []) {
            if (!e || !/^https?:/i.test(e.url || '')) continue;
            if (store.data.bookmarks.some(b => b.url === e.url)) continue;
            store.data.bookmarks.push({ url: String(e.url), title: String(e.title || e.url) });
            added++;
        }
        if (added) { store.save(); broadcast('bookmarks:changed', store.data.bookmarks); }
        return { added };
    });
    handle('bookmarks:remove', (_e, url) => {
        store.data.bookmarks = store.data.bookmarks.filter(b => b.url !== url);
        store.save();
        broadcast('bookmarks:changed', store.data.bookmarks);
    });

    // --- history ---
    handle('history:get', () => store.data.history);
    handle('history:add', (_e, { url, title }) => {
        if (!/^https?:/i.test(url || '')) return;
        const list = store.data.history;
        const head = list[0];
        if (head && head.url === url && Date.now() - head.time < 30000) {
            if (title) head.title = String(title);
        } else {
            list.unshift({ id: crypto.randomUUID(), url: String(url), title: String(title || url), time: Date.now() });
            if (list.length > 2000) list.length = 2000;
        }
        store.save();
        broadcast('history:changed', list);
    });
    handle('history:remove', (_e, id) => {
        store.data.history = store.data.history.filter(h => h.id !== id);
        store.save();
        broadcast('history:changed', store.data.history);
    });
    handle('history:clear', () => {
        store.data.history = [];
        store.save();
        broadcast('history:changed', store.data.history);
    });

    // --- passwords ---
    handle('passwords:list', () => ({
        items: store.data.passwords.map(({ id, site, user }) => ({ id, site, user })),
        encrypted: safeStorage.isEncryptionAvailable()
    }));
    handle('passwords:add', (_e, { site, user, pass }) => {
        site = String(site || '').trim();
        user = String(user || '').trim();
        pass = String(pass || '');
        if (!site || !user || !pass) return { ok: false };
        store.data.passwords.push({ id: crypto.randomUUID(), site, user, pass: encrypt(pass) });
        store.save();
        return { ok: true };
    });
    handle('passwords:remove', (_e, id) => {
        store.data.passwords = store.data.passwords.filter(p => p.id !== id);
        store.save();
    });
    handle('passwords:copy', (_e, id) => {
        const entry = store.data.passwords.find(p => p.id === id);
        if (!entry) return false;
        const secret = decrypt(entry.pass);
        clipboard.writeText(secret);
        setTimeout(() => { if (clipboard.readText() === secret) clipboard.clear(); }, 30000);
        return true;
    });
    handle('passwords:export', async event => {
        if (!store.data.passwords.length) return { ok: false, reason: 'No saved passwords to export.' };
        const win = parentOf(event);
        const warn = await box(win, {
            type: 'warning',
            buttons: ['Cancel', 'Export'],
            defaultId: 0,
            cancelId: 0,
            message: 'Export passwords?',
            detail: 'The file will contain your passwords in plain text. Delete it when you are done.'
        });
        if (warn.response !== 1) return { ok: false, reason: 'Cancelled.' };
        const saveOpts = {
            defaultPath: path.join(app.getPath('downloads'), 'passwords.csv'),
            filters: [{ name: 'CSV', extensions: ['csv'] }]
        };
        const { canceled, filePath } = await (win ? dialog.showSaveDialog(win, saveOpts) : dialog.showSaveDialog(saveOpts));
        if (canceled || !filePath) return { ok: false, reason: 'Cancelled.' };
        const lines = ['site,username,password'];
        for (const p of store.data.passwords) lines.push([p.site, p.user, decrypt(p.pass)].map(csvCell).join(','));
        fs.writeFileSync(filePath, lines.join('\n') + '\n');
        return { ok: true, count: store.data.passwords.length };
    });
    handle('passwords:import', async event => {
        const win = parentOf(event);
        const openOpts = { properties: ['openFile'], filters: [{ name: 'CSV', extensions: ['csv'] }] };
        const { canceled, filePaths } = await (win ? dialog.showOpenDialog(win, openOpts) : dialog.showOpenDialog(openOpts));
        if (canceled || !filePaths.length) return { ok: false, reason: 'Cancelled.' };
        const rows = parseCsv(fs.readFileSync(filePaths[0], 'utf8'));
        if (!rows.length) return { ok: false, reason: 'The file is empty.' };

        let cols = { site: 0, user: 1, pass: 2 };
        const header = rows[0].map(c => c.trim().toLowerCase());
        if (header.includes('password')) {
            const find = (...names) => names.map(n => header.indexOf(n)).find(i => i > -1);
            cols = {
                site: find('url', 'site', 'name', 'origin') ?? 0,
                user: find('username', 'user', 'email', 'login') ?? 1,
                pass: header.indexOf('password')
            };
            rows.shift();
        }
        let count = 0;
        for (const r of rows) {
            const site = (r[cols.site] || '').trim();
            const user = (r[cols.user] || '').trim();
            const pass = r[cols.pass] || '';
            if (!site || !user || !pass) continue;
            store.data.passwords.push({ id: crypto.randomUUID(), site, user, pass: encrypt(pass) });
            count++;
        }
        store.save();
        return { ok: true, count };
    });
    handle('passwords:declined', () => store.data.declined);
    handle('passwords:remove-declined', (_e, site) => {
        store.data.declined = store.data.declined.filter(s => s !== site);
        store.save();
    });
    handle('passwords:clear', () => {
        store.data.passwords = [];
        store.data.declined = [];
        store.save();
    });

    // --- downloads ---
    handle('downloads:get', () => downloads);
    handle('downloads:open', (_e, id) => {
        const d = downloads.find(x => x.id === id);
        if (d && d.state === 'completed') shell.openPath(d.path);
    });
    handle('downloads:show', (_e, id) => {
        const d = downloads.find(x => x.id === id);
        if (d) shell.showItemInFolder(d.path);
    });
    handle('downloads:cancel', (_e, id) => {
        const item = downloadItems.get(id);
        if (item) item.cancel();
    });
    handle('downloads:clear', () => {
        for (let i = downloads.length - 1; i >= 0; i--) {
            if (downloads[i].state !== 'progressing' && downloads[i].state !== 'paused') downloads.splice(i, 1);
        }
        notifyDownloads(true);
    });

    // --- page tools that need the main process ---
    handle('page:save', async (event, wcId) => {
        const info = infoFromContents(event.sender);
        const target = webContents.fromId(wcId);
        if (!info || !target || infoFromContents(target) !== info) return { ok: false };
        const name = (target.getTitle() || 'page').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 80) || 'page';
        const { canceled, filePath } = await dialog.showSaveDialog(info.win, {
            defaultPath: path.join(app.getPath('downloads'), name + '.html'),
            filters: [{ name: 'Web page, complete', extensions: ['html', 'htm'] }]
        });
        if (canceled || !filePath) return { ok: false, cancelled: true };
        try {
            await target.savePage(filePath, 'HTMLComplete');
            return { ok: true, path: filePath };
        } catch (_) {
            return { ok: false };
        }
    });

    handle('devtools:console', async (event, wcId) => {
        const info = infoFromContents(event.sender);
        const target = webContents.fromId(wcId);
        if (!info || !target || infoFromContents(target) !== info) return false;
        try {
            if (!target.isDevToolsOpened()) target.openDevTools();
            await target.devToolsWebContents.executeJavaScript('DevToolsAPI.showPanel("console")');
            return true;
        } catch (_) {
            return false;
        }
    });

    // Screenshot of what is visible in a tab: saved to Downloads and copied to the clipboard
    handle('page:screenshot', async (event, wcId) => {
        const info = infoFromContents(event.sender);
        const target = webContents.fromId(wcId);
        if (!info || !target || infoFromContents(target) !== info) return { ok: false };
        try {
            const image = await target.capturePage();
            if (image.isEmpty()) return { ok: false };
            const d = new Date();
            const pad = n => String(n).padStart(2, '0');
            const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`;
            const file = uniquePath(path.join(app.getPath('downloads'), `Neira screenshot ${stamp}.png`));
            await fs.promises.writeFile(file, image.toPNG());
            clipboard.writeImage(image);
            return { ok: true, path: file };
        } catch (_) {
            return { ok: false };
        }
    });

    handle('browsing:clear', async event => {
        const win = parentOf(event);
        const { response } = await box(win, {
            type: 'warning',
            buttons: ['Cancel', 'Clear data'],
            defaultId: 0,
            cancelId: 0,
            message: 'Clear browsing data?',
            detail: 'This clears your history, cookies, site data and cached files. Saved passwords and bookmarks are kept.'
        });
        if (response !== 1) return { ok: false };
        store.data.history = [];
        store.save();
        broadcast('history:changed', store.data.history);
        const ses = activeSession(); // the active profile's cookies and cache
        await ses.clearStorageData();
        await ses.clearCache();
        return { ok: true };
    });

    // --- speed dial ---
    handle('speeddial:get', () => store.data.speedDial);
    handle('speeddial:set', (_e, list) => {
        store.data.speedDial = cleanSpeedDial(list);
        store.save();
        pruneDialImages();
        broadcast('speeddial:changed', store.data.speedDial);
        return store.data.speedDial;
    });

    // Copies a picture into the app's own folder; it becomes part of a tile when the Add/Edit dialog is saved.
    handle('speeddial:choose-image', async event => {
        const win = parentOf(event);
        const opts = {
            properties: ['openFile'],
            filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }]
        };
        const { canceled, filePaths } = await (win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts));
        if (canceled || !filePaths[0]) return { ok: false, cancelled: true };
        const ext = path.extname(filePaths[0]).slice(1).toLowerCase();
        if (!/^(jpe?g|png|webp|gif)$/.test(ext)) return { ok: false, reason: 'Pick a JPG, PNG, WebP or GIF image.' };
        if (fs.statSync(filePaths[0]).size > 8 * 1024 * 1024) return { ok: false, reason: 'That image is too large (limit 8 MB).' };
        fs.mkdirSync(dialDir, { recursive: true });
        const name = crypto.randomUUID() + '.' + ext;
        const dest = path.join(dialDir, name);
        await fs.promises.copyFile(filePaths[0], dest);
        const now = new Date();
        await fs.promises.utimes(dest, now, now).catch(() => {}); // Windows keeps the original date when copying
        return { ok: true, image: name };
    });
    handle('speeddial:add', (_e, entry) => {
        const clean = cleanSpeedDial([entry])[0];
        if (!clean) return { ok: false, reason: 'That page can’t be added.' };
        if (store.data.speedDial.some(d => d.url === clean.url)) return { ok: false, reason: 'Already on your Speed Dial.' };
        if (store.data.speedDial.length >= MAX_SPEED_DIAL) return { ok: false, reason: 'Speed Dial is full.' };
        store.data.speedDial.push(clean);
        store.save();
        broadcast('speeddial:changed', store.data.speedDial);
        return { ok: true };
    });

    // --- wallpaper upload (copied into the app's own folder, never referenced in place) ---
    handle('wallpaper:choose', async event => {
        const win = parentOf(event);
        const opts = {
            properties: ['openFile'],
            filters: [{ name: 'Images and videos', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm'] }]
        };
        const { canceled, filePaths } = await (win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts));
        if (canceled || !filePaths[0]) return { ok: false, cancelled: true };
        const ext = path.extname(filePaths[0]).slice(1).toLowerCase();
        const isVideo = VIDEO_EXT.has(ext);
        if (!/^(jpe?g|png|webp|gif|mp4|webm)$/.test(ext)) return { ok: false, reason: 'Pick a JPG, PNG, WebP, GIF, MP4 or WebM file.' };
        const size = fs.statSync(filePaths[0]).size;
        const limit = isVideo ? 300 * 1024 * 1024 : 30 * 1024 * 1024;
        if (size > limit) return { ok: false, reason: `That file is too large (limit ${isVideo ? '300' : '30'} MB).` };

        fs.mkdirSync(wallpaperDir, { recursive: true });
        const name = crypto.randomUUID() + '.' + ext;
        await fs.promises.copyFile(filePaths[0], path.join(wallpaperDir, name));
        const s = store.data.settings;
        const previous = s.wallpaper;
        s.wallpaper = 'file:' + name;
        store.save();
        removeWallpaperFile(previous, s.wallpaper);
        broadcast('settings:changed', s);
        return { ok: true, video: isVideo };
    });

    // --- the new tab page asks the browser window to open something in its own tab ---
    listen('newtab:go', (event, text, newTab) => {
        if (typeof text !== 'string' || !text.trim() || text.length > 2000) return;
        sendTo(infoFromContents(event.sender), 'open-input', text, { replaceWcId: event.sender.id, newTab: !!newTab });
    });

    // --- remembered site permissions ---
    handle('permissions:list', () => Object.entries(store.data.permissions).map(([key, allow]) => {
        const i = key.lastIndexOf('|');
        return { origin: key.slice(0, i), permission: key.slice(i + 1), allow };
    }));
    handle('permissions:clear', () => {
        store.data.permissions = {};
        store.save();
    });

    // --- misc ---
    handle('clipboard:write', (_e, text) => { clipboard.writeText(String(text).slice(0, 10000)); });
    handle('dialog:confirm', async (event, message) => {
        const { response } = await box(parentOf(event), {
            type: 'question',
            buttons: ['Cancel', 'OK'],
            defaultId: 0,
            cancelId: 0,
            message: String(message)
        });
        return response === 1;
    });

    // --- profiles ---
    handle('profiles:list', () => profilesPayload());

    handle('profiles:add', (_e, opts) => {
        const { name, color, switch: switchNow } = opts || {};
        const clean = cleanProfileName(name);
        if (!clean) return { ok: false, reason: 'Enter a name for the profile.' };
        if (profileMeta.profiles.length >= MAX_PROFILES) return { ok: false, reason: `You can have up to ${MAX_PROFILES} profiles.` };
        if (profileMeta.profiles.some(p => p.name.toLowerCase() === clean.toLowerCase())) return { ok: false, reason: 'A profile with that name already exists.' };
        const profile = { id: crypto.randomUUID(), name: clean, color: validProfileColor(color) || PROFILE_COLORS[profileMeta.profiles.length % PROFILE_COLORS.length] };

        // The new profile starts fresh, using its colour as the accent colour so it is easy to tell apart.
        try {
            fs.mkdirSync(profileDir(profile.id), { recursive: true });
            const fresh = createStore(path.join(profileDir(profile.id), 'neira-data.json'), freshDefaults());
            fresh.data.settings.accent = profile.color;
            fresh.save();
            fresh.flush();
        } catch (_) {
            return { ok: false, reason: 'Could not create the profile folder.' };
        }
        profileMeta.profiles.push(profile);
        saveProfileMeta();
        if (switchNow) switchProfile(profile.id);
        else broadcast('profiles:changed', profilesPayload());
        return { ok: true, id: profile.id };
    });

    handle('profiles:update', (_e, id, opts) => {
        const profile = profileMeta.profiles.find(p => p.id === id);
        if (!profile) return { ok: false, reason: 'That profile no longer exists.' };
        const { name, color } = opts || {};
        const clean = cleanProfileName(name);
        if (!clean) return { ok: false, reason: 'Enter a name for the profile.' };
        if (profileMeta.profiles.some(p => p.id !== id && p.name.toLowerCase() === clean.toLowerCase())) return { ok: false, reason: 'A profile with that name already exists.' };
        profile.name = clean;
        profile.color = validProfileColor(color) || profile.color;
        saveProfileMeta();
        broadcast('profiles:changed', profilesPayload());
        return { ok: true };
    });

    handle('profiles:switch', (_e, id) => ({ ok: switchProfile(String(id)) }));

    handle('profiles:delete', async (_e, id) => {
        const profile = profileMeta.profiles.find(p => p.id === id);
        if (!profile) return { ok: false, reason: 'That profile no longer exists.' };
        if (id === profileMeta.active) return { ok: false, reason: 'Switch to another profile before deleting this one.' };
        if (profileMeta.profiles.length <= 1) return { ok: false, reason: 'You need at least one profile.' };
        profileMeta.profiles = profileMeta.profiles.filter(p => p.id !== id);
        saveProfileMeta();
        try { // cookies, logins and cached files of that profile
            const ses = id === 'default' ? session.defaultSession : session.fromPartition('persist:profile-' + id);
            await ses.clearStorageData();
            await ses.clearCache();
        } catch (_) { /* nothing to clear */ }
        try { // its data. The first profile lives in the main app folder, so only its own files are removed.
            if (id === 'default') {
                const base = app.getPath('userData');
                fs.rmSync(path.join(base, 'neira-data.json'), { force: true });
                fs.rmSync(path.join(base, 'wallpapers'), { recursive: true, force: true });
                fs.rmSync(path.join(base, 'speeddial'), { recursive: true, force: true });
            } else {
                fs.rmSync(profileDir(id), { recursive: true, force: true });
            }
        } catch (_) { /* leftover files are harmless */ }
        broadcast('profiles:changed', profilesPayload());
        return { ok: true };
    });
}

// ---------------------------------------------------------------------------
// Profiles: every profile has its own data file (settings, bookmarks, history, passwords, Speed Dial...)
// and its own cookie/site-data partition. One profile is active at a time and switching reloads the windows.
// The first profile (id "default") keeps using the original files and session, so nothing existing is moved.
// ---------------------------------------------------------------------------
const PROFILE_COLORS = ['#6366f1', '#3b82f6', '#06b6d4', '#14b8a6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#ec4899', '#a855f7'];
const MAX_PROFILES = 8;
let profileMeta = null; // { active, profiles: [{ id, name, color }] }

const profilesFile = () => path.join(app.getPath('userData'), 'profiles.json');
const profileDir = id => (id === 'default' ? app.getPath('userData') : path.join(app.getPath('userData'), 'profiles', id));
const activeProfile = () => profileMeta.profiles.find(p => p.id === profileMeta.active) || profileMeta.profiles[0];
const profilePartition = () => (activeProfile().id === 'default' ? '' : 'persist:profile-' + activeProfile().id);
const activeSession = () => (profilePartition() ? session.fromPartition(profilePartition()) : session.defaultSession);
const cleanProfileName = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 24);
const validProfileColor = v => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null);
const freshDefaults = () => JSON.parse(JSON.stringify(STORE_DEFAULTS));

function loadProfileMeta() {
    let meta = null;
    try { meta = JSON.parse(fs.readFileSync(profilesFile(), 'utf8')); } catch (_) { /* first run */ }
    const list = meta && Array.isArray(meta.profiles)
        ? meta.profiles
            .filter(p => p && typeof p.id === 'string' && /^[a-z0-9-]{1,40}$/.test(p.id) && typeof p.name === 'string')
            .map(p => ({ id: p.id, name: cleanProfileName(p.name) || 'Profile', color: validProfileColor(p.color) || PROFILE_COLORS[0] }))
        : [];
    if (!list.length) list.push({ id: 'default', name: 'Personal', color: PROFILE_COLORS[0] });
    const active = list.some(p => p.id === (meta && meta.active)) ? meta.active : list[0].id;
    return { active, profiles: list };
}

function saveProfileMeta() {
    try {
        const tmp = profilesFile() + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(profileMeta, null, 2));
        fs.renameSync(tmp, profilesFile());
    } catch (_) { /* the next change tries again */ }
}

// Points the app's data (store, wallpapers, Speed Dial pictures) at a profile.
function openProfileData(profile) {
    const dir = profileDir(profile.id);
    fs.mkdirSync(dir, { recursive: true });
    store = createStore(path.join(dir, 'neira-data.json'), freshDefaults());
    wallpaperDir = path.join(dir, 'wallpapers');
    dialDir = path.join(dir, 'speeddial');
}

const profilesPayload = () => ({ active: profileMeta.active, profiles: profileMeta.profiles.map(p => ({ ...p })) });

function switchProfile(id) {
    const target = profileMeta.profiles.find(p => p.id === id);
    if (!target || id === profileMeta.active) return false;
    if (store) store.flush();
    profileMeta.active = id;
    saveProfileMeta();
    openProfileData(target);
    rebuildShortcuts();
    pruneDialImages();
    for (const info of windows) {
        if (info.win.isDestroyed() || info.isPrivate) continue;
        info.win.webContents.reload(); // starts again with the new profile's data and cookies
    }
    // private windows are not reloaded (their tabs would be lost), so they get the new data pushed instead
    broadcast('settings:changed', store.data.settings);
    broadcast('bookmarks:changed', store.data.bookmarks);
    broadcast('history:changed', store.data.history);
    broadcast('speeddial:changed', store.data.speedDial);
    broadcast('shortcuts:changed', { map: shortcutMap, displaced: null });
    broadcast('profiles:changed', profilesPayload());
    return true;
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
    profileMeta = loadProfileMeta();
    openProfileData(activeProfile());
    saveProfileMeta();
    rebuildShortcuts();

    // The default Electron menu has accelerators (Ctrl+R, Ctrl+W...) that fight with ours.
    if (process.platform === 'darwin') {
        Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
    } else {
        Menu.setApplicationMenu(null);
    }

    protocol.handle('neira-asset', request => assetResponse(request, { wallpaper: wallpaperDir, dial: dialDir }));
    pruneDialImages();

    setupSession(session.defaultSession);
    registerIpc();
    createWindow({ isPrivate: !!store.data.settings.incognitoStartup });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow({ isPrivate: !!store.data.settings.incognitoStartup });
    });
});

app.on('before-quit', () => { if (store) store.flush(); });

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();

    ipcMain.on('show-context-menu', (event, { selectedText }) => {
    const template = [
        {
            label: 'Summarize with Neira',
            click: () => {
                event.sender.send('trigger-action', 'summarize_page', selectedText);
            }
        }
    ];
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: BrowserWindow.fromWebContents(event.sender) });
    const { app, BrowserWindow, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
  });
  mainWindow.loadURL('index.html');

  // Only check for updates if the app is packaged/installed
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify();
  }
}

autoUpdater.on('update-downloaded', () => {
  dialog.showMessageBox({
    type: 'info',
    title: 'Update Ready',
    message: 'A new version of Neira has been downloaded. Restart the application to apply the update.',
    buttons: ['Restart', 'Later']
  }).result.then((buttonIndex) => {
    if (buttonIndex.response === 0) autoUpdater.quitAndInstall();
  });
});

app.whenReady().then(() => {
  createWindow();
});
});
});