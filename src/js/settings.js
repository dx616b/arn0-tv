/*
 * Settings hub: one scrollable index with the original groups as section headers
 * (Home screen / Atmosphere / Samsung / Advanced), then detail pages.
 * Intermediate group pages are removed so OK opens the setting directly.
 */
(function () {
    'use strict';

    var $ = UI.$;
    var registerList = SettingsCore.registerList;
    var registerChipPage = SettingsCore.registerChipPage;
    var chipDetailHints = SettingsCore.chipDetailHints;
    var backPair = SettingsCore.backPair;
    var pinStorageLabel = SettingsBackground.pinStorageLabel;
    var clearSavedPins = SettingsBackground.clearSavedPins;
    var restoreBundledPhotos = SettingsBackground.restoreBundledPhotos;

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

    // ---------- Hub (flat, same groups / same entries as before)

    function atmosphereEntries() {
        var clearLabel = 'Clear saved pins';
        var size = pinStorageLabel();
        if (size && ((Wallpaper.pinsList && Wallpaper.pinsList()) || []).length) {
            clearLabel += ' (' + size + ')';
        }
        var entries = [
            { label: 'Background', run: function () { UI.show('bg'); } },
            { label: 'Screen saver', run: function () { UI.show('screensaver-settings'); } },
            { label: 'Music', run: function () { UI.show('music-settings'); } },
            { label: clearLabel, kind: 'action', run: clearSavedPins }
        ];
        var hidden = window.Wallpaper && Wallpaper.hiddenBundledCount
            ? Wallpaper.hiddenBundledCount() : 0;
        if (hidden) {
            entries.push({
                label: 'Restore bundled photos (' + hidden + ')',
                kind: 'action',
                run: restoreBundledPhotos
            });
        }
        return entries;
    }

    function hubEntries() {
        return [{ section: 'Home screen' }]
            .concat([
                { label: 'Apps on Home', run: function () { UI.show('homeapps'); } },
                { label: 'Consoles', run: function () { UI.show('consoles'); } }
            ])
            .concat([{ section: 'Atmosphere' }])
            .concat(atmosphereEntries())
            .concat([{ section: 'Samsung' }])
            .concat([
                { label: 'TV Settings', run: openTvSettings },
                { label: 'Samsung Home', run: openSamsungHome }
            ])
            .concat([{ section: 'Advanced' }])
            .concat(SettingsAdvanced.entries());
    }

    function hubHints() {
        var focus = document.querySelector('#settings .focused');
        var item = focus && focus._item;
        var ok = 'Open';
        if (item && (item.kind === 'action' || item.kind === 'danger')) ok = 'Run';
        return [['OK / ▶', ok], ['◀', 'Back'], ['Back', 'Home']];
    }

    function bgOkLabel() {
        var focus = document.querySelector('#bg-settings .focused');
        var item = focus && focus._item;
        if (item && item.kind === 'pinLive') return 'Use now / Save';
        if (item && (item.kind === 'photoPin' || item.kind === 'photoBundled' ||
                item.kind === 'photoTemp')) {
            if (item.key === Prefs.get().wallpaper.photo) return 'Options';
        }
        return 'Select';
    }

    function musicOkLabel() {
        var focus = document.querySelector('#music-settings .focused');
        var item = focus && focus._item;
        if (!item) return 'Select';
        if (item.kind === 'play') return 'Play';
        if (item.kind === 'pause') return 'Pause';
        if (item.kind === 'next') return 'Next';
        if (item.kind === 'volume') return 'Volume';
        return 'Select';
    }

    // ---------- Registration

    function init() {
        SettingsCore.renderHub = registerList('settings', hubEntries, hubHints);
        SettingsCore.renderAtmosphere = SettingsCore.renderHub;

        SettingsConsoles.setRender(registerList('consoles', SettingsConsoles.entries,
            function () { return [['OK / ▶', 'Options'], ['◀', 'Back'], backPair()]; }));

        if (window.LiveWallpaper) {
            LiveWallpaper.onChange(SettingsBackground.onLiveChange);
        }

        registerChipPage('bg', {
            el: $('bg-settings'),
            body: $('bg-body'),
            onShow: function () {
                if (window.Wallpaper && Wallpaper.hydratePins) Wallpaper.hydratePins();
                SettingsBackground.render();
                var wp = Prefs.get().wallpaper;
                if (wp.mode === 'live' && wp.liveProvider !== 'mix') SettingsBackground.warm();
            },
            activate: SettingsBackground.activate,
            hints: chipDetailHints(bgOkLabel)
        });

        registerChipPage('appearance', {
            el: $('appearance'),
            body: $('appearance-body'),
            onShow: SettingsAppearance.render,
            activate: SettingsAppearance.activate,
            okLabel: 'Select'
        });

        registerChipPage('sound-settings', {
            el: $('sound-settings'),
            body: $('sound-body'),
            onShow: SettingsSound.render,
            activate: SettingsSound.activate,
            okLabel: 'Select / Preview'
        });

        registerChipPage('screensaver-settings', {
            el: $('screensaver-settings'),
            body: $('screensaver-body'),
            onShow: SettingsScreensaver.render,
            activate: SettingsScreensaver.activate,
            okLabel: 'Select'
        });

        registerChipPage('weather-settings', {
            el: $('weather-settings'),
            body: $('weather-body'),
            onShow: SettingsWeather.render,
            activate: SettingsWeather.activate,
            okLabel: 'Select'
        });

        registerChipPage('music-settings', {
            el: $('music-settings'),
            body: $('music-body'),
            onShow: SettingsMusic.renderMusic,
            activate: SettingsMusic.activate,
            hints: chipDetailHints(musicOkLabel)
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
