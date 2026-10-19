'use strict';
// Adds an "Interface options" group to the Appearance page.
// Self-contained: does not touch pages.js. Choices are remembered on this device.
(() => {
    const KEY = 'neiraUiExtras';
    const root = document.documentElement;
    const defaults = { size: 'default', corners: 'rounded', width: 'default', glass: false, calm: false };
    let s = { ...defaults };
    try { s = { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (_) {}

    const GROUPS = {
        size: { prefix: 'fs-', map: { small: 'fs-small', large: 'fs-large' } },
        corners: { map: { sharp: 'r-sharp', pill: 'r-pill' } },
        width: { map: { narrow: 'sb-narrow', wide: 'sb-wide' } }
    };

    function apply() {
        for (const [k, g] of Object.entries(GROUPS)) {
            for (const c of Object.values(g.map)) root.classList.remove(c);
            if (g.map[s[k]]) root.classList.add(g.map[s[k]]);
        }
        root.classList.toggle('glass', !!s.glass);
        root.classList.toggle('no-motion', !!s.calm);
    }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (_) {} apply(); }
    apply();

    function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; }

    function card(title, desc, control) {
        const c = el('div', 'setting-card');
        const info = el('div', 'setting-info');
        info.append(el('h3', '', title), el('p', '', desc));
        c.append(info, control);
        return c;
    }
    function seg(key, options) {
        const box = el('div', 'seg-x');
        box.setAttribute('role', 'group');
        for (const [value, label] of options) {
            const b = el('button', '', label);
            b.type = 'button';
            b.setAttribute('aria-pressed', String(s[key] === value));
            b.addEventListener('click', () => {
                s[key] = value; save();
                box.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
            });
            box.appendChild(b);
        }
        return box;
    }
    function toggle(key, label) {
        const w = el('label', 'switch');
        const i = document.createElement('input');
        i.type = 'checkbox'; i.checked = !!s[key]; i.setAttribute('aria-label', label);
        i.addEventListener('change', () => { s[key] = i.checked; save(); });
        w.append(i, el('span', 'slider'));
        return w;
    }

    function build() {
        const sec = document.getElementById('appearance');
        if (!sec || sec.querySelector('#ui-extras')) return;
        const wrap = el('div'); wrap.id = 'ui-extras';
        wrap.append(el('h2', 'sub-header', 'Interface options'));
        wrap.append(el('p', 'opt-note', 'Saved on this device. They change how these settings pages look.'));
        wrap.append(
            card('Text size', 'Make settings text smaller or larger.', seg('size', [['small', 'Small'], ['default', 'Default'], ['large', 'Large']])),
            card('Corner style', 'How round cards, buttons and inputs are.', seg('corners', [['sharp', 'Sharp'], ['rounded', 'Rounded'], ['pill', 'Pill']])),
            card('Sidebar width', 'Give the menu more or less room.', seg('width', [['narrow', 'Narrow'], ['default', 'Default'], ['wide', 'Wide']])),
            card('Glass cards', 'See-through cards with a blur effect.', toggle('glass', 'Glass cards')),
            card('Calm mode', 'Turn off animations and transitions on these pages.', toggle('calm', 'Calm mode'))
        );
        const reset = el('button', 'btn btn-small', 'Reset interface options');
        reset.type = 'button';
        reset.style.marginTop = '4px';
        reset.addEventListener('click', () => { s = { ...defaults }; save(); wrap.remove(); build(); });
        wrap.append(reset);
        sec.appendChild(wrap);
    }
    build();

    // ---- "Settings code" viewer (Privacy & Security page) ----
    const SECRET = /pin|pass|secret|recovery|token|hash|salt|key/i;
    function redact(v) {
        if (Array.isArray(v)) return v.map(redact);
        if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET.test(k) ? '••• hidden •••' : redact(x)]));
        return v;
    }
    async function collect() {
        const out = { interfaceOptions: s };
        try {
            const api = window.neira;
            out.browserSettings = api && api.settings && api.settings.get ? redact(await api.settings.get()) : 'not available on this page';
        } catch (_) { out.browserSettings = 'could not be read'; }
        return out;
    }
    function buildCode() {
        const sec = document.getElementById('privacy');
        if (!sec || sec.querySelector('#code-card')) return;
        const btn = el('button', 'btn', 'View settings code'); btn.type = 'button';
        const c = card('Settings code', 'See your current settings as code. Passwords, PINs and recovery codes are always hidden.', btn);
        c.id = 'code-card';
        const ov = el('div', 'modal-overlay'); ov.id = 'code-modal';
        const mc = el('div', 'modal-card wide'); mc.setAttribute('role', 'dialog'); mc.setAttribute('aria-label', 'Settings code');
        const pre = el('pre', 'code-view');
        const act = el('div', 'modal-actions');
        const copy = el('button', 'btn', 'Copy'); copy.type = 'button';
        const close = el('button', 'btn btn-primary', 'Close'); close.type = 'button';
        act.append(copy, close);
        mc.append(el('h3', '', 'Settings code'), pre, act); ov.appendChild(mc); document.body.appendChild(ov);
        const hide = () => { ov.classList.remove('active'); btn.focus(); };
        btn.addEventListener('click', async () => {
            pre.textContent = 'Loading…'; ov.classList.add('active'); close.focus();
            pre.textContent = JSON.stringify(await collect(), null, 2);
        });
        copy.addEventListener('click', async () => {
            try { await navigator.clipboard.writeText(pre.textContent); copy.textContent = 'Copied'; } catch (_) { copy.textContent = 'Could not copy'; }
            setTimeout(() => { copy.textContent = 'Copy'; }, 1600);
        });
        close.addEventListener('click', hide);
        ov.addEventListener('mousedown', e => { if (e.target === ov) hide(); });
        ov.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
        sec.appendChild(c);
    }
    buildCode();

    // ---- Site permissions viewer (Privacy & Security page) ----
    const pick = (o, keys) => { for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]; return undefined; };
    const PERM_NAMES = { media: 'Camera / microphone', camera: 'Camera', microphone: 'Microphone', notifications: 'Notifications', geolocation: 'Location', clipboard: 'Clipboard', midi: 'MIDI' };
    function normalizePerm(item) {
        if (typeof item === 'string') {
            const [site, perm, st] = item.split(/[|,\s]+/);
            return { site: site || item, perm: perm || 'Permission', state: st || '' };
        }
        const site = pick(item, ['origin', 'site', 'host', 'hostname', 'url', 'domain']) || 'Unknown site';
        const perm = pick(item, ['permission', 'type', 'name', 'kind', 'feature']) || 'Permission';
        let st = pick(item, ['allowed', 'granted', 'state', 'value', 'decision', 'allow']);
        if (typeof st === 'boolean') st = st ? 'allowed' : 'blocked';
        return { site: String(site).replace(/^https?:\/\//, '').replace(/\/$/, ''), perm: String(perm), state: st === undefined ? '' : String(st) };
    }
    function buildPerms() {
        const sec = document.getElementById('privacy');
        if (!sec || sec.querySelector('#perms-card')) return;
        const btn = el('button', 'btn', 'View by site'); btn.type = 'button';
        const c = card('Permissions by site', 'See which sites you gave (or denied) camera, microphone or notification access.', btn);
        c.id = 'perms-card';
        const ov = el('div', 'modal-overlay'); ov.id = 'perms-modal';
        const mc = el('div', 'modal-card wide'); mc.setAttribute('role', 'dialog'); mc.setAttribute('aria-label', 'Permissions by site');
        const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Search sites'; search.setAttribute('aria-label', 'Search sites');
        const body = el('div', 'perm-body');
        const act = el('div', 'modal-actions'); const close = el('button', 'btn btn-primary', 'Close'); close.type = 'button'; act.append(close);
        mc.append(el('h3', '', 'Permissions by site'), search, body, act); ov.appendChild(mc); document.body.appendChild(ov);
        let rows = [];
        const draw = () => {
            body.replaceChildren();
            const q = search.value.trim().toLowerCase();
            const groups = new Map();
            for (const r of rows) {
                if (q && !(r.site + ' ' + r.perm).toLowerCase().includes(q)) continue;
                if (!groups.has(r.site)) groups.set(r.site, []);
                groups.get(r.site).push(r);
            }
            if (!groups.size) { body.appendChild(el('div', 'empty', rows.length ? 'No matching sites.' : 'No sites have a remembered choice yet. Neira asks before a site uses your camera, microphone or notifications.')); return; }
            for (const [site, list] of groups) {
                const g = el('div', 'perm-group'); g.append(el('div', 'perm-site', site));
                const chips = el('div', 'perm-chips');
                for (const r of list) {
                    const st = r.state.toLowerCase();
                    const kind = /allow|grant|true|yes/.test(st) ? 'allow' : /block|den|false|no/.test(st) ? 'deny' : '';
                    const name = PERM_NAMES[r.perm] || r.perm;
                    chips.appendChild(el('span', 'perm-chip ' + kind, name + (r.state ? ': ' + r.state : '')));
                }
                g.appendChild(chips); body.appendChild(g);
            }
        };
        const hide = () => { ov.classList.remove('active'); btn.focus(); };
        btn.addEventListener('click', async () => {
            body.replaceChildren(el('div', 'empty', 'Loading…')); ov.classList.add('active'); search.value = ''; search.focus();
            try {
                const api = window.neira; const list = await api.permissions.list();
                rows = (Array.isArray(list) ? list : Object.entries(list || {}).map(([k, v]) => (typeof v === 'object' ? { site: k, ...v } : { site: k, permission: 'Permission', state: v }))).map(normalizePerm);
                draw();
            } catch (_) { body.replaceChildren(el('div', 'empty', 'Could not read site permissions.')); }
        });
        search.addEventListener('input', draw);
        close.addEventListener('click', hide);
        ov.addEventListener('mousedown', e => { if (e.target === ov) hide(); });
        ov.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
        // place right after the existing "Site permissions" card
        const anchor = document.getElementById('perm-reset');
        const after = anchor && anchor.closest('.setting-card');
        if (after) after.after(c); else sec.appendChild(c);
    }
    buildPerms();
})();