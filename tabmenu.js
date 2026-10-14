(() => {
    const neira = window.neira;
    if (!neira) return;

    const wait = ms => new Promise(r => setTimeout(r, ms));
    const tabs = () => [...document.querySelectorAll('#tabs-list .tab')];
    const activeView = () => document.querySelector('#views-container webview.active');
    const click = id => { const el = document.getElementById(id); if (el) el.click(); };

    const menu = document.createElement('div');
    menu.className = 'tab-menu';
    menu.hidden = true;
    document.body.appendChild(menu);

    const hide = () => { menu.hidden = true; menu.innerHTML = ''; };

    const closeTab = tab => { const x = tab && tab.querySelector('.close-tab'); if (x) x.click(); };

    async function closeRight(idx) {
        while (tabs().length > idx + 1) {
            const before = tabs().length;
            closeTab(tabs()[idx + 1]);
            await wait(120);
            if (tabs().length === before) break;
        }
    }
    async function closeLeft(idx) {
        while (idx > 0) {
            const before = tabs().length;
            closeTab(tabs()[0]);
            await wait(120);
            if (tabs().length === before) break;
            idx--;
        }
        const keep = tabs()[idx];
        if (keep) keep.click();
    }

    function currentUrl() {
        try { const v = activeView(); if (v) return v.getURL(); } catch (_) {}
        const input = document.getElementById('url-input');
        return input ? input.value : '';
    }

    function build(tab) {
        const list = tabs();
        const idx = list.indexOf(tab);
        const only = list.length <= 1;
        const isLast = idx === list.length - 1;
        let muted = false;
        try { const v = activeView(); muted = !!(v && v.isAudioMuted && v.isAudioMuted()); } catch (_) {}

        return [
            { label: 'New tab to the right', run: () => neira.runMainAction('new_tab') },
            { label: 'Add tab to new split view', run: () => click('split-screen-btn') },
            { label: 'Move tab to new window', disabled: only, run: () => {
                const url = currentUrl();
                if (!/^https?:/i.test(url)) return;
                neira.window.openUrl(url);
                closeTab(tab);
            } },
            'sep',
            { label: 'Reload', hint: 'Ctrl+R', run: () => click('reload') },
            { label: 'Duplicate', run: () => neira.runMainAction('duplicate_tab') },
            { label: muted ? 'Unmute site' : 'Mute site', run: () => {
                try { const v = activeView(); if (v) v.setAudioMuted(!muted); } catch (_) {}
            } },
            'sep',
            { label: 'Show tabs vertically', run: () => neira.settings.set('tabLayout', 'vertical') },
            'sep',
            { label: 'Close', hint: 'Ctrl+W', run: () => closeTab(tab) },
            { label: 'Close other tabs', disabled: only, run: async () => { await closeRight(idx); await closeLeft(idx); } },
            { label: 'Close tabs to the right', disabled: isLast, run: () => closeRight(idx) }
        ];
    }

    function show(x, y, tab) {
        menu.innerHTML = '';
        for (const item of build(tab)) {
            if (item === 'sep') {
                const s = document.createElement('div');
                s.className = 'tm-sep';
                menu.appendChild(s);
                continue;
            }
            const b = document.createElement('button');
            b.type = 'button';
            b.disabled = !!item.disabled;
            const l = document.createElement('span');
            l.textContent = item.label;
            b.appendChild(l);
            if (item.hint) {
                const h = document.createElement('span');
                h.className = 'tm-hint';
                h.textContent = item.hint;
                b.appendChild(h);
            }
            b.addEventListener('click', () => { hide(); item.run(); });
            menu.appendChild(b);
        }
        menu.hidden = false;
        const r = menu.getBoundingClientRect();
        menu.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 4)) + 'px';
        menu.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) + 'px';
    }

    document.addEventListener('contextmenu', async e => {
        const tab = e.target.closest && e.target.closest('#tabs-list .tab');
        if (!tab) { hide(); return; }
        e.preventDefault();
        tab.click();
        await wait(40);
        show(e.clientX, e.clientY, tab);
    });

    document.addEventListener('mousedown', e => { if (!menu.hidden && !menu.contains(e.target)) hide(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
    window.addEventListener('blur', hide);
    window.addEventListener('resize', hide);
})();