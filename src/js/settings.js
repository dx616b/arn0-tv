/* Settings: hub (Home / Atmosphere / Samsung / Advanced) then detail pages. */
(function () {
    'use strict';

    var $ = UI.$;
    var registerList = SettingsCore.registerList;
    var chipRows = SettingsCore.chipRows;
    var pinStorageLabel = SettingsBackground.pinStorageLabel;
    var clearSavedPins = SettingsBackground.clearSavedPins;
    var restoreBundledPhotos = SettingsBackground.restoreBundledPhotos;

    // Samsung's on-screen keyboard (IME) sends these for its Done / Cancel buttons.

    // Samsung's own home screen (Smart Hub). TV Settings uses Apps.openTvSettings()
    // (ApplicationControl → org.tizen.menu); plain launch of coba.setting shows nothing.
    var SAMSUNG_HOME = 'com.samsung.tv.csfs';

    var opening = false;
    function openSamsungHome() {
        if (opening) return;
        opening = true;
        DevLog.log('Open Samsung Home');
        UI.busy(Apps.launch(SAMSUNG_HOME)).catch(function (err) {
            DevLog.log('Samsung Home failed: ' + DevLog.errorText(err));
            UI.toast('Could not open Samsung Home: ' + DevLog.errorText(err));
        }).then(function () { opening = false; });
    }

    function openTvSettings() {
        if (opening) return;
        opening = true;
        DevLog.log('Open TV Settings');
        UI.busy(Apps.openTvSettings()).catch(function (err) {
            DevLog.log('TV Settings failed: ' + DevLog.errorText(err));
            UI.toast('Could not open TV Settings: ' + DevLog.errorText(err));
        }).then(function () { opening = false; });
    }

    // ---------- Overview

    // Top-level hub: four groups instead of a flat list of every page.
    function overviewEntries() {
        return [
            { label: 'Home screen', run: function () { UI.show('settings-home'); } },
            { label: 'Atmosphere', run: function () { UI.show('settings-atmosphere'); } },
            { label: 'Samsung', run: function () { UI.show('settings-samsung'); } },
            { label: 'Advanced', run: function () { UI.show('advanced'); } }
        ];
    }

    function homeGroupEntries() {
        return [
            { label: 'Apps on Home', run: function () { UI.show('homeapps'); } },
            { label: 'Consoles', run: function () { UI.show('consoles'); } }
        ];
    }

    function atmosphereGroupEntries() {
        var clearLabel = 'Clear saved pins';
        var size = pinStorageLabel();
        if (size && ((Wallpaper.pinsList && Wallpaper.pinsList()) || []).length) {
            clearLabel += ' (' + size + ')';
        }
        var entries = [
            { label: 'Background', run: function () { UI.show('bg'); } },
            { label: 'Screen saver', run: function () { UI.show('screensaver-settings'); } },
            { label: 'Music', run: function () { UI.show('music-settings'); } },
            { label: clearLabel, run: clearSavedPins }
        ];
        var hidden = window.Wallpaper && Wallpaper.hiddenBundledCount
            ? Wallpaper.hiddenBundledCount() : 0;
        if (hidden) {
            entries.push({
                label: 'Restore bundled photos (' + hidden + ')',
                run: restoreBundledPhotos
            });
        }
        return entries;
    }

    function samsungGroupEntries() {
        return [
            { label: 'TV Settings', run: openTvSettings },
            { label: 'Samsung Home', run: openSamsungHome }
        ];
    }

    // ---------- Registration

    function init() {
        registerList('settings', overviewEntries,
            [['OK', 'Open'], ['Back', 'Home']]);
        registerList('settings-home', homeGroupEntries, [['OK', 'Open'], ['Back', 'Settings']]);
        SettingsCore.renderAtmosphere = registerList('settings-atmosphere', atmosphereGroupEntries,
            [['OK', 'Open'], ['Back', 'Settings']]);
        registerList('settings-samsung', samsungGroupEntries, [['OK', 'Open'], ['Back', 'Settings']]);
        registerList('advanced', SettingsAdvanced.entries, [['OK', 'Run'], ['Back', 'Settings']]);
        SettingsConsoles.setRender(registerList('consoles', SettingsConsoles.entries,
            [['OK', 'Options'], ['Back', 'Settings']]));

        if (window.LiveWallpaper) {
            LiveWallpaper.onChange(SettingsBackground.onLiveChange);
        }
        UI.register('bg', {
            el: $('bg-settings'),
            rows: function () { return chipRows($('bg-body')); },
            onShow: function () {
                if (window.Wallpaper && Wallpaper.hydratePins) Wallpaper.hydratePins();
                SettingsBackground.render();
                var wp = Prefs.get().wallpaper;
                if (wp.mode === 'live' && wp.liveProvider !== 'mix') SettingsBackground.warm();
            },
            activate: SettingsBackground.activate,
            onFocus: function () { UI.refreshHints(); },
            hints: function () {
                var focus = document.querySelector('#bg-settings .focused');
                var item = focus && focus._item;
                if (item && item.kind === 'pinLive') {
                    return [['OK', 'Use now / Save'], ['Back', 'Settings']];
                }
                if (item && (item.kind === 'photoPin' || item.kind === 'photoBundled' ||
                        item.kind === 'photoTemp')) {
                    var cur = Prefs.get().wallpaper.photo;
                    if (item.key === cur) {
                        return [['OK', 'Options'], ['Back', 'Settings']];
                    }
                }
                return [['OK', 'Select'], ['Back', 'Settings']];
            }
        });

        UI.register('appearance', {
            el: $('appearance'),
            rows: function () { return chipRows($('appearance-body')); },
            onShow: SettingsAppearance.render,
            activate: SettingsAppearance.activate,
            hints: [['OK', 'Select'], ['Back', 'Settings']]
        });

        UI.register('sound-settings', {
            el: $('sound-settings'),
            rows: function () { return chipRows($('sound-body')); },
            onShow: SettingsSound.render,
            activate: SettingsSound.activate,
            hints: [['OK', 'Select / Preview'], ['Back', 'Settings']]
        });

        UI.register('screensaver-settings', {
            el: $('screensaver-settings'),
            rows: function () { return chipRows($('screensaver-body')); },
            onShow: SettingsScreensaver.render,
            activate: SettingsScreensaver.activate,
            hints: [['OK', 'Select'], ['Back', 'Settings']]
        });

        UI.register('weather-settings', {
            el: $('weather-settings'),
            rows: function () { return chipRows($('weather-body')); },
            onShow: SettingsWeather.render,
            activate: SettingsWeather.activate,
            hints: [['OK', 'Select'], ['Back', 'Settings']]
        });

        UI.register('music-settings', {
            el: $('music-settings'),
            rows: function () { return chipRows($('music-body')); },
            onShow: SettingsMusic.renderMusic,
            activate: SettingsMusic.activate,
            hints: [['OK', 'Select'], ['Back', 'Settings']]
        });

        if (window.Music) {
            Music.onUpdate(function () {
                if (UI.isVisible && UI.isVisible('music-settings')) {
                    SettingsMusic.render();
                }
            });
        }

        SettingsApps.register();
        SettingsRename.register();
    }


    window.Settings = { init: init };
})();
