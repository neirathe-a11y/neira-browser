'use strict';
const { webFrame } = require('electron');

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
            navigationType: 'Other', wasFetchedViaSpdy: true, wasNpnNegotiated: true, npnNegotiatedProtocol: 'h2',
            wasAlternateProtocolAvailable: false, connectionInfo: 'h2'
        });
    } catch (_) {}
})();`).catch(() => {});