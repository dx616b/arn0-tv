/*
 * Settings → Sound page (navigation sound and volume). Entry points are exposed on
 * window.SettingsSound and wired up by settings.js.
 */
(function () {
    'use strict';

    var $ = UI.$;
    var el = UI.el;
    var chip = SettingsCore.chip;

    function renderSound() {
        var p = Prefs.get().sound;
        var body = $('sound-body');
        body.innerHTML = '';

        var enabledBlock = el('div', 'setting-block');
        enabledBlock.appendChild(el('h2', '', 'Sound'));
        var enabledChips = el('div', 'chips');
        enabledChips.appendChild(chip('On', p.enabled, { kind: 'enabled', value: true }));
        enabledChips.appendChild(chip('Off', !p.enabled, { kind: 'enabled', value: false }));
        enabledBlock.appendChild(enabledChips);
        body.appendChild(enabledBlock);

        var presetBlock = el('div', 'setting-block');
        presetBlock.appendChild(el('h2', '', 'Style'));
        var presetChips = el('div', 'chips');
        Sound.presetOptions().forEach(function (preset) {
            presetChips.appendChild(chip(preset.label, p.preset === preset.key,
                { kind: 'preset', value: preset.key }));
        });
        presetBlock.appendChild(presetChips);
        body.appendChild(presetBlock);

        var volumeBlock = el('div', 'setting-block');
        volumeBlock.appendChild(el('h2', '', 'Volume'));
        var volumeChips = el('div', 'chips');
        Sound.volumeOptions().forEach(function (vol) {
            volumeChips.appendChild(chip(vol.label, (p.volume || 'normal') === vol.key,
                { kind: 'volume', value: vol.key }));
        });
        volumeBlock.appendChild(volumeChips);
        body.appendChild(volumeBlock);

        var previewBlock = el('div', 'setting-block');
        previewBlock.appendChild(el('h2', '', 'Try it'));
        var previewChips = el('div', 'chips');
        previewChips.appendChild(chip('Preview selected sound', false, { kind: 'preview' }));
        previewBlock.appendChild(previewChips);
        body.appendChild(previewBlock);
    }

    function redrawSound() {
        SettingsCore.withFocusRestore($('sound-body'), renderSound);
    }

    function activateSound(item) {
        var p = Prefs.get().sound;
        if (item.kind === 'enabled') {
            p.enabled = item.value;
            Prefs.save();
            redrawSound();
            if (p.enabled) Sound.preview();
            return;
        }
        if (item.kind === 'preset') {
            p.preset = item.value;
            Prefs.save();
            redrawSound();
            Sound.preview();
            return;
        }
        if (item.kind === 'volume') {
            p.volume = item.value;
            Prefs.save();
            redrawSound();
            Sound.preview();
            return;
        }
        if (item.kind === 'preview') Sound.preview();
    }

    window.SettingsSound = { render: renderSound, activate: activateSound };
})();
