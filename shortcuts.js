'use strict';
// Single source of truth for shortcuts: definitions, defaults, and key normalisation.
// Only the main process requires this file. Settings/UI get the data over IPC.

const CATEGORIES = [
    {
        category: 'Assistant',
        items: [
            ['summarize_page', 'Summarise the current page with Neira', 'Alt + S'],
            ['toggle_assistant', 'Toggle Assistant panel', 'Alt + A']
        ]
    },
    {
        category: 'Tabs & Windows',
        items: [
            ['new_tab', 'Open a new tab', 'Ctrl + T'],
            ['new_window', 'Open a new window', 'Ctrl + N'],
            ['new_private_window', 'Open a new incognito window', 'Ctrl + Shift + N'],
            ['close_tab', 'Close current tab', 'Ctrl + W'],
            ['close_window', 'Close current window', 'Ctrl + Shift + W'],
            ['restore_tab', 'Restore last closed tab', 'Ctrl + Shift + T'],
            ['cycle_tabs', 'Cycle most recent tabs', 'Ctrl + Tab'],
            ['cycle_tabs_back', 'Cycle most recent tabs (backward)', 'Ctrl + Shift + Tab'],
            ['select_next_tab', 'Select next tab', 'Ctrl + PageDown'],
            ['select_prev_tab', 'Select previous tab', 'Ctrl + PageUp'],
            ['select_last_tab', 'Select last tab', 'Ctrl + 9'],
            ['select_tab_1', 'Select tab 1', 'Ctrl + 1'],
            ['select_tab_2', 'Select tab 2', 'Ctrl + 2'],
            ['select_tab_3', 'Select tab 3', 'Ctrl + 3'],
            ['select_tab_4', 'Select tab 4', 'Ctrl + 4'],
            ['select_tab_5', 'Select tab 5', 'Ctrl + 5'],
            ['select_tab_6', 'Select tab 6', 'Ctrl + 6'],
            ['select_tab_7', 'Select tab 7', 'Ctrl + 7'],
            ['select_tab_8', 'Select tab 8', 'Ctrl + 8'],
            ['move_tab_forward', 'Move current tab to forward', 'Ctrl + Shift + PageDown'],
            ['move_tab_backward', 'Move current tab to backward', 'Ctrl + Shift + PageUp'],
            ['search_tabs', 'Search in open tabs', 'Ctrl + Shift + A'],
            ['duplicate_tab', 'Duplicate current tab', 'Ctrl + Shift + K'],
            ['close_other_tabs', 'Close other tabs', ''],
            ['close_tabs_right', 'Close tabs to the right', ''],
            ['reload_all_tabs', 'Reload all tabs', ''],
            ['toggle_vertical_tabs', 'Switch between horizontal and vertical tabs', 'Alt + V'],
            ['toggle_sidebar', 'Collapse / expand the tab sidebar', 'Alt + Shift + V']
        ]
    },
    {
        category: 'Navigation',
        items: [
            ['go_back', 'Go back in history', 'Alt + Left'],
            ['go_forward', 'Go forward in history', 'Alt + Right'],
            ['reload', 'Reload current page', 'Ctrl + R'],
            ['reload_cache', 'Reload current page (bypass cache)', 'Ctrl + Shift + R'],
            ['stop_loading', 'Stop loading', 'Alt + .'],
            ['open_home', 'Open home page', 'Alt + Home'],
            ['open_file', 'Open a file', 'Ctrl + O'],
            ['focus_address', 'Focus on address bar', 'Ctrl + L'],
            ['focus_search_bar', 'Focus on search bar', 'Ctrl + E']
        ]
    },
    {
        category: 'Page & Viewing',
        items: [
            ['find_in_page', 'Find text in page', 'Ctrl + F'],
            ['find_next', 'Find next occurrence of text in page', 'Ctrl + G'],
            ['find_prev', 'Find previous occurrence of text in page', 'Ctrl + Shift + G'],
            ['toggle_fullscreen', 'Toggle fullscreen', 'F11'],
            ['zoom_in', 'Zoom in', 'Ctrl + +'],
            ['zoom_out', 'Zoom out', 'Ctrl + -'],
            ['reset_zoom', 'Reset zoom', 'Ctrl + 0'],
            ['print', 'Print', 'Ctrl + P'],
            ['print_system', 'Print using system dialog', 'Ctrl + Shift + P'],
            ['save_page', 'Save current page', 'Ctrl + S'],
            ['view_source', 'View page source', 'Ctrl + U'],
            ['toggle_dark_mode', 'Toggle dark mode for websites', 'Alt + Shift + D'],
            ['copy_url', 'Copy URL from address bar', 'Alt + C'],
            ['read_aloud', 'Read page (or selection) aloud', 'Ctrl + Shift + U'],
            ['screenshot', 'Take a screenshot of the page', 'Ctrl + Shift + S'],
            ['translate_page', 'Translate page to English', ''],
            ['send_to_device', 'Send page link to your device', '']
        ]
    },
    {
        category: 'Developer Tools',
        items: [
            ['devtools', 'Open Developer Tools', 'F12'],
            ['devtools_toggle', 'Toggle Developer Tools', 'Ctrl + Shift + I'],
            ['devtools_console', 'Open Developer Tools: Console', 'Ctrl + Shift + J']
        ]
    },
    {
        category: 'Bookmarks & Data',
        items: [
            ['bookmark_curr', 'Bookmark current tab', 'Ctrl + D'],
            ['bookmark_all_tabs', 'Bookmark all tabs', 'Ctrl + Shift + D'],
            ['add_speed_dial', 'Add current page to Speed Dial', ''],
            ['toggle_bookmarks_bar', 'Show bookmark bar', 'Ctrl + Shift + B'],
            ['show_bookmark_manager', 'Show bookmark manager', 'Ctrl + Shift + O'],
            ['show_history', 'Show history', 'Ctrl + H'],
            ['show_downloads', 'Show downloads', 'Ctrl + J'],
            ['clear_browsing_data', 'Clear browsing data', 'Ctrl + Shift + Delete']
        ]
    },
    {
        category: 'Focus',
        items: [
            ['focus_toolbar', 'Focus on toolbar', 'Alt + Shift + T'],
            ['focus_menu_bar', 'Focus on menu bar', 'Alt + F10'],
            ['focus_bookmarks', 'Focus on bookmarks bar', 'Alt + Shift + B'],
            ['focus_web_contents', 'Focus on web contents pane', 'Alt + Shift + W'],
            ['focus_next_pane', 'Focus on next pane', 'F6'],
            ['focus_prev_pane', 'Focus on previous pane', 'Shift + F6']
        ]
    },
    {
        category: 'Menus & Help',
        items: [
            ['show_app_menu', 'Show app menu', 'Alt + F'],
            ['show_avatar_menu', 'Show avatar menu', 'Ctrl + Shift + M'],
            ['show_settings', 'Open settings', 'Ctrl + ,'],
            ['show_shortcuts', 'Customize keyboard shortcuts', 'Ctrl + Alt + K'],
            ['toggle_theme', 'Switch light / dark theme', 'Alt + Shift + L'],
            ['toggle_density', 'Switch compact / comfortable layout', ''],
            ['open_help', 'Open help page', 'F1']
        ]
    }
];

const DEFAULTS = {};
const NAMES = {};
for (const cat of CATEGORIES) {
    for (const [id, name, key] of cat.items) {
        DEFAULTS[id] = key;
        NAMES[id] = name;
    }
}

// Editing keys that should never be hijacked.
const RESERVED = new Set(['Ctrl + C', 'Ctrl + V', 'Ctrl + X', 'Ctrl + A', 'Ctrl + Z', 'Ctrl + Y']);
const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'OS', 'CapsLock']);

const CODE_NAMES = {
    Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'",
    BracketLeft: '[', BracketRight: ']', Backslash: '\\', Backquote: '`',
    ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down',
    Space: 'Space', Enter: 'Enter', NumpadEnter: 'Enter', Tab: 'Tab', Escape: 'Escape',
    Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
    Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown'
};

function keyName(input) {
    const key = input.key || '';
    const code = input.code || '';
    // Layout-independent handling for zoom keys (+ / - / =)
    if (key === '+' || key === '=') return '+';
    if (key === '-' || key === '_') return '-';
    if (/^[a-z]$/i.test(key)) return key.toUpperCase();
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit\d$/.test(code)) return code.slice(5);
    if (/^Numpad\d$/.test(code)) return code.slice(6);
    if (/^\d$/.test(key)) return key;
    if (/^F\d{1,2}$/.test(code)) return code;
    if (/^F\d{1,2}$/.test(key)) return key;
    if (CODE_NAMES[code]) return CODE_NAMES[code];
    if (key === ' ') return 'Space';
    if (key === 'ArrowLeft') return 'Left';
    if (key === 'ArrowRight') return 'Right';
    if (key.length === 1) return key.toUpperCase();
    return key || code || null;
}

// Turns an Electron `before-input-event` input into a canonical combo string, e.g. "Ctrl + Shift + T".
// Returns null for modifier-only presses.
function normalizeInput(input, platform = process.platform) {
    if (MODIFIER_KEYS.has(input.key)) return null;
    const key = keyName(input);
    if (!key) return null;
    const isMac = platform === 'darwin';
    const mods = [];
    if (input.control || (isMac && input.meta)) mods.push('Ctrl');
    if (input.alt) mods.push('Alt');
    // Shift is needed to type "+" on many layouts, so it never counts for the zoom keys.
    if (input.shift && key !== '+' && key !== '-') mods.push('Shift');
    if (input.meta && !isMac) mods.push('Meta');
    return [...mods, key].join(' + ');
}

// "Ctrl + Alt + …" while the user is still holding modifiers during recording.
function describeModifiers(input, platform = process.platform) {
    const isMac = platform === 'darwin';
    const mods = [];
    if (input.control || (isMac && input.meta)) mods.push('Ctrl');
    if (input.alt) mods.push('Alt');
    if (input.shift) mods.push('Shift');
    if (input.meta && !isMac) mods.push('Meta');
    return mods.length ? mods.join(' + ') + ' + …' : '';
}

function parseCombo(combo) {
    const idx = combo.lastIndexOf(' + ');
    if (idx < 0) return { mods: [], key: combo };
    return { mods: combo.slice(0, idx).split(' + '), key: combo.slice(idx + 3) };
}

function validate(combo) {
    if (typeof combo !== 'string' || !combo) return { ok: false, reason: 'Empty shortcut' };
    const { mods, key } = parseCombo(combo);
    const isFKey = /^F\d{1,2}$/.test(key);
    const strong = mods.some(m => m !== 'Shift');
    if (!isFKey && !strong) return { ok: false, reason: 'Use Ctrl, Alt or an F-key in the shortcut' };
    if (RESERVED.has(combo)) return { ok: false, reason: `${combo} is reserved for text editing` };
    return { ok: true };
}

module.exports = { CATEGORIES, DEFAULTS, NAMES, normalizeInput, validate, parseCombo, describeModifiers };