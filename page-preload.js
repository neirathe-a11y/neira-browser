'use strict';
const { ipcRenderer } = require('electron');

function openInNewTab(e, button) {
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    const href = a.href;
    if (!href || !/^https?:/i.test(href)) return;
    e.preventDefault();
    e.stopPropagation();
    ipcRenderer.sendToHost('neira-open-tab', href);
}

// Middle-click (scroll wheel click)
window.addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;
    const a = e.target.closest && e.target.closest('a');
    if (!a) return;
    const href = a.href;
    if (!href || !/^https?:/i.test(href)) return;
    e.preventDefault();
    e.stopPropagation();
    require('electron').ipcRenderer.sendToHost('neira-open-tab', href);
}, true);

// Ctrl+click also opens in background tab, like Chrome
window.addEventListener('click', (e) => {
    if (e.button === 0 && (e.ctrlKey || e.metaKey)) openInNewTab(e, 0);
    else if (e.button === 0) {
        const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
        if (!a) return;
        const target = a.target;
        if (target && target !== '_self' && target !== '_top' && target !== '_parent') {
            const href = a.href;
            if (!href || !/^https?:/i.test(href)) return;
            e.preventDefault();
            e.stopPropagation();
            ipcRenderer.sendToHost('neira-open-tab', href);
        }
    }
}, true);

webFrame.executeJavaScript(`(() => {
    try {
        const c = window.chrome || (window.chrome = {});
        if (!c.app) c.app = {
            isInstalled: false,
            InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
            RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
            getDetails() { return null; },
            getIsInstalled() { return false; },
            runningState() { return 'cannot_run'; }
        };
        if (!c.csi) c.csi = () => ({ onloadT: Date.now(), startE: Date.now(), pageT: performance.now(), tran: 15 });
        if (!c.loadTimes) c.loadTimes = () => ({
            requestTime: Date.now() / 1000, startLoadTime: Date.now() / 1000, commitLoadTime: Date.now() / 1000,
            finishDocumentLoadTime: 0, finishLoadTime: 0, firstPaintTime: 0, firstPaintAfterLoadTime: 0,
            navigationType: 'Other', wasFetchedViaSpdy: true, wasNpnNegotiated: true,
            npnNegotiatedProtocol: 'h2', wasAlternateProtocolAvailable: false, connectionInfo: 'h2'
        });
    } catch (_) {}
})()`);n