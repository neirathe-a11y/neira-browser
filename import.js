'use strict';
(() => {
    const api = window.neira;
    if (!api || !api.importer) return;
    const $ = id => document.getElementById(id);

    const overlay = $('import-overlay');
    if (!overlay) return;

    const viewSetup = $('iw-setup');
    const viewProgress = $('iw-progress');
    const viewResult = $('iw-result');
    const browsersEl = $('iw-browsers');
    const profilesEl = $('iw-profiles');
    const profileSection = $('iw-profile-section');
    const checksEl = $('iw-checks');
    const footMsg = $('iw-foot-msg');
    const btnSkip = $('iw-skip');
    const btnImport = $('iw-import');
    const btnDone = $('iw-done');
    const warnSlot = $('iw-warn-slot');
    const progressFill = $('iw-progress-fill');
    const progressSub = $('iw-progress-sub');
    const progressDetail = $('iw-progress-detail');
    const progressIcon = $('iw-progress-icon');
    const resultMsg = $('iw-result-msg');
    const resultStats = $('iw-result-stats');

    const AVATAR_COLORS = ['#6366f1', '#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#a855f7'];
    const avatarColor = n => AVATAR_COLORS[(String(n).charCodeAt(0) || 0) % AVATAR_COLORS.length];

    const CHECKS = [
        { id: 'bookmarks', label: 'Bookmarks',            desc: 'Your saved links and folders',                    key: 'bookmarks' },
        { id: 'history',   label: 'History',              desc: 'Pages you have visited',                          key: 'history' },
        { id: 'cookies',   label: 'Sessions',             desc: 'Keeps you signed in to Gmail, YouTube and more',  key: 'cookies' },
        { id: 'autofill',  label: 'Autofill & addresses', desc: 'Names, addresses, phone numbers',                 key: 'autofill' },
        { id: 'search',    label: 'Search engines',       desc: 'Your custom search shortcuts',                    key: 'search' },
        { id: 'settings',  label: 'Settings',             desc: 'Homepage and preferences',                        key: 'settings' }
    ];

    let browsers = [];
    let selectedBrowserId = null;
    let selectedProfileId = null;
    let scanData = null;
    let checkState = new Set();

    function renderBrowsers() {
        browsersEl.replaceChildren();
        if (!browsers.length) {
            const empty = document.createElement('div');
            empty.className = 'iw-empty';
            empty.innerHTML = '<div class="big">🕵️</div><div>No supported browsers found on this computer.</div>';
            browsersEl.appendChild(empty);
            footMsg.textContent = 'No browsers detected.';
            btnImport.disabled = true;
            return;
        }
        for (const b of browsers) {
            const el = document.createElement('button');
            el.type = 'button';
            el.className = 'iw-browser' + (b.id === selectedBrowserId ? ' selected' : '');
            el.disabled = !b.profiles || !b.profiles.length;

            const icon = document.createElement('span');
            icon.className = 'iw-browser-icon';
            icon.textContent = b.icon || '🌐';

            const info = document.createElement('div');
            info.className = 'iw-browser-info';
            const h = document.createElement('h3');
            h.textContent = b.name;
            const s = document.createElement('small');
            s.textContent = b.profiles && b.profiles.length
                ? `${b.profiles.length} profile${b.profiles.length === 1 ? '' : 's'} found`
                : 'No profiles found';
            info.append(h, s);

            const chk = document.createElement('span');
            chk.className = 'iw-browser-check';
            chk.innerHTML = '<svg viewBox="0 0 12 12"><polyline points="2.5 6.2 4.8 8.6 9.5 3.5"/></svg>';

            el.append(icon, info, chk);
            el.addEventListener('click', () => selectBrowser(b.id));
            browsersEl.appendChild(el);
        }
    }

    function renderProfiles() {
        const b = browsers.find(x => x.id === selectedBrowserId);
        profilesEl.replaceChildren();
        if (!b || !b.profiles || !b.profiles.length) {
            profileSection.hidden = true;
            return;
        }
        profileSection.hidden = false;
        for (const p of b.profiles) {
            const el = document.createElement('button');
            el.type = 'button';
            el.className = 'iw-profile' + (p.id === selectedProfileId ? ' selected' : '');
            const av = document.createElement('span');
            av.className = 'iw-profile-avatar';
            av.style.background = avatarColor(p.name);
            av.textContent = (String(p.name).trim()[0] || '?').toUpperCase();
            const name = document.createElement('span');
            name.textContent = p.name;
            el.append(av, name);
            el.addEventListener('click', () => selectProfile(p.id));
            profilesEl.appendChild(el);
        }
    }

    function renderChecks() {
        checksEl.replaceChildren();
        for (const c of CHECKS) {
            const on = checkState.has(c.id);
            const info = (scanData && scanData.counts && scanData.counts[c.key]) || { count: 0, available: true };
            const available = info.available !== false;

            const el = document.createElement('button');
            el.type = 'button';
            el.className = 'iw-check' + (on ? ' on' : '');
            el.disabled = !available;

            const box = document.createElement('span');
            box.className = 'iw-check-box';
            box.innerHTML = '<svg viewBox="0 0 12 12"><polyline points="2.5 6.2 4.8 8.6 9.5 3.5"/></svg>';

            const inf = document.createElement('div');
            inf.className = 'iw-check-info';
            const h = document.createElement('h3');
            h.textContent = c.label;
            const p = document.createElement('p');
            p.textContent = c.desc;
            inf.append(h, p);

            const count = document.createElement('span');
            count.className = 'iw-check-count' + (info.count ? '' : ' empty');
            if (!scanData) count.textContent = '…';
            else if (!available) count.textContent = '—';
            else if (c.id === 'cookies') count.textContent = info.count ? `${info.count} sessions` : 'none';
            else if (info.count) count.textContent = info.count.toLocaleString();
            else count.textContent = 'empty';

            el.append(box, inf, count);
            el.addEventListener('click', () => {
                if (!available) return;
                if (checkState.has(c.id)) checkState.delete(c.id);
                else checkState.add(c.id);
                renderChecks();
                updateFooter();
            });
            checksEl.appendChild(el);
        }
    }

    function updateFooter() {
        const b = browsers.find(x => x.id === selectedBrowserId);
        if (!b) {
            footMsg.textContent = 'Pick a browser to see what can be imported.';
            btnImport.disabled = true;
            return;
        }
        if (!scanData) {
            footMsg.textContent = `Scanning ${b.name}…`;
            btnImport.disabled = true;
            return;
        }
        if (!checkState.size) {
            footMsg.textContent = 'Nothing selected — pick at least one item to import.';
            btnImport.disabled = true;
            return;
        }
        const total = [...checkState].reduce((sum, id) => {
            const c = CHECKS.find(x => x.id === id);
            const info = (scanData.counts && scanData.counts[c.key]) || { count: 0 };
            return sum + (info.count || 0);
        }, 0);
        const p = (b.profiles || []).find(x => x.id === selectedProfileId);
        footMsg.innerHTML = `Ready to import <strong>${total.toLocaleString()}</strong> item${total === 1 ? '' : 's'} from <strong>${b.name}</strong>${p ? ' · ' + p.name : ''}`;
        btnImport.disabled = false;
    }

    async function selectBrowser(id) {
        selectedBrowserId = id;
        const b = browsers.find(x => x.id === id);
        selectedProfileId = (b && b.profiles && b.profiles.length) ? b.profiles[0].id : null;
        renderBrowsers();
        renderProfiles();
        await loadScan();
    }

    async function selectProfile(id) {
        selectedProfileId = id;
        renderProfiles();
        await loadScan();
    }

    async function loadScan() {
        scanData = null;
        checkState = new Set();
        renderChecks();
        updateFooter();
        if (!selectedBrowserId || !selectedProfileId) return;

        let r;
        try { r = await api.importer.scan(selectedBrowserId, selectedProfileId); }
        catch (_) { r = null; }

        if (!r || !r.ok) {
            scanData = { counts: {} };
            showWarn((r && r.reason) || 'Could not read that profile.');
            renderChecks();
            updateFooter();
            return;
        }
        scanData = r;
        clearWarn();
        for (const c of CHECKS) {
            const info = (r.counts && r.counts[c.key]) || { available: true };
            if (info.available !== false) checkState.add(c.id);
        }
        renderChecks();
        updateFooter();
    }

    function showWarn(msg) {
        warnSlot.replaceChildren();
        const w = document.createElement('div');
        w.className = 'iw-warn';
        const txt = document.createElement('span');
        txt.textContent = msg;
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.textContent = 'Retry';
        retry.addEventListener('click', () => loadScan());
        w.append(txt, retry);
        warnSlot.appendChild(w);
    }
    function clearWarn() { warnSlot.replaceChildren(); }

    async function runImport() {
        if (!selectedBrowserId || !selectedProfileId || !checkState.size) return;

        viewSetup.hidden = true;
        viewProgress.hidden = false;
        progressIcon.classList.remove('done');
        progressIcon.textContent = '⟳';
        progressFill.style.width = '0%';
        progressSub.textContent = 'Reading data from the other browser';
        progressDetail.textContent = 'This may take a few seconds…';

        const items = [...checkState];

        let pct = 0;
        const iv = setInterval(() => {
            pct = Math.min(92, pct + Math.random() * 7);
            progressFill.style.width = Math.round(pct) + '%';
        }, 180);

        let r;
        try {
            r = await api.importer.run(selectedBrowserId, selectedProfileId, items);
        } catch (err) {
            r = { ok: false, reason: (err && err.message) || 'Import failed.' };
        }

        clearInterval(iv);
        progressFill.style.width = '100%';
        await new Promise(res => setTimeout(res, 320));

        showResult(r);
    }

    function showResult(r) {
        viewProgress.hidden = true;
        viewResult.hidden = false;

        resultStats.replaceChildren();

        if (!r || r.ok === false) {
            resultMsg.textContent = (r && r.reason) || 'The import could not complete.';
            return;
        }

        const items = [
            ['Bookmarks', r.bookmarks],
            ['History', r.history],
            ['Sessions', r.cookies],
            ['Settings', r.settings],
            ['Autofill', r.autofill],
            ['Search engines', r.search]
        ].filter(([, n]) => n > 0);

        if (!items.length) {
            resultMsg.textContent = 'Nothing new to import — you already had all of this.';
            return;
        }

        resultMsg.textContent = `Neira imported ${items.length} categor${items.length === 1 ? 'y' : 'ies'} from ${r.browser || 'the selected browser'}.`;

        for (const [label, n] of items) {
            const el = document.createElement('div');
            el.className = 'iw-stat';
            const b = document.createElement('b');
            b.textContent = n.toLocaleString();
            const s = document.createElement('span');
            s.textContent = label;
            el.append(b, s);
            resultStats.appendChild(el);
        }
    }

    async function closeOverlay() {
        try { await api.importer.markSeen(); } catch (_) {}
        overlay.hidden = true;
        document.documentElement.classList.remove('import-open');
    }

    btnSkip.addEventListener('click', closeOverlay);
    btnImport.addEventListener('click', runImport);
    btnDone.addEventListener('click', closeOverlay);

    async function open() {
        overlay.hidden = false;
        document.documentElement.classList.add('import-open');

        viewSetup.hidden = false;
        viewProgress.hidden = true;
        viewResult.hidden = true;

        try {
            const r = await api.importer.detect();
            browsers = (r && r.browsers) || [];
        } catch (_) {
            browsers = [];
        }
        renderBrowsers();
        renderChecks();
        updateFooter();

        const first = browsers.find(b => b.profiles && b.profiles.length);
        if (first) selectBrowser(first.id);
    }

    window.neiraImport = { open, close: closeOverlay };

    // Chrome-frame listener: main process tells us when another window (Settings) wants the wizard
    if (api.onImporterShowWizard) {
        api.onImporterShowWizard(() => { try { open(); } catch (_) {} });
    }
})();