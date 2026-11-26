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

    function backgroundSummary() {
        var p = Prefs.get().wallpaper;
        if (p.mode === 'off') return 'Off';
        if (p.mode === 'photo') return 'Photo';
        if (p.mode === 'live') {
            if (window.LiveWallpaper && LiveWallpaper.providerLabel) {
                return 'Live · ' + LiveWallpaper.providerLabel();
            }
            return 'Live';
        }
        if (p.mode === 'rotate') return 'Photo';
        return p.mode || 'Off';
    }

    function screensaverSummary() {
        var p = Prefs.get().screensaver;
        if (!p.enabled) return 'Off';
        var delay = (Screensaver.DELAYS || []).filter(function (d) { return d.key === p.delay; })[0];
        return delay ? ('On · ' + delay.label) : 'On';
    }

    function musicSummary() {
        var p = Prefs.get().music;
        if (!p.enabled) return 'Off';
        if (p.source === 'radio') return 'Radio';
        if (p.source === 'playlist') return p.playlistName || 'Playlist';
        return 'Navidrome';
    }

    function pinsSummary() {
        var pins = (Wallpaper.pinsList && Wallpaper.pinsList()) || [];
        if (!pins.length) return 'None';
        return pinStorageLabel() || (pins.length + ' saved');
    }

    function atmosphereEntries() {
        var entries = [
            { label: 'Background', value: backgroundSummary(), run: function () { UI.show('bg'); } },
            {
                label: 'Screen saver',
                value: screensaverSummary(),
                run: function () { UI.show('screensaver-settings'); }
            },
            { label: 'Music', value: musicSummary(), run: function () { UI.show('music-settings'); } },
            { label: 'Clear saved pins', value: pinsSummary(), kind: 'action', run: clearSavedPins }
        ];
        var hidden = window.Wallpaper && Wallpaper.hiddenBundledCount
            ? Wallpaper.hiddenBundledCount() : 0;
        if (hidden) {
            entries.push({
                label: 'Restore bundled photos',
                value: String(hidden),
                kind: 'action',
                run: restoreBundledPhotos
            });
        }
        return entries;
    }

    function hubEntries() {
        // Apps and consoles are managed on Home (hold OK / + tile); Settings starts at Atmosphere.
        return [{ section: 'Atmosphere' }]
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
            onShow: SettingsMusic.show,
            activate: SettingsMusic.activate,
            hints: chipDetailHints(musicOkLabel)
        });

        if (window.SettingsMusicPickers && SettingsMusicPickers.register) {
            SettingsMusicPickers.register();
        }

        if (window.Music) {
            Music.onUpdate(function () {
                if (UI.isVisible && UI.isVisible('music-settings')) {
                    SettingsMusic.render();
                }
            });
        }

        SettingsRename.register();
    }


    window.Settings = { init: init };
})();
