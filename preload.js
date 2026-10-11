'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const send = (channel, ...args) => ipcRenderer.send(channel, ...args);

// Returns subscribe(callback) -> unsubscribe()
const on = channel => callback => {
    const handler = (_event, ...args) => callback(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('neira', {
    confirm: message => invoke('dialog:confirm', message),
    copy: text => invoke('clipboard:write', text),

    // Actions that need the main process (windows, dialogs)
    runMainAction: id => send('action:run', id),
    savePage: webContentsId => invoke('page:save', webContentsId),
    clearBrowsingData: () => invoke('browsing:clear'),
    devtools: { showConsole: webContentsId => invoke('devtools:console', webContentsId) },

    // Browser window
    onAction: on('shortcut:action'),
    onOpenUrl: on('open-url'),
    onModifierReleased: on('shortcut:modifier-released'),
    onOpenInput: on('open-input'),
    onSummarizeText: on('assistant:summarize'),
    screenshot: webContentsId => invoke('page:screenshot', webContentsId),

    settings: {
        get: () => invoke('settings:get'),
        set: (key, value) => invoke('settings:set', key, value),
        onChange: on('settings:changed')
    },

    shortcuts: {
        get: () => invoke('shortcuts:get'),
        set: (id, combo) => invoke('shortcuts:set', id, combo),
        reset: () => invoke('shortcuts:reset'),
        resetOne: id => invoke('shortcuts:reset-one', id),
        exportFile: () => invoke('shortcuts:export'),
        importFile: () => invoke('shortcuts:import'),
        startRecording: id => send('shortcuts:record-start', id),
        stopRecording: () => send('shortcuts:record-stop'),
        onChange: on('shortcuts:changed'),
        onRecordDone: on('shortcuts:record-done'),
        onRecordCancel: on('shortcuts:record-cancel'),
        onRecordInvalid: on('shortcuts:record-invalid'),
        onRecordPreview: on('shortcuts:record-preview')
    },

    bookmarks: {
        get: () => invoke('bookmarks:get'),
        toggle: entry => invoke('bookmarks:toggle', entry),
        addMany: entries => invoke('bookmarks:add-many', entries),
        remove: url => invoke('bookmarks:remove', url),
        onChange: on('bookmarks:changed')
    },

    history: {
        get: () => invoke('history:get'),
        add: entry => invoke('history:add', entry),
        remove: id => invoke('history:remove', id),
        clear: () => invoke('history:clear'),
        onChange: on('history:changed')
    },

    passwords: {
        list: () => invoke('passwords:list'),
        add: entry => invoke('passwords:add', entry),
        remove: id => invoke('passwords:remove', id),
        copy: id => invoke('passwords:copy', id),
        import: () => invoke('passwords:import'),
        export: () => invoke('passwords:export'),
        declined: () => invoke('passwords:declined'),
        removeDeclined: site => invoke('passwords:remove-declined', site),
        clear: () => invoke('passwords:clear')
    },

    // New tab page
    newtab: { go: (text, newTab) => send('newtab:go', text, !!newTab) },
    speedDial: {
        get: () => invoke('speeddial:get'),
        set: list => invoke('speeddial:set', list),
        add: entry => invoke('speeddial:add', entry),
        chooseImage: () => invoke('speeddial:choose-image'),
        onChange: on('speeddial:changed')
    },
    wallpaper: { choose: () => invoke('wallpaper:choose') },

    profiles: {
        list: () => invoke('profiles:list'),
        add: opts => invoke('profiles:add', opts),
        update: (id, opts) => invoke('profiles:update', id, opts),
        remove: id => invoke('profiles:delete', id),
        switch: id => invoke('profiles:switch', id),
        onChange: on('profiles:changed')
    },

    permissions: {
        list: () => invoke('permissions:list'),
        clear: () => invoke('permissions:clear')
    },

    downloads: {
        get: () => invoke('downloads:get'),
        open: id => invoke('downloads:open', id),
        show: id => invoke('downloads:show', id),
        cancel: id => invoke('downloads:cancel', id),
        clear: () => invoke('downloads:clear'),
        onChange: on('downloads:changed')
    }
});
