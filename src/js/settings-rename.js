/*
 * Settings rename dialog (uses Samsung's on-screen keyboard). Shared through SettingsCore.rename;
 * the overlay view is registered by register(), called from settings.js init().
 */
(function () {
    'use strict';

    var $ = UI.$;
    var KEY = UI.KEY;
    var IME_DONE = 65376;
    var IME_CANCEL = 65385;

    // ---------- Rename dialog (uses Samsung's on-screen keyboard)

    var renameDone = null;
    var renameAllowEmpty = false;

    function rename(current, done, opts) {
        opts = opts || {};
        renameDone = done;
        renameAllowEmpty = !!opts.allowEmpty;
        var title = $('rename-title');
        if (title) title.textContent = opts.title || 'Name';
        var input = $('rename-input');
        input.value = current || '';
        input.maxLength = opts.maxLength || 28;
        // Keep type=text: Samsung's IME often returns an empty value for type=password.
        // Mask with CSS instead (Unsplash key + Music password).
        input.type = 'text';
        input.classList.toggle('secret', !!opts.password);
        input.setAttribute('autocomplete', opts.password ? 'off' : 'off');
        UI.show('rename');
    }

    function closeRename(save) {
        var input = $('rename-input');
        var value = input.value.trim();
        var done = renameDone;
        renameDone = null;
        var allowEmpty = renameAllowEmpty;
        renameAllowEmpty = false;
        input.blur();
        input.type = 'text';
        input.classList.remove('secret');
        input.maxLength = 28;
        var title = $('rename-title');
        if (title) title.textContent = 'Name';
        UI.back();
        if (save && (value || allowEmpty) && done) done(value);
    }

    function register() {
        UI.register('rename', {
            el: $('rename'),
            overlay: true,
            focusEl: function () { return $('rename-input'); },
            hints: [['OK', 'Save'], ['Back', 'Cancel']],
            onShow: function () {
                setTimeout(function () {
                    var input = $('rename-input');
                    input.focus();
                    input.setSelectionRange(input.value.length, input.value.length);
                }, 0);
            },
            onKey: function (k) {
                if (k === KEY.ENTER || k === IME_DONE) {
                    closeRename(true);
                    return true;
                }
                if (k === KEY.BACK || k === KEY.ESC || k === IME_CANCEL) {
                    closeRename(false);
                    return true;
                }
                return 'pass';
            }
        });
    }

    SettingsCore.rename = rename;

    window.SettingsRename = { register: register };
})();
