'use strict';
(() => {
        
    const api = window.neira;
    const $ = id => document.getElementById(id);
    const root = document.documentElement;
    const content = $('content');

    // ---------- Import wizard launcher ----------
    (() => {
        const openBtn = $('import-open');
        const status = $('import-status');
        const whyBtn = $('import-close-others');
        if (!openBtn) return;

        openBtn.addEventListener('click', () => {
            if (api && api.importer && api.importer.openWizard) {
                api.importer.openWizard();
                if (status) {
                    status.textContent = 'Opening the import wizard…';
                    setTimeout(() => { status.textContent = ''; }, 2000);
                }
            } else if (status) {
                status.textContent = 'The import wizard is not available in this build yet.';
                status.classList.add('warn');
            }
        });

        if (whyBtn) {
            whyBtn.addEventListener('click', () => {
                if (!status) return;
                status.textContent = 'Chrome, Edge, and Firefox lock their cookies while running. Close them first. Bookmarks and history still work either way.';
                setTimeout(() => { status.textContent = ''; }, 7000);
            });
        }
    })();

    const SECTIONS = {
        history: 'History',
        bookmarks: 'Bookmarks',
        downloads: 'Downloads',
        extensions: 'Extensions',
        permissions: 'Site permissions',
                sync: 'Sync',
        appearance: 'Appearance & Theme',
        ai: 'Local AI',
        search: 'Search & Startup',
        shortcuts: 'Keyboard Shortcuts',
        passwords: 'Passwords',
        privacy: 'Privacy & Security',
        parental: 'Parental Controls',
        about: 'About'
    };
    const PAGE_SIZE = 200;

    let settings = {};
    const loaders = {};
    const loaded = new Set();
    let currentSection = null;

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
        toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
    }

    function skeleton() {
        const s = el('div', 'skeleton');
        s.append(el('i'), el('i'), el('i'));
        return s;
    }

    function failure(container, message, retry) {
        container.replaceChildren();
        const box = el('div', 'empty', message + ' ');
        const btn = el('button', 'btn btn-small', 'Try again');
        btn.addEventListener('click', retry);
        box.appendChild(btn);
        container.appendChild(box);
    }

    function formatBytes(n) {
        if (!n || n < 0) return '';
        const units = ['B', 'KB', 'MB', 'GB'];
        let i = 0;
        while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
        return n.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
    }

    function openUrl(url) { api.newtab.go(url, true); }

    function removeButton(label, onClick) {
        const b = el('button', 'remove', '✕');
        b.title = label;
        b.setAttribute('aria-label', label);
        b.addEventListener('click', e => { e.stopPropagation(); onClick(); });
        return b;
    }

    function setBadge(id, count) {
        const b = $(id);
        if (!b) return;
        b.textContent = count;
        b.hidden = !count;
    }

    function formatClock(seconds) {
        const s = Math.max(0, Math.floor(seconds));
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        if (h) return `${h}h ${m}m`;
        return `${m}m`;
    }

    // -----------------------------------------------------------------------
    // Router
    // -----------------------------------------------------------------------
    function sectionFromLocation() {
        const hash = location.hash.slice(1);
        if (SECTIONS[hash]) return hash;
        let remembered = null;
        try { remembered = sessionStorage.getItem('neira.section'); } catch (_) {}
        return SECTIONS[remembered] ? remembered : 'history';
    }

    function showSection(id) {
        if (currentSection === 'shortcuts' && id !== 'shortcuts') cancelRecording();
        if (currentSection === 'parental' && id !== 'parental' && pcUnlocked) pcUnlocked = false;
        currentSection = id;
        document.querySelectorAll('.page-section').forEach(s => s.classList.toggle('active', s.id === id));
        document.querySelectorAll('.nav-item').forEach(n => {
            const on = n.dataset.section === id;
            n.classList.toggle('active', on);
            if (on) n.setAttribute('aria-current', 'page'); else n.removeAttribute('aria-current');
        });
        document.title = SECTIONS[id] + ' - Neira Browser';
        try { sessionStorage.setItem('neira.section', id); } catch (_) {}
        content.scrollTop = 0;
        if (loaders[id]) {
            if (id === 'parental' || id === 'permissions') loaders[id]();
            else if (!loaded.has(id)) { loaded.add(id); loaders[id](); }
        }
        if (id === 'parental') refreshParentalBadge();
    }

    function route() {
        const id = sectionFromLocation();
        if (location.hash.slice(1) !== id) history.replaceState(null, '', '#' + id);
        showSection(id);
    }

    // -----------------------------------------------------------------------
    // Settings
    // -----------------------------------------------------------------------
    function applySettings(s) {
        settings = s;
        window.neiraTheme.apply(s);
        window.neiraTheme.persist(s);
        window.neiraTheme.swatches($('accent-swatches'), s.accent, hex => api.settings.set('accent', hex));
        $('tint-select').value = s.accentTint || 'off';
        $('ai-toggle').checked = !!s.localAI;
        $('ai-model').value = s.localAIModel || 'balanced';
        $('light-mode').checked = s.theme === 'light';
        $('density-select').value = s.density;
        $('layout-select').value = s.tabLayout;
        $('sidebar-collapsed').checked = !!s.sidebarCollapsed;
        $('newtab-select').value = s.newTabPage;
        $('bookmarks-bar').checked = s.showBookmarksBar !== false;
        $('engine-select').value = s.engine;
        if (document.activeElement !== $('homepage-input')) $('homepage-input').value = s.homepage;
        $('incognito-startup').checked = !!s.incognitoStartup;
        document.querySelectorAll('input[data-setting]').forEach(input => { input.checked = !!s[input.dataset.setting]; });
    }

    function bindSettings() {
        $('light-mode').addEventListener('change', e => api.settings.set('theme', e.target.checked ? 'light' : 'dark'));
        $('density-select').addEventListener('change', e => api.settings.set('density', e.target.value));
        $('tint-select').addEventListener('change', e => api.settings.set('accentTint', e.target.value));
        $('ai-toggle').addEventListener('change', e => api.settings.set('localAI', e.target.checked));
        $('ai-model').addEventListener('change', e => api.settings.set('localAIModel', e.target.value));
        $('layout-select').addEventListener('change', e => api.settings.set('tabLayout', e.target.value));
        $('sidebar-collapsed').addEventListener('change', e => api.settings.set('sidebarCollapsed', e.target.checked));
        $('newtab-select').addEventListener('change', e => api.settings.set('newTabPage', e.target.value));
        $('open-newtab').addEventListener('click', () => api.newtab.go('neira://newtab#customize', true));
        $('bookmarks-bar').addEventListener('change', e => api.settings.set('showBookmarksBar', e.target.checked));
        $('engine-select').addEventListener('change', e => api.settings.set('engine', e.target.value));
        $('incognito-startup').addEventListener('change', e => api.settings.set('incognitoStartup', e.target.checked));
        document.querySelectorAll('input[data-setting]').forEach(input => {
            input.addEventListener('change', () => api.settings.set(input.dataset.setting, input.checked));
        });

        async function saveHomepage() {
            const input = $('homepage-input');
            const status = $('home-status');
            let value = input.value.trim();
            if (!value) return;
            if (!/^https?:\/\//i.test(value)) value = 'https://' + value;
            const before = settings.homepage;
            const next = await api.settings.set('homepage', value);
            const ok = next.homepage !== before || next.homepage === new URL(value, 'https://x').href;
            status.textContent = ok ? 'Home page saved.' : 'Enter a valid http or https address.';
            status.classList.toggle('warn', !ok);
            input.value = next.homepage;
        }
        $('homepage-input').addEventListener('keydown', e => { if (e.key === 'Enter') saveHomepage(); });
        $('homepage-input').addEventListener('change', saveHomepage);

        $('open-private').addEventListener('click', () => api.runMainAction('new_private_window'));
        $('clear-data').addEventListener('click', async () => {
            const r = await api.clearBrowsingData();
            if (r && r.ok) toast('Browsing data cleared');
        });
    }

    // -----------------------------------------------------------------------
    // List sections
    // -----------------------------------------------------------------------
    function makeListSection({ listId, searchId, fetch, subscribe, render }) {
        const state = { data: [], limit: PAGE_SIZE };
        const list = $(listId);
        const search = $(searchId);
        let unsub = null;
        function draw() {
            list.replaceChildren();
            const q = search.value.trim().toLowerCase();
            render(state, q, list);
        }
        async function load() {
            list.replaceChildren(skeleton());
            try {
                state.data = await fetch();
                if (unsub) unsub();
                unsub = subscribe(next => { state.data = next; draw(); });
                draw();
            } catch (_) {
                loaded.delete(listId.split('-')[0]);
                failure(list, 'Could not load this list.', () => { loaded.add(listId.split('-')[0]); load(); });
            }
        }
        search.addEventListener('input', () => { state.limit = PAGE_SIZE; draw(); });
        return { load, state, draw };
    }

    function moreButton(state, total, redraw, container) {
        if (total <= state.limit) return;
        const b = el('button', 'btn more', `Show more (${total - state.limit} left)`);
        b.addEventListener('click', () => { state.limit += PAGE_SIZE; redraw(); });
        container.after(b);
        b.dataset.more = '1';
    }

    function clearMoreButtons(container) {
        const next = container.nextElementSibling;
        if (next && next.dataset.more) next.remove();
    }

    const historySection = makeListSection({
        listId: 'history-list', searchId: 'history-search',
        fetch: () => api.history.get(),
        subscribe: cb => api.history.onChange(cb),
        render(state, q, list) {
            clearMoreButtons(list);
            const items = state.data.filter(h => !q || (h.title + ' ' + h.url).toLowerCase().includes(q));
            if (!items.length) { list.appendChild(el('div', 'empty', q ? 'No matching history.' : 'Pages you visit will show up here.')); return; }
            let lastDay = '';
            for (const h of items.slice(0, state.limit)) {
                const day = new Date(h.time).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
                if (day !== lastDay) { list.appendChild(el('div', 'day', day)); lastDay = day; }
                const row = el('div', 'row');
                const meta = el('div', 'meta');
                meta.append(el('div', 'title', h.title || h.url), el('div', 'sub', h.url));
                row.append(meta, el('div', 'time', new Date(h.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })), removeButton('Remove from history', () => api.history.remove(h.id)));
                row.addEventListener('click', () => openUrl(h.url));
                list.appendChild(row);
            }
            moreButton(state, items.length, historySection.draw, list);
        }
    });
    loaders.history = historySection.load;

    const bookmarksSection = makeListSection({
        listId: 'bookmarks-list', searchId: 'bookmarks-search',
        fetch: () => api.bookmarks.get(),
        subscribe: cb => api.bookmarks.onChange(cb),
        render(state, q, list) {
            clearMoreButtons(list);
            setBadge('badge-bookmarks', state.data.length);
            const items = state.data.filter(b => !q || (b.title + ' ' + b.url).toLowerCase().includes(q));
            if (!items.length) { list.appendChild(el('div', 'empty', q ? 'No matching bookmarks.' : 'No bookmarks yet. Press the ★ in the address bar.')); return; }
            for (const b of items.slice(0, state.limit)) {
                const row = el('div', 'row');
                const meta = el('div', 'meta');
                meta.append(el('div', 'title', b.title || b.url), el('div', 'sub', b.url));
                row.append(meta, removeButton('Remove bookmark', () => api.bookmarks.remove(b.url)));
                row.addEventListener('click', () => openUrl(b.url));
                list.appendChild(row);
            }
            moreButton(state, items.length, bookmarksSection.draw, list);
        }
    });
    loaders.bookmarks = bookmarksSection.load;

    const downloadsSection = makeListSection({
        listId: 'downloads-list', searchId: 'downloads-search',
        fetch: () => api.downloads.get(),
        subscribe: cb => api.downloads.onChange(cb),
        render(state, q, list) {
            clearMoreButtons(list);
            const running = state.data.filter(d => d.state === 'progressing' || d.state === 'paused').length;
            setBadge('badge-downloads', running);
            const items = state.data.filter(d => !q || (d.name + ' ' + d.url).toLowerCase().includes(q));
            if (!items.length) { list.appendChild(el('div', 'empty', q ? 'No matching downloads.' : 'Files you download will show up here.')); return; }
            for (const d of items.slice(0, state.limit)) {
                const row = el('div', 'row static');
                const meta = el('div', 'meta');
                const active = d.state === 'progressing' || d.state === 'paused';
                let status;
                if (active) status = `${formatBytes(d.received)}${d.total > 0 ? ' of ' + formatBytes(d.total) : ''}`;
                else if (d.state === 'completed') status = formatBytes(d.total || d.received) + ' · Completed';
                else status = d.state === 'cancelled' ? 'Cancelled' : 'Failed';
                meta.append(el('div', 'title', d.name), el('div', 'sub', status));
                if (active && d.total > 0) {
                    const bar = el('div', 'bar');
                    const fill = document.createElement('div');
                    fill.style.width = Math.min(100, Math.round((d.received / d.total) * 100)) + '%';
                    bar.appendChild(fill);
                    meta.appendChild(bar);
                }
                const actions = el('div', 'actions');
                if (d.state === 'completed') {
                    const open = el('button', 'btn btn-small', 'Open');
                    open.addEventListener('click', () => api.downloads.open(d.id));
                    const show = el('button', 'btn btn-small', 'Show in folder');
                    show.addEventListener('click', () => api.downloads.show(d.id));
                    actions.append(open, show);
                } else if (active) {
                    const cancel = el('button', 'btn btn-small', 'Cancel');
                    cancel.addEventListener('click', () => api.downloads.cancel(d.id));
                    actions.appendChild(cancel);
                }
                row.append(meta, actions);
                list.appendChild(row);
            }
            moreButton(state, items.length, downloadsSection.draw, list);
        }
    });
    loaders.downloads = downloadsSection.load;

    $('history-clear').addEventListener('click', async () => {
        if (await api.confirm('Clear all browsing history?')) await api.history.clear();
    });
    $('downloads-clear').addEventListener('click', () => api.downloads.clear());

    async function primeBadges() {
        try {
            const [bm, dl] = await Promise.all([api.bookmarks.get(), api.downloads.get()]);
            setBadge('badge-bookmarks', bm.length);
            setBadge('badge-downloads', dl.filter(d => d.state === 'progressing' || d.state === 'paused').length);
            api.bookmarks.onChange(list => setBadge('badge-bookmarks', list.length));
            api.downloads.onChange(list => setBadge('badge-downloads', list.filter(d => d.state === 'progressing' || d.state === 'paused').length));
        } catch (_) {}
    }

    // -----------------------------------------------------------------------
    // Extensions
    // -----------------------------------------------------------------------
    const EXT_KEY = 'neira.extensions';
    let extensions = [];
    let extTab = 'mine';

    function loadExtensions() {
        try { extensions = JSON.parse(localStorage.getItem(EXT_KEY) || '[]'); } catch (_) { extensions = []; }
        if (!Array.isArray(extensions)) extensions = [];
    }
    function saveExtensions() { try { localStorage.setItem(EXT_KEY, JSON.stringify(extensions)); } catch (_) {} }

    function renderExtensions() {
        const list = $('ext-list');
        const empty = $('ext-empty');
        if (!list || !empty) return;
        list.replaceChildren();
        if (!extensions.length) { list.hidden = true; empty.hidden = false; return; }
        list.hidden = false;
        empty.hidden = true;
        for (const ext of extensions) {
            const card = el('div', 'ext-card');
            const icon = el('div', 'ext-icon', ext.icon || '🧩');
            const info = el('div', 'ext-info');
            info.append(
                el('div', 'ext-name', ext.name),
                el('div', 'ext-meta', `v${ext.version || '1.0.0'} · Local extension`),
                el('div', 'ext-desc', ext.description || 'No description provided.')
            );
            const actions = el('div', 'ext-actions');
            const toggleLabel = ext.enabled !== false ? 'Disable' : 'Enable';
            const toggle = el('button', 'btn btn-small', toggleLabel);
            toggle.addEventListener('click', () => {
                ext.enabled = ext.enabled === false;
                saveExtensions();
                renderExtensions();
                toast(ext.enabled ? `${ext.name} enabled` : `${ext.name} disabled`);
            });
            const remove = el('button', 'btn btn-small btn-danger', 'Remove');
            remove.addEventListener('click', async () => {
                if (!await api.confirm(`Remove the extension “${ext.name}”?`)) return;
                extensions = extensions.filter(e => e.id !== ext.id);
                saveExtensions();
                renderExtensions();
                toast('Extension removed');
            });
            actions.append(toggle, remove);
            info.appendChild(actions);
            card.append(icon, info);
            list.appendChild(card);
        }
    }

    function renderExtShortcuts() {
        const body = $('ext-shortcuts-body');
        if (!body) return;
        body.replaceChildren();
        const withKeys = extensions.filter(e => e.shortcuts && Object.keys(e.shortcuts).length);
        if (!withKeys.length) {
            const box = el('div', 'list');
            box.appendChild(el('div', 'empty', 'No extension shortcuts yet.'));
            body.appendChild(box);
            return;
        }
        for (const ext of withKeys) {
            const head = el('h3', 'sc-cat', ext.name);
            const list = el('div', 'sc-list');
            for (const [name, combo] of Object.entries(ext.shortcuts)) {
                const row = el('div', 'sc-row');
                row.append(el('div', 'sc-name', name), el('div', 'keys', combo || 'Not set'));
                list.appendChild(row);
            }
            body.append(head, list);
        }
    }

    function bindExtensions() {
        document.querySelectorAll('.ext-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                extTab = tab.dataset.tab;
                document.querySelectorAll('.ext-tab').forEach(t => {
                    const on = t === tab;
                    t.classList.toggle('active', on);
                    t.setAttribute('aria-selected', String(on));
                });
                $('ext-panel-mine').hidden = extTab !== 'mine';
                $('ext-panel-shortcuts').hidden = extTab !== 'shortcuts';
                if (extTab === 'shortcuts') renderExtShortcuts();
            });
        });
        const loadBtn = $('ext-load');
        if (loadBtn) loadBtn.addEventListener('click', async () => {
            if (!api.extensions || !api.extensions.load) { toast('Loading extensions is not available in this build.'); return; }
            try {
                const r = await api.extensions.load();
                if (!r || !r.ok) { if (r && r.reason) toast(r.reason); return; }
                const existing = extensions.findIndex(e => e.id === r.extension.id);
                if (existing >= 0) extensions[existing] = r.extension;
                else extensions.push(r.extension);
                saveExtensions();
                renderExtensions();
                toast(`Loaded ${r.extension.name}`);
            } catch (_) {
                toast('Could not load that extension.');
            }
        });
        const store = $('ext-store');
        if (store) store.addEventListener('click', e => {
            e.preventDefault();
            api.newtab.go('https://chromewebstore.google.com/', true);
        });
    }

    loaders.extensions = () => { loadExtensions(); renderExtensions(); };

    // -----------------------------------------------------------------------
    // Keyboard shortcuts
    // -----------------------------------------------------------------------
    const sc = { data: null, search: '', chip: 'all', recording: null, last: null };
    const KEY_LABELS = { Left: '←', Right: '→', Up: '↑', Down: '↓', Delete: 'Del', Escape: 'Esc' };

    function parseCombo(combo) {
        const i = combo.lastIndexOf(' + ');
        return i < 0 ? [combo] : [...combo.slice(0, i).split(' + '), combo.slice(i + 3)];
    }

    function keycaps(combo) {
        const frag = document.createDocumentFragment();
        if (!combo) { frag.appendChild(el('span', 'keys-empty', 'Not set')); return frag; }
        parseCombo(combo).forEach((part, i) => {
            if (i) frag.appendChild(el('span', 'keys-plus', '+'));
            frag.appendChild(el('kbd', '', KEY_LABELS[part] || part));
        });
        return frag;
    }

    const comboLabel = combo => (combo ? combo.replace(/ \+ /g, '+') : 'no shortcut');
    const isCustom = id => sc.data.map[id] !== sc.data.defaults[id];

    function matchesFilters(cat, item) {
        const combo = sc.data.map[item.id] || '';
        if (sc.chip === '__custom' && !isCustom(item.id)) return false;
        if (sc.chip !== 'all' && sc.chip !== '__custom' && sc.chip !== cat.category) return false;
        const q = sc.search;
        if (!q) return true;
        const haystack = (item.name + ' ' + combo + ' ' + combo.replace(/ \+ /g, '') + ' ' + cat.category).toLowerCase();
        return haystack.includes(q) || haystack.includes(q.replace(/\s*\+\s*/g, ' + '));
    }

    function renderChips() {
        const chips = $('sc-chips');
        chips.replaceChildren();
        const total = sc.data.categories.reduce((n, c) => n + c.items.length, 0);
        const custom = sc.data.categories.reduce((n, c) => n + c.items.filter(i => isCustom(i.id)).length, 0);
        setBadge('badge-shortcuts', custom);
        const defs = [{ key: 'all', label: 'All', count: total }];
        for (const c of sc.data.categories) defs.push({ key: c.category, label: c.category, count: c.items.length });
        defs.push({ key: '__custom', label: 'Customized', count: custom });
        for (const d of defs) {
            const b = el('button', 'chip' + (sc.chip === d.key ? ' active' : ''), d.label);
            b.appendChild(el('b', '', String(d.count)));
            b.setAttribute('aria-pressed', sc.chip === d.key ? 'true' : 'false');
            b.addEventListener('click', () => { sc.chip = d.key; renderShortcuts(); });
            chips.appendChild(b);
        }
    }

    function renderShortcuts() {
        if (!sc.data) return;
        const scroll = content.scrollTop;
        renderChips();
        const body = $('sc-body');
        body.replaceChildren();
        let shown = 0;
        for (const cat of sc.data.categories) {
            const items = cat.items.filter(item => matchesFilters(cat, item));
            if (!items.length) continue;
            const head = el('h3', 'sc-cat', cat.category);
            head.appendChild(el('span', '', `${items.length} shortcut${items.length === 1 ? '' : 's'}`));
            const list = el('div', 'sc-list');
            for (const item of items) {
                shown++;
                const combo = sc.data.map[item.id] || '';
                const custom = isCustom(item.id);
                const row = el('div', 'sc-row' + (sc.recording === item.id ? ' recording' : ''));
                row.dataset.id = item.id;
                const name = el('div', 'sc-name');
                name.appendChild(el('span', '', item.name));
                if (custom) { const dot = el('span', 'sc-dot'); dot.title = 'Customized'; name.appendChild(dot); }
                const actions = el('div', 'sc-actions');
                const reset = el('button', 'icon-btn' + (custom ? '' : ' hidden'), '↺');
                reset.title = `Restore default (${comboLabel(sc.data.defaults[item.id])})`;
                reset.setAttribute('aria-label', 'Restore default shortcut for ' + item.name);
                reset.addEventListener('click', e => { e.stopPropagation(); resetOne(item.id); });
                const clear = el('button', 'icon-btn' + (combo ? '' : ' hidden'), '✕');
                clear.title = 'Remove shortcut';
                clear.setAttribute('aria-label', 'Remove shortcut for ' + item.name);
                clear.addEventListener('click', e => { e.stopPropagation(); clearOne(item.id); });
                const keys = el('button', 'keys');
                keys.setAttribute('aria-label', `${item.name}: ${comboLabel(combo)}. Click to change.`);
                if (sc.recording === item.id) keys.appendChild(el('span', 'keys-live', 'Press keys…'));
                else keys.appendChild(keycaps(combo));
                actions.append(reset, clear, keys);
                row.append(name, actions);
                row.addEventListener('click', () => toggleRecording(item.id));
                list.appendChild(row);
            }
            body.append(head, list);
        }
        if (!shown) {
            const list = el('div', 'list');
            list.appendChild(el('div', 'empty', sc.chip === '__custom' && !sc.search ? 'You haven’t customized any shortcuts yet.' : 'No shortcuts match.'));
            body.appendChild(list);
        }
        content.scrollTop = scroll;
    }

    function showBanner(id) {
        const banner = $('record-banner');
        banner.hidden = !id;
        banner.classList.remove('warn');
        if (!id) return;
        $('record-title').textContent = `Set shortcut for “${sc.data.names[id]}”`;
        $('record-hint').textContent = 'Press the new keys · Esc cancels · Backspace clears';
        $('record-preview').textContent = '';
    }

    function toggleRecording(id) {
        if (sc.recording === id) { cancelRecording(); return; }
        sc.recording = id;
        api.shortcuts.startRecording(id);
        showBanner(id);
        renderShortcuts();
        const row = document.querySelector(`.sc-row[data-id="${id}"]`);
        if (row) row.scrollIntoView({ block: 'nearest' });
    }

    function cancelRecording() {
        if (!sc.recording) return;
        sc.recording = null;
        api.shortcuts.stopRecording();
        showBanner(null);
        renderShortcuts();
    }

    let snackTimer;
    function showSnack(message, change) {
        sc.last = change || null;
        $('snack-msg').textContent = message;
        $('snack-undo').hidden = !change;
        $('snack').hidden = false;
        clearTimeout(snackTimer);
        snackTimer = setTimeout(hideSnack, 7000);
    }
    function hideSnack() { $('snack').hidden = true; sc.last = null; }

    function describeChange({ id, combo, displaced }) {
        const name = sc.data.names[id];
        if (!combo) return `“${name}” no longer has a shortcut.`;
        let msg = `“${name}” is now ${comboLabel(combo)}.`;
        if (displaced) msg += ` “${sc.data.names[displaced]}” lost that shortcut.`;
        return msg;
    }

    async function undoLast() {
        const ch = sc.last;
        if (!ch) return;
        hideSnack();
        await api.shortcuts.set(ch.id, ch.previous);
        if (ch.displaced) await api.shortcuts.set(ch.displaced, ch.combo);
        toast('Change undone');
    }

    async function resetOne(id) {
        cancelRecording();
        const r = await api.shortcuts.resetOne(id);
        const combo = sc.data.defaults[id];
        showSnack(describeChange({ id, combo, displaced: r.displaced }), { id, previous: r.previous, combo, displaced: r.displaced });
    }

    async function clearOne(id) {
        cancelRecording();
        const r = await api.shortcuts.set(id, '');
        showSnack(describeChange({ id, combo: '' }), { id, previous: r.previous, combo: '', displaced: null });
    }

    function bindShortcuts() {
        api.shortcuts.onRecordPreview(text => {
            if (!sc.recording) return;
            $('record-banner').classList.remove('warn');
            $('record-preview').textContent = text;
        });
        api.shortcuts.onRecordInvalid(reason => {
            $('record-banner').classList.add('warn');
            $('record-hint').textContent = reason + '. Try another combination.';
        });
        api.shortcuts.onRecordDone(change => {
            sc.recording = null;
            showBanner(null);
            showSnack(describeChange(change), change);
            renderShortcuts();
        });
        api.shortcuts.onRecordCancel(() => {
            sc.recording = null;
            showBanner(null);
            renderShortcuts();
        });
        api.shortcuts.onChange(({ map }) => {
            if (!sc.data) return;
            sc.data.map = map;
            renderShortcuts();
        });
        $('sc-search').addEventListener('input', e => { sc.search = e.target.value.trim().toLowerCase(); renderShortcuts(); });
        $('sc-search').addEventListener('focus', cancelRecording);
        $('snack-undo').addEventListener('click', undoLast);
        $('sc-reset').addEventListener('click', async () => {
            cancelRecording();
            if (!await api.confirm('Reset every shortcut to its default?')) return;
            await api.shortcuts.reset();
            showSnack('All shortcuts restored to their defaults.');
        });
        $('sc-export').addEventListener('click', async () => {
            const r = await api.shortcuts.exportFile();
            if (r && r.ok) toast('Shortcuts exported');
        });
        $('sc-import').addEventListener('click', async () => {
            cancelRecording();
            const r = await api.shortcuts.importFile();
            if (r && r.ok) showSnack(`Imported ${r.count} shortcut${r.count === 1 ? '' : 's'}.`);
            else if (r && r.reason) toast(r.reason);
        });
        document.addEventListener('mousedown', e => { if (sc.recording && !e.target.closest('.sc-row, #record-banner')) cancelRecording(); });
        window.addEventListener('blur', cancelRecording);
        window.addEventListener('beforeunload', () => api.shortcuts.stopRecording());
        document.addEventListener('visibilitychange', () => { if (document.hidden) cancelRecording(); });
    }

    async function loadShortcuts() {
        const body = $('sc-body');
        if (sc.data) { renderShortcuts(); return; }
        body.replaceChildren(el('div', 'list'));
        body.firstChild.appendChild(skeleton());
        try {
            sc.data = await api.shortcuts.get();
            renderShortcuts();
        } catch (_) {
            loaded.delete('shortcuts');
            failure(body, 'Could not load shortcuts.', () => { loaded.add('shortcuts'); loadShortcuts(); });
        }
    }
    loaders.shortcuts = loadShortcuts;

    // -----------------------------------------------------------------------
    // Permissions
    // -----------------------------------------------------------------------
    const PERM_LABELS = { media: '🎥 Camera & microphone', notifications: '🔔 Notifications' };

async function renderPermissions() {
    try {
        const list = await api.permissions.list();
        $('perm-desc').textContent = list.length
            ? `${list.length} remembered choice${list.length === 1 ? '' : 's'}. Location is always blocked.`
            : 'No remembered choices. Neira asks before a site uses your camera, microphone or notifications.';
        $('perm-reset').disabled = !list.length;
    } catch (_) {}
}

async function renderPermSites() {
    const boxEl = $('perm-sites');
    let rows;
    try { rows = await api.permissions.listDetailed(); }
    catch (_) { failure(boxEl, 'Could not load site permissions.', renderPermSites); return; }

    const q = $('perm-search').value.trim().toLowerCase();
    rows = rows.filter(r => !q || r.origin.toLowerCase().includes(q));
    boxEl.replaceChildren();

    if (!rows.length) {
        const list = el('div', 'list');
        list.appendChild(el('div', 'empty', q ? 'No matching sites.' : 'No remembered site permissions yet.'));
        boxEl.appendChild(list);
        return;
    }

    for (const row of rows) {
        const card = el('div', 'perm-site');
        const head = el('div', 'perm-head');
        head.appendChild(el('span', 'perm-origin', row.origin.replace(/^https?:\/\//, '')));
        const rm = el('button', 'btn btn-small btn-danger', 'Remove site');
        rm.addEventListener('click', async () => {
            if (!await api.confirm(`Forget all remembered choices for ${row.origin}?`)) return;
            await api.permissions.removeOrigin(row.origin);
            toast('Site removed');
        });
        head.appendChild(rm);
        card.appendChild(head);

        for (const p of row.perms) {
            const line = el('div', 'perm-row');
            const label = PERM_LABELS[p.permission] || p.permission;
            line.appendChild(el('span', '', label));

            const sel = document.createElement('select');
            sel.setAttribute('aria-label', `${label} for ${row.origin}`);
            for (const [v, t] of [['allow', 'Allow'], ['block', 'Block'], ['ask', 'Ask every time']]) {
                const o = document.createElement('option');
                o.value = v;
                o.textContent = t;
                sel.appendChild(o);
            }
            sel.value = p.allow ? 'allow' : 'block';
            sel.addEventListener('change', async () => {
                if (sel.value === 'ask') await api.permissions.removeFor(row.origin, p.permission);
                else await api.permissions.setFor(row.origin, p.permission, sel.value === 'allow');
                toast(sel.value === 'ask' ? 'Will ask next time' : `${label}: ${sel.value}`);
            });
            line.appendChild(sel);
            card.appendChild(line);
        }
        boxEl.appendChild(card);
    }
}

loaders.privacy = renderPermissions;
loaders.permissions = renderPermSites;

$('perm-search').addEventListener('input', renderPermSites);
$('perm-manage').addEventListener('click', () => { location.hash = '#permissions'; });
$('perm-reset').addEventListener('click', async () => {
    if (!await api.confirm('Forget all remembered site permission choices?')) return;
    await api.permissions.clear();
    toast('Site permissions reset');
});
api.permissions.onChanged(() => {
    renderPermissions();
    if (currentSection === 'permissions') renderPermSites();
});

    // -----------------------------------------------------------------------
    // Passwords
    // -----------------------------------------------------------------------
    function siteRow(label, sub, onClick, onDelete, deleteLabel) {
        const row = el('div', 'row' + (onClick ? '' : ' static'));
        const meta = el('div', 'meta');
        meta.appendChild(el('div', 'title', label));
        if (sub) meta.appendChild(el('div', 'sub', sub));
        row.append(meta, removeButton(deleteLabel, onDelete));
        if (onClick) row.addEventListener('click', onClick);
        return row;
    }

    async function renderPasswords() {
        const list = $('pw-list');
        try {
            const { items, encrypted } = await api.passwords.list();
            $('passwords-sub').textContent = encrypted
                ? 'Click a saved entry to copy its password for 30 seconds.'
                : 'Warning: OS encryption is unavailable. Click an entry to copy its password.';
            list.replaceChildren();
            if (!items.length) list.appendChild(el('div', 'empty', 'No saved passwords yet.'));
            for (const item of items) {
                list.appendChild(siteRow(item.site, item.user,
                    async () => { if (await api.passwords.copy(item.id)) toast('Password copied for 30 seconds'); },
                    async () => { await api.passwords.remove(item.id); renderPasswords(); },
                    'Delete password'));
            }
            const declinedList = $('declined-list');
            const declined = await api.passwords.declined();
            declinedList.replaceChildren();
            if (!declined.length) declinedList.appendChild(el('div', 'empty', 'No declined sites.'));
            for (const site of declined) {
                declinedList.appendChild(siteRow(site, '', null, async () => { await api.passwords.removeDeclined(site); renderPasswords(); }, 'Remove'));
            }
        } catch (_) {
            loaded.delete('passwords');
            failure(list, 'Could not load passwords.', () => { loaded.add('passwords'); renderPasswords(); });
        }
    }
    loaders.passwords = () => { $('pw-list').replaceChildren(skeleton()); renderPasswords(); };

    function bindPasswords() {
        const modal = $('pw-modal');
        const close = () => {
            modal.classList.remove('active');
            ['pw-site', 'pw-user', 'pw-pass'].forEach(id => { $(id).value = ''; });
            $('pw-error').textContent = '';
        };
        $('pw-add').addEventListener('click', () => { modal.classList.add('active'); $('pw-site').focus(); });
        $('pw-cancel').addEventListener('click', close);
        modal.addEventListener('mousedown', e => { if (e.target === modal) close(); });
     modal.addEventListener('keydown', e => { if (e.key === 'Escape') close(); if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') $('pw-save').click(); });
               $('pw-save').addEventListener('click', async () => {
            const site = $('pw-site').value.trim();
            const user = $('pw-user').value.trim();
            const pass = $('pw-pass').value;
            if (!site || !user || !pass) { $('pw-error').textContent = 'Fill in the website, username and password.'; return; }
            let r;
            try { r = await api.passwords.add({ site, user, pass }); }
            catch (err) { $('pw-error').textContent = 'Could not save: ' + (err && err.message ? err.message : 'unknown error'); return; }
            if (!r || !r.ok) { $('pw-error').textContent = (r && r.reason) || 'Neira could not save this password.'; return; }
            close();
            await renderPasswords();
            toast('Password saved');
        });
        $('pw-import').addEventListener('click', async () => {
            const r = await api.passwords.import();
            if (r.ok) { toast(`Imported ${r.count} password${r.count === 1 ? '' : 's'}`); renderPasswords(); }
            else if (r.reason && r.reason !== 'Cancelled.') toast(r.reason);
        });
        $('pw-export').addEventListener('click', async () => {
            const r = await api.passwords.export();
            if (r.ok) toast(`Exported ${r.count} password${r.count === 1 ? '' : 's'}`);
            else if (r.reason && r.reason !== 'Cancelled.') toast(r.reason);
        });
        $('pw-delete-all').addEventListener('click', async () => {
            if (!await api.confirm('Delete all saved passwords and declined sites?')) return;
            await api.passwords.clear();
            if (loaded.has('passwords')) renderPasswords();
            toast('Password data deleted');
        });
    }

    // -----------------------------------------------------------------------
    // Parental Controls
    // -----------------------------------------------------------------------
    let pcState = null;
    let pcUnlocked = false;

    async function refreshParentalBadge() {
        try {
            const status = await api.parental.status();
            const badge = $('badge-parental');
            if (badge) {
                badge.hidden = !status.enabled;
                badge.textContent = status.enabled ? 'ON' : '';
            }
            const hidden = !!status.hidden && !!status.enabled;
            const nav = $('nav-parental');
            const grp = $('nav-group-family');
            if (nav) nav.hidden = hidden;
            if (grp) grp.hidden = hidden;
        } catch (_) {}
    }

    function showPcView(which) {
        $('pc-locked').hidden = which !== 'locked';
        $('pc-setup').hidden = which !== 'setup';
        $('pc-dashboard').hidden = which !== 'dashboard';
    }

    function hideRecoveryUi() {
        $('pc-recovery').hidden = true;
        $('pc-newrecovery').hidden = true;
        $('pc-recovery-code').value = '';
        $('pc-recovery-new').value = '';
        $('pc-recovery-new2').value = '';
        $('pc-recovery-error').textContent = '';
    }

    async function renderParentalLocked() {
        const status = await api.parental.status();
        pcState = status;
        hideRecoveryUi();
        if (!status.hasPin && !status.enabled) {
            $('pc-lock-title').textContent = 'Parental controls are off';
            $('pc-lock-sub').textContent = 'Set a PIN to enable SafeSearch, an educational allowlist and daily screen-time budgets.';
            $('pc-pin-wrap').hidden = true;
            $('pc-no-pin').hidden = false;
            $('pc-forgot-row').hidden = true;
        } else {
            $('pc-lock-title').textContent = 'Parental controls are locked';
            $('pc-lock-sub').textContent = 'Enter your PIN to view and change parental settings.';
            $('pc-pin-wrap').hidden = false;
            $('pc-no-pin').hidden = true;
            $('pc-forgot-row').hidden = false;
        }
        showPcView('locked');
    }

    function budgetRow(id, cat) {
        const row = el('div', 'pc-budget-row');
        const name = el('div', 'pc-budget-name');
        name.appendChild(el('strong', '', cat.label));
        name.appendChild(el('small', '', `${cat.hosts.length} sites · e.g. ${cat.hosts.slice(0, 3).join(', ')}`));
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.max = '600';
        input.step = '5';
        input.value = String(cat.minutes);
        input.setAttribute('aria-label', `${cat.label} daily limit in minutes`);

        const commit = async () => {
            const raw = input.value.trim();
            if (raw === '') { input.value = String(cat.minutes); return; }
            let minutes = Number(raw);
            if (!Number.isFinite(minutes)) { input.value = String(cat.minutes); return; }
            minutes = Math.max(0, Math.min(600, Math.round(minutes)));
            input.value = String(minutes);
            if (minutes === cat.minutes) return;
            const patch = { categories: {} };
            patch.categories[id] = { minutes };
            const r = await api.parental.update(patch);
            if (!r || !r.ok) {
                toast(r && r.reason ? r.reason : 'Could not save the budget.');
                input.value = String(cat.minutes);
                return;
            }
            const persisted = r.state && r.state.categories && r.state.categories[id];
            if (persisted) { cat.minutes = persisted.minutes; input.value = String(persisted.minutes); }
            toast(`${cat.label} limit saved: ${input.value} min/day`);
        };
        input.addEventListener('change', commit);
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
        row.append(name, input, el('div', 'pc-unit', 'min/day'));
        return row;
    }

    function usageCard(label, seconds, limitSeconds) {
        const card = el('div', 'pc-usage-card');
        card.appendChild(el('h4', '', label));
        card.appendChild(el('div', 'pc-big', formatClock(seconds)));
        if (limitSeconds > 0) {
            const pct = Math.min(100, Math.round((seconds / limitSeconds) * 100));
            card.appendChild(el('div', 'pc-sub', `${formatClock(Math.max(0, limitSeconds - seconds))} left of ${formatClock(limitSeconds)}`));
            const bar = el('div', 'bar');
            const fill = document.createElement('div');
            fill.style.width = pct + '%';
            bar.appendChild(fill);
            card.appendChild(bar);
            if (pct >= 100) card.classList.add('danger');
            else if (pct >= 75) card.classList.add('warn');
        } else {
            card.appendChild(el('div', 'pc-sub', 'Blocked'));
            card.classList.add('danger');
        }
        return card;
    }

    async function renderParentalDashboard() {
        const status = await api.parental.status();
        pcState = status;
        const usage = status.usage || {};

        // State banner: "on" or "off with a Turn on button"
        const banner = $('pc-state-banner');
        banner.replaceChildren();
        if (status.enabled) {
            banner.hidden = true;
        } else {
            banner.hidden = false;
            const card = el('div', 'setting-card');
            const info = el('div', 'setting-info');
            info.append(
                el('h3', '', 'Parental controls are turned off'),
                el('p', '', 'Your PIN and settings are saved, but nothing is being enforced right now. Turn them back on to apply SafeSearch, blocklists and time budgets.')
            );
            const btn = el('button', 'btn btn-primary', 'Turn on');
            btn.addEventListener('click', async () => {
                const pin = await requestPin({ title: 'Turn on parental controls', sub: 'Enter your PIN to re-enable enforcement.' });
                if (pin === null) return;
                const r = await api.parental.enable(pin);
                if (!r.ok) { toast(r.reason || 'Could not turn on parental controls.'); return; }
                toast('Parental controls turned on');
                refreshParentalBadge();
                renderParentalDashboard();
            });
            card.append(info, btn);
            banner.appendChild(card);
        }

        const usageBox = $('pc-usage');
        usageBox.replaceChildren();
        let totalLimit = 0;
        for (const [id, cat] of Object.entries(status.categories)) {
            const limit = cat.minutes * 60;
            totalLimit += limit;
            usageBox.appendChild(usageCard(cat.label, usage[id] || 0, limit));
        }
        if (totalLimit > 0) usageBox.appendChild(usageCard('All categories', usage.total || 0, totalLimit));

        $('pc-date').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
        $('pc-safesearch').checked = !!status.safeSearch;
        $('pc-allowlist-only').checked = !!status.allowlistOnly;
        $('pc-locked-toggle').checked = !!status.locked;
        $('pc-hidden-toggle').checked = !!status.hidden;
        $('pc-hidden-note').hidden = !status.hidden;

        const blockList = $('pc-block-list');
        blockList.replaceChildren();
        if (!status.blocklist || !status.blocklist.length) {
            blockList.appendChild(el('div', 'pc-muted', 'No sites blocked yet.'));
        } else {
            for (const domain of status.blocklist) {
                const chip = el('span', 'chip blocked');
                chip.appendChild(el('span', '', domain));
                const x = el('button', 'chip-x', '✕');
                x.setAttribute('aria-label', 'Unblock ' + domain);
                x.addEventListener('click', async e => {
                    e.stopPropagation();
                    const next = status.blocklist.filter(d => d !== domain);
                    const r = await api.parental.update({ blocklist: next });
                    if (!r || !r.ok) { toast(r && r.reason ? r.reason : 'Could not unblock that site.'); return; }
                    renderParentalDashboard();
                    toast(`Unblocked ${domain}`);
                });
                chip.appendChild(x);
                blockList.appendChild(chip);
            }
        }

        const allowList = $('pc-allow-list');
        allowList.replaceChildren();
        if (!status.allowlist.length) {
            allowList.appendChild(el('div', 'pc-muted', 'No sites on the allowlist yet.'));
        } else {
            for (const domain of status.allowlist) {
                const chip = el('span', 'chip');
                chip.appendChild(el('span', '', domain));
                const x = el('button', 'chip-x', '✕');
                x.setAttribute('aria-label', 'Remove ' + domain);
                x.addEventListener('click', async e => {
                    e.stopPropagation();
                    const next = status.allowlist.filter(d => d !== domain);
                    const r = await api.parental.update({ allowlist: next });
                    if (!r || !r.ok) { toast(r && r.reason ? r.reason : 'Could not remove that site.'); return; }
                    renderParentalDashboard();
                    toast(`Removed ${domain}`);
                });
                chip.appendChild(x);
                allowList.appendChild(chip);
            }
        }

        const budgets = $('pc-budgets');
        budgets.replaceChildren();
        for (const [id, cat] of Object.entries(status.categories)) budgets.appendChild(budgetRow(id, cat));

        const blocks = $('pc-blocks');
        blocks.replaceChildren();
        if (!status.blocked.length) {
            blocks.appendChild(el('div', 'empty', 'No sites have been blocked yet.'));
        } else {
            for (const b of status.blocked) {
                const row = el('div', 'row static');
                const meta = el('div', 'meta');
                meta.append(el('div', 'title', b.host), el('div', 'sub', b.reason));
                row.append(meta, el('div', 'time', new Date(b.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })));
                blocks.appendChild(row);
            }
        }

        showPcView('dashboard');
    }

    function requestPin({ title, sub } = {}) {
        return new Promise(resolve => {
            const modal = $('pc-pin-modal');
            const input = $('pc-pin-modal-input');
            const err = $('pc-pin-modal-error');
            const okBtn = $('pc-pin-modal-ok');
            const cancelBtn = $('pc-pin-modal-cancel');
            const cleanup = () => {
                modal.classList.remove('active');
                input.value = '';
                err.textContent = '';
                okBtn.removeEventListener('click', onOk);
                cancelBtn.removeEventListener('click', onCancel);
                modal.removeEventListener('mousedown', onOverlay);
                input.removeEventListener('keydown', onKey);
            };
            const onOk = () => {
                const val = input.value.trim();
                if (!val) { err.textContent = 'Enter a PIN.'; return; }
                const result = val;
                cleanup();
                resolve(result);
            };
            const onCancel = () => { cleanup(); resolve(null); };
            const onOverlay = e => { if (e.target === modal) onCancel(); };
            const onKey = e => {
                if (e.key === 'Enter') { e.preventDefault(); onOk(); }
                else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
            };
            $('pc-pin-modal-title').textContent = title || 'Enter parental PIN';
            $('pc-pin-modal-sub').textContent = sub || 'Parental controls are protected. Enter your PIN to continue.';
            err.textContent = '';
            input.value = '';
            input.type = 'password';
            modal.classList.add('active');
            okBtn.addEventListener('click', onOk);
            cancelBtn.addEventListener('click', onCancel);
            modal.addEventListener('mousedown', onOverlay);
            input.addEventListener('keydown', onKey);
            setTimeout(() => input.focus(), 30);
        });
    }

    let recoveryOnDone = null;
    function showNewRecovery(code, onDone) {
        $('pc-newrecovery').hidden = false;
        $('pc-recovery').hidden = true;
        $('pc-newrecovery-code').textContent = code;
        recoveryOnDone = onDone || null;
    }

    function bindRecoveryCard() {
        const copy = $('pc-newrecovery-copy');
        if (copy) copy.addEventListener('click', async () => {
            await api.copy($('pc-newrecovery-code').textContent);
            toast('Recovery code copied');
        });
        const done = $('pc-newrecovery-done');
        if (done) done.addEventListener('click', () => {
            $('pc-newrecovery').hidden = true;
            const cb = recoveryOnDone;
            recoveryOnDone = null;
            if (cb) cb();
            else renderParentalDashboard();
            refreshParentalBadge();
        });
    }

    function bindParental() {
        $('pc-unlock').addEventListener('click', async () => {
            const pin = $('pc-pin').value;
            const err = $('pc-lock-error');
            err.textContent = '';
            if (!pin) { err.textContent = 'Enter your PIN.'; return; }
            const r = await api.parental.verify(pin);
            if (!r.ok) { err.textContent = r.reason || 'Incorrect PIN.'; return; }
            $('pc-pin').value = '';
            pcUnlocked = true;
            renderParentalDashboard();
        });
        $('pc-pin').addEventListener('keydown', e => { if (e.key === 'Enter') $('pc-unlock').click(); });

        $('pc-forgot').addEventListener('click', async () => {
            hideRecoveryUi();
            $('pc-recovery').hidden = false;
            const info = await api.parental.forgotInfo();
            $('pc-reset-path').textContent = info.resetFile || 'DISABLE-PARENTAL-CONTROLS.txt';
            if (!info.hasRecovery) {
                $('pc-recovery-error').textContent = 'No recovery code was set for this profile. Use the file-based reset described below.';
                $('pc-recovery-save').disabled = true;
            } else {
                $('pc-recovery-save').disabled = false;
            }
            $('pc-recovery-code').focus();
        });
        $('pc-recovery-cancel').addEventListener('click', hideRecoveryUi);
        $('pc-recovery-save').addEventListener('click', async () => {
            const code = $('pc-recovery-code').value.trim();
            const a = $('pc-recovery-new').value;
            const b = $('pc-recovery-new2').value;
            const err = $('pc-recovery-error');
            err.textContent = '';
            if (!code) { err.textContent = 'Enter the recovery code.'; return; }
            if (!/^\d{4,8}$/.test(a)) { err.textContent = 'The new PIN must be 4 to 8 digits.'; return; }
            if (a !== b) { err.textContent = 'The new PINs do not match.'; return; }
            const r = await api.parental.recover(code, a);
            if (!r.ok) { err.textContent = r.reason || 'Could not recover access.'; return; }
            pcUnlocked = true;
            showNewRecovery(r.recoveryCode);
            $('pc-recovery-code').value = '';
            $('pc-recovery-new').value = '';
            $('pc-recovery-new2').value = '';
            toast('PIN updated');
        });

        $('pc-setup-start').addEventListener('click', () => {
            $('pc-setup-form').hidden = false;
            $('pc-setup-recovery').hidden = true;
            $('pc-new-pin').value = '';
            $('pc-new-pin2').value = '';
            $('pc-setup-error').textContent = '';
            showPcView('setup');
            $('pc-new-pin').focus();
        });
        $('pc-setup-cancel').addEventListener('click', () => renderParentalLocked());
        $('pc-setup-save').addEventListener('click', async () => {
            const a = $('pc-new-pin').value;
            const b = $('pc-new-pin2').value;
            const err = $('pc-setup-error');
            err.textContent = '';
            if (!/^\d{4,8}$/.test(a)) { err.textContent = 'Use a 4 to 8 digit PIN.'; return; }
            if (a !== b) { err.textContent = 'PINs do not match.'; return; }
            const r = await api.parental.setup(a);
            if (!r.ok) { err.textContent = r.reason || 'Could not set the PIN.'; return; }
            $('pc-new-pin').value = '';
            $('pc-new-pin2').value = '';
            $('pc-setup-form').hidden = true;
            $('pc-setup-recovery').hidden = false;
            $('pc-setup-recovery-code').textContent = r.recoveryCode;
            $('pc-setup-recovery-copy').onclick = async () => {
                await api.copy(r.recoveryCode);
                toast('Recovery code copied');
            };
            $('pc-setup-recovery-done').onclick = () => {
                pcUnlocked = true;
                toast('Parental controls enabled');
                renderParentalDashboard();
                refreshParentalBadge();
            };
            $('pc-setup-recovery-copy').focus();
        });

        $('pc-safesearch').addEventListener('change', async e => {
            const r = await api.parental.update({ safeSearch: e.target.checked });
            if (r && r.ok) toast(e.target.checked ? 'SafeSearch enforced' : 'SafeSearch off');
        });
        $('pc-allowlist-only').addEventListener('change', async e => {
            const r = await api.parental.update({ allowlistOnly: e.target.checked });
            if (r && r.ok) toast(e.target.checked ? 'Only allowlisted sites are reachable' : 'Allowlist-only off');
        });
        $('pc-locked-toggle').addEventListener('change', async e => {
            await api.parental.update({ locked: e.target.checked });
            if (e.target.checked) {
                pcUnlocked = false;
                toast('Parental controls locked — re-enter PIN next time');
                await renderParentalLocked();
                return;
            }
            toast('Locking disabled — session stays unlocked');
        });
        $('pc-hidden-toggle').addEventListener('change', async e => {
            if (e.target.checked) {
                const ok = await api.confirm('Hide parental controls from the sidebar?\n\nEnforcement keeps running. To reach this page, type neira://parental in the address bar.');
                if (!ok) { e.target.checked = false; return; }
            }
            await api.parental.update({ hidden: e.target.checked });
            $('pc-hidden-note').hidden = !e.target.checked;
            refreshParentalBadge();
            toast(e.target.checked ? 'Parental controls hidden from sidebar' : 'Parental controls visible again');
        });

        $('pc-block-add').addEventListener('click', async () => {
            const input = $('pc-block-input');
            const raw = input.value.trim();
            if (!raw) { toast('Type a website to block.'); return; }
            const clean = raw.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0].replace(/:\d+$/, '');
            if (!/^[a-z0-9][a-z0-9.-]{0,120}$/.test(clean) || clean.length < 2) { toast('That does not look like a website.'); return; }
            const status = await api.parental.status();
            const list = status.blocklist || [];
            if (list.includes(clean)) { toast('Already blocked.'); return; }
            const r = await api.parental.update({ blocklist: [...list, clean] });
            if (!r || !r.ok) { toast(r && r.reason ? r.reason : 'Could not block that site.'); return; }
            const persisted = (r.state && r.state.blocklist) || [];
            if (!persisted.includes(clean)) { toast('That website was rejected.'); return; }
            input.value = '';
            renderParentalDashboard();
            toast(`Blocked ${clean}`);
        });
        $('pc-block-input').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('pc-block-add').click(); } });

        $('pc-allow-add').addEventListener('click', async () => {
            const input = $('pc-allow-input');
            const raw = input.value.trim();
            if (!raw) { toast('Type a website to allow.'); return; }
            const clean = raw.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0].replace(/:\d+$/, '');
            if (!/^[a-z0-9][a-z0-9.-]{0,120}$/.test(clean) || clean.length < 2) { toast('That does not look like a website.'); return; }
            const status = await api.parental.status();
            if (status.allowlist.includes(clean)) { toast('Already on the allowlist.'); return; }
            const r = await api.parental.update({ allowlist: [...status.allowlist, clean] });
            if (!r || !r.ok) { toast(r && r.reason ? r.reason : 'Could not add that site.'); return; }
            const persisted = (r.state && r.state.allowlist) || [];
            if (!persisted.includes(clean)) { toast('That website was rejected.'); return; }
            input.value = '';
            renderParentalDashboard();
        });
        $('pc-allow-input').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('pc-allow-add').click(); } });

        $('pc-reset-day').addEventListener('click', async () => {
            if (!await api.confirm("Reset today's screen time to zero?")) return;
            await api.parental.resetDay();
            renderParentalDashboard();
            toast('Time reset');
        });
        $('pc-clear-blocks').addEventListener('click', async () => {
            await api.parental.clearBlocks();
            renderParentalDashboard();
        });

        $('pc-disable').addEventListener('click', async () => {
            const pin = await requestPin({ title: 'Turn off parental controls', sub: 'Enter your parental PIN to turn off parental controls.' });
            if (pin === null) return;
            const r = await api.parental.disable(pin);
            if (!r.ok) { toast(r.reason || 'Could not turn off parental controls.'); return; }
            pcUnlocked = true;
            toast('Parental controls turned off');
            refreshParentalBadge();
            renderParentalDashboard();
        });

        const changePinBtn = $('pc-change-pin');
        if (changePinBtn) changePinBtn.addEventListener('click', () => {
            const modal = $('pc-changepin-modal');
            if (!modal) { toast('Change PIN is unavailable in this build.'); return; }
            $('pc-changepin-current').value = '';
            $('pc-changepin-new').value = '';
            $('pc-changepin-new2').value = '';
            $('pc-changepin-error').textContent = '';
            modal.classList.add('active');
            setTimeout(() => $('pc-changepin-current').focus(), 30);
        });
        const changePinModal = $('pc-changepin-modal');
        if (changePinModal) {
            $('pc-changepin-cancel').addEventListener('click', () => changePinModal.classList.remove('active'));
            changePinModal.addEventListener('mousedown', e => { if (e.target === changePinModal) changePinModal.classList.remove('active'); });
            changePinModal.addEventListener('keydown', e => {
                if (e.key === 'Escape') { e.preventDefault(); changePinModal.classList.remove('active'); }
                else if (e.key === 'Enter') { e.preventDefault(); $('pc-changepin-save').click(); }
            });
            $('pc-changepin-save').addEventListener('click', async () => {
                const err = $('pc-changepin-error');
                err.textContent = '';
                const current = $('pc-changepin-current').value;
                const a = $('pc-changepin-new').value;
                const b = $('pc-changepin-new2').value;
                if (!current) { err.textContent = 'Enter your current PIN.'; return; }
                if (!/^\d{4,8}$/.test(a)) { err.textContent = 'The new PIN must be 4 to 8 digits.'; return; }
                if (a !== b) { err.textContent = 'The new PINs do not match.'; return; }
                if (a === current) { err.textContent = 'The new PIN must be different from the current one.'; return; }
                const r = await api.parental.changePin(current, a);
                if (!r.ok) { err.textContent = r.reason || 'Could not change the PIN.'; return; }
                changePinModal.classList.remove('active');
                showNewRecovery(r.recoveryCode, () => renderParentalDashboard());
                toast('PIN changed');
            });
        }

        api.parental.onUsage(() => { if (pcUnlocked && currentSection === 'parental') renderParentalDashboard(); });
        api.parental.onBlocked(() => { if (pcUnlocked && currentSection === 'parental') renderParentalDashboard(); });
        api.parental.onChanged(() => {
            refreshParentalBadge();
            if (currentSection === 'parental') {
                if (pcUnlocked) renderParentalDashboard();
                else renderParentalLocked();
            }
        });
    }

    loaders.parental = async () => {
        pcUnlocked = false;
        await renderParentalLocked();
        refreshParentalBadge();
    };

    // -----------------------------------------------------------------------
    // Boot
    // -----------------------------------------------------------------------
        // Default browser card (Settings > Search & Startup)
    function setupDefaultBrowser() {
        const api = window.neira;
        const button = document.getElementById('db-set');
        const status = document.getElementById('db-status');
        const hint = document.getElementById('db-hint');
        if (!api || !api.defaultBrowser || !button || !status) return;

        async function refresh() {
            let s;
            try { s = await api.defaultBrowser.status(); } catch (_) { return; }
            const lines = [(s.web ? '✓ ' : '✗ ') + 'Web links (http and https)'];
            if (s.pdf !== null) lines.push((s.pdf ? '✓ ' : '✗ ') + 'PDF files');
            status.textContent = lines.join('\n');
            const windows = s.platform === 'win32';
            button.textContent = windows ? 'Open Windows default apps' : (s.web ? 'Neira is your default browser' : 'Make Neira default');
            button.disabled = !windows && s.web;
            hint.hidden = !windows;
            hint.textContent = s.registered
                ? 'Windows asks you to choose: in the page that opens, pick Neira and set it for the types you want (HTTP, HTTPS, .pdf, .html).'
                : 'Neira is not registered with Windows yet. Install it with the setup file (or update), then come back here.';
        }

        button.addEventListener('click', async () => {
            button.disabled = true;
            let r = null;
            try { r = await api.defaultBrowser.set(); } catch (_) { /* shown below */ }
            if (r && !r.ok && r.reason) { hint.hidden = false; hint.textContent = r.reason; }
            setTimeout(() => { button.disabled = false; refresh(); }, 800);
        });
        window.addEventListener('focus', refresh); // coming back from the Windows settings page
        refresh();
    }

    async function init() {
        const safe = (name, fn) => {
            try { fn(); } catch (err) { console.warn(`[pages] ${name} failed:`, err); }
        };
        safe('bindSettings', bindSettings);
                safe('setupDefaultBrowser', setupDefaultBrowser);
        safe('bindExtensions', bindExtensions);
        safe('bindShortcuts', bindShortcuts);
        safe('bindPasswords', bindPasswords);
        safe('bindRecoveryCard', bindRecoveryCard);
        safe('bindParental', bindParental);

        window.addEventListener('hashchange', route);
        safe('route', route);

        const results = await Promise.allSettled([api.settings.get(), primeBadges()]);
        if (results[0].status === 'fulfilled') safe('applySettings', () => applySettings(results[0].value));
        api.settings.onChange(s => safe('applySettings', () => applySettings(s)));

        if (!loaded.has('shortcuts')) {
            try {
                sc.data = await api.shortcuts.get();
                renderChips();
            } catch (_) {}
        }

        safe('refreshParentalBadge', refreshParentalBadge);
    }
    init();
})();