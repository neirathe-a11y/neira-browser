'use strict';
// Optional visual helpers for the assistant panel. Purely additive: this only toggles classes and CSS variables
// on elements that app.js already creates. It never changes the assistant's content or logic, and
// assistant-fx.css still works (with slightly fewer touches) if this file is removed.
(() => {
    const out = document.getElementById('assistant-out');
    const panel = document.getElementById('assistant');
    if (!out || !panel) return;

    // 1. State classes on every answer card:  is-loading -> is-streaming -> is-done
    function syncCard(card) {
        const actions = card.querySelector(':scope > .as-actions');
        const writing = !!card.querySelector(':scope > .as-md');
        card.classList.toggle('is-loading', !!card.querySelector(':scope > .as-skel, :scope > .as-progress'));
        card.classList.toggle('is-streaming', writing && !!actions && actions.children.length === 1); // only "Stop" is showing
        card.classList.toggle('is-done', !!actions && actions.children.length > 1);
    }

    const dirty = new Set();
    let flushRaf = 0;
    const flush = () => { flushRaf = 0; dirty.forEach(syncCard); dirty.clear(); };

    new MutationObserver(records => {
        for (const r of records) {
            const target = r.target.nodeType === 1 ? r.target : r.target.parentElement;
            if (!target || target.closest('.as-md')) continue; // token updates: nothing to learn from them
            const card = target.closest('.as-card');
            if (card) dirty.add(card);
            for (const n of r.addedNodes) if (n.nodeType === 1 && n.classList.contains('as-card')) dirty.add(n);
        }
        if (dirty.size && !flushRaf) flushRaf = requestAnimationFrame(flush);
    }).observe(out, { childList: true, subtree: true });

    // 2. Spotlight that follows the pointer across a card
    let spot = null;
    let spotRaf = 0;
    out.addEventListener('pointermove', e => {
        const card = e.target.closest && e.target.closest('.as-card');
        if (!card) return;
        spot = { card, x: e.clientX, y: e.clientY };
        if (spotRaf) return;
        spotRaf = requestAnimationFrame(() => {
            spotRaf = 0;
            const rect = spot.card.getBoundingClientRect();
            spot.card.style.setProperty('--mx', (spot.x - rect.left) + 'px');
            spot.card.style.setProperty('--my', (spot.y - rect.top) + 'px');
        });
    }, { passive: true });

    // 3. Press glow that starts where you click
    panel.addEventListener('pointerdown', e => {
        const b = e.target.closest && e.target.closest('.primary-btn, .secondary-btn, .as-link');
        if (!b) return;
        const rect = b.getBoundingClientRect();
        b.style.setProperty('--px', ((e.clientX - rect.left) / rect.width * 100) + '%');
        b.style.setProperty('--py', ((e.clientY - rect.top) / rect.height * 100) + '%');
    }, { passive: true });

    // 4. A green tick on Copy
    panel.addEventListener('click', e => {
        const b = e.target.closest && e.target.closest('.as-actions .as-link');
        if (!b || b.textContent.trim() !== 'Copy') return;
        b.classList.add('did-copy');
        setTimeout(() => b.classList.remove('did-copy'), 1400);
    });

    out.querySelectorAll('.as-card').forEach(syncCard);
})();
