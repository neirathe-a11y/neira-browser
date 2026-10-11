// webview-preload.js
window.addEventListener('DOMContentLoaded', () => {
    if (window.__shortcutListenerInjected) return;
    window.__shortcutListenerInjected = true;

    window.addEventListener('keydown', (e) => {
        // Skip shortcut capture when typing inside input or textarea elements
        if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
            return;
        }

        const isCtrl = e.ctrlKey || e.metaKey;
        if (isCtrl || e.altKey || e.key === 'F5') {
            window.parent.postMessage({
                type: 'shortcut-keydown',
                key: e.key,
                code: e.code,
                ctrlKey: e.ctrlKey,
                shiftKey: e.shiftKey,
                altKey: e.altKey,
                metaKey: e.metaKey
            }, '*');
        }
    }, true);
});