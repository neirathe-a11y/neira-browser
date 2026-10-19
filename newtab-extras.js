'use strict';
// Adds extra home page customisation to the Customize drawer.
// Self-contained: does not change newtab.js. Choices are saved on this device.
(() => {
    if (document.documentElement.classList.contains('private')) return;
    const KEY = 'neiraHomeExtras';
    const root = document.documentElement;
    const D = { clockFont: 'light', clockSize: 'm', h24: true, seconds: false, showDate: true,
        greet: false, name: '', searchW: 'default', searchStyle: 'glass', showSearch: true,
        tileSize: 'm', tileShape: 'round', labels: true, lift: true, showDial: true, pos: 'top',
        showNotes: false, showTodo: false, showTimer: false, focusMin: 25, breakMin: 5,
        vignette: false, grain: false, parallax: false, focus: false,
        showCountdown: false, cdName: '', cdDate: '',
        showProgress: false, shortcuts: true, keys: true, autofocus: true, v: 2 };
    let s = { ...D };
    try {
        const old = JSON.parse(localStorage.getItem(KEY) || '{}');
        s = { ...D, ...old };
        if (old.v !== 2) { s.h24 = true; s.tileShape = 'round'; s.v = 2; }
    } catch (_) {}

    const CLASS_MAP = {
        clockFont: { bold: 'cf-bold', mono: 'cf-mono' }, clockSize: { s: 'cs-s', l: 'cs-l' },
        searchW: { compact: 'sw-compact', wide: 'sw-wide' }, searchStyle: { solid: 'ss-solid', minimal: 'ss-minimal' },
        tileSize: { s: 'ts-s', l: 'ts-l' }, tileShape: { round: 'tshape-round', square: 'tshape-square' },
        pos: { center: 'pos-center', low: 'pos-low' }
    };
    const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };

    // ---- widgets ----
    const store = {
        get(k, f) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : f; } catch (_) { return f; } },
        set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }
    };
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const pomo = { mode: 'focus', left: 25 * 60, run: false, id: 0 };
    const mins = () => (pomo.mode === 'focus' ? s.focusMin : s.breakMin);
    let wbox;
    function flash(msg) {
        const t = document.getElementById('toast'); if (!t) return;
        t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 3000);
    }
    function wcard(title, ...kids) { const c = el('div', 'xw'); c.append(el('h4', '', title), ...kids); return c; }
    function fmt(n) { return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0'); }

    function notesCard() {
        const ta = document.createElement('textarea');
        ta.placeholder = 'Jot something down…'; ta.value = store.get('neiraNotes', ''); ta.maxLength = 4000;
        ta.addEventListener('input', () => store.set('neiraNotes', ta.value));
        return wcard('Quick notes', ta);
    }
    function todoCard() {
        let items = store.get('neiraTodos', []);
        const list = el('ul', 'xw-todo');
        const inp = document.createElement('input'); inp.type = 'text'; inp.placeholder = 'Add a task and press Enter'; inp.maxLength = 80;
        const draw = () => {
            list.replaceChildren();
            items.forEach((it, i) => {
                const li = el('li', it.done ? 'done' : '');
                const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = it.done; cb.setAttribute('aria-label', it.text);
                cb.addEventListener('change', () => { it.done = cb.checked; store.set('neiraTodos', items); draw(); });
                const x = el('button', '', '✕'); x.type = 'button'; x.setAttribute('aria-label', 'Delete ' + it.text);
                x.addEventListener('click', () => { items.splice(i, 1); store.set('neiraTodos', items); draw(); });
                li.append(cb, el('span', '', it.text), x); list.appendChild(li);
            });
        };
        inp.addEventListener('keydown', e => {
            if (e.key !== 'Enter' || !inp.value.trim()) return;
            items.push({ text: inp.value.trim(), done: false }); inp.value = ''; store.set('neiraTodos', items); draw();
        });
        draw(); return wcard('To-do', inp, list);
    }
    function timerCard() {
        const time = el('div', 'xw-time'); time.id = 'xp-time';
        const modeLbl = el('div', 'xw-mode'); modeLbl.id = 'xp-mode';
        const go = el('button', 'btn btn-primary btn-sm'); go.type = 'button';
        const rst = el('button', 'btn btn-sm', 'Reset'); rst.type = 'button';
        const paint = () => {
            time.textContent = fmt(pomo.left); modeLbl.textContent = pomo.mode === 'focus' ? 'Focus' : 'Break';
            go.textContent = pomo.run ? 'Pause' : 'Start';
        };
        const stop = () => { clearInterval(pomo.id); pomo.run = false; };
        go.addEventListener('click', () => {
            if (pomo.run) { stop(); paint(); return; }
            pomo.run = true;
            pomo.id = setInterval(() => {
                pomo.left--;
                if (pomo.left <= 0) {
                    stop(); flash(pomo.mode === 'focus' ? 'Focus session done. Take a break!' : 'Break over. Ready to focus?');
                    pomo.mode = pomo.mode === 'focus' ? 'break' : 'focus'; pomo.left = mins() * 60;
                }
                const t = document.getElementById('xp-time');
                if (t) { t.textContent = fmt(pomo.left); document.getElementById('xp-mode').textContent = pomo.mode === 'focus' ? 'Focus' : 'Break'; }
                const g = document.getElementById('xp-go'); if (g) g.textContent = pomo.run ? 'Pause' : 'Start';
            }, 1000);
            paint();
        });
        go.id = 'xp-go';
        rst.addEventListener('click', () => { stop(); pomo.left = mins() * 60; paint(); });
        paint();
        const row = el('div', 'xw-btns'); row.append(go, rst);
        return wcard('Focus timer', modeLbl, time, row);
    }

    let live = [];
    setInterval(() => live.forEach(f => f()), 1000);
    function countdownCard() {
        const big = el('div', 'xw-time'), sub = el('div', 'xw-mode');
        const f = () => {
            if (!s.cdDate) { big.textContent = '--'; sub.textContent = 'Pick a date in Customize'; return; }
            const days = Math.ceil((new Date(s.cdDate + 'T00:00:00') - new Date()) / 864e5);
            big.textContent = days > 0 ? days + (days === 1 ? ' day' : ' days') : days === 0 ? 'Today!' : 'Passed';
            sub.textContent = s.cdName || 'Countdown';
        };
        f(); live.push(f); return wcard('Countdown', big, sub);
    }
    function progressCard() {
        const c = wcard('Time passed');
        const bars = [['Today', () => { const n = new Date(); return (n.getHours() * 60 + n.getMinutes()) / 1440; }],
            ['This week', () => { const n = new Date(); return (((n.getDay() + 6) % 7) + (n.getHours() / 24)) / 7; }],
            ['This year', () => { const n = new Date(); return (n - new Date(n.getFullYear(), 0, 1)) / (new Date(n.getFullYear() + 1, 0, 1) - new Date(n.getFullYear(), 0, 1)); }]];
        for (const [name, calc] of bars) {
            const lab = el('div', 'xw-city'); const pct = el('span', 'xw-ct'); lab.append(el('span', '', name), pct);
            const bar = el('div', 'xw-bar'); const fill = el('div'); bar.append(fill); c.append(lab, bar);
            const f = () => { const v = Math.max(0, Math.min(1, calc())); fill.style.width = (v * 100).toFixed(1) + '%'; pct.textContent = Math.round(v * 100) + '%'; };
            f(); live.push(f);
        }
        return c;
    }
    // Smart search: type "yt cats", "gh react", "w moon", "r topic", "maps cafe", "a headphones"
    const SC = { yt: 'https://www.youtube.com/results?search_query=', gh: 'https://github.com/search?q=', w: 'https://en.wikipedia.org/wiki/Special:Search?search=',
        r: 'https://www.reddit.com/search/?q=', maps: 'https://www.google.com/maps/search/', a: 'https://www.amazon.com/s?k=' };
    const sForm = document.getElementById('search-form'), sQ = document.getElementById('q');
    if (sForm && sQ) sForm.addEventListener('submit', e => {
        if (!s.shortcuts) return;
        const m = sQ.value.trim().match(/^(\w+)\s+(.+)$/);
        const base = m && SC[m[1].toLowerCase()];
        if (!base || !window.neira) return;
        e.preventDefault(); e.stopImmediatePropagation();
        window.neira.newtab.go(base + encodeURIComponent(m[2]));
    }, true);
    function focusSearch() {
        if (!s.autofocus || !sQ || !s.showSearch) return;
        const a = document.activeElement;
        if (a && a !== document.body && a !== sQ && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) return;
        const dr = document.getElementById('drawer'); if (dr && !dr.hidden) return;
        sQ.focus({ preventScroll: true });
    }
    [0, 60, 250, 600].forEach(ms => setTimeout(focusSearch, ms));
    window.addEventListener('focus', focusSearch);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) focusSearch(); });
    document.addEventListener('keydown', e => {
        if (!s.autofocus || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || (e.key === '/' && s.keys)) return;
        const tg = e.target && e.target.tagName;
        if (/INPUT|TEXTAREA|SELECT|BUTTON/.test(tg) || (e.target && e.target.isContentEditable)) return;
        focusSearch();
    }, true);
    document.addEventListener('keydown', e => {
        if (!s.keys || e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
        const tg = e.target && e.target.tagName;
        if (tg === 'INPUT' || tg === 'TEXTAREA' || tg === 'SELECT') return;
        e.preventDefault(); if (sQ) sQ.focus();
    });
    function renderWidgets() {
        const dial = document.getElementById('dial'); if (!dial) return;
        if (!wbox) { wbox = el('div'); wbox.id = 'xwidgets'; dial.after(wbox); }
        wbox.replaceChildren(); live = [];
        if (s.showCountdown) wbox.append(countdownCard());
        if (s.showProgress) wbox.append(progressCard());
        if (s.showTimer) wbox.append(timerCard());
        if (s.showTodo) wbox.append(todoCard());
        if (s.showNotes) wbox.append(notesCard());
        wbox.hidden = !wbox.children.length;
    }
    window.addEventListener('mousemove', e => {
        const w = document.getElementById('wallpaper'); if (!w) return;
        if (!s.parallax || reduce.matches) { if (w.style.transform) w.style.transform = ''; return; }
        w.style.transform = `translate3d(${(e.clientX / innerWidth - .5) * -18}px, ${(e.clientY / innerHeight - .5) * -18}px, 0)`;
    });

    // ---- own clock + greeting (the original #time/#date are hidden by CSS) ----
    const clock = document.getElementById('clock');
    let xg, xt, xd;
    if (clock) {
        xg = el('div'); xg.id = 'xgreet';
        xt = el('div'); xt.id = 'xtime';
        xd = el('div'); xd.id = 'xdate';
        clock.prepend(xg, xt, xd);
        root.classList.add('xclock');
    }
    let timer;
    function tick() {
        if (!xt) return;
        const now = new Date();
        const o = { hour: '2-digit', minute: '2-digit', hour12: !s.h24 };
        if (s.seconds) o.second = '2-digit';
        xt.textContent = now.toLocaleTimeString([], o);
        xd.textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
        const h = now.getHours();
        const part = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
        xg.textContent = s.greet ? part + (s.name.trim() ? ', ' + s.name.trim() : '') : '';
        xg.hidden = !s.greet;
    }
    function apply() {
        for (const [k, map] of Object.entries(CLASS_MAP)) {
            for (const c of Object.values(map)) root.classList.remove(c);
            if (map[s[k]]) root.classList.add(map[s[k]]);
        }
        root.classList.toggle('no-date', !s.showDate);
        root.classList.toggle('hide-search', !s.showSearch);
        root.classList.toggle('hide-dial', !s.showDial);
        root.classList.toggle('no-labels', !s.labels);
        root.classList.toggle('no-lift', !s.lift);
        root.classList.toggle('vig', !!s.vignette);
        root.classList.toggle('grain', !!s.grain);
        root.classList.toggle('focus-mode', !!s.focus);
        if (!pomo.run) pomo.left = mins() * 60;
        renderWidgets();
        clearInterval(timer);
        tick();
        timer = setInterval(tick, s.seconds ? 1000 : 10000);
    }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (_) {} apply(); }
    apply();

    // ---- drawer controls ----
    function seg(label, key, options) {
        const w = el('div', 'opt'); w.append(el('span', 'opt-label', label));
        const box = el('div', 'seg-x'); box.setAttribute('role', 'group'); box.setAttribute('aria-label', label);
        for (const [v, t] of options) {
            const b = el('button', '', t); b.type = 'button';
            b.setAttribute('aria-pressed', String(s[key] === v));
            b.addEventListener('click', () => {
                s[key] = v; save();
                box.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
            });
            box.appendChild(b);
        }
        w.append(box); return w;
    }
    function toggle(label, key) {
        const r = el('div', 'row'); r.append(el('span', '', label));
        const sw = el('label', 'switch'); const i = document.createElement('input');
        i.type = 'checkbox'; i.checked = !!s[key]; i.setAttribute('aria-label', label);
        i.addEventListener('change', () => { s[key] = i.checked; save(); });
        sw.append(i, el('span', 'slider')); r.append(sw); return r;
    }
    function text(label, key, placeholder) {
        const w = el('div', 'opt'); w.append(el('span', 'opt-label', label));
        const i = document.createElement('input');
        i.type = 'text'; i.value = s[key]; i.placeholder = placeholder; i.maxLength = 30; i.autocomplete = 'off';
        i.addEventListener('input', () => { s[key] = i.value; save(); });
        w.append(i); return w;
    }
    function group(title, open, ...kids) {
        const sec = el('section', 'ex-group');
        const d = document.createElement('details'); d.open = open;
        const sm = el('summary', '', title);
        const b = el('div', 'ex-body'); b.append(...kids);
        d.append(sm, b); sec.append(d); return sec;
    }

    function sel(label, key, options) {
        const w = el('div', 'opt'); w.append(el('span', 'opt-label', label));
        const x = document.createElement('select'); x.setAttribute('aria-label', label);
        for (const [v, t2] of options) { const o = el('option', '', t2); o.value = v; x.appendChild(o); }
        x.value = s[key]; x.addEventListener('change', () => { s[key] = x.value; save(); }); w.append(x); return w;
    }
    function field(label, key, type, ph) {
        const w = el('div', 'opt'); w.append(el('span', 'opt-label', label));
        const i = document.createElement('input'); i.type = type; i.value = s[key]; i.placeholder = ph || ''; i.maxLength = 30; i.autocomplete = 'off';
        i.addEventListener('input', () => { s[key] = i.value; save(); }); w.append(i); return w;
    }
    function num(label, key) {
        const w = el('div', 'opt'); w.append(el('span', 'opt-label', label));
        const i = document.createElement('input'); i.type = 'number'; i.min = 1; i.max = 180; i.value = s[key];
        i.addEventListener('input', () => { if (!i.value) return; s[key] = Math.max(1, Math.min(180, parseInt(i.value, 10) || 1)); save(); });
        w.append(i); return w;
    }
    function backupBox() {
        const w = el('div', 'opt');
        const exp = el('button', 'btn btn-sm', 'Copy my settings'); exp.type = 'button';
        exp.addEventListener('click', async () => {
            try { await navigator.clipboard.writeText(JSON.stringify(s)); flash('Settings copied'); } catch (_) { flash('Could not copy'); }
        });
        const inp = document.createElement('input'); inp.type = 'text'; inp.placeholder = 'Paste settings here';
        const imp = el('button', 'btn btn-sm', 'Apply pasted settings'); imp.type = 'button';
        imp.addEventListener('click', () => {
            try { const o = JSON.parse(inp.value); s = { ...D, ...o }; save(); build(); flash('Settings applied'); }
            catch (_) { flash('That isn’t valid settings text'); }
        });
        w.append(exp, inp, imp); return w;
    }

    function build() {
        const body = document.querySelector('.drawer-body');
        if (!body) return;
        body.querySelectorAll('.ex-group, .ex-reset').forEach(n => n.remove());
        const frag = document.createDocumentFragment();
        frag.append(
            group('Clock and greeting', true,
                seg('Font', 'clockFont', [['light', 'Light'], ['bold', 'Bold'], ['mono', 'Mono']]),
                seg('Size', 'clockSize', [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']]),
                toggle('24-hour time', 'h24'), toggle('Show seconds', 'seconds'), toggle('Show date', 'showDate'),
                toggle('Show greeting', 'greet'), text('Your name (for the greeting)', 'name', 'Optional')),
            group('Search bar', false,
                toggle('Show search bar', 'showSearch'),
                seg('Width', 'searchW', [['compact', 'Compact'], ['default', 'Default'], ['wide', 'Wide']]),
                seg('Style', 'searchStyle', [['glass', 'Glass'], ['solid', 'Solid'], ['minimal', 'Minimal']])),
            group('Smart search', false,
                toggle('Search shortcuts', 'shortcuts'),
                (() => { const n = el('p', 'opt-label', 'Try: yt cats, gh react, w moon, r topic, maps cafe, a headphones'); return n; })(),
                toggle('Press / to search', 'keys'),
                toggle('Type right away on new tab', 'autofocus')),
            group('Speed Dial', false,
                toggle('Show Speed Dial', 'showDial'),
                seg('Tile size', 'tileSize', [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']]),
                seg('Tile shape', 'tileShape', [['angled', 'Angled'], ['round', 'Rounded'], ['square', 'Square']]),
                toggle('Show names under tiles', 'labels'), toggle('Lift tiles on hover', 'lift')),
            group('Layout', false,
                seg('Vertical position', 'pos', [['top', 'Top'], ['low', 'Lower'], ['center', 'Centered']])),
            group('Widgets', false,
                toggle('Focus timer', 'showTimer'), num('Focus length (minutes)', 'focusMin'), num('Break length (minutes)', 'breakMin'),
                toggle('To-do list', 'showTodo'), toggle('Quick notes', 'showNotes'),
                toggle('Countdown', 'showCountdown'), field('Event name', 'cdName', 'text', 'e.g. Holiday'), field('Event date', 'cdDate', 'date'),
                toggle('Time passed (day, week, year)', 'showProgress')),
            group('Effects and modes', false,
                toggle('Focus mode (clock only)', 'focus'), toggle('Vignette', 'vignette'),
                toggle('Film grain', 'grain'), toggle('Parallax wallpaper', 'parallax')),
            group('Backup', false, backupBox())
        );
        const reset = el('section', 'ex-reset'); reset.style.padding = '16px 0 4px';
        const rb = el('button', 'btn', 'Reset home page options'); rb.type = 'button'; rb.style.width = '100%';
        rb.addEventListener('click', () => { s = { ...D }; save(); build(); });
        reset.append(rb); frag.append(reset);
        body.insertBefore(frag, body.lastElementChild);
    }
    build();
})();