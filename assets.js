'use strict';
// Serves the user's wallpaper files (images and videos) through neira-asset://wallpaper/<file>, and the
// custom Speed Dial pictures through neira-asset://dial/<file>, to our own pages.
// Only files inside those two folders, with a safe generated name, can ever be reached.
// Range requests are supported so videos can loop and seek.
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const MIME = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
    mp4: 'video/mp4', webm: 'video/webm'
};
const VIDEO_EXT = new Set(['mp4', 'webm']);
const NAME_RE = /^[a-z0-9-]+\.(jpg|jpeg|png|webp|gif|mp4|webm)$/;

function plain(status, text) {
    return new Response(text, { status, headers: { 'Content-Type': 'text/plain' } });
}

// dirs: { wallpaper: <folder>, dial: <folder> }
function assetResponse(request, dirs) {
    let url;
    try { url = new URL(request.url); } catch (_) { return plain(400, 'Bad request'); }
    const dir = Object.prototype.hasOwnProperty.call(dirs, url.hostname) ? dirs[url.hostname] : null;
    if (!dir) return plain(404, 'Not found');

    let name;
    try { name = decodeURIComponent(url.pathname.slice(1)); } catch (_) { return plain(400, 'Bad request'); }
    if (!NAME_RE.test(name)) return plain(404, 'Not found');
    if (url.hostname === 'dial' && VIDEO_EXT.has(name.split('.').pop())) return plain(404, 'Not found');

    const file = path.join(dir, name);
    let size;
    try {
        const stat = fs.statSync(file);
        if (!stat.isFile()) return plain(404, 'Not found');
        size = stat.size;
    } catch (_) {
        return plain(404, 'Not found');
    }

    const type = MIME[name.split('.').pop()];
    const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes' };
    const range = request.headers.get('range');

    if (range) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
        if (!m || (m[1] === '' && m[2] === '')) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
        let start;
        let end;
        if (m[1] === '') { // suffix range: the last N bytes
            start = Math.max(0, size - Number(m[2]));
            end = size - 1;
        } else {
            start = Number(m[1]);
            end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
        }
        if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
        return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
            status: 206,
            headers: { ...base, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) }
        });
    }
    return new Response(Readable.toWeb(fs.createReadStream(file)), {
        status: 200,
        headers: { ...base, 'Content-Length': String(size) }
    });
}

module.exports = { assetResponse, MIME, VIDEO_EXT, NAME_RE };
