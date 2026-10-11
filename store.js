'use strict';
const fs = require('fs');
const path = require('path');

// Minimal JSON store: `data` is a plain object you mutate, then call save().
function createStore(file, defaults) {
    const data = JSON.parse(JSON.stringify(defaults));
    try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        for (const key of Object.keys(defaults)) {
            if (parsed[key] === undefined) continue;
            const base = defaults[key];
            // Merge plain objects so new default keys appear after an update
            data[key] = (base && typeof base === 'object' && !Array.isArray(base))
                ? Object.assign({}, base, parsed[key])
                : parsed[key];
        }
    } catch (_) { /* first run or unreadable file: use defaults */ }

    let timer = null;
    function flush() {
        clearTimeout(timer);
        timer = null;
        try {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            const tmp = file + '.tmp';
            fs.writeFileSync(tmp, JSON.stringify(data));
            fs.renameSync(tmp, file);
        } catch (err) {
            console.error('Failed to save store:', err);
        }
    }
    function save() {
        if (!timer) timer = setTimeout(flush, 300);
    }
    return { data, save, flush };
}

module.exports = { createStore };