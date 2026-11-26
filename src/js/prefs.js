/*
 * User settings, stored on the TV (localStorage). js/config.js only provides the defaults.
 * They survive restarts and in-place updates, but not an uninstall.
 */
(function () {
    'use strict';

    var KEY = 'arn0.prefs.v1';
    var LEGACY_WALLPAPER_KEY = 'arn0.wallpaper';

    function defaults() {
        var cfg = window.LAUNCHER_CONFIG || {};
        var theme = cfg.theme || {};
        // Optional first-run seeds from config.local.js (wallpaper / music blocks).
        var wallSeed = cfg.wallpaper && typeof cfg.wallpaper === 'object' ? cfg.wallpaper : {};
        var musicSeed = cfg.music && typeof cfg.music === 'object' ? cfg.music : {};
        return {
            sound: {
                enabled: cfg.sound ? cfg.sound.enabled !== false : true,
                preset: cfg.sound && cfg.sound.preset || 'soft',
                volume: 'normal'        // 'quiet' | 'normal' | 'loud' (Style Soft is timbre, not level)
            },
            wallpaper: {
                // Fresh install: Live Bing + shuffle (no API key). Seeds from config.local override.
                mode: wallSeed.mode || 'live',   // 'off' | 'photo' | 'rotate' | 'live'
                rotateOn: false,                 // Photos: Off = hold current; On = timer / Left-Right advance
                photo: wallSeed.photo || theme.wallpaper || 'forest',
                liveProvider: wallSeed.liveProvider || 'bing',   // 'bing' | 'nasa' | 'wikimedia' | 'wallhaven' | 'unsplash' | 'immich' | 'mix'
                liveKey: '',            // current entry in the live pool (date key)
                // Multi-select Live sources (missing key uses default). Wallhaven starts off.
                mixEnabled: {
                    bing: true,
                    nasa: true,
                    wikimedia: true,
                    wallhaven: false,
                    unsplash: true,
                    immich: true
                },
                liveMultiSelect: false, // set true after one-shot chip map migration
                // Saved favorites (metadata in prefs; image bytes in IndexedDB — see Wallpaper).
                pins: [],               // up to Wallpaper.PIN_MAX × { key, file, thumb, bytes, … }
                pinned: null,           // legacy single pin; migrated into pins[] on load
                // One Live photo in use as Photo without saving to the pin shelf (URL only).
                tempPhoto: null,        // { key, title, file, thumb, … } | null
                // Shipped stills the user hid from Photo / Rotate (files stay in the app).
                hiddenBundled: [],
                interval: wallSeed.interval || '15m',        // see Wallpaper.INTERVALS (rotate + live cycle)
                random: wallSeed.random != null ? !!wallSeed.random : true, // Shuffle: Mix provider order / Rotate photos
                // How many remote entries to buffer per source / in the upcoming plan.
                livePool: wallSeed.livePool || 'small', // 'small' | 'normal' | 'large' (default 8)
                // Home / Live / Rotate: when false, skip portrait (taller than wide) photos.
                allowPortrait: wallSeed.allowPortrait != null ? !!wallSeed.allowPortrait : false,
                lastChange: 0
            },
            screensaver: {
                enabled: true,
                delay: '5m',            // see Screensaver.DELAYS
                photoEvery: '75s',      // see Screensaver.PHOTO_EVERY
                dark: '15m',            // see Screensaver.DARK_AFTER
                chromeHide: '20s',      // see Screensaver.CHROME_HIDE (caption/clock fade)
                pan: true,              // Ken Burns drift / portrait zoom
                panSpeed: 'normal',     // 'slow' | 'normal' | 'fast' (amount is auto from image vs stage)
                blur: true              // letterbox blur fill (portrait contain)
            },
            // Seeded from config.js weather; Settings → Weather edits these.
            weather: {
                place: 'auto',          // 'off' | 'auto' (IP detect) | 'custom'
                latitude: null,
                longitude: null,
                label: null,            // display name when place === 'custom' / after auto detect
                unit: 'celsius'         // 'celsius' | 'fahrenheit'
            },
            // Ambient player: curated Radio and/or Subsonic (creds in Subsonic store).
            music: {
                enabled: musicSeed.enabled != null ? !!musicSeed.enabled : false,
                playing: false,
                volume: musicSeed.volume || 'med',          // Music.VOLUMES key: low | med | high
                source: musicSeed.source || 'random',       // 'radio' | 'random' | 'playlist'
                radioId: musicSeed.radioId || 'rrdeep', // Music.STATIONS id, 'custom:<id>' (Your list) or 'somafm:<id>'
                radioCustomUrl: musicSeed.radioCustomUrl || '',
                // Last ice host that played (e.g. https://ice2.somafm.com/) — tried first next time.
                radioGoodHost: musicSeed.radioGoodHost || '',
                // Chosen SomaFM channel { id, title, genre, urls } and saved favourites (see settings-music-pickers).
                somaSelected: null,
                customList: [],    // Your list: [{ id, title, url }]
                radioNav: 'all',   // Next steps through: 'all' channels | 'favourites'
                favourites: [],
                songHistory: [],   // Navidrome tracks played, oldest first (Down steps back through them)
                playlistId: musicSeed.playlistId || null,
                playlistName: musicSeed.playlistName || null,
                // Playlist playback (Navidrome). Defaults match the old always-shuffle / always-loop behaviour.
                playlistShuffle: musicSeed.playlistShuffle != null ? !!musicSeed.playlistShuffle : true,
                playlistRepeat: musicSeed.playlistRepeat != null ? !!musicSeed.playlistRepeat : true
            },
            appearance: {
                clock: '24h',           // '24h' | '12h' (default 24-hour)
                showDate: true,
                locale: cfg.locale || 'en-GB',
                font: 'manrope',        // see Appearance.FONTS
                names: 'always',        // app names under tiles: 'always' | 'focused' | 'never'
                // Curated presets: scale+ring, scale only, or ring only.
                focus: 'both',          // 'both' | 'scale' | 'ring'
                tiles: 'comfortable'    // 'comfortable' | 'compact'
            },
            home: null,                 // [{ id, label, brand }] once edited; null = config.js apps
            inputs: null                // [{ hdmi, label, brand, method, hidden }] once edited; null = config.js
        };
    }

    function merge(target, saved) {
        if (!saved) return;
        Object.keys(target).forEach(function (k) {
            if (saved[k] !== undefined) target[k] = saved[k];
        });
    }

    function load() {
        var prefs = defaults();
        if (window.Weather && Weather.seedFromConfig) Weather.seedFromConfig(prefs.weather);
        try {
            var saved = JSON.parse(localStorage.getItem(KEY));
            if (saved) {
                merge(prefs.sound, saved.sound);
                merge(prefs.wallpaper, saved.wallpaper);
                // Old Rotate mode → Photos Live provider with rotate on.
                if (prefs.wallpaper.mode === 'rotate') {
                    prefs.wallpaper.mode = 'live';
                    prefs.wallpaper.liveProvider = 'photos';
                    prefs.wallpaper.rotateOn = true;
                }
                // mixEnabled is a map; fill any keys missing from older saves (keep def for new keys).
                (function () {
                    var def = {
                        bing: true, nasa: true, wikimedia: true,
                        wallhaven: false, unsplash: true, immich: true
                    };
                    var cur = prefs.wallpaper.mixEnabled;
                    if (!cur || typeof cur !== 'object') {
                        prefs.wallpaper.mixEnabled = def;
                        return;
                    }
                    Object.keys(def).forEach(function (k) {
                        if (cur[k] === undefined) return;
                        def[k] = cur[k] !== false;
                    });
                    prefs.wallpaper.mixEnabled = def;
                })();
                merge(prefs.screensaver, saved.screensaver);
                merge(prefs.weather, saved.weather);
                merge(prefs.music, saved.music);
                merge(prefs.appearance, saved.appearance);
                // Batch 1+2 briefly split Motion × Focus; fold into one curated focus preset.
                if (saved.appearance) {
                    var m = saved.appearance.motion;
                    var f = prefs.appearance.focus;
                    if (m === 'off' || m === 'reduced' || f === 'off') {
                        if (f === 'both' || f === 'scale' || f === 'off' || !f) prefs.appearance.focus = 'ring';
                    }
                    if (prefs.appearance.focus !== 'both' && prefs.appearance.focus !== 'scale' &&
                            prefs.appearance.focus !== 'ring') {
                        prefs.appearance.focus = 'both';
                    }
                }
                if (Array.isArray(saved.home) && saved.home.length) prefs.home = saved.home;
                if (Array.isArray(saved.inputs)) prefs.inputs = saved.inputs;
            } else {
                var legacy = localStorage.getItem(LEGACY_WALLPAPER_KEY);
                if (legacy) prefs.wallpaper.photo = legacy;
            }
        } catch (e) {
            // Unreadable storage: run with defaults.
        }
        // "Midnight" used to be a photo; it is now what Off shows.
        if (prefs.wallpaper.photo === 'midnight') {
            if (prefs.wallpaper.mode === 'photo') prefs.wallpaper.mode = 'off';
            prefs.wallpaper.photo = 'forest';
        }
        // One legacy `pinned` object → pins[] (bytes are re-fetched on next pin if missing).
        if (!Array.isArray(prefs.wallpaper.pins)) prefs.wallpaper.pins = [];
        if (prefs.wallpaper.pinned && prefs.wallpaper.pinned.key) {
            var oldPin = prefs.wallpaper.pinned;
            if (!prefs.wallpaper.pins.some(function (x) { return x.key === oldPin.key; })) {
                prefs.wallpaper.pins.unshift(oldPin);
            }
            prefs.wallpaper.pinned = null;
        }
        // Cap matches Wallpaper.PIN_MAX (20). Do not trim harder here — that would
        // silently drop favorites after a limit raise.
        if (prefs.wallpaper.pins.length > 20) {
            prefs.wallpaper.pins = prefs.wallpaper.pins.slice(0, 20);
        }
        if (!Array.isArray(prefs.wallpaper.hiddenBundled)) {
            prefs.wallpaper.hiddenBundled = [];
        }
        if (prefs.wallpaper.tempPhoto && !prefs.wallpaper.tempPhoto.key) {
            prefs.wallpaper.tempPhoto = null;
        }
        return prefs;
    }

    var prefs = load();

    function save() {
        try {
            localStorage.setItem(KEY, JSON.stringify(prefs));
            return true;
        } catch (e) {
            DevLog.log('Could not save settings: ' + DevLog.errorText(e));
            return false;
        }
    }

    function reset() {
        try {
            localStorage.removeItem(KEY);
            localStorage.removeItem(LEGACY_WALLPAPER_KEY);
        } catch (e) {
            // Nothing stored, nothing to clear.
        }
        if (window.LiveWallpaper) {
            LiveWallpaper.clearCache();
            if (LiveWallpaper.clearUnsplashKey) LiveWallpaper.clearUnsplashKey();
            if (LiveWallpaper.clearWallhavenSettings) LiveWallpaper.clearWallhavenSettings();
            if (LiveWallpaper.clearImmichLink) LiveWallpaper.clearImmichLink();
        }
        if (window.Wallpaper && Wallpaper.clearPins) Wallpaper.clearPins();
        if (window.Subsonic) Subsonic.clearCreds();
        if (window.Weather && Weather.clearReading) Weather.clearReading();
        prefs = defaults();
    }

    window.Prefs = {
        get: function () { return prefs; },
        save: save,
        reset: reset
    };
})();
