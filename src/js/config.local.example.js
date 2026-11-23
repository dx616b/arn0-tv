/*
 * Copy this to js/config.local.js and put your own values in it. That file is gitignored, so
 * anything here stays out of the repository while still reaching both `npm run preview` and the
 * packaged .wgt — nothing to strip before a push, nothing to put back before a build.
 *
 * Keys are merged over js/config.js one level deep, so you can set weather.latitude without
 * restating the rest of the block. Arrays (apps, inputs) replace the default wholesale.
 */
window.LAUNCHER_LOCAL = {
    // Weather: prefer Settings → Weather on the TV (presets, Use my location, or Search city).
    // Optional seed before first prefs save:
    // weather: { latitude: 48.86, longitude: 2.35, label: 'Paris', unit: 'celsius' },

    // Optional first-run seed for Music. Prefer Settings → Music on the TV afterwards.
    // subsonic: {
    //     baseUrl: 'http://192.168.1.10:4533',
    //     user: 'me',
    //     password: 'secret',
    //     maxBitRate: 320
    // },

    // Live wallpapers (metadata cache only; photos fetched on demand into a planned queue).
    // Provider in Settings → Background (bing | nasa | wikimedia | wallhaven | unsplash | immich | mix).
    // liveWallpaper: { market: 'en-GB', unsplashAccessKey: 'YOUR_ACCESS_KEY' },
    // Immich album (share link from Immich → Sharing → Shared links):
    // liveWallpaper: { market: 'en-GB', immichLink: 'https://host/share/KEY' },
    // Unsplash collection (optional; empty = popular photos):
    // liveWallpaper: { market: 'en-GB', unsplashCollection: 'COLLECTION_ID' },

    // Optional first-run Background prefs (overridden once you save Settings on the TV):
    // wallpaper: { mode: 'live', liveProvider: 'immich', interval: '30s', random: true },
    // music: { enabled: true, volume: 'med', source: 'random' },

    // Lab → PC log mirror. Release wgts leave this off.
    // Local TV sideloads: npm run build:local injects http://<Windows-LAN>:8099/log
    // (WSL asks Windows for the IP). Run npm run devlog on Windows. Override: DEV_LOG_HOST.
    // devLogUrl: null,

    // locale: 'fr-FR',
};
