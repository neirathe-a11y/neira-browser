(() => {
    const w = window.neira && window.neira.window;
    if (!w || !w.dragStart) return;

    const ZONES = '.tab-bar, .toolbar, .rail';
    const INTERACTIVE = 'button, input, select, textarea, a, .tab, .rail-tab, .url-bar-container, .private-badge, .win-controls, .find-bar';
    let active = false;

    const stop = () => {
        if (!active) return;
        active = false;
        w.dragStop();
    };

    document.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        if (!e.target.closest(ZONES) || e.target.closest(INTERACTIVE)) return;
        active = true;
        w.dragStart();
    });

    document.addEventListener('mousemove', e => { if (active && e.buttons === 0) stop(); });
    window.addEventListener('mouseup', stop);
    window.addEventListener('blur', stop);

    document.addEventListener('dblclick', e => {
        if (!e.target.closest(ZONES) || e.target.closest(INTERACTIVE)) return;
        w.maximizeToggle();
    });
})();