'use strict';
const { ipcRenderer } = require('electron');

window.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a');
    if (!a) return;

    const href = a.href;
    const target = a.target;
    
    // If it's a normal link, let the page handle it
    if (!href || ((!target || target === '_self') && e.button === 0)) return;

    // Stop the page from opening a popup
    e.preventDefault();
    e.stopPropagation();
    
    // Tell Neira to open the tab
    ipcRenderer.sendToHost('neira-open-tab', href);
}, true);