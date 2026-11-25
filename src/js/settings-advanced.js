/*
 * Settings → Advanced section entries (clock, look, weather, sound, refresh, reset, Lab).
 * Wired into the flat Settings hub by settings.js.
 */
(function () {
    'use strict';

    function advancedEntries() {
        var entries = [
            { label: 'Clock', run: SettingsCore.openClock },
            { label: 'Weather', run: function () { UI.show('weather-settings'); } },
            { label: 'Appearance', run: SettingsCore.openLook },
            { label: 'Navigation sound', run: function () { UI.show('sound-settings'); } },
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
                    { label: 'Cancel', current: true },
                    {
                        label: 'Reset everything', run: function () {
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
