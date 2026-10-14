'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const send = (channel, ...args) => ipcRenderer.send(channel, ...args);
const sendSync = (channel, ...args) => ipcRenderer.sendSync(channel, ...args);

const on = channel => callback => {
    const handler = (_event, ...args) => callback(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('neira', {
    confirm: message => invoke('dialog:confirm', message),
    copy: text => invoke('clipboard:write', text),

    runMainAction: id => send('action:run', id),
    savePage: webContentsId => invoke('page:save', webContentsId),
    clearBrowsingData: () => invoke('browsing:clear'),
    devtools: { showConsole: webContentsId => invoke('devtools:console', webContentsId) },

    window: {
        minimize: () => send('window:minimize'),
        maximizeToggle: () => send('window:maximize-toggle'),
        close: () => send('window:close'),
        dragStart: () => send('window:drag-start'),
        dragStop: () => send('window:drag-stop'),
        openUrl: url => send('window:open-url', url),
        isMaximized: () => sendSync('window:is-maximized'),
        onMaximized: on('window:maximized')
    },

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
    },
    parental: {
        status: () => invoke('parental:status'),
        setup: pin => invoke('parental:setup', pin),
        verify: pin => invoke('parental:verify', pin),
        changePin: (currentPin, newPin) => invoke('parental:change-pin', currentPin, newPin),
        recover: (code, newPin) => invoke('parental:recover', code, newPin),
        regenerateRecovery: pin => invoke('parental:regenerate-recovery', pin),
        forgotInfo: () => invoke('parental:forgot-info'),
        update: patch => invoke('parental:update', patch),
        enable: pin => invoke('parental:enable', pin),
        disable: pin => invoke('parental:disable', pin),
        resetDay: () => invoke('parental:reset-day'),
        clearBlocks: () => invoke('parental:clear-blocks'),
        onChanged: on('parental:changed'),
        onUsage: on('parental:usage'),
        onBlocked: on('parental:blocked')
    },
    extensions: {
        load: () => invoke('extensions:load'),
        list: () => invoke('extensions:list'),
        remove: id => invoke('extensions:remove', id),
        setEnabled: (id, enabled) => invoke('extensions:set-enabled', id, enabled),
        onChange: on('extensions:changed')
    }
});