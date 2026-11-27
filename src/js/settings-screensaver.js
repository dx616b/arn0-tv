/*
 * Settings → Screen saver page. Entry points are exposed on window.SettingsScreensaver and wired
 * up by settings.js.
 */
(function () {
    'use strict';

    var $ = UI.$;
    var el = UI.el;
    var chip = SettingsCore.chip;
    var note = SettingsCore.note;

    var SS_NOTES = {
        enabled: 'Starts when Home is idle with no remote input.',
        delay: 'How long to wait on Home before the screen saver opens.',
        photoEvery: 'Only while Background is Live or rotating photos.',
        dark: 'Fades to black to rest the panel. Clock stays until then.',
        chromeHide: 'Hides caption, music and hints. Clock stays; a key brings text back.',
        pan: 'Slow move across the photo so stills do not burn in.',
        panSpeed: 'How fast each drift pass runs.',
        blur: 'Soft side fill for tall photos. Off shows plain bars instead.'
    };

    var TIMINGS = {
        delay: {
            list: Screensaver.DELAYS,
            presets: ['3m', '5m', '10m'],
            minMs: 60 * 1000, maxMs: 180 * 60 * 1000,
            fallbackMs: 5 * 60 * 1000, units: ['minutes', 'hours']
        },
        photoEvery: {
            list: Screensaver.PHOTO_EVERY,
            presets: ['60s', '75s', '90s'],
            minMs: 10 * 1000, maxMs: 60 * 60 * 1000,
            fallbackMs: 75 * 1000, units: ['seconds', 'minutes']
        },
        dark: {
            list: Screensaver.DARK_AFTER,
            presets: ['5m', '15m', '1h'],
            special: ['never'],
            minMs: 60 * 1000, maxMs: 24 * 60 * 60 * 1000,
            fallbackMs: 15 * 60 * 1000, units: ['minutes', 'hours']
        },
        chromeHide: {
            list: Screensaver.CHROME_HIDE,
            presets: ['10s', '30s', '1m'],
            special: ['never'],
            minMs: 1000, maxMs: 60 * 60 * 1000,
            fallbackMs: 20 * 1000, units: ['seconds', 'minutes']
        }
    };

    /*
     * "Change photo" only means something while the Background is on Rotate or Live: with a
     * single photo the screen saver holds it, exactly as Home does.
     */
    function screensaverBlocks() {
        var mode = Prefs.get().wallpaper.mode;
        var blocks = [
            { title: 'Enabled', key: 'enabled', options: [[true, 'On'], [false, 'Off']] },
            timingBlock('Start after', 'delay')
        ];
        if (mode === 'rotate' || mode === 'live') {
            blocks.push(timingBlock('Change photo every', 'photoEvery'));
        }
        blocks.push(timingBlock('Go dark after', 'dark'));
        blocks.push(timingBlock('Hide text after', 'chromeHide'));
        blocks.push({ title: 'Drift', key: 'pan', options: [[true, 'On'], [false, 'Off']] });
        if (Prefs.get().screensaver.pan !== false) {
            blocks.push({ title: 'Drift speed', key: 'panSpeed', options: optionPairs(Screensaver.PAN_SPEEDS) });
        }
        blocks.push({ title: 'Blur fill', key: 'blur', options: [[true, 'On'], [false, 'Off']] });
        return blocks;
    }

    function timingBlock(title, key) {
        var spec = TIMINGS[key];
        var keys = spec.presets.concat(spec.special || []);
        var options = keys.map(function (k) {
            var found = spec.list.filter(function (o) { return o.key === k; })[0];
            return found ? [found.key, found.label] : null;
        }).filter(Boolean);
        return { title: title, key: key, options: options, timing: spec };
    }

    function optionPairs(list) {
        return list.map(function (o) { return [o.key, o.label]; });
    }

    function durationLabel(ms) {
        if (ms % (60 * 60 * 1000) === 0) {
            var hours = ms / (60 * 60 * 1000);
            return hours + (hours === 1 ? ' hour' : ' hours');
        }
        if (ms % (60 * 1000) === 0) return (ms / (60 * 1000)) + ' min';
        return Math.round(ms / 1000) + ' s';
    }

    function timeValueLabel(spec, value) {
        var custom = String(value || '').match(/^custom:(\d+)$/);
        if (custom && Number(custom[1]) > 0) return durationLabel(Number(custom[1]));
        var found = spec.list.filter(function (o) { return o.key === value; })[0];
        return found ? found.label : '';
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
            if (b.timing) {
                var isPreset = b.options.some(function (o) { return p[b.key] === o[0]; });
                var currentLabel = timeValueLabel(b.timing, p[b.key]);
                chips.appendChild(chip(
                    isPreset ? 'Custom…' : ('Custom · ' + (currentLabel || durationLabel(b.timing.fallbackMs))),
                    !isPreset,
                    {
                        kind: 'customTiming',
                        key: b.key,
                        title: b.title,
                        minMs: b.timing.minMs,
                        maxMs: b.timing.maxMs,
                        fallbackMs: b.timing.fallbackMs,
                        units: b.timing.units
                    }
                ));
            }
            block.appendChild(chips);
            if (SS_NOTES[b.key]) block.appendChild(note(SS_NOTES[b.key]));
            body.appendChild(block);
        });

        var tryBlock = el('div', 'setting-block');
        tryBlock.appendChild(el('h2', '', 'Try it'));
        var tryChips = el('div', 'chips');
        tryChips.appendChild(chip('Show it now', false, { kind: 'preview' }));
        tryBlock.appendChild(tryChips);
        tryBlock.appendChild(note('Opens the screen saver immediately to check the look.'));
        body.appendChild(tryBlock);
    }

    function activateScreensaver(item) {
        if (item.kind === 'preview') {
            Screensaver.open();
            return;
        }
        if (item.kind === 'customTiming') {
            var spec = TIMINGS[item.key];
            var savedValue = Prefs.get().screensaver[item.key];
            var currentOption = spec.list.filter(function (o) { return o.key === savedValue; })[0];
            var customValue = String(savedValue || '').match(/^custom:(\d+)$/);
            var currentMs = currentOption ? currentOption.ms : (customValue ? Number(customValue[1]) : 0);
            SettingsCore.customDuration(item.title, currentMs, {
                minMs: item.minMs,
                maxMs: item.maxMs,
                fallbackMs: item.fallbackMs,
                units: item.units
            }, function (ms) {
                Prefs.get().screensaver[item.key] = 'custom:' + ms;
                Prefs.save();
                Screensaver.poke();
                SettingsCore.withFocusRestore($('screensaver-body'), renderScreensaver);
            });
            return;
        }
        Prefs.get().screensaver[item.key] = item.value;
        Prefs.save();
        // Otherwise a countdown that began before the change could fire straight away.
        Screensaver.poke();
        SettingsCore.withFocusRestore($('screensaver-body'), renderScreensaver);
    }

    window.SettingsScreensaver = { render: renderScreensaver, activate: activateScreensaver };
})();
