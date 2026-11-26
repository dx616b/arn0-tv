/*
 * Tile styling per brand. `match` is tested against "<name> <id>" of an installed app.
 * `mark` is a file in img/marks/; the build recolours it in `fg` (img/tiles/<key>.svg), shown over `bg`.
 * `text` instead of `mark` draws a typographic logo (for brands without an available mark).
 * `pad` optionally overrides the mark's [vertical, horizontal] inset in % of the tile (default [26, 22]).
 */
window.BRANDS = [
    { key: 'livetv', match: /livetv|live.?tv|tv-viewer|channel/i, text: 'TV', bg: 'linear-gradient(135deg,#0a1f3d,#1a4a8a)', fg: '#fff' },
    { key: 'tvsettings', mark: 'tvsettings', bg: 'linear-gradient(135deg,#1e293b,#475569)', fg: '#fff', pad: [22, 22] },
    { key: 'internet', match: /internet|browser|org\.tizen\.browser/i, mark: 'internet', bg: 'linear-gradient(135deg,#0c4a6e,#0284c7)', fg: '#fff' },
    { key: 'youtube', match: /youtube|tizentube|cobalt-yt/i, mark: 'youtube', bg: '#e62117', fg: '#fff' },
    { key: 'netflix', match: /netflix/i, mark: 'netflix', bg: '#141414', fg: '#e50914' },
    { key: 'primevideo', match: /prime ?video/i, mark: 'primevideo', bg: 'linear-gradient(135deg,#0b4f7a,#1aa0e0)', fg: '#fff', pad: [12, 10] },
    { key: 'disneyplus', match: /disney/i, mark: 'disneyplus', bg: 'linear-gradient(135deg,#091550,#1f5bd8)', fg: '#fff' },
    { key: 'appletv', match: /apple ?tv|aria-video/i, mark: 'appletv', bg: '#1c1c1e', fg: '#fff' },
    { key: 'spotify', match: /spotify/i, mark: 'spotify', bg: '#121212', fg: '#1ed760' },
    { key: 'movistar', match: /movistar/i, mark: 'movistar', bg: '#0b6fd8', fg: '#fff' },
    { key: 'max', match: /(^|\s)max(\s|$)|hbo/i, mark: 'max', bg: '#002be7', fg: '#fff' },
    { key: 'dazn', match: /dazn/i, mark: 'dazn', bg: '#0c161c', fg: '#f8fc00' },
    { key: 'plex', match: /plex/i, mark: 'plex', bg: '#1f1f1f', fg: '#e5a00d' },
    { key: 'twitch', match: /twitch/i, mark: 'twitch', bg: '#9146ff', fg: '#fff' },
    { key: 'tf1', match: /tf1/i, text: 'TF1+', bg: 'linear-gradient(135deg,#071a4d,#1d4ed8)', fg: '#fff' },
    { key: 'crunchyroll', match: /crunchyroll/i, mark: 'crunchyroll', bg: '#f47521', fg: '#fff' },

    // Consoles / HDMI devices — `match` also drives logo-from-name on Rename.
    { key: 'hdmi1', match: /hdmi\s*1\b/i, mark: 'hdmi1', bg: 'linear-gradient(135deg,#1e293b,#334155)', fg: '#fff' },
    { key: 'hdmi2', match: /hdmi\s*2\b/i, mark: 'hdmi2', bg: 'linear-gradient(135deg,#1e293b,#334155)', fg: '#fff' },
    { key: 'hdmi3', match: /hdmi\s*3\b/i, mark: 'hdmi3', bg: 'linear-gradient(135deg,#1e293b,#334155)', fg: '#fff' },
    { key: 'hdmi4', match: /hdmi\s*4\b/i, mark: 'hdmi4', bg: 'linear-gradient(135deg,#1e293b,#334155)', fg: '#fff' },
    { key: 'hdmi', match: /\bhdmi\b/i, mark: 'hdmi', bg: 'linear-gradient(135deg,#1e293b,#334155)', fg: '#fff' },
    { key: 'playstation', match: /play.?station|\bps[345]\b/i, mark: 'playstation', bg: 'linear-gradient(135deg,#00205c,#0070d1)', fg: '#fff' },
    { key: 'xbox', match: /xbox/i, mark: 'xbox', bg: 'linear-gradient(135deg,#0a3a0a,#16a016)', fg: '#fff' },
    { key: 'switch', match: /nintendo|\bswitch\b/i, mark: 'nintendoswitch', bg: 'linear-gradient(135deg,#b3000e,#ff2a2a)', fg: '#fff' },
    { key: 'steamdeck', match: /steam.?deck/i, mark: 'steamdeck', bg: 'linear-gradient(135deg,#1b2838,#2a475e)', fg: '#fff' },
    { key: 'steam', match: /\bsteam\b/i, mark: 'steam', bg: 'linear-gradient(135deg,#171a21,#1b2838)', fg: '#fff' },
    { key: 'nvidia', match: /nvidia|shield/i, mark: 'nvidia', bg: 'linear-gradient(135deg,#076800,#76b900)', fg: '#fff', pad: [18, 14] },
    { key: 'chromecast', match: /chromecast|google.?tv/i, mark: 'chromecast', bg: 'linear-gradient(135deg,#1a73e8,#4285f4)', fg: '#fff', pad: [20, 20] },
    { key: 'raspberrypi', match: /raspberry|raspi|\brpi\b/i, mark: 'raspberrypi', bg: 'linear-gradient(135deg,#6b2d5c,#c51a4a)', fg: '#fff', pad: [18, 18] },
    { key: 'pc', match: /(^|\s)pc(\s|$)|windows.?pc|gaming.?pc/i, text: 'PC', bg: 'linear-gradient(135deg,#1e293b,#475569)', fg: '#fff' }
];

/* Max length for console rename — keeps Home names one line at a readable size. */
window.CONSOLE_NAME_MAX = 16;

/* Logo key suggested by a console name (Rename / Add). */
window.brandKeyFromLabel = function (label) {
    var b = window.findBrand({ name: label || '', id: '' });
    return b ? b.key : '';
};

window.findBrand = function (keyOrApp) {
    if (typeof keyOrApp === 'string') {
        return window.BRANDS.find(function (b) { return b.key === keyOrApp; }) || null;
    }
    var text = (keyOrApp.name || '') + ' ' + (keyOrApp.id || '');
    return window.BRANDS.find(function (b) { return b.match && b.match.test(text); }) || null;
};

/* Optional console tile colour override (prefs.inputs[].color). Empty key = brand default. */
window.CONSOLE_COLORS = [
    { key: '', label: 'Default' },
    { key: 'slate', label: 'Slate', bg: 'linear-gradient(135deg,#1e293b,#475569)' },
    { key: 'blue', label: 'Blue', bg: 'linear-gradient(135deg,#0a2a6e,#1d6feb)' },
    { key: 'cyan', label: 'Cyan', bg: 'linear-gradient(135deg,#0c4a6e,#06b6d4)' },
    { key: 'teal', label: 'Teal', bg: 'linear-gradient(135deg,#134e4a,#14b8a6)' },
    { key: 'green', label: 'Green', bg: 'linear-gradient(135deg,#0a3a0a,#22c55e)' },
    { key: 'lime', label: 'Lime', bg: 'linear-gradient(135deg,#3f6212,#84cc16)' },
    { key: 'amber', label: 'Amber', bg: 'linear-gradient(135deg,#78350f,#f59e0b)' },
    { key: 'orange', label: 'Orange', bg: 'linear-gradient(135deg,#7c2d12,#f97316)' },
    { key: 'red', label: 'Red', bg: 'linear-gradient(135deg,#7f1d1d,#ef4444)' },
    { key: 'pink', label: 'Pink', bg: 'linear-gradient(135deg,#831843,#ec4899)' },
    { key: 'purple', label: 'Purple', bg: 'linear-gradient(135deg,#4c1d95,#a855f7)' },
    { key: 'indigo', label: 'Indigo', bg: 'linear-gradient(135deg,#312e81,#6366f1)' },
    { key: 'black', label: 'Black', bg: 'linear-gradient(135deg,#0a0a0a,#262626)' }
];

window.findConsoleColor = function (key) {
    return window.CONSOLE_COLORS.find(function (c) { return c.key === (key || ''); })
        || window.CONSOLE_COLORS[0];
};

window.consoleTileBg = function (input, brandBg) {
    var c = window.findConsoleColor(input && input.color);
    return c.key ? c.bg : (brandBg || '#2a2f3a');
};
