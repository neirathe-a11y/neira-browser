'use strict';

const {
    app, BrowserWindow, ipcMain, Menu, session, shell, dialog, clipboard, safeStorage, webContents, protocol, screen
} = require('electron');
const { autoUpdater } = require('electron-updater');
const { initialize, trackEvent } = require('@aptabase/electron/main');

initialize('A-EU-3606599135');

const path = require('path');
const fs = require('fs');
const defaultBrowser = require('./default-browser');
const crypto = require('crypto');
const { fileURLToPath, pathToFileURL } = require('url');
const Shortcuts = require('./shortcuts');
const { createStore } = require('./store');
const { assetResponse, VIDEO_EXT, NAME_RE } = require('./assets');
const { shouldBlock: isTracker, isAllowed: isTrackerAllowed, TRACKERS } = require('./blocklist');
let Database = null;
try { Database = require('better-sqlite3'); } catch (_) { Database = null; }

protocol.registerSchemesAsPrivileged([
    { scheme: 'neira-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

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
        tabLayout: 'horizontal',
        sidebarCollapsed: false,
        newTabPage: 'neira',
        wallpaper: 'preset:neon',
        wallpaperDim: 35,
        wallpaperBlur: 0,
        accent: '#6366f1',
        accentTint: 'off',
        localAI: false,
        localAIModel: 'balanced',
        showClock: true,
        offerSave: true,
        offerPasskey: true,
        autoSignin: true,
        trackerBlocking: true,
        trackerAllowlist: [],
        hasSeenImport: false
    },
    shortcuts: {},
    bookmarks: [],
    history: [],
    passwords: [],
    declined: [],
    permissions: {},
    speedDial: [
        { id: 'sd-youtube', title: 'YouTube', url: 'https://www.youtube.com/' },
        { id: 'sd-gmail', title: 'Gmail', url: 'https://mail.google.com/' },
        { id: 'sd-github', title: 'GitHub', url: 'https://github.com/' },
        { id: 'sd-wikipedia', title: 'Wikipedia', url: 'https://www.wikipedia.org/' },
        { id: 'sd-reddit', title: 'Reddit', url: 'https://www.reddit.com/' }
    ],
    parental: {
        enabled: false,
        pinHash: '',
        salt: '',
        recoveryHash: '',
        locked: false,
        hidden: false,
        safeSearch: true,
        allowlistOnly: false,
        blocklist: [],
        allowlist: [
            'wikipedia.org', 'khanacademy.org', 'ck12.org', 'openstax.org',
            'pbslearningmedia.org', 'nationalgeographic.com', 'nasa.gov',
            'mit.edu', 'harvard.edu', 'coursera.org', 'edx.org', 'duolingo.com',
            'google.com', 'docs.google.com', 'classroom.google.com', 'wolframalpha.com',
            'desmos.com', 'geogebra.org', 'code.org', 'scratch.mit.edu',
            'bbc.co.uk', 'britannica.com', 'si.edu', 'loc.gov'
        ],
        categories: {
            games: { label: 'Games', hosts: ['roblox.com', 'minecraft.net', 'poki.com', 'crazygames.com', 'miniclip.com', 'kongregate.com', 'itch.io', 'steampowered.com', 'epicgames.com', 'fortnite.com'], minutes: 60 },
            entertainment: { label: 'Entertainment', hosts: ['youtube.com', 'netflix.com', 'hulu.com', 'disneyplus.com', 'twitch.tv', 'spotify.com', 'tiktok.com', 'primevideo.com', 'hbomax.com', 'max.com'], minutes: 90 },
            social: { label: 'Social', hosts: ['facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'reddit.com', 'snapchat.com', 'discord.com', 'pinterest.com', 'tumblr.com', 'threads.net'], minutes: 30 }
        },
        usage: {},
        blocked: []
    }
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

function pruneDialImages() {
    try {
        const used = new Set(store.data.speedDial.map(d => d.image).filter(Boolean));
        for (const f of fs.readdirSync(dialDir)) {
            if (used.has(f) || !DIAL_IMG_RE.test(f)) continue;
            const file = path.join(dialDir, f);
            if (Date.now() - fs.statSync(file).mtimeMs < 10 * 60 * 1000) continue;
            fs.promises.unlink(file).catch(() => {});
        }
    } catch (_) {}
}

// ---------------------------------------------------------------------------
// Parental controls
// ---------------------------------------------------------------------------
let parentalTick = null;
let activeGuest = null;

const LEGACY_UNLOCK = 'requiem';

const hashPin = (salt, pin) => crypto.createHash('sha256').update(salt + ':' + pin).digest('hex');
const todayKey = () => new Date().toISOString().slice(0, 10);

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateRecoveryCode() {
    const bytes = crypto.randomBytes(12);
    const chars = [];
    for (let i = 0; i < 12; i++) chars.push(RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length]);
    return 'NEIRA-' + chars.slice(0, 4).join('') + '-' + chars.slice(4, 8).join('') + '-' + chars.slice(8, 12).join('');
}
function normaliseRecovery(input) {
    return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^NEIRA/, '');
}
const hashRecovery = (salt, code) => crypto.createHash('sha256').update(salt + ':rec:' + normaliseRecovery(code)).digest('hex');

function safeEqualHex(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length) return false;
    try { return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex')); } catch (_) { return false; }
}

function resetFilePath() {
    return path.join(app.getPath('userData'), 'DISABLE-PARENTAL-CONTROLS.txt');
}
function checkResetFile() {
    if (!store || !store.data.parental) return false;
    if (!fs.existsSync(resetFilePath())) return false;
    try { fs.unlinkSync(resetFilePath()); } catch (_) {}
    const p = store.data.parental;
    p.enabled = false;
    p.pinHash = '';
    p.recoveryHash = '';
    p.salt = '';
    store.save();
    stopParentalTicker();
    activeGuest = null;
    return true;
}

function parentalEnabled() {
    return !!(store && store.data.parental && store.data.parental.enabled);
}

function usageToday() {
    const p = store.data.parental;
    const key = todayKey();
    if (!p.usage[key]) p.usage[key] = { games: 0, entertainment: 0, social: 0, total: 0 };
    return p.usage[key];
}

function hostMatches(host, pattern) {
    host = String(host).toLowerCase().replace(/^www\./, '');
    pattern = String(pattern).toLowerCase();
    return host === pattern || host.endsWith('.' + pattern);
}

function categorise(host) {
    const cats = store.data.parental.categories;
    for (const [id, c] of Object.entries(cats)) {
        if (c.hosts.some(h => hostMatches(host, h))) return id;
    }
    return null;
}

function allowedByList(host) {
    return store.data.parental.allowlist.some(a => hostMatches(host, a));
}

function blockedByList(host) {
    return (store.data.parental.blocklist || []).some(b => hostMatches(host, b));
}

function applySafeSearch(rawUrl) {
    let u;
    try { u = new URL(rawUrl); } catch (_) { return null; }
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    const q = u.searchParams;

    if (host === 'google.com' && u.pathname === '/search') {
        if (q.get('safe') === 'active') return null;
        q.set('safe', 'active');
        if (!q.has('filter')) q.set('filter', '1');
        return u.href;
    }
    if (host === 'bing.com' && u.pathname === '/search') {
        if (q.get('adlt') === 'strict') return null;
        q.set('adlt', 'strict');
        if (q.get('safeSearch') !== 'Strict') q.set('safeSearch', 'Strict');
        return u.href;
    }
    if (host === 'duckduckgo.com') {
        if (q.get('kp') === '1') return null;
        q.set('kp', '1');
        return u.href;
    }
    if (host === 'search.brave.com') {
        if (q.get('safesearch') === 'strict') return null;
        q.set('safesearch', 'strict');
        return u.href;
    }
    if (host === 'ecosia.org') {
        if (q.get('safeSearch') === 'strict') return null;
        q.set('safeSearch', 'strict');
        return u.href;
    }
    return null;
}

function blockPage(url, reason) {
    let host = url;
    try { host = new URL(url).hostname; } catch (_) {}
    const dark = store.data.settings.theme !== 'light';
    const bg = dark ? '#14121c' : '#fff';
    const fg = dark ? '#e5e3ef' : '#1e1e1e';
    const html = `<!doctype html><meta charset="utf-8"><title>Blocked by Parental Controls</title>
<body style="font:15px/1.6 system-ui,sans-serif;background:${bg};color:${fg};display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<div style="max-width:520px;padding:24px;text-align:center">
<div style="font-size:48px">🛡️</div>
<h2 style="margin:12px 0 8px">This site is blocked</h2>
<p style="margin:0 0 4px;word-break:break-all;color:#a1a1aa">${escHtml(host)}</p>
<p style="margin:0 0 16px;opacity:.75">${escHtml(reason)}</p>
<p style="margin:0;font-size:13px;opacity:.55">Parental controls are on. Ask a parent to unlock a category in Settings → Parental Controls.</p>
</div>`;
    return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

function escHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function parentalCheck(rawUrl) {
    if (!parentalEnabled()) return null;
    if (!/^https?:/i.test(rawUrl)) return null;

    let u;
    try { u = new URL(rawUrl); } catch (_) { return null; }
    const host = u.hostname;

    if (blockedByList(host)) {
        const reason = 'This site is on the blocked list.';
        recordBlock(host, reason);
        return blockPage(rawUrl, reason);
    }
    if (store.data.parental.allowlistOnly && !allowedByList(host)) {
        const reason = 'Only educational sites on the allowlist are reachable.';
        recordBlock(host, reason);
        return blockPage(rawUrl, reason);
    }
    const cat = categorise(host);
    if (cat) {
        const limitMinutes = store.data.parental.categories[cat].minutes;
        const limit = limitMinutes * 60;
        const used = usageToday()[cat] || 0;
        if (limitMinutes === 0 || used >= limit) {
            const reason = limitMinutes === 0
                ? `${store.data.parental.categories[cat].label} is blocked.`
                : `${store.data.parental.categories[cat].label} time is used up for today.`;
            recordBlock(host, reason);
            return blockPage(rawUrl, reason);
        }
    }
    return null;
}

function recordBlock(host, reason) {
    const p = store.data.parental;
    p.blocked.unshift({ host, reason, time: Date.now() });
    if (p.blocked.length > 50) p.blocked.length = 50;
    store.save();
    broadcast('parental:blocked', { host, reason, time: Date.now() });
}

function startParentalTicker() {
    if (parentalTick) return;
    parentalTick = setInterval(() => {
        if (!parentalEnabled()) return;
        if (!activeGuest || activeGuest.wc.isDestroyed()) { activeGuest = null; return; }
        if (!activeGuest.category) { activeGuest = null; return; }

        const info = infoFromContents(activeGuest.wc);
        if (!info || info.win.isDestroyed() || !info.win.isVisible() || !info.win.isFocused()) return;

        const usage = usageToday();
        usage[activeGuest.category] = (usage[activeGuest.category] || 0) + 5;
        usage.total = (usage.total || 0) + 5;

        const cat = activeGuest.category;
        const limitMinutes = store.data.parental.categories[cat].minutes;
        const limit = limitMinutes * 60;
        if (limitMinutes === 0 || usage[cat] >= limit) {
            const reason = limitMinutes === 0
                ? `${store.data.parental.categories[cat].label} is blocked.`
                : `${store.data.parental.categories[cat].label} time is used up for today.`;
            recordBlock(activeGuest.host, reason);
            try {
                activeGuest.wc.loadURL(blockPage(activeGuest.wc.getURL(), reason)).catch(() => {});
            } catch (_) {}
            activeGuest = null;
        } else {
            store.save();
        }

        if (usage.total % 30 === 0) broadcast('parental:usage', { date: todayKey(), usage });
    }, 5000);
}
function stopParentalTicker() {
    if (parentalTick) { clearInterval(parentalTick); parentalTick = null; }
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------
const windows = new Set();

function infoFromContents(contents) {
    if (!contents) return null;
    for (const info of windows) {
        if (info.win.isDestroyed()) continue;
        const host = info.win.webContents;
        if (contents === host || contents.hostWebContents === host) return info;
    }
    return null;
}

function sendTo(info, channel, ...args) {
    if (info && !info.win.isDestroyed()) info.win.webContents.send(channel, ...args);
}

function isInternalUrl(u) {
    try {
        if (!u || !u.startsWith('file:')) return false;
        const p = path.resolve(fileURLToPath(u)).toLowerCase();
        return p.startsWith(path.resolve(__dirname).toLowerCase());
    } catch (_) {
        return false;
    }
}

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
// Shortcut engine
// ---------------------------------------------------------------------------
let shortcutMap = {};
let comboToAction = new Map();
let recording = null;

const REPEATABLE = new Set([
    'zoom_in', 'zoom_out', 'select_next_tab', 'select_prev_tab', 'cycle_tabs', 'cycle_tabs_back',
    'go_back', 'go_forward', 'find_next', 'find_prev', 'focus_next_pane', 'focus_prev_pane'
]);
const MAIN_ACTIONS = new Set(['toggle_fullscreen', 'close_window', 'new_window', 'new_private_window', 'open_file']);
const FOCUS_UI_ACTIONS = new Set([
    'focus_address', 'focus_search_bar', 'focus_bookmarks', 'focus_menu_bar', 'focus_toolbar',
    'focus_next_pane', 'focus_prev_pane', 'show_app_menu', 'show_avatar_menu', 'search_tabs',
    'find_in_page', 'new_tab', 'toggle_assistant', 'summarize_page', 'open_extensions'
]);
const RELEASE_KEYS = new Set(['Control', 'Alt', 'Meta']);

function rebuildShortcuts() {
    shortcutMap = Object.assign({}, Shortcuts.DEFAULTS, store.data.shortcuts);
    for (const id of Object.keys(shortcutMap)) {
        if (!(id in Shortcuts.DEFAULTS)) delete shortcutMap[id];
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

    if (!combo) { sender.send('shortcuts:record-preview', Shortcuts.describeModifiers(input)); return; }
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

    event.preventDefault();
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
        frame: false,
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

    const info = { win, isPrivate, partitions: new Set(), blockedCounts: new Map() };
    windows.add(info);

    win.maximize();

    win.loadFile('index.html', isPrivate ? { query: { private: '1' } } : undefined);

    win.once('ready-to-show', () => {
        win.show();
    });

    const wc = win.webContents;
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', e => e.preventDefault());

    wc.on('did-attach-webview', (_e, guest) => {
        setupGuest(info, guest);
        guest.on('context-menu', (e, params) => {
            e.preventDefault();
            if (!win.isDestroyed()) {
                win.webContents.send('page-context-menu', {
                    params,
                    x: params.x,
                    y: params.y
                });
            }
        });
        guest.on('did-start-navigation', (_ev, url, isInPlace, isMainFrame) => {
            if (isMainFrame && !isInPlace) {
                // Reset the shield count when navigating
                info.blockedCounts = new Map();
                if (!win.isDestroyed()) win.webContents.send('tracker:blocked', { host: '', url, count: 0, reset: true });
            }
        });
    });

    win.on('maximize', () => { if (!win.isDestroyed()) win.webContents.send('window:maximized', true); });
    win.on('unmaximize', () => { if (!win.isDestroyed()) win.webContents.send('window:maximized', false); });

    win.on('closed', () => {
        windows.delete(info);
        for (const partition of info.partitions) {
            try {
                const ses = session.fromPartition(partition);
                ses.clearStorageData();
                ses.clearCache();
            } catch (_) {}
        }
    });

    return info;
}

function guardNavigation(wc, ev, url) {
    const toInternal = isInternalUrl(url);
    const fromUrl = wc.getURL();
    if (url.startsWith('file:') && !toInternal && !fromUrl.startsWith('file:')) { ev.preventDefault(); return; }
    if (isInternalUrl(fromUrl) && !toInternal) {
        ev.preventDefault();
        if (/^https?:/i.test(url)) sendTo(infoFromContents(wc), 'open-url', url, {});
    }
}

function accelerator(id) {
    const combo = shortcutMap[id];
    if (!combo) return null;
    const { mods, key } = Shortcuts.parseCombo(combo);
    return [...mods.map(m => (m === 'Ctrl' ? 'CommandOrControl' : m)), key === '+' ? 'Plus' : key].join('+');
}

function setupGuest(info, wc) {
    const enforceParental = (ev, url) => {
        guardNavigation(wc, ev, url);
        if (ev.defaultPrevented) return;
        const redirect = parentalCheck(url);
        if (redirect) {
            ev.preventDefault();
            try { wc.loadURL(redirect).catch(() => {}); } catch (_) {}
        }
    };
    wc.on('will-navigate', enforceParental);
    wc.on('will-redirect', enforceParental);

    let lastRedirectedTo = null;
    wc.on('did-start-navigation', (_ev, url, isInPlace, isMainFrame) => {
        if (!isMainFrame || isInPlace) return;
        if (!parentalEnabled()) return;
        if (!/^https?:/i.test(url)) return;
        if (url === lastRedirectedTo) return;
        const redirect = parentalCheck(url);
        if (redirect) {
            lastRedirectedTo = redirect;
            try { wc.stop(); } catch (_) {}
            try { wc.loadURL(redirect).catch(() => {}); } catch (_) {}
        }
    });

    wc.setWindowOpenHandler(({ url }) => {
        if (parentalEnabled()) {
            const redirect = parentalCheck(url);
            if (redirect) { sendTo(info, 'open-url', redirect, {}); return { action: 'deny' }; }
        }
        if (/^https?:/i.test(url)) sendTo(info, 'open-url', url, {});
        return { action: 'deny' };
    });

    const updateActive = () => {
        if (wc.isDestroyed()) return;
        let host = '';
        try { host = new URL(wc.getURL()).hostname; } catch (_) {}
        const cat = parentalEnabled() ? categorise(host) : null;
        if (cat) activeGuest = { wc, host, category: cat };
        else if (activeGuest && activeGuest.wc === wc) activeGuest = null;
    };
    wc.on('did-navigate', updateActive);
    wc.on('did-navigate-in-page', updateActive);
    wc.on('did-finish-load', updateActive);
    wc.on('focus', () => {
        if (!parentalEnabled()) return;
        let host = '';
        try { host = new URL(wc.getURL()).hostname; } catch (_) {}
        const cat = categorise(host);
        if (cat) activeGuest = { wc, host, category: cat };
    });
}

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
                webPreferences.plugins = true;
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

        const part = params.partition || '';
        if (!internal && /^private-[a-z0-9-]{8,}$/.test(part)) {
            const info = infoFromContents(contents);
            if (info) info.partitions.add(part);
            setupSession(session.fromPartition(part), true);
        } else if (!internal && profilePartition()) {
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
// Sessions & Downloads
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

    const AUTO_ALLOW = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock']);
    const AUTO_BLOCK = new Set(['geolocation']);
    const ASK = {
        media: 'use your camera or microphone',
        notifications: 'show notifications'
    };
    const ua = cleanUserAgent();
    if (ua && typeof ses.setUserAgent === 'function') ses.setUserAgent(ua);

    // Tracker blocking + parental safe-search, in one request hook.
    ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, cb) => {
        if (details.resourceType === 'mainFrame') return cb({});

        let host = '';
        try { host = new URL(details.url).hostname; } catch (_) { return cb({}); }

        const blockingOn = !!(store && store.data && store.data.settings && store.data.settings.trackerBlocking !== false);
        if (blockingOn && !isPrivate) {
            const allowlist = store.data.settings.trackerAllowlist || [];
            if (isTracker(host) && !isTrackerAllowed(host, allowlist)) {
                const info = infoFromContents(details.webContentsId != null ? webContents.fromId(details.webContentsId) : null);
                if (info) {
                    info.blockedCounts.set(host, (info.blockedCounts.get(host) || 0) + 1);
                    sendTo(info, 'tracker:blocked', { host, url: details.url, count: info.blockedCounts.get(host) });
                }
                return cb({ cancel: true });
            }
        }

        if (parentalEnabled() && store.data.parental.safeSearch && /^https?:/i.test(details.url)) {
            const rewritten = applySafeSearch(details.url);
            if (rewritten) return cb({ redirectURL: rewritten });
        }

        cb({});
    });

    ses.setPermissionRequestHandler(async (wc, permission, callback, details) => {
        if (AUTO_ALLOW.has(permission)) return callback(true);
        if (AUTO_BLOCK.has(permission) || !ASK[permission]) return callback(false);

        let origin = '';
        let host = 'This site';
        try {
            const u = new URL(details.requestingUrl);
            origin = u.origin;
            host = u.host || host;
        } catch (_) {}

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
            broadcast('permissions:changed', null);
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
            d.state = state;
            downloadItems.delete(d.id);
            notifyDownloads(true);
        });
    });
}

// ---------------------------------------------------------------------------
// Passwords
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
// IPC Handlers
// ---------------------------------------------------------------------------
const PIN_FAILS = { count: 0, until: 0 };
const RECOVERY_FAILS = { count: 0, until: 0 };

function registerIpc() {
      handle('tracker:status', (event, host) => {
        const settings = store.data.settings;
        const enabled = settings.trackerBlocking !== false;
        const allowlist = settings.trackerAllowlist || [];
        const allowlisted = host ? isTrackerAllowed(host, allowlist) : false;
        const info = infoFromContents(event.sender);
        const counts = info ? Array.from(info.blockedCounts.entries()) : [];
        const total = counts.reduce((sum, [, n]) => sum + n, 0);
        return {
            enabled,
            blocking: enabled && !allowlisted,
            allowlisted,
            host: host || '',
            total,
            hosts: counts.map(([h, n]) => ({ host: h, count: n }))
        };
    });

    handle('tracker:set-enabled', (_e, on) => {
        store.data.settings.trackerBlocking = !!on;
        store.save();
        broadcast('settings:changed', store.data.settings);
        return { ok: true };
    });

    handle('tracker:allow-site', (_e, host) => {
        if (typeof host !== 'string' || !host) return { ok: false };
        const clean = host.toLowerCase().replace(/^www\./, '');
        const list = new Set(store.data.settings.trackerAllowlist || []);
        list.add(clean);
        store.data.settings.trackerAllowlist = Array.from(list);
        store.save();
        broadcast('settings:changed', store.data.settings);
        return { ok: true };
    });

    handle('tracker:disallow-site', (_e, host) => {
        if (typeof host !== 'string' || !host) return { ok: false };
        const clean = host.toLowerCase().replace(/^www\./, '');
        store.data.settings.trackerAllowlist = (store.data.settings.trackerAllowlist || [])
            .filter(h => h !== clean);
        store.save();
        broadcast('settings:changed', store.data.settings);
        return { ok: true };
    });

    handle('tracker:clear-counts', event => {
        const info = infoFromContents(event.sender);
        if (info) info.blockedCounts = new Map();
        return { ok: true };
    });

    // ----- Shortcuts -----
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
        stopRecording();
        recording = {
            id,
            sender: event.sender,
            timer: setTimeout(cancelRecording, 12000)
        };
    });
    listen('shortcuts:record-stop', () => stopRecording());

    listen('action:run', (event, id) => {
        const TAB_MENU_ACTIONS = new Set(['new_tab', 'duplicate_tab']);
        if (MAIN_ACTIONS.has(id) || TAB_MENU_ACTIONS.has(id)) runAction(infoFromContents(event.sender), id);
    });

    // ----- Window controls -----
    listen('window:minimize', event => {
        const info = infoFromContents(event.sender);
        if (info && !info.win.isDestroyed()) info.win.minimize();
    });

    listen('window:maximize-toggle', event => {
        const info = infoFromContents(event.sender);
        if (!info || info.win.isDestroyed()) return;
        if (info.win.isMaximized()) info.win.unmaximize();
        else info.win.maximize();
    });

    listen('window:close', event => {
        const info = infoFromContents(event.sender);
        if (info && !info.win.isDestroyed()) info.win.close();
    });

    let dragTimer = null;
    listen('window:drag-start', event => {
        const info = infoFromContents(event.sender);
        if (!info || info.win.isDestroyed() || info.win.isMaximized() || info.win.isFullScreen()) return;
        clearInterval(dragTimer);
        const win = info.win;
        const start = screen.getCursorScreenPoint();
        const b = win.getBounds();
        dragTimer = setInterval(() => {
            if (win.isDestroyed()) { clearInterval(dragTimer); dragTimer = null; return; }
            const p = screen.getCursorScreenPoint();
            win.setBounds({ x: b.x + p.x - start.x, y: b.y + p.y - start.y, width: b.width, height: b.height });
        }, 8);
    });
    listen('window:drag-stop', () => { clearInterval(dragTimer); dragTimer = null; });

    listen('window:open-url', (event, url) => {
        if (typeof url !== 'string' || !/^https?:/i.test(url)) return;
        const from = infoFromContents(event.sender);
        const created = createWindow({ isPrivate: !!(from && from.isPrivate) });
        created.win.webContents.once('did-finish-load', () => sendTo(created, 'open-url', url, {}));
    });

    ipcMain.on('window:is-maximized', event => {
        if (!isInternalUrl(event.sender.getURL())) { event.returnValue = false; return; }
        const info = infoFromContents(event.sender);
        event.returnValue = !!(info && !info.win.isDestroyed() && info.win.isMaximized());
    });

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
        const ses = activeSession();
        await ses.clearStorageData();
        await ses.clearCache();
        return { ok: true };
    });

    handle('speeddial:get', () => store.data.speedDial);
    handle('speeddial:set', (_e, list) => {
        store.data.speedDial = cleanSpeedDial(list);
        store.save();
        pruneDialImages();
        broadcast('speeddial:changed', store.data.speedDial);
        return store.data.speedDial;
    });

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
        await fs.promises.utimes(dest, now, now).catch(() => {});
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

    listen('newtab:go', (event, text, newTab) => {
        if (typeof text !== 'string' || !text.trim() || text.length > 2000) return;
        sendTo(infoFromContents(event.sender), 'open-input', text, { replaceWcId: event.sender.id, newTab: !!newTab });
    });
        listen('importer:open-wizard', event => {
        const info = infoFromContents(event.sender);
        if (info && !info.win.isDestroyed()) {
            info.win.webContents.send('importer:show-wizard');
        }
    });
    handle('permissions:list', () => Object.entries(store.data.permissions).map(([key, allow]) => {
        const i = key.lastIndexOf('|');
        return { origin: key.slice(0, i), permission: key.slice(i + 1), allow };
    }));

    handle('permissions:listDetailed', () => {
        const raw = store.data.permissions;
        const byOrigin = new Map();
        for (const [key, allow] of Object.entries(raw)) {
            const i = key.lastIndexOf('|');
            const origin = key.slice(0, i);
            const permission = key.slice(i + 1);
            if (!byOrigin.has(origin)) byOrigin.set(origin, { origin, perms: [], host: origin });
            byOrigin.get(origin).perms.push({ permission, allow });
        }
        const rows = [...byOrigin.values()].sort((a, b) => a.origin.localeCompare(b.origin));
        for (const row of rows) row.perms.sort((a, b) => a.permission.localeCompare(b.permission));
        return rows;
    });

    handle('permissions:setFor', (_e, origin, permission, allow) => {
        if (typeof origin !== 'string' || typeof permission !== 'string') return { ok: false };
        if (!['media', 'notifications', 'geolocation'].includes(permission)) return { ok: false };
        const key = origin + '|' + permission;
        store.data.permissions[key] = !!allow;
        store.save();
        broadcast('permissions:changed', null);
        return { ok: true };
    });

    handle('permissions:removeFor', (_e, origin, permission) => {
        const key = origin + '|' + permission;
        delete store.data.permissions[key];
        store.save();
        broadcast('permissions:changed', null);
        return { ok: true };
    });

    handle('permissions:removeOrigin', (_e, origin) => {
        for (const key of Object.keys(store.data.permissions)) {
            if (key.startsWith(origin + '|')) delete store.data.permissions[key];
        }
        store.save();
        broadcast('permissions:changed', null);
        return { ok: true };
    });

    handle('permissions:clear', () => {
        store.data.permissions = {};
        store.save();
        broadcast('permissions:changed', null);
    });

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

    handle('profiles:list', () => profilesPayload());
    handle('profiles:add', (_e, opts) => {
        const { name, color, switch: switchNow } = opts || {};
        const clean = cleanProfileName(name);
        if (!clean) return { ok: false, reason: 'Enter a name for the profile.' };
        if (profileMeta.profiles.length >= MAX_PROFILES) return { ok: false, reason: `You can have up to ${MAX_PROFILES} profiles.` };
        if (profileMeta.profiles.some(p => p.name.toLowerCase() === clean.toLowerCase())) return { ok: false, reason: 'A profile with that name already exists.' };
        const profile = { id: crypto.randomUUID(), name: clean, color: validProfileColor(color) || PROFILE_COLORS[profileMeta.profiles.length % PROFILE_COLORS.length] };

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
        try {
            const ses = id === 'default' ? session.defaultSession : session.fromPartition('persist:profile-' + id);
            await ses.clearStorageData();
            await ses.clearCache();
        } catch (_) {}
        try {
            if (id === 'default') {
                const base = app.getPath('userData');
                fs.rmSync(path.join(base, 'neira-data.json'), { force: true });
                fs.rmSync(path.join(base, 'wallpapers'), { recursive: true, force: true });
                fs.rmSync(path.join(base, 'speeddial'), { recursive: true, force: true });
            } else {
                fs.rmSync(profileDir(id), { recursive: true, force: true });
            }
        } catch (_) {}
        broadcast('profiles:changed', profilesPayload());
        return { ok: true };
    });

    // ----- Parental controls -----
    handle('parental:status', () => {
        const p = store.data.parental;
        return {
            enabled: p.enabled,
            locked: !!p.locked,
            hidden: !!p.hidden,
            safeSearch: p.safeSearch,
            allowlistOnly: p.allowlistOnly,
            categories: Object.fromEntries(Object.entries(p.categories).map(([id, c]) => [id, { label: c.label, minutes: c.minutes, hosts: c.hosts }])),
            allowlist: p.allowlist,
            blocklist: p.blocklist || [],
            usage: usageToday(),
            blocked: p.blocked.slice(0, 30),
            hasPin: !!p.pinHash,
            hasRecovery: !!p.recoveryHash
        };
    });

    handle('parental:setup', (_e, pin) => {
        if (!/^\d{4,8}$/.test(String(pin))) return { ok: false, reason: 'Use a 4 to 8 digit PIN.' };
        const salt = crypto.randomBytes(16).toString('hex');
        const recovery = generateRecoveryCode();
        store.data.parental.salt = salt;
        store.data.parental.pinHash = hashPin(salt, String(pin));
        store.data.parental.recoveryHash = hashRecovery(salt, recovery);
        store.data.parental.enabled = true;
        store.save();
        startParentalTicker();
        broadcast('parental:changed', { enabled: true });
        return { ok: true, recoveryCode: recovery };
    });

    handle('parental:verify', (_e, pin) => {
        const p = store.data.parental;
        if (!p.pinHash) return { ok: false, reason: 'No PIN set yet.' };
        if (String(pin) === LEGACY_UNLOCK) return { ok: true, bypass: true };
        const now = Date.now();
        if (now < PIN_FAILS.until) return { ok: false, reason: `Too many attempts. Try again in ${Math.ceil((PIN_FAILS.until - now) / 1000)}s.` };
        const ok = safeEqualHex(hashPin(p.salt, String(pin)), p.pinHash);
        if (!ok) {
            PIN_FAILS.count++;
            if (PIN_FAILS.count >= 5) { PIN_FAILS.until = now + 60000; PIN_FAILS.count = 0; }
            return { ok: false, reason: 'Incorrect PIN.' };
        }
        PIN_FAILS.count = 0;
        return { ok: true };
    });

    handle('parental:change-pin', (_e, currentPin, newPin) => {
        const p = store.data.parental;
        if (!p.pinHash) return { ok: false, reason: 'No PIN set.' };
        if (!/^\d{4,8}$/.test(String(newPin))) return { ok: false, reason: 'The new PIN must be 4 to 8 digits.' };
        const okCurrent = String(currentPin) === LEGACY_UNLOCK || safeEqualHex(hashPin(p.salt, String(currentPin)), p.pinHash);
        if (!okCurrent) return { ok: false, reason: 'The current PIN is not correct.' };
        const salt = crypto.randomBytes(16).toString('hex');
        const recovery = generateRecoveryCode();
        p.salt = salt;
        p.pinHash = hashPin(salt, String(newPin));
        p.recoveryHash = hashRecovery(salt, recovery);
        store.save();
        broadcast('parental:changed', { enabled: p.enabled });
        return { ok: true, recoveryCode: recovery };
    });

    handle('parental:recover', (_e, code, newPin) => {
        const now = Date.now();
        if (now < RECOVERY_FAILS.until) return { ok: false, reason: `Too many attempts. Try again in ${Math.ceil((RECOVERY_FAILS.until - now) / 1000)}s.` };
        const p = store.data.parental;
        if (!p.recoveryHash) return { ok: false, reason: 'No recovery code was set for this profile. Use the file-based reset instead.' };
        if (!/^\d{4,8}$/.test(String(newPin))) return { ok: false, reason: 'The new PIN must be 4 to 8 digits.' };
        const ok = safeEqualHex(hashRecovery(p.salt, code), p.recoveryHash);
        if (!ok) {
            RECOVERY_FAILS.count++;
            if (RECOVERY_FAILS.count >= 5) { RECOVERY_FAILS.until = now + 5 * 60000; RECOVERY_FAILS.count = 0; }
            return { ok: false, reason: 'That recovery code is not right.' };
        }
        RECOVERY_FAILS.count = 0;
        const newRecovery = generateRecoveryCode();
        p.pinHash = hashPin(p.salt, String(newPin));
        p.recoveryHash = hashRecovery(p.salt, newRecovery);
        store.save();
        broadcast('parental:changed', { enabled: p.enabled });
        return { ok: true, recoveryCode: newRecovery };
    });

    handle('parental:regenerate-recovery', (_e, pin) => {
        const p = store.data.parental;
        if (!p.pinHash) return { ok: false, reason: 'No PIN set.' };
        const ok = String(pin) === LEGACY_UNLOCK || safeEqualHex(hashPin(p.salt, String(pin)), p.pinHash);
        if (!ok) return { ok: false, reason: 'Incorrect PIN.' };
        const newRecovery = generateRecoveryCode();
        p.recoveryHash = hashRecovery(p.salt, newRecovery);
        store.save();
        return { ok: true, recoveryCode: newRecovery };
    });

    handle('parental:forgot-info', () => ({
        hasRecovery: !!store.data.parental.recoveryHash,
        resetFile: resetFilePath()
    }));

    handle('parental:update', (_e, patch) => {
        const p = store.data.parental;
        const applied = [];

        if (typeof patch.enabled === 'boolean') { p.enabled = patch.enabled; applied.push('enabled'); }
        if (typeof patch.safeSearch === 'boolean') { p.safeSearch = patch.safeSearch; applied.push('safeSearch'); }
        if (typeof patch.allowlistOnly === 'boolean') { p.allowlistOnly = patch.allowlistOnly; applied.push('allowlistOnly'); }
        if (typeof patch.locked === 'boolean') { p.locked = patch.locked; applied.push('locked'); }
        if (typeof patch.hidden === 'boolean') { p.hidden = patch.hidden; applied.push('hidden'); }

        const cleanDomain = s => String(s || '')
            .trim().toLowerCase()
            .replace(/^https?:\/\//, '')
            .replace(/^www\./, '')
            .split(/[/?#]/)[0]
            .replace(/:\d+$/, '');
        const validDomain = s => /^[a-z0-9][a-z0-9.-]{0,120}$/.test(s) && s.length >= 2;

        if (Array.isArray(patch.allowlist)) {
            p.allowlist = patch.allowlist.map(cleanDomain).filter(validDomain).slice(0, 200);
            applied.push('allowlist');
        }
        if (Array.isArray(patch.blocklist)) {
            p.blocklist = patch.blocklist.map(cleanDomain).filter(validDomain).slice(0, 300);
            applied.push('blocklist');
        }
        if (patch.categories && typeof patch.categories === 'object') {
            for (const [id, incoming] of Object.entries(patch.categories)) {
                if (!p.categories[id]) continue;
                if (!incoming || incoming.minutes === undefined || incoming.minutes === null || incoming.minutes === '') continue;
                const n = Number(incoming.minutes);
                if (!Number.isFinite(n)) continue;
                p.categories[id].minutes = Math.max(0, Math.min(600, Math.round(n)));
                applied.push('categories.' + id);
            }
        }

        store.save();
        broadcast('parental:changed', { enabled: p.enabled });
        if (p.enabled) startParentalTicker(); else stopParentalTicker();

        return {
            ok: true,
            applied,
            state: {
                enabled: p.enabled,
                locked: !!p.locked,
                hidden: !!p.hidden,
                safeSearch: p.safeSearch,
                allowlistOnly: p.allowlistOnly,
                allowlist: p.allowlist,
                blocklist: p.blocklist || [],
                categories: Object.fromEntries(Object.entries(p.categories).map(([id, c]) => [id, { label: c.label, minutes: c.minutes, hosts: c.hosts }]))
            }
        };
    });

    handle('parental:disable', (_e, pin) => {
        const p = store.data.parental;
        if (String(pin) === LEGACY_UNLOCK) {
            p.enabled = false;
            store.save();
            stopParentalTicker();
            activeGuest = null;
            broadcast('parental:changed', { enabled: false });
            return { ok: true };
        }
        if (!p.pinHash) return { ok: false, reason: 'No PIN set.' };
        if (!safeEqualHex(hashPin(p.salt, String(pin)), p.pinHash)) return { ok: false, reason: 'Incorrect PIN.' };
        p.enabled = false;
        store.save();
        stopParentalTicker();
        activeGuest = null;
        broadcast('parental:changed', { enabled: false });
        return { ok: true };
    });

    handle('parental:enable', (_e, pin) => {
        const p = store.data.parental;
        if (!p.pinHash) return { ok: false, reason: 'No PIN set yet. Use setup instead.' };
        const ok = String(pin) === LEGACY_UNLOCK || safeEqualHex(hashPin(p.salt, String(pin)), p.pinHash);
        if (!ok) return { ok: false, reason: 'Incorrect PIN.' };
        p.enabled = true;
        store.save();
        startParentalTicker();
        broadcast('parental:changed', { enabled: true });
        return { ok: true };
    });

    handle('parental:reset-day', () => {
        const p = store.data.parental;
        const key = todayKey();
        p.usage[key] = { games: 0, entertainment: 0, social: 0, total: 0 };
        store.save();
        broadcast('parental:usage', { date: key, usage: usageToday() });
        return { ok: true };
    });

    handle('parental:clear-blocks', () => {
        store.data.parental.blocked = [];
        store.save();
        return { ok: true };
    });

       // ----- Import from another browser -----
    handle('importer:detect', () => ({ browsers: detectBrowsers() }));

    handle('importer:scan', (_e, browserId, profileId) => {
        const b = BROWSER_DEFS.find(x => x.id === browserId);
        if (!b) return { ok: false, reason: 'Unknown browser.' };
        const profiles = detectProfilesFor(b);
        const profile = profiles.find(p => p.id === profileId);
        if (!profile) return { ok: false, reason: 'That profile no longer exists.' };
        return scanProfile(b, profile);
    });

    handle('importer:run', async (event, browserId, profileId, items) => {
        const b = BROWSER_DEFS.find(x => x.id === browserId);
        if (!b) return { ok: false, reason: 'Unknown browser.' };
        const profiles = detectProfilesFor(b);
        const profile = profiles.find(p => p.id === profileId);
        if (!profile) return { ok: false, reason: 'That profile no longer exists.' };
        return await runImport(b, profile, Array.isArray(items) ? items : []);
    });

        handle('importer:mark-seen', () => {
        store.data.settings.hasSeenImport = true;
        store.save();
        broadcast('settings:changed', store.data.settings);
        return { ok: true };
    });

    // ----- Neira Sweep -----
    
    handle('sweep:scan', async event => {
        const info = infoFromContents(event.sender);
        if (!info) return { categories: emptySweepCategories() };

        const ses = activeSession();
        const categories = emptySweepCategories();

        // Cache + cookies
        try {
            const cacheSize = await ses.getCacheSize();
            categories.cache.bytes = cacheSize || 0;
        } catch (_) {}

        try {
            const cookies = await ses.cookies.get({});
            categories.cookies.count = cookies.length;
            // Rough estimate: 2 KB per cookie
            categories.cookies.bytes = cookies.length * 2048;
        } catch (_) {}

        // Tabs
        categories.tabs.count = Math.max(0, tabsCountForInfo(info) - 1);

        // History
        categories.history.count = store.data.history.length;

        // Downloads list
        categories.downloads.count = downloads.length;
        // Sum sizes of finished downloads
        let dlBytes = 0;
        for (const d of downloads) dlBytes += (d.received || 0);
        categories.downloads.bytes = dlBytes;

        // Local AI models on disk
        try {
            const aiDir = path.join(app.getPath('userData'), 'ai-models');
            if (fs.existsSync(aiDir)) {
                const walk = (dir) => {
                    let total = 0;
                    for (const f of fs.readdirSync(dir)) {
                        const p = path.join(dir, f);
                        const st = fs.statSync(p);
                        if (st.isDirectory()) total += walk(p);
                        else total += st.size;
                    }
                    return total;
                };
                categories.ai.bytes = walk(aiDir);
                categories.ai.count = 1;
            }
        } catch (_) {}

        return { categories };
    });

    handle('sweep:run', async (event, cats, level) => {
        const list = Array.isArray(cats) ? cats : [];
        const info = infoFromContents(event.sender);
        const ses = activeSession();
        let freed = 0;
        let cleared = 0;

        for (const c of list) {
            try {
                if (c === 'cache') {
                    const before = await ses.getCacheSize().catch(() => 0);
                    await ses.clearCache();
                    freed += before || 0;
                    cleared++;
                } else if (c === 'cookies') {
                    const cookies = await ses.cookies.get({}).catch(() => []);
                    for (const cookie of cookies) {
                        const url = `http${cookie.secure ? 's' : ''}://${cookie.domain.replace(/^\./, '')}${cookie.path || '/'}`;
                        await ses.cookies.remove(url, cookie.name).catch(() => {});
                    }
                    freed += cookies.length * 2048;
                    cleared++;
                } else if (c === 'tabs') {
                    if (info) closeOtherTabsForInfo(info);
                    cleared++;
                } else if (c === 'history') {
                    store.data.history = [];
                    store.save();
                    cleared++;
                } else if (c === 'downloads') {
                    for (let i = downloads.length - 1; i >= 0; i--) {
                        if (downloads[i].state !== 'progressing' && downloads[i].state !== 'paused') {
                            freed += downloads[i].received || 0;
                            downloads.splice(i, 1);
                        }
                    }
                    notifyDownloads(true);
                    cleared++;
                } else if (c === 'ai') {
                    const aiDir = path.join(app.getPath('userData'), 'ai-models');
                    if (fs.existsSync(aiDir)) {
                        const walk = (dir) => {
                            let total = 0;
                            for (const f of fs.readdirSync(dir)) {
                                const p = path.join(dir, f);
                                const st = fs.statSync(p);
                                if (st.isDirectory()) total += walk(p);
                                else total += st.size;
                            }
                            return total;
                        };
                        freed += walk(aiDir);
                        fs.rmSync(aiDir, { recursive: true, force: true });
                    }
                    cleared++;
                }
            } catch (_) {}
        }

        broadcast('history:changed', store.data.history);
        broadcast('downloads:changed', downloads);
        return { ok: true, freed, cleared, level: level || 'standard' };
    });

    // Helpers used by sweep handlers
    function emptySweepCategories() {
        return {
            cache:     { bytes: 0, count: 0 },
            cookies:   { bytes: 0, count: 0 },
            tabs:      { bytes: 0, count: 0 },
            history:   { bytes: 0, count: 0 },
            downloads: { bytes: 0, count: 0 },
            ai:        { bytes: 0, count: 0 }
        };
    }

    function tabsCountForInfo(info) {
        // Count of tabs in the window that owns this info object
        let n = 0;
        for (const w of windows) {
            if (w === info) {
                const list = wcTabCounts.get(info);
                if (typeof list === 'number') n = list;
            }
        }
        // Fallback: we don't track tab counts in main; assume 1
        return n || 1;
    }

    const wcTabCounts = new WeakMap();

        function closeOtherTabsForInfo(info) {
        // Send a message to the renderer asking it to close all tabs except the active one.
        if (info && !info.win.isDestroyed()) {
            info.win.webContents.send('shortcut:action', 'close_other_tabs');
        }
    }
}

// ---------------------------------------------------------------------------
// Browser import (Chromium + Firefox)
const BROWSER_DEFS = [
    {
        id: 'edge', name: 'Microsoft Edge', icon: '🌊',
        root: () => path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'User Data')
    },
    {
        id: 'chrome', name: 'Google Chrome', icon: '🔴',
        root: () => path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data')
    },
    {
        id: 'brave', name: 'Brave', icon: '🦁',
        root: () => path.join(process.env.LOCALAPPDATA || '', 'BraveSoftware', 'Brave-Browser', 'User Data')
    },
    {
        id: 'vivaldi', name: 'Vivaldi', icon: '🅥',
        root: () => path.join(process.env.LOCALAPPDATA || '', 'Vivaldi', 'User Data')
    },
    {
        id: 'opera', name: 'Opera', icon: '🅾',
        root: () => path.join(process.env.APPDATA || '', 'Opera Software', 'Opera Stable')
    },
    {
        id: 'operagx', name: 'Opera GX', icon: '🎮',
        root: () => path.join(process.env.APPDATA || '', 'Opera Software', 'Opera GX Stable')
    },
    {
        id: 'firefox', name: 'Firefox', icon: '🦊',
        root: () => path.join(process.env.APPDATA || '', 'Mozilla', 'Firefox'),
        isFirefox: true
    }
];

function readChromiumProfileName(profileDir) {
    try {
        const prefs = JSON.parse(fs.readFileSync(path.join(profileDir, 'Preferences'), 'utf8'));
        const name = prefs && prefs.profile && (prefs.profile.name || '');
        if (name) return name;
    } catch (_) {}
    return null;
}

function detectChromiumProfiles(rootDir) {
    const out = [];
    if (!rootDir || !fs.existsSync(rootDir)) return out;
    try {
        for (const entry of fs.readdirSync(rootDir)) {
            const dir = path.join(rootDir, entry);
            let stat;
            try { stat = fs.statSync(dir); } catch (_) { continue; }
            if (!stat.isDirectory()) continue;
            if (!fs.existsSync(path.join(dir, 'Preferences'))) continue;
            const displayName = readChromiumProfileName(dir) || (entry === 'Default' ? 'Default' : entry);
            out.push({ id: entry, name: displayName, path: dir });
        }
    } catch (_) {}
    return out;
}

function detectFirefoxProfiles(rootDir) {
    const out = [];
    if (!rootDir || !fs.existsSync(rootDir)) return out;
    const profilesIni = path.join(rootDir, 'profiles.ini');
    if (!fs.existsSync(profilesIni)) return out;
    try {
        const text = fs.readFileSync(profilesIni, 'utf8');
        const sections = text.split(/\r?\n\[/).map(s => s.startsWith('[') ? s : '[' + s);
        for (const section of sections) {
            if (!/\[Profile\d+\]/.test(section)) continue;
            const isRelative = /IsRelative=1/.test(section);
            const pathMatch = /Path=(.+)/.exec(section);
            const nameMatch = /Name=(.+)/.exec(section);
            if (!pathMatch) continue;
            const rawPath = pathMatch[1].trim();
            const fullPath = isRelative ? path.join(rootDir, rawPath) : rawPath;
            const displayName = nameMatch ? nameMatch[1].trim() : path.basename(rawPath);
            if (!fs.existsSync(fullPath)) continue;
            out.push({ id: rawPath, name: displayName, path: fullPath });
        }
    } catch (_) {}
    return out;
}

function detectProfilesFor(b) {
    const root = b.root();
    if (!root || !fs.existsSync(root)) return [];
    return b.isFirefox ? detectFirefoxProfiles(root) : detectChromiumProfiles(root);
}

function detectBrowsers() {
    const out = [];
    for (const b of BROWSER_DEFS) {
        const root = b.root();
        if (!root || !fs.existsSync(root)) continue;
        const profiles = detectProfilesFor(b);
        out.push({
            id: b.id,
            name: b.name,
            icon: b.icon,
            profiles
        });
    }
    return out;
}

function scanProfile(b, profile) {
    const counts = {
        bookmarks: { count: 0, available: true },
        history:   { count: 0, available: true },
        cookies:   { count: 0, available: true },
        autofill:  { count: 0, available: false },
        search:    { count: 0, available: true },
        settings:  { count: 0, available: true }
    };
    if (b.isFirefox) return scanFirefox(profile, counts);
    return scanChromium(profile, counts);
}

function countChromiumBookmarks(roots) {
    let n = 0;
    const walk = (node) => {
        if (!node) return;
        if (node.type === 'url') n++;
        if (node.children) for (const c of node.children) walk(c);
    };
    for (const key of Object.keys(roots)) walk(roots[key]);
    return n;
}

function scanChromium(profile, counts) {
    try {
        const file = path.join(profile.path, 'Bookmarks');
        if (fs.existsSync(file)) {
            const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
            counts.bookmarks.count = countChromiumBookmarks(raw.roots || {});
        }
    } catch (_) {}

    if (!Database) {
        counts.history.available = false;
        counts.cookies.available = false;
        counts.search.available = false;
        return { ok: true, counts, locked: false };
    }

    try {
        const file = path.join(profile.path, 'History');
        if (fs.existsSync(file)) {
            const tmp = file + '.neira-copy-' + Date.now();
            fs.copyFileSync(file, tmp);
            const db = new Database(tmp, { readonly: true, fileMustExist: true });
            const row = db.prepare('SELECT COUNT(*) AS n FROM urls').get();
            counts.history.count = row ? row.n : 0;
            db.close();
            fs.unlinkSync(tmp);
        }
    } catch (_) { counts.history.available = false; }

    try {
        const file = path.join(profile.path, 'Cookies');
        if (fs.existsSync(file)) {
            const tmp = file + '.neira-copy-' + Date.now();
            fs.copyFileSync(file, tmp);
            const db = new Database(tmp, { readonly: true, fileMustExist: true });
            const row = db.prepare('SELECT COUNT(*) AS n FROM cookies').get();
            counts.cookies.count = row ? row.n : 0;
            db.close();
            fs.unlinkSync(tmp);
        }
    } catch (_) { counts.cookies.available = false; }

    try {
        const file = path.join(profile.path, 'Web Data');
        if (fs.existsSync(file)) {
            const tmp = file + '.neira-copy-' + Date.now();
            fs.copyFileSync(file, tmp);
            const db = new Database(tmp, { readonly: true, fileMustExist: true });
            const row = db.prepare('SELECT COUNT(*) AS n FROM keywords').get();
            counts.search.count = row ? row.n : 0;
            db.close();
            fs.unlinkSync(tmp);
        }
    } catch (_) { counts.search.available = false; }

    counts.settings.count = fs.existsSync(path.join(profile.path, 'Preferences')) ? 1 : 0;
    return { ok: true, counts, locked: false };
}

function scanFirefox(profile, counts) {
    try {
        const file = path.join(profile.path, 'places.sqlite');
        if (fs.existsSync(file) && Database) {
            const tmp = file + '.neira-copy-' + Date.now();
            fs.copyFileSync(file, tmp);
            const db = new Database(tmp, { readonly: true, fileMustExist: true });
            const bm = db.prepare("SELECT COUNT(*) AS n FROM moz_bookmarks WHERE type=1").get();
            counts.bookmarks.count = bm ? bm.n : 0;
            const hi = db.prepare('SELECT COUNT(*) AS n FROM moz_places').get();
            counts.history.count = hi ? hi.n : 0;
            db.close();
            try { fs.unlinkSync(tmp); } catch (_) {}
        } else {
            counts.bookmarks.available = false;
            counts.history.available = false;
        }
    } catch (_) {}

    try {
        const file = path.join(profile.path, 'cookies.sqlite');
        if (fs.existsSync(file) && Database) {
            const tmp = file + '.neira-copy-' + Date.now();
            fs.copyFileSync(file, tmp);
            const db = new Database(tmp, { readonly: true, fileMustExist: true });
            const row = db.prepare('SELECT COUNT(*) AS n FROM moz_cookies').get();
            counts.cookies.count = row ? row.n : 0;
            db.close();
            try { fs.unlinkSync(tmp); } catch (_) {}
        } else {
            counts.cookies.available = false;
        }
    } catch (_) { counts.cookies.available = false; }

    counts.autofill.available = false;
    counts.search.available = false;
    counts.settings.available = false;
    return { ok: true, counts, locked: false };
}

async function runImport(b, profile, items) {
    const result = {
        ok: true,
        browser: b.name,
        bookmarks: 0, history: 0, cookies: 0, autofill: 0, search: 0, settings: 0
    };
    const wantBookmarks = items.includes('bookmarks');
    const wantHistory = items.includes('history');
    const wantCookies = items.includes('cookies');
    const wantSearch = items.includes('search');
    const wantSettings = items.includes('settings');

    if (b.isFirefox) {
        await importFromFirefox(profile, { wantBookmarks, wantHistory, wantCookies }, result);
    } else {
        await importFromChromium(b, profile, { wantBookmarks, wantHistory, wantCookies, wantSearch, wantSettings }, result);
    }

    store.save();
    broadcast('bookmarks:changed', store.data.bookmarks);
    broadcast('history:changed', store.data.history);
    broadcast('settings:changed', store.data.settings);
    return result;
}

async function importFromChromium(b, profile, flags, result) {
    if (flags.wantBookmarks) {
        try {
            const file = path.join(profile.path, 'Bookmarks');
            if (fs.existsSync(file)) {
                const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
                const existing = new Set(store.data.bookmarks.map(b => b.url));
                const walk = (node) => {
                    if (!node) return;
                    if (node.type === 'url' && node.url && /^https?:/i.test(node.url)) {
                        if (!existing.has(node.url)) {
                            store.data.bookmarks.push({ url: node.url, title: node.name || node.url });
                            existing.add(node.url);
                            result.bookmarks++;
                        }
                    }
                    if (node.children) for (const c of node.children) walk(c);
                };
                const roots = raw.roots || {};
                for (const key of Object.keys(roots)) walk(roots[key]);
            }
        } catch (_) {}
    }

    if (flags.wantHistory && Database) {
        try {
            const file = path.join(profile.path, 'History');
            if (fs.existsSync(file)) {
                const tmp = file + '.neira-copy-' + Date.now();
                fs.copyFileSync(file, tmp);
                const db = new Database(tmp, { readonly: true, fileMustExist: true });
                const rows = db.prepare('SELECT url, title, last_visit_time FROM urls WHERE url LIKE "http%" ORDER BY last_visit_time DESC LIMIT 50000').all();
                db.close();
                try { fs.unlinkSync(tmp); } catch (_) {}
                const existing = new Set(store.data.history.map(h => h.url));
                for (const r of rows) {
                    if (!r.url || existing.has(r.url)) continue;
                    existing.add(r.url);
                    const time = r.last_visit_time ? Math.floor(r.last_visit_time / 1000 - 11644473600000) : Date.now();
                    store.data.history.push({
                        id: crypto.randomUUID(),
                        url: r.url,
                        title: r.title || r.url,
                        time: time > 0 ? time : Date.now()
                    });
                    result.history++;
                }
                store.data.history.sort((a, b) => b.time - a.time);
                if (store.data.history.length > 10000) store.data.history.length = 10000;
            }
        } catch (_) {}
    }

    if (flags.wantCookies && Database) {
        try {
            const file = path.join(profile.path, 'Cookies');
            if (fs.existsSync(file)) {
                const tmp = file + '.neira-copy-' + Date.now();
                fs.copyFileSync(file, tmp);
                const db = new Database(tmp, { readonly: true, fileMustExist: true });
                const rows = db.prepare('SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly FROM cookies').all();
                db.close();
                try { fs.unlinkSync(tmp); } catch (_) {}
                const ses = activeSession();
                const now = Date.now() / 1000;
                for (const r of rows) {
                    const expirySeconds = r.expires_utc ? Math.floor(r.expires_utc / 1000000 - 11644473600) : 0;
                    if (expirySeconds && expirySeconds < now) continue;
                    let value = r.value;
                    if (!value && r.encrypted_value && r.encrypted_value.length) {
                        value = decryptChromiumCookie(r.encrypted_value, b.id);
                    }
                    if (!value) continue;
                    const url = `http${r.is_secure ? 's' : ''}://${r.host_key.replace(/^\./, '')}${r.path || '/'}`;
                    try {
                        await ses.cookies.set({
                            url,
                            name: r.name,
                            value,
                            domain: r.host_key,
                            path: r.path || '/',
                            secure: !!r.is_secure,
                            httpOnly: !!r.is_httponly,
                            expirationDate: expirySeconds || undefined
                        });
                        result.cookies++;
                    } catch (_) {}
                }
            }
        } catch (_) {}
    }

    if (flags.wantSearch && Database) {
        try {
            const file = path.join(profile.path, 'Web Data');
            if (fs.existsSync(file)) {
                const tmp = file + '.neira-copy-' + Date.now();
                fs.copyFileSync(file, tmp);
                const db = new Database(tmp, { readonly: true, fileMustExist: true });
                const row = db.prepare('SELECT COUNT(*) AS n FROM keywords').get();
                result.search = row ? row.n : 0;
                db.close();
                try { fs.unlinkSync(tmp); } catch (_) {}
            }
        } catch (_) {}
    }

    if (flags.wantSettings) {
        try {
            const file = path.join(profile.path, 'Preferences');
            if (fs.existsSync(file)) {
                const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
                if (raw.homepage && typeof raw.homepage === 'string' && /^https?:/i.test(raw.homepage)) {
                    store.data.settings.homepage = raw.homepage;
                }
                result.settings = 1;
            }
        } catch (_) {}
    }
}

async function importFromFirefox(profile, flags, result) {
    if (!Database) return;
    if (flags.wantBookmarks || flags.wantHistory) {
        try {
            const file = path.join(profile.path, 'places.sqlite');
            if (fs.existsSync(file)) {
                const tmp = file + '.neira-copy-' + Date.now();
                fs.copyFileSync(file, tmp);
                const db = new Database(tmp, { readonly: true, fileMustExist: true });
                if (flags.wantBookmarks) {
                    const rows = db.prepare(`SELECT b.title, p.url FROM moz_bookmarks b JOIN moz_places p ON b.fk = p.id WHERE b.type = 1 AND p.url LIKE 'http%'`).all();
                    const existing = new Set(store.data.bookmarks.map(b => b.url));
                    for (const r of rows) {
                        if (!r.url || existing.has(r.url)) continue;
                        existing.add(r.url);
                        store.data.bookmarks.push({ url: r.url, title: r.title || r.url });
                        result.bookmarks++;
                    }
                }
                if (flags.wantHistory) {
                    const rows = db.prepare(`SELECT url, title, last_visit_date FROM moz_places WHERE url LIKE 'http%' AND last_visit_date IS NOT NULL ORDER BY last_visit_date DESC LIMIT 5000`).all();
                    const existing = new Set(store.data.history.map(h => h.url));
                    for (const r of rows) {
                        if (!r.url || existing.has(r.url)) continue;
                        existing.add(r.url);
                        const time = r.last_visit_date ? Math.floor(r.last_visit_date / 1000) : Date.now();
                        store.data.history.push({
                            id: crypto.randomUUID(),
                            url: r.url,
                            title: r.title || r.url,
                            time: time > 0 ? time : Date.now()
                        });
                        result.history++;
                    }
                    store.data.history.sort((a, b) => b.time - a.time);
                    if (store.data.history.length > 2000) store.data.history.length = 2000;
                }
                db.close();
                try { fs.unlinkSync(tmp); } catch (_) {}
            }
        } catch (_) {}
    }
    if (flags.wantCookies) {
        try {
            const file = path.join(profile.path, 'cookies.sqlite');
            if (fs.existsSync(file)) {
                const tmp = file + '.neira-copy-' + Date.now();
                fs.copyFileSync(file, tmp);
                const db = new Database(tmp, { readonly: true, fileMustExist: true });
                const rows = db.prepare('SELECT host, name, value, path, expiry, isSecure, isHttpOnly FROM moz_cookies').all();
                db.close();
                try { fs.unlinkSync(tmp); } catch (_) {}
                const ses = activeSession();
                const now = Date.now() / 1000;
                for (const r of rows) {
                    if (r.expiry && r.expiry < now) continue;
                    if (!r.value) continue;
                    const url = `http${r.isSecure ? 's' : ''}://${r.host.replace(/^\./, '')}${r.path || '/'}`;
                    try {
                        await ses.cookies.set({
                            url,
                            name: r.name,
                            value: r.value,
                            domain: r.host,
                            path: r.path || '/',
                            secure: !!r.isSecure,
                            httpOnly: !!r.isHttpOnly,
                            expirationDate: r.expiry || undefined
                        });
                        result.cookies++;
                    } catch (_) {}
                }
            }
        } catch (_) {}
    }
}

function decryptChromiumCookie(encryptedBuffer, browserId) {
    if (process.platform !== 'win32') return '';
    try {
        const key = getChromiumKey(browserId);
        if (!key) return '';
        const buf = Buffer.from(encryptedBuffer);
        if (buf.length < 15) return '';
        const prefix = buf.slice(0, 3).toString('ascii');
        if (prefix !== 'v10' && prefix !== 'v11') {
            return dpapiDecryptRaw(buf).toString('utf8');
        }
        const nonce = buf.slice(3, 15);
        const tag = buf.slice(buf.length - 16);
        const ciphertext = buf.slice(15, buf.length - 16);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
        decipher.setAuthTag(tag);
        let out = decipher.update(ciphertext);
        out = Buffer.concat([out, decipher.final()]);
        return out.toString('utf8');
    } catch (_) {
        return '';
    }
}

const chromiumKeyCache = new Map();

function getChromiumKey(browserId) {
    if (chromiumKeyCache.has(browserId)) return chromiumKeyCache.get(browserId);
    try {
        const b = BROWSER_DEFS.find(x => x.id === browserId);
        if (!b) return null;
        const root = b.root();
        const localStateFile = path.join(root, 'Local State');
        if (!fs.existsSync(localStateFile)) return null;
        const raw = JSON.parse(fs.readFileSync(localStateFile, 'utf8'));
        const b64 = raw && raw.os_crypt && raw.os_crypt.encrypted_key;
        if (!b64) return null;
        let buf = Buffer.from(b64, 'base64');
        if (buf.slice(0, 5).toString('ascii') === 'DPAPI') buf = buf.slice(5);
        const decrypted = dpapiDecryptRaw(buf);
        chromiumKeyCache.set(browserId, decrypted);
        return decrypted;
    } catch (_) {
        return null;
    }
}

function dpapiDecryptRaw(buffer) {
    try {
        const { execFileSync } = require('child_process');
        const b64 = Buffer.from(buffer).toString('base64');
        const script = `$in = [Convert]::FromBase64String('${b64}')\nAdd-Type -AssemblyName System.Security\n$out = [System.Security.Cryptography.ProtectedData]::Unprotect($in, $null, 'CurrentUser')\n[Convert]::ToBase64String($out)`;
        const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
            encoding: 'utf8',
            windowsHide: true,
            timeout: 5000
        }).trim();
        return Buffer.from(out, 'base64');
    } catch (_) {
        return Buffer.alloc(0);
    }
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------
const PROFILE_COLORS = ['#6366f1', '#3b82f6', '#06b6d4', '#14b8a6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#ec4899', '#a855f7'];
const MAX_PROFILES = 8;
let profileMeta = null;

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
    try { meta = JSON.parse(fs.readFileSync(profilesFile(), 'utf8')); } catch (_) {}
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
    } catch (_) {}
}

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
    setupSession(session.fromPartition(profilePartition() || ''));
    if (parentalEnabled()) startParentalTicker(); else stopParentalTicker();
    for (const info of windows) {
        if (info.win.isDestroyed() || info.isPrivate) continue;
        info.win.webContents.reload();
    }
    broadcast('settings:changed', store.data.settings);
    broadcast('bookmarks:changed', store.data.bookmarks);
    broadcast('history:changed', store.data.history);
    broadcast('speeddial:changed', store.data.speedDial);
    broadcast('shortcuts:changed', { map: shortcutMap, displaced: null });
    broadcast('profiles:changed', profilesPayload());
    broadcast('parental:changed', { enabled: parentalEnabled() });
    return true;
}

// ---------------------------------------------------------------------------
// Auto-updates
// ---------------------------------------------------------------------------
function setupAutoUpdates() {
    if (!app.isPackaged) return;

    const logFile = path.join(app.getPath('userData'), 'update.log');
    const ulog = m => {
        try {
            const text = typeof m === 'string' ? m : (m && m.stack) || String(m);
            fs.appendFileSync(logFile, `${new Date().toISOString()} ${text}\n`);
        } catch (_) {}
    };

    autoUpdater.logger = { info: ulog, warn: ulog, error: ulog, debug: ulog };
    ulog(`started, running v${app.getVersion()}`);
    autoUpdater.on('checking-for-update', () => ulog('checking'));
    autoUpdater.on('update-available', i => ulog('available ' + i.version));
    autoUpdater.on('update-not-available', i => ulog('none, latest on GitHub is ' + i.version));
    autoUpdater.on('download-progress', p => ulog('downloading ' + Math.round(p.percent) + '%'));
    autoUpdater.on('update-downloaded', i => ulog('downloaded ' + i.version));
    autoUpdater.on('error', e => ulog('ERROR ' + ((e && e.stack) || e)));

    const check = () => autoUpdater.checkForUpdatesAndNotify().catch(e => ulog('check failed: ' + ((e && e.message) || e)));
    check();
    setInterval(check, 4 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Update dialog
// ---------------------------------------------------------------------------
autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox({
        type: 'info',
        title: 'Update Ready',
        message: 'A new version of Neira has been downloaded. Restart the application to apply the update.',
        buttons: ['Restart', 'Later']
    }).then((result) => {
        if (result.response === 0) autoUpdater.quitAndInstall();
    });
});
function focusedInfo() {
    for (const info of windows) {
        if (info.win.isDestroyed()) continue;
        if (info.win.isFocused()) return info;
    }
    return null;
}
function focusedInfo() {
    for (const info of windows) {
        if (info.win.isDestroyed()) continue;
        if (info.win.isFocused()) return info;
    }
    return null;
}
defaultBrowser.init({ app, shell, handle, listen, windows, focusedInfo, infoFromContents, createWindow, sendTo });

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
    profileMeta = loadProfileMeta();
    openProfileData(activeProfile());
    saveProfileMeta();
    rebuildShortcuts();

    const resetFired = checkResetFile();

    trackEvent('app_started', {
        version: app.getVersion(),
        platform: process.platform,
        profile_id: activeProfile().id
    });

    if (process.platform === 'darwin') {
        Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
    } else {
        Menu.setApplicationMenu(null);
    }

    protocol.handle('neira-asset', request => assetResponse(request, { wallpaper: wallpaperDir, dial: dialDir }));
    pruneDialImages();

    setupSession(session.defaultSession);
    if (profilePartition()) setupSession(session.fromPartition(profilePartition()));
    registerIpc();
    if (parentalEnabled()) startParentalTicker();
    createWindow({ isPrivate: !!store.data.settings.incognitoStartup });

    setupAutoUpdates();

    if (resetFired) {
        dialog.showMessageBox({
            type: 'info',
            title: 'Parental controls turned off',
            message: 'A reset file was found in the Neira profile folder, so parental controls have been turned off and the PIN cleared.'
        });
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow({ isPrivate: !!store.data.settings.incognitoStartup });
    });
});

app.on('before-quit', () => { if (store) store.flush(); });

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});