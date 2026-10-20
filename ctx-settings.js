'use strict';
(() => {
    const api = window.neira;
    const sec = document.getElementById('cm-section');
    const pv = document.getElementById('cm-preview');
    if (!api || !sec || !pv) return;

    const DEF = { bg: '#1c1c3a', text: '#ffffff', border: '#1f5f7a', hover: '#2a2a55', opacity: 100, radius: 10,
                  fontSize: 13, padding: 7, blur: 0, minWidth: 220, shadow: 'medium', showShortcuts: true, animate: true };
    const SH = { none: 'none', soft: '0 4px 14px rgba(0,0,0,.25)', medium: '0 14px 40px rgba(0,0,0,.55)', strong: '0 20px 60px rgba(0,0,0,.8)' };
    const PRESETS = {
        indigo:   { bg: '#1c1c3a', text: '#ffffff', border: '#1f5f7a', hover: '#2a2a55', opacity: 100, blur: 0, radius: 10, shadow: 'medium' },
        midnight: { bg: '#0b0d14', text: '#e2e8f0', border: '#222836', hover: '#1a1f2e', opacity: 100, blur: 0, radius: 8, shadow: 'medium' },
        neon:     { bg: '#06080f', text: '#d8fbff', border: '#00f0ff', hover: '#0b2a33', opacity: 96, blur: 0, radius: 12, shadow: 'strong' },
        light:    { bg: '#ffffff', text: '#1e1e1e', border: '#d4d4d8', hover: '#eef0f5', opacity: 100, blur: 0, radius: 10, shadow: 'soft' },
        glass:    { bg: '#202048', text: '#ffffff', border: '#6b6bb5', hover: '#4a4a8a', opacity: 55, blur: 16, radius: 14, shadow: 'medium' }
    };

    let cur = {};
    let timer = 0;

    function paint() {
        const c = { ...DEF, ...cur };
        const s = pv.style;
        s.setProperty('--bg', c.bg);
        s.setProperty('--tx', c.text);
        s.setProperty('--bd', c.border);
        s.setProperty('--hv', c.hover);
        s.setProperty('--op', c.opacity + '%');
        s.setProperty('--r', c.radius + 'px');
        s.setProperty('--fs', c.fontSize + 'px');
        s.setProperty('--pd', c.padding + 'px');
        s.setProperty('--bl', c.blur + 'px');
        s.setProperty('--w', c.minWidth + 'px');
        s.setProperty('--sh', SH[c.shadow] || SH.medium);
        pv.classList.toggle('nohints', !c.showShortcuts);
        sec.querySelectorAll('[data-k]').forEach(el => {
            const v = c[el.dataset.k];
            if (el.type === 'checkbox') el.checked = !!v;
            else el.value = v;
        });
    }

    function save() {
        clearTimeout(timer);
        timer = setTimeout(() => api.settings.set('contextMenu', cur), 80);
    }

    sec.addEventListener('input', e => {
        const k = e.target.dataset && e.target.dataset.k;
        if (!k) return;
        cur[k] = e.target.type === 'checkbox' ? e.target.checked
               : e.target.type === 'range' ? Number(e.target.value)
               : e.target.value;
        paint();
        save();
    });

    sec.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
        cur = b.dataset.preset === 'reset' ? {} : { ...PRESETS[b.dataset.preset] };
        paint();
        save();
    }));

    api.settings.get().then(s => { cur = { ...(s.contextMenu || {}) }; paint(); });
    api.settings.onChange(s => {
        if (sec.contains(document.activeElement)) return;
        cur = { ...(s.contextMenu || {}) };
        paint();
    });
})();