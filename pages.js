'use strict';
(() => {
    const api = window.neira;
    const $ = id => document.getElementById(id);
    const root = document.documentElement;
    const content = $('content');

    const SECTIONS = {
        history: 'History',
        bookmarks: 'Bookmarks',
        downloads: 'Downloads',
        appearance: 'Appearance & Theme',
        ai: 'Local AI',
        search: 'Search & Startup',
        shortcuts: 'Keyboard Shortcuts',
        passwords: 'Passwords',
        privacy: 'Privacy & Security',
        about: 'About'
    };
    const PAGE_SIZE = 200;

    let settings = {};
    const loaders = {};      // section id -> loader (runs once, the first time the section is shown)
    const loaded = new Set();
    let currentSection = null;

    // -----------------------------------------------------------------------
    // Small helpers
    // -----------------------------------------------------------------------
    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    let toastTimer;
    function toast(message) {
        const t = $('toast');
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

    function openUrl(url) {
        // Our page never navigates in place; main opens http(s) links in a new tab.
        window.open(url, '_blank');
    }

    function removeButton(label, onClick) {
        const b = el('button', 'remove', '✕');
        b.title = label;
        b.setAttribute('aria-label', label);
        b.addEventListener('click', e => { e.stopPropagation(); onClick(); });
        return b;
    }

    function setBadge(id, count) {
        const b = $(id);
        b.textContent = count;
        b.hidden = !count;
    }

    // -----------------------------------------------------------------------
    // Router: one page, nine sections, #hash deep links (neira://history etc.)
    // -----------------------------------------------------------------------
    function sectionFromLocation() {
        const hash = location.hash.slice(1);
        if (SECTIONS[hash]) return hash;
        let remembered = null;
        try { remembered = sessionStorage.getItem('neira.section'); } catch (_) { /* ignore */ }
        return SECTIONS[remembered] ? remembered : 'history';
    }

    function showSection(id) {
        if (currentSection === 'shortcuts' && id !== 'shortcuts') cancelRecording();
        currentSection = id;
        document.querySelectorAll('.page-section').forEach(s => s.classList.toggle('active', s.id === id));
        document.querySelectorAll('.nav-item').forEach(n => {
            const on = n.dataset.section === id;
            n.classList.toggle('active', on);
            if (on) n.setAttribute('aria-current', 'page'); else n.removeAttribute('aria-current');
        });
        document.title = SECTIONS[id] + ' - Neira Browser';
        try { sessionStorage.setItem('neira.section', id); } catch (_) { /* ignore */ }
        content.scrollTop = 0;
        if (!loaded.has(id) && loaders[id]) { loaded.add(id); loaders[id](); }
    }

    function route() {
        const id = sectionFromLocation();
        if (location.hash.slice(1) !== id) history.replaceState(null, '', '#' + id);
        showSection(id);
    }

    // -----------------------------------------------------------------------
    // Settings (theme, density, search, startup, password options)
    // -----------------------------------------------------------------------
    function applySettings(s) {
        settings = s;
        window.neiraTheme.apply(s);   // light/dark, density, accent colour, surface tint (boot.js)
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
        $('open-newtab').addEventListener('click', () => api.newtab.go('neira://newtab#customize', true)); // new tab, Customize drawer open
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
    // History / bookmarks / downloads
    // -----------------------------------------------------------------------
    function makeListSection({ listId, searchId, fetch, subscribe, render }) {
        const state = { data: [], limit: PAGE_SIZE };
        const list = $(listId);
        const search = $(searchId);

        function draw() {
            list.replaceChildren();
            const q = search.value.trim().toLowerCase();
            render(state, q, list);
        }
        async function load() {
            list.replaceChildren(skeleton());
            try {
                state.data = await fetch();
                subscribe(next => { state.data = next; draw(); });
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
        listId: 'history-list',
        searchId: 'history-search',
        fetch: () => api.history.get(),
        subscribe: cb => api.history.onChange(cb),
        render(state, q, list) {
            clearMoreButtons(list);
            const items = state.data.filter(h => !q || (h.title + ' ' + h.url).toLowerCase().includes(q));
            if (!items.length) {
                list.appendChild(el('div', 'empty', q ? 'No matching history.' : 'Pages you visit will show up here.'));
                return;
            }
            let lastDay = '';
            for (const h of items.slice(0, state.limit)) {
                const day = new Date(h.time).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
                if (day !== lastDay) { list.appendChild(el('div', 'day', day)); lastDay = day; }
                const row = el('div', 'row');
                const meta = el('div', 'meta');
                meta.append(el('div', 'title', h.title || h.url), el('div', 'sub', h.url));
                row.append(
                    meta,
                    el('div', 'time', new Date(h.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
                    removeButton('Remove from history', () => api.history.remove(h.id))
                );
                row.addEventListener('click', () => openUrl(h.url));
                list.appendChild(row);
            }
            moreButton(state, items.length, historySection.draw, list);
        }
    });
    loaders.history = historySection.load;

    const bookmarksSection = makeListSection({
        listId: 'bookmarks-list',
        searchId: 'bookmarks-search',
        fetch: () => api.bookmarks.get(),
        subscribe: cb => api.bookmarks.onChange(cb),
        render(state, q, list) {
            clearMoreButtons(list);
            setBadge('badge-bookmarks', state.data.length);
            const items = state.data.filter(b => !q || (b.title + ' ' + b.url).toLowerCase().includes(q));
            if (!items.length) {
                list.appendChild(el('div', 'empty', q ? 'No matching bookmarks.' : 'No bookmarks yet. Press the ★ in the address bar.'));
                return;
            }
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
        listId: 'downloads-list',
        searchId: 'downloads-search',
        fetch: () => api.downloads.get(),
        subscribe: cb => api.downloads.onChange(cb),
        render(state, q, list) {
            clearMoreButtons(list);
            const running = state.data.filter(d => d.state === 'progressing' || d.state === 'paused').length;
            setBadge('badge-downloads', running);
            const items = state.data.filter(d => !q || (d.name + ' ' + d.url).toLowerCase().includes(q));
            if (!items.length) {
                list.appendChild(el('div', 'empty', q ? 'No matching downloads.' : 'Files you download will show up here.'));
                return;
            }
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

    // Keep the sidebar badges right even before those sections are opened.
    async function primeBadges() {
        try {
            const [bm, dl] = await Promise.all([api.bookmarks.get(), api.downloads.get()]);
            setBadge('badge-bookmarks', bm.length);
            setBadge('badge-downloads', dl.filter(d => d.state === 'progressing' || d.state === 'paused').length);
            api.bookmarks.onChange(list => setBadge('badge-bookmarks', list.length));
            api.downloads.onChange(list => setBadge('badge-downloads', list.filter(d => d.state === 'progressing' || d.state === 'paused').length));
        } catch (_) { /* badges are cosmetic */ }
    }

    // -----------------------------------------------------------------------
    // Keyboard shortcuts editor
    // -----------------------------------------------------------------------
    const sc = {
        data: null,          // { categories, map, defaults, names }
        search: '',
        chip: 'all',         // 'all' | '__custom' | category name
        recording: null,     // action id being recorded
        last: null           // last change, for Undo
    };
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

    // --- recording ---
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

    // --- undo snackbar ---
    let snackTimer;
    function showSnack(message, change) {
        sc.last = change || null;
        $('snack-msg').textContent = message;
        $('snack-undo').hidden = !change;
        $('snack').hidden = false;
        clearTimeout(snackTimer);
        snackTimer = setTimeout(hideSnack, 7000);
    }
    function hideSnack() {
        $('snack').hidden = true;
        sc.last = null;
    }

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
        await api.shortcuts.set(ch.id, ch.previous);              // frees the combo first
        if (ch.displaced) await api.shortcuts.set(ch.displaced, ch.combo); // then hands it back
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

        // Anything that takes you away from the editor must release the keyboard.
        document.addEventListener('mousedown', e => { if (sc.recording && !e.target.closest('.sc-row, #record-banner')) cancelRecording(); });
        window.addEventListener('blur', cancelRecording);
        window.addEventListener('beforeunload', () => api.shortcuts.stopRecording());
        document.addEventListener('visibilitychange', () => { if (document.hidden) cancelRecording(); });
    }

    async function loadShortcuts() {
        const body = $('sc-body');
        if (sc.data) { renderShortcuts(); return; } // already warmed during init
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
    // Site permissions
    // -----------------------------------------------------------------------
    async function renderPermissions() {
        try {
            const list = await api.permissions.list();
            $('perm-desc').textContent = list.length
                ? `${list.length} remembered choice${list.length === 1 ? '' : 's'} (camera, microphone, notifications). Location is always blocked.`
                : 'No remembered choices. Neira asks before a site uses your camera, microphone or notifications. Location is always blocked.';
            $('perm-reset').disabled = !list.length;
        } catch (_) { /* cosmetic */ }
    }
    loaders.privacy = renderPermissions;
    $('perm-reset').addEventListener('click', async () => {
        if (!await api.confirm('Forget all remembered site permission choices?')) return;
        await api.permissions.clear();
        renderPermissions();
        toast('Site permissions reset');
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
                : 'Warning: OS encryption is unavailable, so passwords are stored without protection. Click an entry to copy its password.';
            list.replaceChildren();
            if (!items.length) { list.appendChild(el('div', 'empty', 'No saved passwords yet.')); }
            for (const item of items) {
                list.appendChild(siteRow(
                    item.site, item.user,
                    async () => { if (await api.passwords.copy(item.id)) toast('Password copied for 30 seconds'); },
                    async () => { await api.passwords.remove(item.id); renderPasswords(); },
                    'Delete password'
                ));
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
        modal.addEventListener('keydown', e => {
            if (e.key === 'Escape') close();
            if (e.key === 'Enter') $('pw-save').click();
        });
        $('pw-save').addEventListener('click', async () => {
            const r = await api.passwords.add({ site: $('pw-site').value, user: $('pw-user').value, pass: $('pw-pass').value });
            if (!r.ok) { $('pw-error').textContent = 'Fill in the website, username and password.'; return; }
            close();
            renderPasswords();
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
    // Boot: wire everything first, show the page immediately, then fill in data
    // -----------------------------------------------------------------------
    async function init() {
        bindSettings();
        bindShortcuts();
        bindPasswords();
        window.addEventListener('hashchange', route);
        route(); // sections and skeletons are visible straight away

        const results = await Promise.allSettled([api.settings.get(), primeBadges()]);
        if (results[0].status === 'fulfilled') applySettings(results[0].value);
        api.settings.onChange(applySettings);

        // Warm the shortcut data so the editor opens instantly (and the Customized badge is right)
        if (!loaded.has('shortcuts')) {
            try {
                sc.data = await api.shortcuts.get();
                renderChips();
            } catch (_) { /* the editor retries when opened */ }
        }
    }
    init();
})();