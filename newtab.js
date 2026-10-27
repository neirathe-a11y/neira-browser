'use strict';
(() => {
    const api = window.neira;
    const $ = id => document.getElementById(id);
    const MAX_DIAL = 24;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const isPrivate = document.documentElement.classList.contains('private');

    // =====================================================================
    // PRIVATE MODE: completely separate page. Only wire the search box.
    // =====================================================================
    if (isPrivate) {
        const form = $('incog-form');
        const input = $('incog-q');
        if (form && input) {
            form.addEventListener('submit', e => {
                e.preventDefault();
                const text = input.value.trim();
                if (text) api.newtab.go(text);
            });
            setTimeout(() => input.focus(), 50);
        }
        return; // nothing else runs in private mode
    }

    // =====================================================================
    // NORMAL MODE
    // =====================================================================
   const PRESETS = [
    { value: 'none',             label: 'None',      cls: 'wp-none' },
    { value: 'preset:nebula',    label: 'Nebula',    cls: 'wp-nebula' },
    { value: 'preset:synthwave', label: 'Synthwave', cls: 'wp-synthwave' },
    { value: 'preset:borealis',  label: 'Northern',  cls: 'wp-borealis' },
    { value: 'preset:ocean',     label: 'Ocean',     cls: 'wp-ocean' },
    { value: 'preset:sunset',    label: 'Sunset',    cls: 'wp-sunset' },
    { value: 'preset:ember',     label: 'Ember',     cls: 'wp-ember' },
    { value: 'preset:stars',     label: 'Stars',     cls: 'wp-stars' }
];

// Old names -> new ones, so anyone who had Neon/Aurora/Midnight saved doesn't get a blank page
const LEGACY_WALLPAPERS = {
    'preset:neon': 'preset:nebula',
    'preset:aurora': 'preset:borealis',
    'preset:midnight': 'preset:ocean'
};
(() => {
    const css = `
.wp-nebula {
    --a1: var(--accent);
    --a2: hsl(from var(--accent) calc(h + 50) s l);
    --a3: hsl(from var(--accent) calc(h - 50) s l);
    background:
        radial-gradient(ellipse 60% 50% at 18% 22%, color-mix(in srgb, var(--a1) 60%, transparent), transparent 62%),
        radial-gradient(ellipse 55% 45% at 82% 28%, color-mix(in srgb, var(--a2) 48%, transparent), transparent 62%),
        radial-gradient(ellipse 70% 55% at 55% 88%, color-mix(in srgb, var(--a3) 55%, transparent), transparent 62%),
        radial-gradient(ellipse 30% 25% at 70% 60%, color-mix(in srgb, var(--a1) 25%, transparent), transparent 70%),
        color-mix(in srgb, var(--accent) 8%, #07061a);
}
.wp-synthwave {
    --a1: var(--accent);
    --a2: hsl(from var(--accent) calc(h + 50) s l);
    --a3: hsl(from var(--accent) calc(h - 50) s l);
    background:
        repeating-linear-gradient(90deg, color-mix(in srgb, var(--a2) 45%, transparent) 0 1px, transparent 1px 70px) bottom / 100% 38% no-repeat,
        repeating-linear-gradient(0deg,  color-mix(in srgb, var(--a2) 45%, transparent) 0 1px, transparent 1px 34px) bottom / 100% 38% no-repeat,
        radial-gradient(circle at 50% 62%, color-mix(in srgb, var(--a2) 40%, #fff) 0 9%, var(--a2) 14%, transparent 15%),
        linear-gradient(180deg,
            color-mix(in srgb, var(--accent) 10%, #0a0214) 0%,
            color-mix(in srgb, var(--a3) 35%, #12052a) 38%,
            color-mix(in srgb, var(--a3) 70%, #1a0838) 58%,
            var(--a1) 76%,
            color-mix(in srgb, var(--a2) 70%, #fff) 100%);
}
.wp-borealis {
    --a1: var(--accent);
    --a2: hsl(from var(--accent) calc(h + 50) s l);
    --a3: hsl(from var(--accent) calc(h - 50) s l);
    background:
        radial-gradient(ellipse 80% 35% at 30% 30%, color-mix(in srgb, var(--a1) 55%, transparent), transparent 70%),
        radial-gradient(ellipse 70% 30% at 70% 38%, color-mix(in srgb, var(--a2) 45%, transparent), transparent 70%),
        radial-gradient(ellipse 60% 28% at 50% 22%, color-mix(in srgb, var(--a3) 40%, transparent), transparent 70%),
        linear-gradient(180deg,
            color-mix(in srgb, var(--accent) 6%, #020617) 0%,
            color-mix(in srgb, var(--accent) 12%, #06142b) 60%,
            color-mix(in srgb, var(--accent) 16%, #0b1f2e) 100%);
    background-size: 160% 160%, 160% 160%, 160% 160%, 100% 100%;
    background-position: 0% 0%, 100% 0%, 50% 0%, 0 0;
    animation: wpBorealis 18s ease-in-out infinite alternate;
}
@keyframes wpBorealis {
    0%   { background-position: 0% 10%,  100% 0%,  40% 0%,  0 0; }
    100% { background-position: 100% 0%, 0% 12%,  60% 14%, 0 0; }
}
.wp-ocean {
    --a1: var(--accent);
    --a2: hsl(from var(--accent) calc(h + 50) s l);
    --a3: hsl(from var(--accent) calc(h - 50) s l);
    background:
        radial-gradient(ellipse 60% 45% at 50% -8%, color-mix(in srgb, var(--a2) 42%, transparent), transparent 60%),
        radial-gradient(ellipse 40% 30% at 15% 75%, color-mix(in srgb, var(--a1) 28%, transparent), transparent 70%),
        radial-gradient(ellipse 40% 30% at 85% 85%, color-mix(in srgb, var(--a3) 25%, transparent), transparent 70%),
        linear-gradient(180deg,
            color-mix(in srgb, var(--accent) 30%, #02121c) 0%,
            color-mix(in srgb, var(--accent) 18%, #01101a) 45%,
            color-mix(in srgb, var(--accent) 6%, #010a10) 100%);
}
.wp-sunset {
    --a1: var(--accent);
    --a2: hsl(from var(--accent) calc(h + 50) s l);
    --a3: hsl(from var(--accent) calc(h - 50) s l);
    background:
        radial-gradient(ellipse 50% 28% at 50% 82%, color-mix(in srgb, var(--a2) 65%, #fff), transparent 70%),
        linear-gradient(180deg,
            color-mix(in srgb, var(--accent) 8%, #0c0820) 0%,
            color-mix(in srgb, var(--a3) 40%, #140c2e) 28%,
            color-mix(in srgb, var(--a1) 85%, #2a0f4a) 58%,
            var(--a2) 80%,
            color-mix(in srgb, var(--a2) 55%, #fff) 100%);
}
.wp-ember {
    --a1: var(--accent);
    --a2: hsl(from var(--accent) calc(h + 50) s l);
    --a3: hsl(from var(--accent) calc(h - 50) s l);
    background:
        radial-gradient(ellipse 70% 50% at 50% 118%, color-mix(in srgb, var(--a1) 70%, transparent), transparent 62%),
        radial-gradient(ellipse 45% 35% at 15% 105%, color-mix(in srgb, var(--a3) 42%, transparent), transparent 65%),
        radial-gradient(ellipse 40% 30% at 88% 100%, color-mix(in srgb, var(--a2) 32%, transparent), transparent 65%),
        color-mix(in srgb, var(--accent) 6%, #0b0507);
}
.thumb[class*="wp-"] { animation: none !important; }
@media (prefers-reduced-motion: reduce) { .wp-borealis { animation: none; } }
`;
    const s = document.createElement('style');
    s.textContent = css + css.replace(/\.wp-(\w+)\s*\{/g, '#wp-grid .wp-card .thumb.wp-$1 {');
    document.head.appendChild(s);
})();
let settings = { wallpaper: 'preset:nebula', wallpaperDim: 35, wallpaperBlur: 0, showClock: true, engine: '' };    let dial = [];
    let historyItems = [];
    let bookmarkItems = [];

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    let toastTimer;
    function toast(message) {
        const t = $('toast');
        if (!t) return;
        t.textContent = message;
        t.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
    }

    const go = text => api.newtab.go(text);

    function hostOf(url) {
        try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return url; }
    }

    function hueOf(text) {
        let h = 0;
        for (const c of text) h = (h * 31 + c.charCodeAt(0)) >>> 0;
        return h % 360;
    }

    // -------------------------------------------------------------------
    // Wallpaper Engine
    // -------------------------------------------------------------------
    let stars = null;
    let videoEl = null;

    function stopStars() {
        if (!stars) return;
        cancelAnimationFrame(stars.raf);
        window.removeEventListener('resize', stars.onResize);
        stars = null;
    }

    function startStars(canvas) {
        const ctx = canvas.getContext('2d');
        const state = { raf: 0, list: [], onResize: null };
        const resize = () => {
            const dpr = window.devicePixelRatio || 1;
            canvas.width = Math.floor(canvas.clientWidth * dpr);
            canvas.height = Math.floor(canvas.clientHeight * dpr);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            const count = Math.round((canvas.clientWidth * canvas.clientHeight) / 7000);
            state.list = Array.from({ length: count }, () => ({
                x: Math.random() * canvas.clientWidth,
                y: Math.random() * canvas.clientHeight,
                r: Math.random() * 1.4 + 0.3,
                speed: Math.random() * 0.12 + 0.02,
                phase: Math.random() * Math.PI * 2
            }));
        };
        const draw = time => {
            ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
            for (const s of state.list) {
                if (!reduceMotion.matches) {
                    s.y -= s.speed;
                    if (s.y < -2) { s.y = canvas.clientHeight + 2; s.x = Math.random() * canvas.clientWidth; }
                }
                const twinkle = reduceMotion.matches ? 0.8 : 0.55 + 0.45 * Math.sin(time / 700 + s.phase);
                ctx.globalAlpha = twinkle;
                ctx.fillStyle = '#fff';
                ctx.beginPath();
                ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
                ctx.fill();
            }
            if (!reduceMotion.matches) state.raf = requestAnimationFrame(draw);
        };
        state.onResize = () => { resize(); if (reduceMotion.matches) draw(0); };
        window.addEventListener('resize', state.onResize);
        resize();
        draw(0);
        stars = state;
    }

    function applyWallpaper() {
        const layer = $('wallpaper');
        if (!layer) return;
        stopStars();
        videoEl = null;
        layer.className = 'wallpaper';
        layer.replaceChildren();
        layer.style.setProperty('--blur', (settings.wallpaperBlur || 0) + 'px');
        const dim = $('wp-dim');
        if (dim) dim.style.opacity = String((settings.wallpaperDim || 0) / 100);

const value = settings.wallpaper || 'preset:nebula';
        if (value === 'none') { layer.classList.add('wp-none'); return; }
        
        if (value.startsWith('preset:')) {
            const name = value.slice(7);
            layer.classList.add('wp-' + name);
            if (name === 'stars') {
                const canvas = document.createElement('canvas');
                layer.appendChild(canvas);
                startStars(canvas);
            }
            return;
        }
        
        if (value.startsWith('file:')) {
            const name = value.slice(5);
            const url = 'neira-asset://wallpaper/' + encodeURIComponent(name);
            if (/\.(mp4|webm)$/i.test(name)) {
                const v = document.createElement('video');
                v.muted = true; v.loop = true; v.playsInline = true; v.setAttribute('muted', '');
                v.addEventListener('error', () => {
                    toast('That video could not be played.');
                    layer.replaceChildren();
layer.className = 'wallpaper wp-nebula';
                });
                v.src = url;
                layer.appendChild(v);
                if (!reduceMotion.matches) v.play().catch(() => {});
                videoEl = v;
            } else {
                const img = document.createElement('img');
                img.alt = '';
img.addEventListener('error', () => { layer.replaceChildren(); layer.className = 'wallpaper wp-nebula'; });                img.src = url;
                layer.appendChild(img);
            }
        }
    }

    document.addEventListener('visibilitychange', () => {
        if (!videoEl) return;
        if (document.hidden) videoEl.pause();
        else if (!reduceMotion.matches) videoEl.play().catch(() => {});
    });

    // -------------------------------------------------------------------
    // Clock
    // -------------------------------------------------------------------
    function tick() {
        const now = new Date();
        const t = $('time');
        const d = $('date');
        if (t) t.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (d) d.textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    }
    setInterval(tick, 10000);

    // -------------------------------------------------------------------
    // Search bar with local suggestions
    // -------------------------------------------------------------------
    const qInput = $('q');
    const suggestEl = $('suggest');
    let rows = [];
    let selected = -1;

    function computeSuggestions(text) {
        const needle = text.trim().toLowerCase();
        if (!needle) return [];
        const seen = new Set();
        const out = [];
        const add = (title, url, kind) => {
            if (out.length >= 7 || seen.has(url)) return;
            seen.add(url);
            out.push({ main: title || url, sub: url, kind, value: url });
        };
        const match = (a, b) => (a + ' ' + b).toLowerCase().includes(needle);
        for (const d of dial) if (match(d.title, d.url)) add(d.title, d.url, 'Speed Dial');
        for (const b of bookmarkItems) if (match(b.title || '', b.url)) add(b.title, b.url, 'Bookmark');
        for (const h of historyItems) {
            if (out.length >= 7) break;
            if (match(h.title || '', h.url)) add(h.title, h.url, 'History');
        }
        return out;
    }

    function closeSuggest() {
        if (!suggestEl) return;
        suggestEl.hidden = true;
        suggestEl.replaceChildren();
        qInput.setAttribute('aria-expanded', 'false');
        rows = [];
        selected = -1;
    }

    function renderSuggest() {
        if (!suggestEl) return;
        suggestEl.replaceChildren();
        rows.forEach((r, i) => {
            const b = el('button', 'sg-item' + (i === selected ? ' sel' : ''));
            b.type = 'button';
            b.setAttribute('role', 'option');
            b.appendChild(el('span', 'sg-main', r.main));
            if (r.sub) b.appendChild(el('span', 'sg-sub', r.sub));
            if (r.kind) b.appendChild(el('span', 'sg-kind', r.kind));
            b.addEventListener('mousedown', e => { e.preventDefault(); go(r.value); });
            suggestEl.appendChild(b);
        });
        suggestEl.hidden = !rows.length;
        qInput.setAttribute('aria-expanded', rows.length ? 'true' : 'false');
    }

    if (qInput) {
        qInput.addEventListener('input', () => {
            const text = qInput.value;
            const found = computeSuggestions(text);
            rows = text.trim() ? [{ main: `Search for “${text.trim()}”`, sub: '', kind: '', value: text.trim() }, ...found] : [];
            selected = -1;
            renderSuggest();
        });

        qInput.addEventListener('keydown', e => {
            if (e.key === 'ArrowDown' && rows.length) { e.preventDefault(); selected = (selected + 1) % rows.length; renderSuggest(); }
            else if (e.key === 'ArrowUp' && rows.length) { e.preventDefault(); selected = (selected - 1 + rows.length) % rows.length; renderSuggest(); }
            else if (e.key === 'Escape') { if (rows.length) { e.preventDefault(); closeSuggest(); } }
        });

        qInput.addEventListener('blur', () => setTimeout(closeSuggest, 120));
    }

    const searchForm = $('search-form');
    if (searchForm) {
        searchForm.addEventListener('submit', e => {
            e.preventDefault();
            const text = selected >= 0 && rows[selected] ? rows[selected].value : qInput.value.trim();
            if (text) go(text);
        });
    }

    const engineSel = $('engine');
    if (engineSel) engineSel.addEventListener('change', e => api.settings.set('engine', e.target.value));

    // -------------------------------------------------------------------
    // Speed Dial
    // -------------------------------------------------------------------
    let dragFrom = null;
    let keepFocus = null;

    async function saveDial(next) {
        dial = next;
        renderDial();
        try { dial = await api.speedDial.set(next); } catch (_) { toast('Could not save your Speed Dial.'); }
    }

    function renderDial() {
        const grid = $('dial');
        if (!grid) return;
        const active = document.activeElement && document.activeElement.closest ? document.activeElement.closest('.tile') : null;
        const refocus = keepFocus !== null ? keepFocus : (active && grid.contains(active) ? [...grid.children].indexOf(active) : null);
        keepFocus = null;
        grid.replaceChildren();

        dial.forEach((d, i) => {
            const host = hostOf(d.url);
            const hue = hueOf(host);
            const tile = el('div', 'tile');
            tile.tabIndex = 0;
            tile.draggable = true;
            tile.setAttribute('role', 'listitem');
            tile.title = `${d.url}\nDrag to reorder, or press Shift + ← / →`;

            const art = el('div', 'tile-art');
            art.style.setProperty('--h1', String(hue));
            art.style.setProperty('--h2', String((hue + 40) % 360));
            if (d.image) {
                art.classList.add('has-image');
                const img = document.createElement('img');
                img.alt = '';
                img.draggable = false;
                img.addEventListener('error', () => {
                    img.remove();
                    art.classList.remove('has-image');
                    art.appendChild(el('span', 'tile-host', host));
                });
                img.src = 'neira-asset://dial/' + encodeURIComponent(d.image);
                art.appendChild(img);
            } else {
                art.appendChild(el('span', 'tile-host', host));
            }

            const tools = el('div', 'tile-tools');
            const edit = el('button', '', '✎');
            edit.type = 'button';
            edit.setAttribute('aria-label', 'Edit ' + d.title);
            edit.addEventListener('click', e => { e.stopPropagation(); openModal(i); });
            const remove = el('button', '', '✕');
            remove.type = 'button';
            remove.setAttribute('aria-label', 'Remove ' + d.title);
            remove.addEventListener('click', e => {
                e.stopPropagation();
                saveDial(dial.filter((_, idx) => idx !== i));
                toast(`Removed ${d.title}`);
            });
            tools.append(edit, remove);
            for (const b of [edit, remove]) b.addEventListener('keydown', e => e.stopPropagation());

            tile.append(art, el('div', 'tile-title', d.title), tools);

            tile.addEventListener('click', () => go(d.url));
            tile.addEventListener('keydown', e => {
                if (e.key === 'Enter') { e.preventDefault(); go(d.url); }
                else if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                    e.preventDefault();
                    const j = i + (e.key === 'ArrowRight' ? 1 : -1);
                    if (j < 0 || j >= dial.length) return;
                    const next = [...dial];
                    [next[i], next[j]] = [next[j], next[i]];
                    keepFocus = j;
                    saveDial(next);
                }
            });

            tile.addEventListener('dragstart', e => {
                dragFrom = i;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(i));
                tile.classList.add('dragging');
            });
            tile.addEventListener('dragend', () => {
                dragFrom = null;
                tile.classList.remove('dragging');
                grid.querySelectorAll('.over').forEach(n => n.classList.remove('over'));
            });
            tile.addEventListener('dragover', e => { if (dragFrom === null) return; e.preventDefault(); tile.classList.add('over'); });
            tile.addEventListener('dragleave', () => tile.classList.remove('over'));
            tile.addEventListener('drop', e => {
                e.preventDefault();
                tile.classList.remove('over');
                if (dragFrom === null || dragFrom === i) return;
                const next = [...dial];
                const [moved] = next.splice(dragFrom, 1);
                next.splice(i, 0, moved);
                dragFrom = null;
                saveDial(next);
            });

            grid.appendChild(tile);
        });

        if (dial.length < MAX_DIAL) {
            const add = el('div', 'tile tile-add');
            add.tabIndex = 0;
            add.setAttribute('role', 'listitem');
            add.title = 'Add a site';
            const art = el('div', 'tile-art');
            art.appendChild(el('span', 'tile-host', '+'));
            add.append(art, el('div', 'tile-title', 'Add site'));
            add.addEventListener('click', () => openModal(-1));
            add.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal(-1); } });
            grid.appendChild(add);
        }
        if (refocus !== null && grid.children[refocus]) grid.children[refocus].focus();
    }

    // Add / edit dialog
    let editIndex = -1;
    let pendingImage = '';
    const modal = $('dial-modal');

    function renderDialImage() {
        const box = $('dial-image-preview');
        if (!box) return;
        box.replaceChildren();
        if (pendingImage) {
            const img = document.createElement('img');
            img.alt = '';
            img.src = 'neira-asset://dial/' + encodeURIComponent(pendingImage);
            box.appendChild(img);
        } else {
            box.textContent = 'Default look';
        }
        $('dial-image-choose').textContent = pendingImage ? 'Change image…' : 'Choose image…';
        $('dial-image-clear').hidden = !pendingImage;
    }

    function openModal(index) {
        editIndex = index;
        $('dial-modal-title').textContent = index >= 0 ? 'Edit site' : 'Add to Speed Dial';
        $('dial-title').value = index >= 0 ? dial[index].title : '';
        $('dial-url').value = index >= 0 ? dial[index].url : '';
        $('dial-error').textContent = '';
        pendingImage = index >= 0 ? (dial[index].image || '') : '';
        renderDialImage();
        modal.hidden = false;
        $(index >= 0 ? 'dial-title' : 'dial-url').focus();
    }

    function closeModal() {
        modal.hidden = true;
        if (qInput) qInput.focus();
    }

    function submitModal() {
        let address = $('dial-url').value.trim();
        if (!address) { $('dial-error').textContent = 'Enter a web address.'; return; }
        if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(address)) address = 'https://' + address;
        let url;
        try { url = new URL(address); } catch (_) { url = null; }
        if (!url || !/^https?:$/.test(url.protocol) || (!url.hostname.includes('.') && url.hostname !== 'localhost')) {
            $('dial-error').textContent = 'That doesn’t look like a valid web address.';
            return;
        }
        const title = $('dial-title').value.trim() || hostOf(url.href);
        const next = [...dial];
        if (editIndex >= 0) next[editIndex] = { ...next[editIndex], title, url: url.href, image: pendingImage };
        else next.push({ title, url: url.href, image: pendingImage });
        closeModal();
        saveDial(next);
    }

    if ($('dial-save')) $('dial-save').addEventListener('click', submitModal);
    if ($('dial-cancel')) $('dial-cancel').addEventListener('click', closeModal);
    if ($('dial-image-choose')) $('dial-image-choose').addEventListener('click', async () => {
        $('dial-error').textContent = '';
        const r = await api.speedDial.chooseImage();
        if (r && r.ok) { pendingImage = r.image; renderDialImage(); }
        else if (r && r.reason) $('dial-error').textContent = r.reason;
    });
    if ($('dial-image-clear')) $('dial-image-clear').addEventListener('click', () => { pendingImage = ''; renderDialImage(); });
    if (modal) {
        modal.addEventListener('mousedown', e => { if (e.target === modal) closeModal(); });
        modal.addEventListener('keydown', e => {
            if (e.key === 'Escape') { e.stopPropagation(); closeModal(); }
            else if (e.key === 'Enter') {
                if (e.target.tagName === 'BUTTON') return;
                e.preventDefault();
                submitModal();
            }
        });
    }

    // -------------------------------------------------------------------
    // Customize drawer
    // -------------------------------------------------------------------
    const drawer = $('drawer');

    function renderWallpaperGrid() {
        const grid = $('wp-grid');
        if (!grid) return;
        grid.replaceChildren();
const current = settings.wallpaper || 'preset:nebula';
        // Presets
        for (const p of PRESETS) {
            const card = el('button', 'wp-card' + (current === p.value ? ' active' : ''));
            card.type = 'button';
            const thumb = el('div', 'thumb ' + p.cls);
            if (p.value === 'none') thumb.textContent = '∅';
            card.append(thumb, el('span', 'label', p.label));
            card.addEventListener('click', () => api.settings.set('wallpaper', p.value));
            grid.appendChild(card);
        }

        // Custom File
        if (current.startsWith('file:')) {
            const name = current.slice(5);
            const card = el('button', 'wp-card active');
            card.type = 'button';
            const thumb = el('div', 'thumb');
            const url = 'neira-asset://wallpaper/' + encodeURIComponent(name);
            if (/\.(mp4|webm)$/i.test(name)) {
                const v = document.createElement('video');
                v.muted = true;
                v.preload = 'metadata';
                v.src = url;
                thumb.appendChild(v);
            } else {
                const img = document.createElement('img');
                img.alt = '';
                img.src = url;
                thumb.appendChild(img);
            }
            card.append(thumb, el('span', 'label', 'Yours'));
            grid.appendChild(card);
        }

        // Upload Button
        const upload = el('button', 'wp-card');
        upload.type = 'button';
        const thumb = el('div', 'thumb', '+');
        upload.append(thumb, el('span', 'label', 'Image / video'));
        upload.addEventListener('click', async () => {
            const r = await api.wallpaper.choose();
            if (r && r.ok) toast(r.video ? 'Live wallpaper set' : 'Wallpaper set');
            else if (r && r.reason) toast(r.reason);
        });
        grid.appendChild(upload);
    }

    function renderAccentSwatches() {
        const box = $('accent-swatches');
        if (!box || !window.neiraTheme) return;
        window.neiraTheme.swatches(box, settings.accent, hex => api.settings.set('accent', hex));
    }

    function syncDrawerControls() {
        if ($('hide-splash')) {
            $('hide-splash').checked = settings.hideSplash === true;
        }
        if ($('dim')) {
            $('dim').value = String(settings.wallpaperDim || 0);
            $('dim-out').textContent = (settings.wallpaperDim || 0) + '%';
        }
        if ($('blur')) {
            $('blur').value = String(settings.wallpaperBlur || 0);
            $('blur-out').textContent = (settings.wallpaperBlur || 0) + 'px';
        }
        if ($('show-clock')) $('show-clock').checked = settings.showClock !== false;
    }

    function openDrawer() {
        if (!drawer) return;
        drawer.hidden = false;
        renderWallpaperGrid();
        renderAccentSwatches();
        syncDrawerControls();
        $('drawer-close').focus();
    }
    function closeDrawer() {
        if (!drawer) return;
        drawer.hidden = true;
        if ($('customize-btn')) $('customize-btn').focus();
    }

    if ($('customize-btn')) $('customize-btn').addEventListener('click', () => (drawer.hidden ? openDrawer() : closeDrawer()));
    if ($('drawer-close')) $('drawer-close').addEventListener('click', closeDrawer);
    if (drawer) drawer.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
    if ($('all-settings')) $('all-settings').addEventListener('click', () => go('neira://settings'));

    if ($('dim')) {
        $('dim').addEventListener('input', e => {
            const d = $('wp-dim');
            if (d) d.style.opacity = String(Number(e.target.value) / 100);
            $('dim-out').textContent = e.target.value + '%';
        });
        $('dim').addEventListener('change', e => api.settings.set('wallpaperDim', Number(e.target.value)));
    }
    if ($('blur')) {
        $('blur').addEventListener('input', e => {
            const w = $('wallpaper');
            if (w) w.style.setProperty('--blur', e.target.value + 'px');
            $('blur-out').textContent = e.target.value + 'px';
        });
        $('blur').addEventListener('change', e => api.settings.set('wallpaperBlur', Number(e.target.value)));
    }
    if ($('show-clock')) $('show-clock').addEventListener('change', e => api.settings.set('showClock', e.target.checked));

if ($('hide-splash')) {
    $('hide-splash').checked = settings.hideSplash === true;
    $('hide-splash').addEventListener('change', e => api.settings.set('hideSplash', e.target.checked));
}

    // -------------------------------------------------------------------
    // Boot
    // -------------------------------------------------------------------
   function applySettings(next) {
    if (LEGACY_WALLPAPERS[next.wallpaper]) {
        const fixed = LEGACY_WALLPAPERS[next.wallpaper];
        next = { ...next, wallpaper: fixed };
        api.settings.set('wallpaper', fixed);   // save the migrated value
    }
    const wallpaperChanged = next.wallpaper !== settings.wallpaper
        || next.wallpaperDim !== settings.wallpaperDim || next.wallpaperBlur !== settings.wallpaperBlur;
    settings = next;
    window.neiraTheme.apply(next);
    window.neiraTheme.persist(next);

    if (wallpaperChanged) applyWallpaper();
    if ($('clock')) $('clock').hidden = settings.showClock === false;
    if ($('engine')) $('engine').value = settings.engine;
    if (drawer && !drawer.hidden) { renderWallpaperGrid(); renderAccentSwatches(); syncDrawerControls(); }
}
    async function init() {
        tick();
        if (qInput) qInput.focus();
        renderDial();
        
        const [s, d, h, b] = await Promise.allSettled([
            api.settings.get(), api.speedDial.get(), api.history.get(), api.bookmarks.get()
        ]);
        
        if (d.status === 'fulfilled') dial = d.value;
        if (h.status === 'fulfilled') historyItems = h.value;
        if (b.status === 'fulfilled') bookmarkItems = b.value;
        
        // Default settings fallback
        settings = { ...settings, wallpaper: 'preset:nebula' };
        if (s.status === 'fulfilled') applySettings(s.value);
        else applyWallpaper();
        
        renderDial();

        api.settings.onChange(applySettings);
        api.speedDial.onChange(list => { dial = list; renderDial(); });
        api.history.onChange(list => { historyItems = list; });
        api.bookmarks.onChange(list => { bookmarkItems = list; });
        
        if (location.hash === '#customize') openDrawer();
    }
    
    init();
})();