/*
 * Settings → Screen saver page. Entry points are exposed on window.SettingsScreensaver and wired
 * up by settings.js.
 */
(function () {
    'use strict';

    var $ = UI.$;
    var el = UI.el;
    var chip = SettingsCore.chip;

    /*
     * "Change photo" only means something while the Background is on Rotate or Live: with a
     * single photo the screen saver holds it, exactly as Home does.
     */
    function screensaverBlocks() {
        var mode = Prefs.get().wallpaper.mode;
        var blocks = [
            { title: 'Enabled', key: 'enabled', options: [[true, 'On'], [false, 'Off']] },
            { title: 'Start after', key: 'delay', options: optionPairs(Screensaver.DELAYS) }
        ];
        if (mode === 'rotate' || mode === 'live') {
            blocks.push({ title: 'Change photo every', key: 'photoEvery', options: optionPairs(Screensaver.PHOTO_EVERY) });
        }
        blocks.push({ title: 'Go dark after', key: 'dark', options: optionPairs(Screensaver.DARK_AFTER) });
        blocks.push({ title: 'Hide text after', key: 'chromeHide', options: optionPairs(Screensaver.CHROME_HIDE) });
        blocks.push({ title: 'Drift', key: 'pan', options: [[true, 'On'], [false, 'Off']] });
        if (Prefs.get().screensaver.pan !== false) {
            blocks.push({ title: 'Drift speed', key: 'panSpeed', options: optionPairs(Screensaver.PAN_SPEEDS) });
        }
        blocks.push({ title: 'Blur fill', key: 'blur', options: [[true, 'On'], [false, 'Off']] });
        return blocks;
    }

    function optionPairs(list) {
        return list.map(function (o) { return [o.key, o.label]; });
    }

    function renderScreensaver() {
        var p = Prefs.get().screensaver;
        var body = $('screensaver-body');
        body.innerHTML = '';
        screensaverBlocks().forEach(function (b) {
            var block = el('div', 'setting-block');
            block.appendChild(el('h2', '', b.title));
            var chips = el('div', 'chips');
            b.options.forEach(function (o) {
                chips.appendChild(chip(o[1], p[b.key] === o[0], { key: b.key, value: o[0] }));
            });
            block.appendChild(chips);
            body.appendChild(block);
        });

        var tryBlock = el('div', 'setting-block');
        tryBlock.appendChild(el('h2', '', 'Try it'));
        var tryChips = el('div', 'chips');
        tryChips.appendChild(chip('Show it now', false, { kind: 'preview' }));
        tryBlock.appendChild(tryChips);
        body.appendChild(tryBlock);
    }

    function activateScreensaver(item) {
        if (item.kind === 'preview') {
            Screensaver.open();
            return;
        }
        Prefs.get().screensaver[item.key] = item.value;
        Prefs.save();
        // Otherwise a countdown that began before the change could fire straight away.
        Screensaver.poke();
        renderScreensaver();
        UI.refresh();
    }

    window.SettingsScreensaver = { render: renderScreensaver, activate: activateScreensaver };
})();
