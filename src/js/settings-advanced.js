/*
 * Settings → Advanced section entries (clock, look, weather, sound, refresh, reset, Lab).
 * Wired into the flat Settings hub by settings.js.
 */
(function () {
    'use strict';

    function clockSummary() {
        var p = Prefs.get().appearance;
        var clock = p.clock === '12h' ? '12-hour' : '24-hour';
        return p.showDate === false ? clock + ' · no date' : clock;
    }

    function appearanceSummary() {
        var p = Prefs.get().appearance;
        var font = Appearance.font(p.font);
        var tiles = p.tiles === 'compact' ? 'Compact' : 'Comfortable';
        var rows = (p.tiles === 'compact' && Number(p.homeRows) === 2) ? '2 rows' : '1 row';
        return (font ? font.label : 'Manrope') + ' · ' + tiles + ' · ' + rows;
    }

    function weatherSummary() {
        if (window.Weather && Weather.summary) return Weather.summary();
        return 'Off';
    }

    function soundSummary() {
        var p = Prefs.get().sound;
        if (!p.enabled) return 'Off';
        var preset = (p.preset || 'soft');
        preset = preset.charAt(0).toUpperCase() + preset.slice(1);
        return 'On · ' + preset;
    }

    function advancedEntries() {
        var entries = [
            { label: 'Clock', value: clockSummary(), run: SettingsCore.openClock },
            { label: 'Weather', value: weatherSummary(), run: function () { UI.show('weather-settings'); } },
            { label: 'Appearance', value: appearanceSummary(), run: SettingsCore.openLook },
            {
                label: 'Navigation sound',
                value: soundSummary(),
                run: function () { UI.show('sound-settings'); }
            },
            {
                label: 'Refresh app list',
                kind: 'action',
                run: function () {
                    UI.busy(Home.reloadApps()).then(function () {
                        UI.toast('App list refreshed');
                    });
                }
            }
        ];
        if (window.LAUNCHER_CONFIG.devLogUrl) {
            entries.push({
                label: 'Export settings',
                kind: 'action',
                run: function () {
                    DevLog.log('Settings export', Prefs.get());
                    UI.toast('Settings sent to the Mac log');
                }
            });
        }
        entries.push({
            label: 'Reset all settings',
            kind: 'danger',
            run: function () {
                UI.menu('Reset all settings?', [
                    { label: 'Cancel', kind: 'action', current: true },
                    {
                        label: 'Reset everything',
                        kind: 'danger',
                        run: function () {
                            Prefs.reset();
                            location.reload();
                        }
                    }
                ], { detail: 'Restores defaults. This cannot be undone.' });
            }
        });
        entries.push({ label: 'Lab', run: function () { UI.show('lab'); } });
        return entries;
    }

    window.SettingsAdvanced = { entries: advancedEntries };
})();
