/*
 * Settings → Appearance page (clock style and look). Entry points are exposed on
 * window.SettingsAppearance and wired up by settings.js.
 */
(function () {
    'use strict';

    var $ = UI.$;
    var el = UI.el;
    var chip = SettingsCore.chip;

    // Same view, two entry points: Advanced → Clock; Advanced → Appearance (font / names).
    var appearanceSection = 'clock';

    function appearanceBlocks() {
        var clock = [
            { title: 'Clock', key: 'clock', options: [['24h', '24-hour'], ['12h', '12-hour']] },
            { title: 'Date', key: 'showDate', options: [[true, 'Show'], [false, 'Hide']] },
            { title: 'Date language', key: 'locale', options: Appearance.LOCALES.map(function (l) { return [l.key, l.label]; }) }
        ];
        var look = [
            { title: 'Font', key: 'font', options: Appearance.FONTS.map(function (f) { return [f.key, f.label, f.family]; }) },
            { title: 'App names', key: 'names', options: [['always', 'Always'], ['focused', 'When selected'], ['never', 'Never']] },
            {
                title: 'Focus',
                key: 'focus',
                options: [['both', 'Both'], ['scale', 'Scale'], ['ring', 'Ring']]
            },
            {
                title: 'Tiles',
                key: 'tiles',
                options: [['comfortable', 'Comfortable'], ['compact', 'Compact']]
            }
        ];
        if (appearanceSection === 'look') return look;
        return clock;
    }

    function setAppearanceTitle() {
        var h = $('appearance') && $('appearance').querySelector('.page-head h1');
        if (h) h.textContent = appearanceSection === 'look' ? 'Appearance' : 'Clock';
    }

    function openClock() {
        appearanceSection = 'clock';
        setAppearanceTitle();
        UI.show('appearance');
    }

    function openLook() {
        appearanceSection = 'look';
        setAppearanceTitle();
        UI.show('appearance');
    }

    function renderAppearance() {
        setAppearanceTitle();
        var p = Prefs.get().appearance;
        var body = $('appearance-body');
        body.innerHTML = '';
        appearanceBlocks().forEach(function (b) {
            var block = el('div', 'setting-block');
            block.appendChild(el('h2', '', b.title));
            var chips = el('div', 'chips');
            b.options.forEach(function (o) {
                var c = chip(o[1], p[b.key] === o[0], { key: b.key, value: o[0] });
                if (o[2]) c.style.fontFamily = o[2];
                chips.appendChild(c);
            });
            block.appendChild(chips);
            if (b.key === 'focus') {
                block.appendChild(el('p', 'setting-note muted',
                    'Applies on Home, Settings and the screen saver. Menus stay plain.'));
            }
            body.appendChild(block);
        });
    }

    function activateAppearance(item) {
        Prefs.get().appearance[item.key] = item.value;
        Prefs.save();
        Appearance.apply();
        Home.updateClock();
        SettingsCore.withFocusRestore($('appearance-body'), renderAppearance);
    }

    SettingsCore.openClock = openClock;
    SettingsCore.openLook = openLook;

    window.SettingsAppearance = { render: renderAppearance, activate: activateAppearance };
})();
