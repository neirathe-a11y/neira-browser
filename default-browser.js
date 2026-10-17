'use strict';
// Lets Neira act as the computer's default browser and as the app that opens PDFs, web pages and media files.
//
//  - One window family: opening a link or file while Neira is running adds a tab to the open window.
//  - Reads the link or file from the command line (Windows/Linux) and from open-url/open-file (macOS).
//  - Settings page: shows whether Neira is the default and opens the system place where you choose it.
//
// Windows only lets the *user* pick a default browser, so Neira registers itself in
// "Settings > Apps > Default apps" (per user, no admin needed) every time the installed app starts.
// Because it lives in the app, everyone who updates gets it; no installer script is needed.
// The button on the Settings page just takes people to the Windows page where they pick Neira.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { pathToFileURL, fileURLToPath } = require('url');

// Files Neira offers to open. (Chromium shows PDFs with its built-in viewer.)
const OPEN_EXT = new Set([
    '.pdf', '.html', '.htm', '.xhtml', '.svg',
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.webm'
]);
const MAX_URLS = 8;
const READY_FALLBACK_MS = 3000; // if the page never says it is ready (older app.js), treat it as ready after this

// The links and files in a command line, as URLs. isDevRun: started with `electron .` instead of the installed exe.
function urlsFromArgv(argv, cwd, isDevRun) {
    const out = [];
    for (const arg of argv.slice(isDevRun ? 2 : 1)) {
        if (out.length >= MAX_URLS) break;
        if (!arg || arg.startsWith('-')) continue; // Chromium/Electron switches
        if (/^https?:\/\//i.test(arg)) { if (arg.length < 8192) out.push(arg); continue; }
        let file = arg;
        if (/^file:\/\//i.test(arg)) {
            try { file = fileURLToPath(arg); } catch (_) { continue; }
        }
        if (!OPEN_EXT.has(path.extname(file).toLowerCase())) continue;
        const full = path.resolve(cwd || process.cwd(), file);
        if (fs.existsSync(full)) out.push(pathToFileURL(full).href);
    }
    return out;
}

// One value out of `reg query` output, or ''.
function parseRegValue(stdout, name) {
    const m = new RegExp('(?:^|\\s)' + name + '\\s+REG_\\w+\\s+([^\\r\\n]+)', 'i').exec(String(stdout));
    return m ? m[1].trim() : '';
}

function regValue(key, name) {
    return new Promise(resolve => {
        execFile('reg', ['query', key, '/v', name], { windowsHide: true, timeout: 4000 }, (err, stdout) => {
            resolve(err ? '' : parseRegValue(stdout, name));
        });
    });
}

// ---------------------------------------------------------------------------
// Windows: register Neira as a browser / PDF viewer candidate (HKEY_CURRENT_USER only)
// ---------------------------------------------------------------------------
const REG_SCHEMA = 1; // bump to rewrite the entries on the next start
const REGISTERED_EXT = ['.pdf', '.html', '.htm', '.xhtml', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.webm'];

const regEscape = text => String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

// The text of a .reg file that registers the app at `exe`.
function buildRegFile(exe) {
    const command = regEscape('"' + exe + '"');
    const commandWithFile = regEscape('"' + exe + '" "%1"');
    const icon = regEscape(exe + ',0');
    const lines = ['Windows Registry Editor Version 5.00', ''];
    const key = (subkey, values) => {
        lines.push('[HKEY_CURRENT_USER\\' + subkey + ']');
        for (const [name, data] of values) lines.push((name === '' ? '@' : '"' + name + '"') + '=' + data);
        lines.push('');
    };
    const text = v => '"' + regEscape(v) + '"';
    const raw = v => '"' + v + '"'; // already escaped

    key('Software\\Classes\\NeiraURL', [['', text('Neira URL')], ['URL Protocol', text('')]]);
    key('Software\\Classes\\NeiraURL\\DefaultIcon', [['', raw(icon)]]);
    key('Software\\Classes\\NeiraURL\\shell\\open\\command', [['', raw(commandWithFile)]]);
    key('Software\\Classes\\NeiraFile', [['', text('Neira Document')]]);
    key('Software\\Classes\\NeiraFile\\DefaultIcon', [['', raw(icon)]]);
    key('Software\\Classes\\NeiraFile\\shell\\open\\command', [['', raw(commandWithFile)]]);

    const app = 'Software\\Clients\\StartMenuInternet\\Neira';
    key(app, [['', text('Neira')]]);
    key(app + '\\DefaultIcon', [['', raw(icon)]]);
    key(app + '\\shell\\open\\command', [['', raw(command)]]);
    key(app + '\\Capabilities', [
        ['ApplicationName', text('Neira')],
        ['ApplicationDescription', text('Neira Browser')],
        ['ApplicationIcon', raw(icon)]
    ]);
    key(app + '\\Capabilities\\URLAssociations', [['http', text('NeiraURL')], ['https', text('NeiraURL')]]);
    key(app + '\\Capabilities\\FileAssociations', REGISTERED_EXT.map(ext => [ext, text('NeiraFile')]));
    for (const ext of REGISTERED_EXT) key('Software\\Classes\\' + ext + '\\OpenWithProgids', [['NeiraFile', 'hex(0):']]);
    key('Software\\RegisteredApplications', [['Neira', text('Software\\Clients\\StartMenuInternet\\Neira\\Capabilities')]]);
    return lines.join('\r\n');
}

function importRegFile(app, content) {
    return new Promise((resolve, reject) => {
        const file = path.join(app.getPath('temp'), 'neira-default-apps-' + process.pid + '.reg');
        try { fs.writeFileSync(file, '\ufeff' + content, 'utf16le'); } catch (e) { reject(e); return; }
        execFile('reg', ['import', file], { windowsHide: true, timeout: 15000 }, err => {
            try { fs.unlinkSync(file); } catch (_) { /* temp file */ }
            if (err) reject(err); else resolve();
        });
    });
}

// Writes the entries when they are missing, or the app moved/updated its registration format.
// Returns true when it wrote them.
async function ensureWindowsRegistration({ app, exe, query = regValue, importReg = content => importRegFile(app, content) }) {
    const markerFile = path.join(app.getPath('userData'), 'default-apps.json');
    let marker = {};
    try { marker = JSON.parse(fs.readFileSync(markerFile, 'utf8')); } catch (_) { /* first run */ }
    const present = await query('HKCU\\Software\\RegisteredApplications', 'Neira');
    if (present && marker.exe === exe && marker.schema === REG_SCHEMA) return false;
    await importReg(buildRegFile(exe));
    try { fs.writeFileSync(markerFile, JSON.stringify({ exe, schema: REG_SCHEMA })); } catch (_) { /* tries again next start */ }
    return true;
}

async function windowsStatus() {
    const [web, pdf, registered] = await Promise.all([
        regValue('HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice', 'ProgId'),
        regValue('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.pdf\\UserChoice', 'ProgId'),
        regValue('HKCU\\Software\\RegisteredApplications', 'Neira')
    ]);
    return { web: web === 'NeiraURL', pdf: pdf === 'NeiraFile', registered: !!registered };
}

// Returns false in a second copy of the app (which quits at once), true otherwise.
function init({ app, shell, handle, listen, windows, focusedInfo, infoFromContents, createWindow, sendTo }) {
    if (!app.requestSingleInstanceLock()) { app.exit(0); return false; }

    const isDevRun = !!process.defaultApp;
    // links and files this launch was started with; the first window opens them
    let pending = urlsFromArgv(process.argv, process.cwd(), isDevRun).map(url => ({ url, replaceStartTab: true }));
    const readyHosts = new WeakSet();
    const loadedAt = new WeakMap();
    let flushTimer = null;

    app.on('browser-window-created', (_e, win) => {
        const wc = win.webContents;
        wc.once('did-finish-load', () => loadedAt.set(wc, Date.now()));
    });

    const normalWindows = () => [...windows].filter(i => !i.isPrivate && !i.win.isDestroyed());
    const isReady = info => {
        const wc = info.win.webContents;
        return readyHosts.has(wc) || (loadedAt.has(wc) && Date.now() - loadedAt.get(wc) > READY_FALLBACK_MS);
    };

    function raise(info) {
        const win = info.win;
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
    }

    function flushTo(info) {
        if (!pending.length) return;
        const items = pending;
        pending = [];
        raise(info);
        items.forEach((item, i) => sendTo(info, 'open-url', item.url, { background: i > 0, replaceStartTab: !!item.replaceStartTab }));
    }

    // Sends the queue to a window as soon as one is ready (or makes one when none exists).
    function tryFlush(attempt = 0) {
        clearTimeout(flushTimer);
        if (!pending.length || !app.isReady()) return;
        const wins = normalWindows();
        if (!wins.length) { createWindow(); return; } // its renderer will report ready and flush the queue
        const focused = focusedInfo();
        const target = (focused && !focused.isPrivate && isReady(focused) && focused) || wins.find(isReady);
        if (target) { flushTo(target); return; }
        if (attempt < 30) flushTimer = setTimeout(() => tryFlush(attempt + 1), 500);
    }

    function open(urls) {
        if (!urls.length) { // started again with nothing to open: just bring Neira forward
            const focused = normalWindows()[0];
            if (focused) raise(focused); else if (app.isReady()) createWindow();
            return;
        }
        pending.push(...urls.map(url => ({ url })));
        tryFlush();
    }

    app.on('second-instance', (_e, argv, cwd) => open(urlsFromArgv(argv, cwd, isDevRun)));

    // macOS delivers links and files as events
    app.on('open-url', (event, url) => { event.preventDefault(); if (/^https?:\/\//i.test(url)) open([url]); });
    app.on('open-file', (event, file) => {
        event.preventDefault();
        if (OPEN_EXT.has(path.extname(file).toLowerCase())) open([pathToFileURL(file).href]);
    });

    app.whenReady().then(() => {
        if (pending.length) tryFlush();
        // installed Windows app: make sure Neira is listed in Settings > Default apps (runs quietly in the background)
        if (process.platform === 'win32' && app.isPackaged) {
            ensureWindowsRegistration({ app, exe: process.execPath }).catch(err => console.error('default apps registration failed:', err && err.message));
        }
    });

    // the browser window says its tabs are ready to receive links (app.js calls neira.rendererReady())
    listen('renderer:ready', event => {
        const info = infoFromContents(event.sender);
        if (!info) return;
        readyHosts.add(info.win.webContents);
        if (!info.isPrivate) flushTo(info);
    });

    // Settings page
    handle('defaultbrowser:status', async () => {
        if (process.platform === 'win32') return { platform: 'win32', ...(await windowsStatus()) };
        return {
            platform: process.platform,
            web: app.isDefaultProtocolClient('http') && app.isDefaultProtocolClient('https'),
            pdf: null,
            registered: true
        };
    });

    handle('defaultbrowser:set', async () => {
        if (!app.isPackaged) return { ok: false, reason: 'This only works in the installed app, not with npm start.' };
        if (process.platform === 'win32') {
            await shell.openExternal('ms-settings:defaultapps?registeredAppUser=Neira');
            return { ok: true, opened: 'settings' };
        }
        const ok = app.setAsDefaultProtocolClient('http') && app.setAsDefaultProtocolClient('https');
        return { ok, opened: 'system' };
    });

    return true;
}

module.exports = { init, urlsFromArgv, parseRegValue, buildRegFile, ensureWindowsRegistration };