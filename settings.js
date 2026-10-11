'use strict';
(() => {
    const api = window.neira;
    const $ = id => document.getElementById(id);

    let toastTimer;
    function toast(message) {
        const el = $('toast');
        el.textContent = message;
        el.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
    }

    // -----------------------------------------------------------------------
    // Navigation between sections
    // -----------------------------------------------------------------------
    const navItems = document.querySelectorAll('.nav-item');
    const sections = document.querySelectorAll('.section');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            cancelRecording();
            navItems.forEach(n => n.classList.remove('active'));
            sections.forEach(s => s.classList.remove('active'));
            item.classList.add('active');
            $(item.dataset.target).classList.add('active');
        });
    });

    // -----------------------------------------------------------------------
    // General settings (apply instantly through the main process)
    // -----------------------------------------------------------------------
    function applySettings(s) {
        document.body.classList.toggle('light-theme', s.theme === 'light');
        $('theme-select').value = s.theme;
        $('engine-select').value = s.engine;
        if (document.activeElement !== $('homepage-input')) $('homepage-input').value = s.homepage;
        document.querySelectorAll('input[data-setting]').forEach(input => {
            input.checked = !!s[input.dataset.setting];
        });
    }

    $('theme-select').addEventListener('change', e => api.settings.set('theme', e.target.value));
    $('engine-select').addEventListener('change', e => api.settings.set('engine', e.target.value));
    document.querySelectorAll('input[data-setting]').forEach(input => {
        input.addEventListener('change', () => api.settings.set(input.dataset.setting, input.checked));
    });

    async function saveHomepage() {
        const input = $('homepage-input');
        const status = $('home-status');
        let value = input.value.trim();
        if (!value) return;
        if (!/^https?:\/\//i.test(value)) value = 'https://' + value;
        const next = await api.settings.set('homepage', value);
        const ok = next.homepage === new URL(value, 'https://x').href || next.homepage === value;
        status.textContent = ok ? 'Home page saved.' : 'Enter a valid http or https address.';
        status.classList.toggle('warn', !ok);
        input.value = next.homepage;
    }
    $('homepage-input').addEventListener('keydown', e => { if (e.key === 'Enter') saveHomepage(); });
    $('homepage-input').addEventListener('change', saveHomepage);

    // -----------------------------------------------------------------------
    // Passwords
    // -----------------------------------------------------------------------
    function emptyRow(text) {
        const row = document.createElement('div');
        row.className = 'setting-row empty-row';
        row.textContent = text;
        return row;
    }

    function siteRow(label, sub, onClick, onDelete, deleteTitle) {
        const row = document.createElement('div');
        row.className = 'list-row';
        const info = document.createElement('div');
        info.className = 'site-info';
        const icon = document.createElement('span');
        icon.className = 'site-icon';
        icon.textContent = '🌐';
        const text = document.createElement('div');
        const name = document.createElement('div');
        name.className = 'site-name';
        name.textContent = label;
        text.appendChild(name);
        if (sub) {
            const user = document.createElement('div');
            user.className = 'site-user';
            user.textContent = sub;
            text.appendChild(user);
        }
        info.append(icon, text);
        const del = document.createElement('span');
        del.className = 'close-icon';
        del.title = deleteTitle;
        del.textContent = '✕';
        del.addEventListener('click', e => { e.stopPropagation(); onDelete(); });
        if (onClick) row.addEventListener('click', onClick);
        row.append(info, del);
        return row;
    }

    async function renderPasswords() {
        const list = $('saved-passwords-list');
        const { items, encrypted } = await api.passwords.list();
        $('passwords-subtitle').textContent = encrypted
            ? 'Save and manage your passwords. Click a saved entry to copy its password for 30 seconds.'
            : 'Warning: OS encryption is unavailable, so passwords are stored without protection. Click an entry to copy its password.';
        list.replaceChildren();
        if (!items.length) {
            list.appendChild(emptyRow('No saved passwords. Click “Add” to save one.'));
            return;
        }
        for (const item of items) {
            list.appendChild(siteRow(
                item.site,
                item.user,
                async () => { if (await api.passwords.copy(item.id)) toast('Password copied for 30 seconds'); },
                async () => { await api.passwords.remove(item.id); renderPasswords(); },
                'Delete'
            ));
        }
    }

    async function renderDeclined() {
        const list = $('declined-sites-list');
        const sites = await api.passwords.declined();
        list.replaceChildren();
        if (!sites.length) {
            list.appendChild(emptyRow('No declined sites.'));
            return;
        }
        for (const site of sites) {
            list.appendChild(siteRow(site, '', null, async () => { await api.passwords.removeDeclined(site); renderDeclined(); }, 'Remove'));
        }
    }

    const addModal = $('add-modal');
    function closeAddModal() {
        addModal.classList.remove('active');
        ['site-in', 'user-in', 'pass-in'].forEach(id => { $(id).value = ''; });
        $('add-error').textContent = '';
    }
    $('open-add-modal').addEventListener('click', () => { addModal.classList.add('active'); $('site-in').focus(); });
    $('close-add-modal').addEventListener('click', closeAddModal);
    addModal.addEventListener('click', e => { if (e.target === addModal) closeAddModal(); });
    $('save-pwd-btn').addEventListener('click', async () => {
        const result = await api.passwords.add({
            site: $('site-in').value,
            user: $('user-in').value,
            pass: $('pass-in').value
        });
        if (!result.ok) { $('add-error').textContent = 'Fill in the website, username and password.'; return; }
        closeAddModal();
        renderPasswords();
        toast('Password saved');
    });

    $('btn-import').addEventListener('click', async () => {
        const r = await api.passwords.import();
        if (r.ok) { toast(`Imported ${r.count} password${r.count === 1 ? '' : 's'}`); renderPasswords(); }
        else if (r.reason && r.reason !== 'Cancelled.') toast(r.reason);
    });
    $('btn-export').addEventListener('click', async () => {
        const r = await api.passwords.export();
        if (r.ok) toast(`Exported ${r.count} password${r.count === 1 ? '' : 's'}`);
        else if (r.reason && r.reason !== 'Cancelled.') toast(r.reason);
    });
    $('btn-delete-all').addEventListener('click', async () => {
        if (!await api.confirm('Delete all saved passwords and declined sites?')) return;
        await api.passwords.clear();
        renderPasswords();
        renderDeclined();
        toast('Password data deleted');
    });

    // -----------------------------------------------------------------------
    // Keyboard shortcuts
    // The main process owns recording AND saving, so a change is live the instant it is recorded.
    // -----------------------------------------------------------------------
    let shortcutData = null;   // { categories, map, defaults, names }
    let recordingId = null;
    const statusEl = $('shortcut-status');

    function setStatus(message, warn = false) {
        statusEl.textContent = message;
        statusEl.classList.toggle('warn', warn);
    }

    function renderShortcuts() {
        if (!shortcutData) return;
        const filter = $('shortcut-search').value.trim().toLowerCase();
        const container = $('shortcuts-container');
        container.replaceChildren();

        for (const cat of shortcutData.categories) {
            const items = cat.items.filter(item => {
                const combo = shortcutData.map[item.id] || '';
                return item.name.toLowerCase().includes(filter) || combo.toLowerCase().includes(filter);
            });
            if (!items.length) continue;

            const header = document.createElement('div');
            header.className = 'shortcut-category';
            header.textContent = cat.category;
            container.appendChild(header);

            for (const item of items) {
                const combo = shortcutData.map[item.id] || '';
                const isDefault = combo === shortcutData.defaults[item.id];

                const row = document.createElement('div');
                row.className = 'setting-row';
                const label = document.createElement('span');
                label.className = 'setting-label';
                label.textContent = item.name;

                const controls = document.createElement('div');
                controls.className = 'shortcut-controls';

                const reset = document.createElement('button');
                reset.className = 'reset-one';
                reset.textContent = '↺';
                reset.title = 'Restore default';
                reset.style.visibility = isDefault ? 'hidden' : 'visible';
                reset.addEventListener('click', async () => {
                    cancelRecording();
                    const r = await api.shortcuts.resetOne(item.id);
                    announceDisplaced(r.displaced, shortcutData.defaults[item.id]);
                });

                const btn = document.createElement('button');
                btn.className = 'shortcut-btn';
                if (recordingId === item.id) {
                    btn.classList.add('recording');
                    btn.textContent = 'Press keys…';
                } else {
                    btn.textContent = combo || 'Unassigned';
                    if (!combo) btn.classList.add('unassigned');
                }
                btn.addEventListener('click', () => startRecording(item.id));

                controls.append(reset, btn);
                row.append(label, controls);
                container.appendChild(row);
            }
        }
    }

    function announceDisplaced(displacedId, combo) {
        if (displacedId) setStatus(`${combo} was used by “${shortcutData.names[displacedId]}”, which is now unassigned.`);
        else setStatus('Saved. The new shortcut works right away.');
    }

    function startRecording(id) {
        recordingId = id;
        setStatus(`Press the new shortcut for “${shortcutData.names[id]}”. Esc cancels, Backspace clears.`);
        api.shortcuts.startRecording(id);
        renderShortcuts();
    }

    function cancelRecording() {
        if (!recordingId) return;
        recordingId = null;
        api.shortcuts.stopRecording();
        setStatus('');
        renderShortcuts();
    }

    api.shortcuts.onRecordDone(({ id, combo, displaced }) => {
        recordingId = null;
        if (!combo) setStatus(`“${shortcutData.names[id]}” is now unassigned.`);
        else announceDisplaced(displaced, combo);
        renderShortcuts();
    });
    api.shortcuts.onRecordCancel(() => {
        recordingId = null;
        setStatus('');
        renderShortcuts();
    });
    api.shortcuts.onRecordInvalid(reason => setStatus(`${reason}. Try another combination.`, true));

    // Any other client changing shortcuts (or this one finishing) keeps the list in sync.
    api.shortcuts.onChange(({ map }) => {
        if (!shortcutData) return;
        shortcutData.map = map;
        renderShortcuts();
    });

    // Leaving the page or window must never leave keyboard capture on.
    window.addEventListener('blur', cancelRecording);
    window.addEventListener('beforeunload', () => api.shortcuts.stopRecording());
    document.addEventListener('visibilitychange', () => { if (document.hidden) cancelRecording(); });

    $('shortcut-search').addEventListener('input', renderShortcuts);
    $('reset-shortcuts-btn').addEventListener('click', async () => {
        cancelRecording();
        if (!await api.confirm('Reset all shortcuts to their default combinations?')) return;
        await api.shortcuts.reset();
        setStatus('All shortcuts restored to defaults.');
    });

    // -----------------------------------------------------------------------
    // Boot
    // -----------------------------------------------------------------------
    async function init() {
        const [settings, shortcuts] = await Promise.all([api.settings.get(), api.shortcuts.get()]);
        applySettings(settings);
        shortcutData = shortcuts;
        api.settings.onChange(applySettings);
        renderShortcuts();
        renderPasswords();
        renderDeclined();
    }
    init();
})();