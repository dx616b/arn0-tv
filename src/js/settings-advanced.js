/*
 * Settings → Advanced page (shortcuts, app list refresh, reset, Lab). Entry point is exposed on
 * window.SettingsAdvanced and wired up by settings.js.
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
                label: 'Refresh app list', run: function () {
                    UI.busy(Home.reloadApps()).then(function () {
                        UI.toast('App list refreshed');
                    });
                }
            }
        ];
        if (window.LAUNCHER_CONFIG.devLogUrl) {
            entries.push({
                label: 'Export settings', run: function () {
                    DevLog.log('Settings export', Prefs.get());
                    UI.toast('Settings sent to the Mac log');
                }
            });
        }
        entries.push({
            label: 'Reset all settings', run: function () {
                UI.menu('Reset all settings?', [
                    {
                        label: 'Reset', run: function () {
                            Prefs.reset();
                            location.reload();
                        }
                    },
                    { label: 'Cancel' }
                ]);
            }
        });
        entries.push({ label: 'Lab', run: function () { UI.show('lab'); } });
        return entries;
    }

    window.SettingsAdvanced = { entries: advancedEntries };
})();
