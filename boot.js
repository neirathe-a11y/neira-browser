'use strict';
// Runs in <head> before first paint so the theme, accent colour and density are right immediately
// (no dark/light flash). The real values come from the main process a moment later.
// Also exposes window.neiraTheme so every page applies colours the same way.
(() => {
    const DEFAULT_ACCENT = '#6366f1';
    const TINTS = { off: '0%', subtle: '7%', strong: '15%' };
    const ACCENTS = [
        { name: 'Indigo', value: '#6366f1' },
        { name: 'Blue', value: '#3b82f6' },
        { name: 'Cyan', value: '#06b6d4' },
        { name: 'Teal', value: '#14b8a6' },
        { name: 'Green', value: '#22c55e' },
        { name: 'Yellow', value: '#eab308' },
        { name: 'Orange', value: '#f97316' },
        { name: 'Red', value: '#ef4444' },
        { name: 'Pink', value: '#ec4899' },
        { name: 'Purple', value: '#a855f7' }
    ];
    const HEX = /^#[0-9a-f]{6}$/i;

    // White or near-black text, whichever reads better on the accent colour.
    function onAccent(hex) {
        const n = parseInt(hex.slice(1), 16);
        const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
        const lum = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
        return lum > 0.45 ? '#111111' : '#ffffff';
    }

    function apply(ui) {
        const root = document.documentElement;
        ui = ui || {};
        root.classList.toggle('light-theme', ui.theme === 'light');
        root.classList.toggle('compact', ui.density === 'compact');
        root.classList.toggle('vertical-tabs', ui.tabLayout === 'vertical');
        root.classList.toggle('sidebar-collapsed', ui.tabLayout === 'vertical' && !!ui.sidebarCollapsed);

        // Private windows keep their own purple identity.
        if (root.classList.contains('private')) {
            root.style.removeProperty('--accent');
            root.style.removeProperty('--on-accent');
            root.style.removeProperty('--tint');
            return;
        }
        const accent = HEX.test(ui.accent || '') ? ui.accent.toLowerCase() : DEFAULT_ACCENT;
        root.style.setProperty('--accent', accent);
        root.style.setProperty('--on-accent', onAccent(accent));
        root.style.setProperty('--tint', TINTS[ui.accentTint] || TINTS.off);
    }

    // Remember everything boot.js needs, so the next window or page paints correctly straight away.
    function persist(s) {
        try {
            localStorage.setItem('neira.ui', JSON.stringify({
                theme: s.theme, density: s.density, tabLayout: s.tabLayout,
                sidebarCollapsed: !!s.sidebarCollapsed, accent: s.accent, accentTint: s.accentTint
            }));
        } catch (_) { /* storage unavailable */ }
    }

    // Builds (once) and updates a row of accent-colour swatches: presets plus a custom colour picker.
    function swatches(box, current, onPick) {
        const cur = (HEX.test(current || '') ? current : DEFAULT_ACCENT).toLowerCase();
        if (!box.firstChild) {
            for (const a of ACCENTS) {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'swatch';
                b.dataset.value = a.value;
                b.title = a.name;
                b.style.setProperty('--sw', a.value);
                b.setAttribute('role', 'radio');
                b.setAttribute('aria-label', a.name);
                b.addEventListener('click', () => onPick(a.value));
                box.appendChild(b);
            }
            const custom = document.createElement('label');
            custom.className = 'swatch custom';
            custom.title = 'Custom colour';
            const input = document.createElement('input');
            input.type = 'color';
            input.setAttribute('aria-label', 'Custom accent colour');
            input.addEventListener('change', () => onPick(input.value));
            custom.appendChild(input);
            box.appendChild(custom);
        }
        let matched = false;
        for (const b of box.querySelectorAll('button.swatch')) {
            const on = b.dataset.value === cur;
            b.classList.toggle('active', on);
            b.setAttribute('aria-checked', String(on));
            if (on) matched = true;
        }
        const custom = box.querySelector('.custom');
        custom.classList.toggle('active', !matched);
        custom.style.setProperty('--sw', cur);
        custom.firstChild.value = cur;
    }

    window.neiraTheme = { apply, persist, swatches, ACCENTS, DEFAULT_ACCENT, HEX, onAccent };

    try {
        if (new URLSearchParams(location.search).get('private') === '1') document.documentElement.classList.add('private');
        apply(JSON.parse(localStorage.getItem('neira.ui') || '{}'));
    } catch (_) { /* storage unavailable: defaults apply */ }
window.neiraTheme = window.neiraTheme || {};
window.neiraTheme.ACCENTS = [
    { name: 'Indigo', value: '#6366f1' },
    { name: 'Blue', value: '#3b82f6' },
    { name: 'Sky', value: '#0ea5e9' },
    { name: 'Cyan / Neon', value: '#00f0ff' },
    { name: 'Teal', value: '#14b8a6' },
    { name: 'Emerald', value: '#10b981' },
    { name: 'Green', value: '#22c55e' },
    { name: 'Lime', value: '#84cc16' },
    { name: 'Yellow', value: '#eab308' },
    { name: 'Amber', value: '#f59e0b' },
    { name: 'Orange', value: '#f97316' },
    { name: 'Red', value: '#ef4444' },
    { name: 'Rose', value: '#f43f5e' },
    { name: 'Pink', value: '#ec4899' },
    { name: 'Fuchsia', value: '#d946ef' },
    { name: 'Purple', value: '#a855f7' },
    { name: 'Violet', value: '#8b5cf6' },
    { name: 'Slate Gray', value: '#64748b' }
];
})();