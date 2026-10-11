document.addEventListener('DOMContentLoaded', () => {
    const horizontalTabsContainer = document.getElementById('horizontal-tabs-container');
    const verticalTabsContainer = document.getElementById('vertical-tabs-container');
    const urlInput = document.getElementById('url-input');

    let isVertical = false;
    let tabsMap = new Map();
    let activeTabId = null;

    // --- IPC LISTENERS ---
    if (window.electronAPI) {
        window.electronAPI.onSetVerticalTabs((enabled) => {
            isVertical = enabled;
            const topContainer = document.getElementById('browser-top-container');
            const sidebar = document.getElementById('vertical-sidebar');
            if (topContainer) topContainer.style.display = enabled ? 'none' : 'flex';
            if (sidebar) sidebar.style.display = enabled ? 'flex' : 'none';
            renderTabs();
        });

        window.electronAPI.onTabCreated((tab) => {
            tabsMap.set(tab.tabId, tab);
            if (tab.active) activeTabId = tab.tabId;
            renderTabs();
        });

        window.electronAPI.onTabUpdated((tab) => {
            if (tabsMap.has(tab.tabId)) {
                tabsMap.set(tab.tabId, { ...tabsMap.get(tab.tabId), ...tab });
                if (tab.active) activeTabId = tab.tabId;
                renderTabs();
            }
        });

        window.electronAPI.onTabClosed((data) => {
            tabsMap.delete(data.tabId);
            renderTabs();
        });

        window.electronAPI.onUpdateUrlBar((data) => {
            if (urlInput && document.activeElement !== urlInput) {
                urlInput.value = data.url || '';
            }
        });
    }

    // --- RENDER TABS ---
    function renderTabs() {
        const container = isVertical ? verticalTabsContainer : horizontalTabsContainer;
        if (!container) return;
        
        container.innerHTML = ''; 
        
        tabsMap.forEach((tab) => {
            const tabBtn = document.createElement('div');
            tabBtn.className = `tab-button ${tab.active ? 'active' : ''}`;
            
            const titleSpan = document.createElement('span');
            titleSpan.textContent = tab.title || 'Loading...';
            titleSpan.style.flexGrow = '1';
            titleSpan.style.overflow = 'hidden';
            titleSpan.style.textOverflow = 'ellipsis';
            titleSpan.onclick = () => window.electronAPI && window.electronAPI.switchTab(tab.tabId);
            tabBtn.appendChild(titleSpan);

            const closeBtn = document.createElement('span');
            closeBtn.textContent = '✕';
            closeBtn.className = 'tab-close-btn';
            closeBtn.onclick = (e) => {
                e.stopPropagation(); 
                if (window.electronAPI) window.electronAPI.closeTab(tab.tabId);
            };
            
            tabBtn.appendChild(closeBtn);
            container.appendChild(tabBtn);
        });
    }

    // --- BUTTON CLICK BINDINGS ---
    const clickHandler = (id, fn) => {
        const el = document.getElementById(id);
        if (el) el.onclick = fn;
    };

    clickHandler('new-tab-btn', () => window.electronAPI && window.electronAPI.createTab());
    clickHandler('sidebar-new-tab-btn', () => window.electronAPI && window.electronAPI.createTab());
    
    clickHandler('history-btn', () => window.electronAPI && window.electronAPI.openHistory());
    clickHandler('sidebar-history-btn', () => window.electronAPI && window.electronAPI.openHistory());
    
    clickHandler('downloads-btn', () => window.electronAPI && window.electronAPI.openDownloads());
    clickHandler('sidebar-downloads-btn', () => window.electronAPI && window.electronAPI.openDownloads());
    
    clickHandler('settings-btn', () => window.electronAPI && window.electronAPI.openSettings());
    clickHandler('sidebar-settings-btn', () => window.electronAPI && window.electronAPI.openSettings());

    clickHandler('back-btn', () => window.electronAPI && window.electronAPI.navBack());
    clickHandler('forward-btn', () => window.electronAPI && window.electronAPI.navForward());
    clickHandler('reload-btn', () => window.electronAPI && window.electronAPI.navReload());

    if (urlInput) {
        urlInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && window.electronAPI) {
                window.electronAPI.navigate(urlInput.value);
            }
        });
    }

    // --- STRICT DOM-READY WEBVIEW INJECTION ---
    const setupWebviewKeyListeners = (webview) => {
        if (!webview) return;

        const scriptToInject = `
            (function() {
                if (window.__shortcutListenerInjected) return;
                window.__shortcutListenerInjected = true;

                window.addEventListener('keydown', (e) => {
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
            })();
        `;

        const safeExecute = () => {
            if (typeof webview.isDestroyed === 'function' && webview.isDestroyed()) return;
            webview.executeJavaScript(scriptToInject).catch((err) => {
                console.warn('Execution skipped:', err.message);
            });
        };

        // Strict listener: execution occurs strictly when GuestView frame exists
        webview.addEventListener('dom-ready', safeExecute, { once: true });
    };

    // Attach listeners to existing webviews
    document.querySelectorAll('webview').forEach(setupWebviewKeyListeners);

    // Observer for dynamically added webviews
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node && node.tagName === 'WEBVIEW') {
                    setupWebviewKeyListeners(node);
                }
            });
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });
});