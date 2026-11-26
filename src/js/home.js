/* Home, All apps and Lab screens; app list loading, launching and HDMI inputs. */
(function () {
    'use strict';

    var CACHE_KEY = 'arn0.apps.v1';
    var REFRESH_AFTER_MS = 5 * 60 * 1000;
    var GRID_COLS = 5;

    var cfg = window.LAUNCHER_CONFIG;
    var log = DevLog.log;
    var $ = UI.$;
    var el = UI.el;
    var KEY = UI.KEY;

    var state = {
        apps: [],              // launchable apps from the TV (or the cache)
        appsSig: null,
        lastFetch: 0,
        showEverything: false, // All apps: bypass the consumer filter
        tvMode: false,         // HDMI shown inside the launcher
        hdmi: {},              // last known { port: connected }
        discoveredInputs: null // TV HDMI ports when prefs.inputs is still null
    };

    // Hold OK on an app / console to rearrange on Home (no Settings).
    var HOLD_MS = 600;
    var holdTimer = null;
    var holdEl = null;
    var holdFired = false;
    var holdDone = false;
    var rearrange = {
        active: false,
        kind: null,   // 'app' | 'input'
        index: -1,    // apps: row index; inputs: index in full list (incl. hidden)
        items: null,  // working copy until OK / Back
        armed: false  // false until the hold-OK key is released
    };

    // ---------- Tiles

    // Pre-coloured by scripts/build-marks.mjs.
    // opts.pad: apply brands.js inset (app tiles). Console marks are sized in CSS (left column).
    function markEl(brand, opts) {
        var m = new Image();
        m.className = 'mark';
        m.src = 'img/tiles/' + brand.key + '.svg';
        if (brand.pad && opts && opts.pad) {
            m.style.top = brand.pad[0] + '%';
            m.style.height = (100 - 2 * brand.pad[0]) + '%';
            m.style.left = brand.pad[1] + '%';
            m.style.width = (100 - 2 * brand.pad[1]) + '%';
        }
        return m;
    }

    function initials(label) {
        var words = label.replace(/[^\w\s+]/g, ' ').trim().split(/\s+/);
        return (words[0] ? words[0][0] : '?') + (words[1] ? words[1][0] : '');
    }

    function hue(text) {
        var h = 0;
        for (var i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
        return h;
    }

    // Brand fills as glass: keep hue, let the wallpaper show through.
    function hexToRgba(hex, alpha) {
        var h = String(hex).replace('#', '');
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        if (h.length !== 6) return 'rgba(255,255,255,' + alpha + ')';
        var n = parseInt(h, 16);
        return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
    }

    function glassBg(bg, alpha) {
        alpha = alpha == null ? 0.46 : alpha;
        if (!bg) return 'rgba(255,255,255,0.12)';
        return String(bg)
            .replace(/#([0-9a-fA-F]{3,6})\b/g, function (_, h) { return hexToRgba(h, alpha); })
            .replace(/hsl\(([^)]+)\)/g, function (_, body) { return 'hsla(' + body + ',' + alpha + ')'; });
    }

    var ICON_PX = 192;

    /*
     * Many Tizen icons ship with empty transparent margins. Crop to opaque pixels so the
     * artwork fills the tile without a per-app pad. Box icons (a solid rectangle with partly
     * transparent edges) have their background cleared, so the tile shows through.
     */
    // Clears the background colour of a box icon, starting from the edges so the logo stays.
    function clearBackground(canvas, bgR, bgG, bgB) {
        var w = canvas.width;
        var h = canvas.height;
        var out = document.createElement('canvas');
        out.width = w;
        out.height = h;
        var octx = out.getContext('2d');
        octx.drawImage(canvas, 0, 0);
        var clearData = octx.getImageData(0, 0, w, h);
        var cd = clearData.data;
        var visited = new Uint8Array(w * h);
        var stack = [];
        var seed = function (q) {
            if (!visited[q] && cd[q * 4 + 3] > 0) {
                visited[q] = 1;
                stack.push(q);
            }
        };
        var bx;
        var by;
        for (bx = 0; bx < w; bx++) {
            seed(bx);
            seed((h - 1) * w + bx);
        }
        for (by = 0; by < h; by++) {
            seed(by * w);
            seed(by * w + w - 1);
        }
        while (stack.length) {
            var q = stack.pop();
            var o = q * 4;
            if (Math.abs(cd[o] - bgR) >= 60 || Math.abs(cd[o + 1] - bgG) >= 60 || Math.abs(cd[o + 2] - bgB) >= 60) continue;
            cd[o + 3] = 0;
            var qx = q % w;
            if (qx > 0) seed(q - 1);
            if (qx < w - 1) seed(q + 1);
            if (q >= w) seed(q - w);
            if (q < w * (h - 1)) seed(q + w);
        }
        octx.putImageData(clearData, 0, 0);
        try {
            return out.toDataURL('image/png');
        } catch (e) {
            return null;
        }
    }

    function trimIconPadding(img, done) {
        var sw = img.naturalWidth;
        var sh = img.naturalHeight;
        if (!sw || !sh) { done(null); return; }
        // Tiles are small, so work on a copy at most ICON_PX wide: much cheaper to process.
        var scale = Math.min(1, ICON_PX / Math.max(sw, sh));
        var w = Math.max(1, Math.round(sw * scale));
        var h = Math.max(1, Math.round(sh * scale));
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        if (!ctx) { done(null); return; }
        try {
            ctx.drawImage(img, 0, 0, w, h);
            var data = ctx.getImageData(0, 0, w, h).data;
        } catch (e) {
            done(null);
            return;
        }
        var minX = w;
        var minY = h;
        var maxX = -1;
        var maxY = -1;
        var i;
        for (i = 3; i < data.length; i += 4) {
            if (data[i] < 12) continue;
            var p = (i - 3) / 4;
            var x = p % w;
            var y = (p - x) / w;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        }
        if (maxX < 0) { done(null); return; }
        // Box icon: all four corners are partly visible.
        var isBox = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]].every(function (c) {
            return data[(c[1] * w + c[0]) * 4 + 3] >= 40;
        });
        // Solid area bounds, and the artwork's background colour sampled just inside its edges.
        var sx0 = w;
        var sy0 = h;
        var sx1 = -1;
        var sy1 = -1;
        for (i = 3; i < data.length; i += 4) {
            if (data[i] < 200) continue;
            var q = (i - 3) / 4;
            var qx = q % w;
            var qy = (q - qx) / w;
            if (qx < sx0) sx0 = qx;
            if (qy < sy0) sy0 = qy;
            if (qx > sx1) sx1 = qx;
            if (qy > sy1) sy1 = qy;
        }
        var sum = [0, 0, 0];
        var n = 0;
        if (sx1 >= 0) {
            var bw = sx1 - sx0 + 1;
            var bh = sy1 - sy0 + 1;
            for (i = 3; i < data.length; i += 4) {
                if (data[i] < 200) continue;
                var p2 = (i - 3) / 4;
                var px2 = p2 % w;
                var py2 = (p2 - px2) / w;
                var edge = px2 < sx0 + bw * 0.08 || px2 > sx1 - bw * 0.08 ||
                    py2 < sy0 + bh * 0.08 || py2 > sy1 - bh * 0.08;
                if (!edge) continue;
                sum[0] += data[i - 3];
                sum[1] += data[i - 2];
                sum[2] += data[i - 1];
                n++;
            }
        }
        if (isBox && n) {
            done(clearBackground(canvas, sum[0] / n, sum[1] / n, sum[2] / n));
            return;
        }
        var margin = Math.max(1, Math.round(Math.max(w, h) * 0.02));
        minX = Math.max(0, minX - margin);
        minY = Math.max(0, minY - margin);
        maxX = Math.min(w - 1, maxX + margin);
        maxY = Math.min(h - 1, maxY + margin);
        var cw = maxX - minX + 1;
        var ch = maxY - minY + 1;
        if (cw / w > 0.9 && ch / h > 0.9) { done(null); return; }
        var out = document.createElement('canvas');
        out.width = cw;
        out.height = ch;
        out.getContext('2d').drawImage(canvas, minX, minY, cw, ch, 0, 0, cw, ch);
        try {
            done(out.toDataURL('image/png'));
        } catch (e2) {
            done(null);
        }
    }

    // Processed icons are kept for the session, so each one is only drawn to a canvas once.
    var iconCache = {};

    // Installed apps report a native path; it may or may not be readable from a web app.
    // pad: optional [vertical, horizontal] inset % override after auto-trim.
    function tryIcon(tile, mono, path, pad) {
        var img = new Image();
        img.className = 'icon';
        if (iconCache[path]) img._ready = true;
        if (pad) {
            img.style.top = pad[0] + '%';
            img.style.height = (100 - 2 * pad[0]) + '%';
            img.style.left = pad[1] + '%';
            img.style.width = (100 - 2 * pad[1]) + '%';
        }
        img.onload = function () {
            if (img._ready) {
                mono.style.display = 'none';
                if (!img.parentNode) tile.appendChild(img);
                return;
            }
            trimIconPadding(img, function (url) {
                img._ready = true;
                iconCache[path] = url || img.src;
                if (url) img.src = url;
                else {
                    mono.style.display = 'none';
                    tile.appendChild(img);
                }
            });
        };
        img.src = iconCache[path] || (path.charAt(0) === '/' ? 'file://' + path : path);
    }

    function tileFace(item) {
        var tile = el('div', 'tile');
        if (item.brand) {
            tile.style.background = glassBg(item.brand.bg);
            if (item.brand.text) {
                var word = el('div', 'wordmark', item.brand.text);
                word.style.color = item.brand.fg;
                tile.appendChild(word);
            } else {
                tile.appendChild(markEl(item.brand, { pad: true }));
            }
        } else {
            tile.style.background = glassBg('hsl(' + hue(item.label) + ',32%,28%)');
            var mono = el('div', 'mono', initials(item.label).toUpperCase());
            tile.appendChild(mono);
            if (item.iconPath) tryIcon(tile, mono, item.iconPath, item.iconPad);
        }
        return tile;
    }

    function appTile(item) {
        var wrap = el('div', 'app');
        wrap.appendChild(tileFace(item));
        wrap.appendChild(el('div', 'label', item.label));
        wrap._item = item;
        return wrap;
    }

    // Small tile used in Settings lists.
    function miniTile(item) {
        var wrap = el('div', 'mini');
        wrap.appendChild(tileFace(item));
        return wrap;
    }

    function allAppsTile() {
        var wrap = el('div', 'app');
        var tile = el('div', 'tile all-tile');
        tile.innerHTML = '<svg viewBox="0 0 24 24" fill="#fff"><rect x="3" y="3" width="7.5" height="7.5" rx="2"/>' +
            '<rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/>' +
            '<rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/></svg>';
        wrap.appendChild(tile);
        wrap.appendChild(el('div', 'label', 'All apps'));
        wrap._item = { kind: 'all' };
        return wrap;
    }

    // asApp: apps-row size when Consoles shelf is hidden (empty); else console-row tile.
    function addConsoleTile(asApp) {
        var plus = '<svg viewBox="0 0 24 24" fill="#fff"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>';
        if (asApp) {
            var app = el('div', 'app');
            var face = el('div', 'tile all-tile add-tile');
            face.innerHTML = plus;
            app.appendChild(face);
            app.appendChild(el('div', 'label', 'Add console'));
            app._item = { kind: 'add-console' };
            return app;
        }
        var wrap = el('div', 'input add-console');
        var tile = el('div', 'tile add-tile');
        tile.innerHTML = plus;
        wrap.appendChild(tile);
        wrap._item = { kind: 'add-console' };
        return wrap;
    }

    function inputTile(input) {
        var brand = findBrand(input.brand || '') || { bg: '#2a2f3a', fg: '#fff', mark: null };
        var wrap = el('div', 'input');
        var tile = el('div', 'tile');
        tile.style.background = glassBg(consoleTileBg(input, brand.bg), 0.38);
        // Logo panel (centred mark) + name / HDMI on the right.
        var logo = el('div', 'input-logo');
        if (brand.mark) logo.appendChild(markEl(brand));
        else if (brand.text) {
            var word = el('div', 'wordmark', brand.text);
            word.style.color = brand.fg || '#fff';
            logo.appendChild(word);
        }
        tile.appendChild(logo);
        var meta = el('div', 'meta');
        var name = el('div', 'name', input.label || '');
        meta.appendChild(name);
        var port = el('div', 'port');
        var dot = el('span', 'dot');
        port.appendChild(dot);
        port.appendChild(document.createTextNode('HDMI ' + input.hdmi));
        meta.appendChild(port);
        tile.appendChild(meta);
        wrap.appendChild(tile);
        wrap._item = { kind: 'input', hdmi: input.hdmi, label: input.label, method: input.method };
        wrap._dot = dot;
        wrap._name = name;
        return wrap;
    }

    // Shrink console name font until it fits one line (floor at 18px).
    function fitConsoleName(el) {
        if (!el) return;
        el.style.fontSize = '';
        var size = parseFloat(getComputedStyle(el).fontSize) || 30;
        var min = 18;
        while (size > min && el.scrollWidth > el.clientWidth + 1) {
            size -= 1;
            el.style.fontSize = size + 'px';
        }
    }

    function fitAllConsoleNames() {
        var row = $('inputs-row');
        if (!row) return;
        UI.children(row).forEach(function (wrap) {
            if (wrap._name) fitConsoleName(wrap._name);
        });
    }

    // Console tile for Settings lists: brand colours (or colour override) and logo only.
    function miniInputTile(input) {
        var brand = findBrand(input.brand || '');
        return miniTile({
            label: input.label,
            brand: brand && {
                key: brand.key,
                bg: consoleTileBg(input, brand.bg),
                fg: brand.fg,
                mark: brand.mark,
                text: brand.text,
                pad: brand.pad
            }
        });
    }

    // ---------- Home content

    function inputSeed(port) {
        return {
            hdmi: port,
            label: 'HDMI ' + port,
            brand: (port >= 1 && port <= 4) ? ('hdmi' + port) : 'hdmi'
        };
    }

    // null = not edited yet (use TV discovery); [] = user cleared every console.
    function inputsOwned() {
        return Prefs.get().inputs != null;
    }

    // Consoles: user list once edited (including empty); else every HDMI the TV reports.
    function inputs() {
        if (inputsOwned()) return Prefs.get().inputs;
        if (state.discoveredInputs && state.discoveredInputs.length) return state.discoveredInputs;
        return cfg.inputs || [];
    }

    function setInputs(list) {
        Prefs.get().inputs = list;
        Prefs.save();
        renderHome();
    }

    // Entries shown on Home: edited list from Settings, else config.js.
    function homeEntries() {
        return Prefs.get().home || cfg.apps || [];
    }

    function homeItems() {
        return Apps.curated(state.apps, { apps: homeEntries() });
    }

    function setHomeItems(items) {
        Prefs.get().home = items.map(function (i) {
            if (i.kind === 'tvsettings' || i.action === 'tvsettings') {
                return {
                    action: 'tvsettings',
                    label: i.label || 'TV Settings',
                    brand: 'tvsettings'
                };
            }
            var entry = { id: i.id, label: i.label };
            if (i.brand) entry.brand = i.brand.key;
            if (i.iconPad) entry.iconPad = i.iconPad;
            return entry;
        });
        Prefs.save();
        renderHome();
    }

    function appsForHome() {
        if (rearrange.active && rearrange.kind === 'app') return rearrange.items;
        return homeItems();
    }

    function inputsForHome() {
        if (rearrange.active && rearrange.kind === 'input') return rearrange.items;
        return inputs();
    }

    function appsCols() {
        return window.Appearance && Appearance.gridCols ? Appearance.gridCols() : 5;
    }

    function homeAppRows() {
        return window.Appearance && Appearance.homeRows ? Appearance.homeRows() : 1;
    }

    // Leave the last cell(s) for All apps (+ Add console when none).
    function appsCap(reserveAddConsole) {
        var rows = homeAppRows();
        return Math.max(0, appsCols() * rows - 1 - (reserveAddConsole ? 1 : 0));
    }

    function appsFocusRows() {
        var kids = UI.children($('apps-row'));
        if (homeAppRows() > 1) return UI.chunk(kids, appsCols());
        return [kids];
    }

    // Content width inside .row-viewport (excludes focus pad).
    function shelfViewWidth(port) {
        if (!port) return 0;
        var cs = getComputedStyle(port);
        return port.clientWidth
            - (parseInt(cs.paddingLeft, 10) || 0)
            - (parseInt(cs.paddingRight, 10) || 0);
    }

    // Clip half-tiles; show gear-column ▶ only when there is real overflow (ignore subpixel).
    function syncShelfMore(shelf, track) {
        if (!shelf) return;
        if (!track || !track.classList.contains('row-track')) {
            shelf.classList.remove('more-right');
            return;
        }
        var port = track.parentNode;
        var view = shelfViewWidth(port);
        var content = track.scrollWidth || 0;
        var pos = track._pos || 0;
        // Gutter-sized slack so a full row never false-triggers from rounding.
        shelf.classList.toggle('more-right', content - pos - view > 32);
    }

    function bindShelfMore(track) {
        if (!track) return;
        var port = track.parentNode;
        if (!port || !port.classList.contains('row-viewport')) return;
        var shelf = port.parentNode;
        if (!shelf || !shelf.classList.contains('shelf')) return;
        port._syncMore = function () { syncShelfMore(shelf, track); };
        setTimeout(port._syncMore, 0);
    }

    function syncAllShelfMore() {
        bindShelfMore($('apps-row'));
        bindShelfMore($('inputs-row'));
    }

    function renderHome() {
        var row2 = $('inputs-row');
        row2.innerHTML = '';
        var consoling = rearrange.active && rearrange.kind === 'input';
        var visible = [];
        inputsForHome().forEach(function (input) {
            if (!input.hidden) visible.push(input);
        });
        visible.forEach(function (input) { row2.appendChild(inputTile(input)); });
        var empty = !visible.length && !consoling;
        var reserveAdd = empty && !consoling;
        var multi = homeAppRows() > 1;

        var items = appsForHome();
        if (!items.length) {
            items = Apps.allSorted(state.apps, false).slice(0, appsCap(reserveAdd));
        } else if (multi && !(rearrange.active && rearrange.kind === 'app')) {
            items = items.slice(0, appsCap(reserveAdd));
        }

        var home = $('home');
        if (home) home.classList.toggle('home-apps-multi', multi);

        var row = $('apps-row');
        row.className = multi ? 'home-apps-grid grid' : 'row-track';
        if (UI.resetScroll) UI.resetScroll(row);
        row.innerHTML = '';
        items.forEach(function (item) { row.appendChild(appTile(item)); });
        row.appendChild(allAppsTile());
        if (!empty && !consoling) row2.appendChild(addConsoleTile(false));
        if (reserveAdd) row.appendChild(addConsoleTile(true));
        $('inputs-section').classList.toggle('hidden', empty);
        applyMovingClass();
        applyInputStatus();
        syncAllShelfMore();
        setTimeout(fitAllConsoleNames, 0);
        if (UI.isVisible('home')) UI.refresh();
    }

    function addAppToHome(item) {
        if (!item || (item.kind !== 'app' && item.kind !== 'tvsettings')) return;
        var items = homeItems().slice();
        var exists = items.some(function (i) {
            if (item.kind === 'tvsettings' || item.id === 'arn0:tvsettings') {
                return i.kind === 'tvsettings' || i.id === 'arn0:tvsettings';
            }
            return i.id === item.id;
        });
        if (exists) {
            UI.toast('Already on Home');
            if (window.Sound) Sound.play('edge');
            return;
        }
        items.push(item);
        setHomeItems(items);
        UI.toast('Added ' + item.label + ' to Home');
        if (window.Sound) Sound.play('ok');
    }

    function canRearrange(item) {
        return item && (item.kind === 'app' || item.kind === 'tvsettings' || item.kind === 'input');
    }

    function rearrangeIndexFor(el) {
        var item = el && el._item;
        if (!canRearrange(item)) return -1;
        if (item.kind === 'input') {
            var list = inputsForHome();
            for (var i = 0; i < list.length; i++) {
                if (!list[i].hidden && list[i].hdmi === item.hdmi) return i;
            }
            return -1;
        }
        var apps = UI.children($('apps-row'));
        var idx = apps.indexOf(el);
        if (idx < 0) return -1;
        // All apps / Add console stay at the end — not reorderable.
        var allIdx = apps.length;
        for (var a = 0; a < apps.length; a++) {
            if (apps[a]._item && apps[a]._item.kind === 'all') {
                allIdx = a;
                break;
            }
        }
        if (idx >= allIdx) return -1;
        return idx;
    }

    function applyMovingClass() {
        var prev = document.querySelectorAll('#home .moving');
        for (var i = 0; i < prev.length; i++) prev[i].classList.remove('moving');
        if (!rearrange.active) return;
        var tile = rearrangeTile();
        if (tile) tile.classList.add('moving');
    }

    function rearrangeTile() {
        if (!rearrange.active) return null;
        if (rearrange.kind === 'app') {
            return UI.children($('apps-row'))[rearrange.index] || null;
        }
        var list = rearrange.items || [];
        var vis = -1;
        for (var i = 0; i <= rearrange.index && i < list.length; i++) {
            if (!list[i].hidden) vis++;
        }
        return vis >= 0 ? (UI.children($('inputs-row'))[vis] || null) : null;
    }

    function focusRearrangeTile() {
        var tile = rearrangeTile();
        if (tile) UI.focusOn(tile);
        else UI.refresh();
        applyMovingClass();
        if (UI.refreshHints) UI.refreshHints();
    }

    function clearHold() {
        clearTimeout(holdTimer);
        holdTimer = null;
        holdEl = null;
        if (!holdDone) holdFired = false;
    }

    function startHold(el) {
        if (holdTimer || holdDone) return;
        holdEl = el;
        holdFired = false;
        holdTimer = setTimeout(function () {
            holdTimer = null;
            holdFired = true;
            holdDone = true;
            var target = holdEl;
            holdEl = null;
            var idx = rearrangeIndexFor(target);
            if (idx < 0) return;
            beginRearrange(target._item.kind === 'input' ? 'input' : 'app', idx);
        }, HOLD_MS);
    }

    function beginRearrange(kind, index) {
        rearrange.active = true;
        rearrange.armed = false;
        rearrange.kind = kind;
        rearrange.index = index;
        if (kind === 'app') {
            rearrange.items = homeItems().slice();
            if (!rearrange.items.length) {
                rearrange.items = Apps.allSorted(state.apps, false).slice(0, 8);
            }
        } else {
            // Shallow-copy each console so colour / method / etc. survive OK.
            rearrange.items = inputs().map(function (inp) {
                return Object.assign({}, inp);
            });
        }
        renderHome();
        focusRearrangeTile();
        if (window.Sound) Sound.play('ok');
    }

    function endRearrange() {
        rearrange.active = false;
        rearrange.armed = false;
        rearrange.kind = null;
        rearrange.index = -1;
        rearrange.items = null;
    }

    function commitRearrange() {
        if (!rearrange.active) return;
        var kind = rearrange.kind;
        var items = rearrange.items;
        endRearrange();
        if (kind === 'app') setHomeItems(items);
        else setInputs(items);
        if (UI.refreshHints) UI.refreshHints();
        if (window.Sound) Sound.play('ok');
    }

    function cancelRearrange() {
        if (!rearrange.active) return;
        endRearrange();
        renderHome();
        if (UI.refreshHints) UI.refreshHints();
        if (window.Sound) Sound.play('back');
    }

    function swapAt(list, a, b) {
        var tmp = list[a];
        list[a] = list[b];
        list[b] = tmp;
    }

    function rearrangeMove(dc) {
        if (!rearrange.active || !rearrange.items) return true;
        var items = rearrange.items;
        if (rearrange.kind === 'app') {
            var n = items.length;
            if (n < 2) return true;
            var to = (rearrange.index + dc + n) % n;
            if (to === rearrange.index) return true;
            swapAt(items, rearrange.index, to);
            rearrange.index = to;
        } else {
            var visible = [];
            items.forEach(function (inp, i) {
                if (!inp.hidden) visible.push(i);
            });
            if (visible.length < 2) return true;
            var pos = visible.indexOf(rearrange.index);
            if (pos < 0) return true;
            var toPos = (pos + dc + visible.length) % visible.length;
            if (toPos === pos) return true;
            swapAt(items, visible[pos], visible[toPos]);
            rearrange.index = visible[toPos];
        }
        renderHome();
        focusRearrangeTile();
        if (window.Sound) Sound.play('move');
        return true;
    }

    // Drop the focused tile from the working list (same as Settings remove). OK still saves.
    function pickVisibleIndex(list, prefer) {
        var visible = [];
        list.forEach(function (inp, i) {
            if (!inp.hidden) visible.push(i);
        });
        if (!visible.length) return -1;
        if (prefer >= 0 && prefer < list.length && !list[prefer].hidden) return prefer;
        var pick = visible[0];
        for (var j = 0; j < visible.length; j++) {
            if (visible[j] >= prefer) return visible[j];
            pick = visible[j];
        }
        return pick;
    }

    function rearrangeRemove() {
        if (!rearrange.active || !rearrange.items) return true;
        var items = rearrange.items;
        if (rearrange.kind === 'app') {
            if (items.length <= 1) {
                UI.toast('Home needs at least one app');
                if (window.Sound) Sound.play('edge');
                return true;
            }
            var next = rearrange.index;
            items.splice(rearrange.index, 1);
            if (next >= items.length) next = items.length - 1;
            rearrange.index = next;
        } else {
            var pos = rearrange.index;
            if (pos < 0 || pos >= items.length) return true;
            items.splice(pos, 1);
            rearrange.index = pickVisibleIndex(items, pos);
            if (rearrange.index < 0) {
                renderHome();
                if (UI.refreshHints) UI.refreshHints();
                if (window.Sound) Sound.play('ok');
                return true;
            }
        }
        renderHome();
        focusRearrangeTile();
        if (window.Sound) Sound.play('ok');
        return true;
    }

    // Same console menu as Settings; edits stay in the working copy until OK / Back.
    function openConsoleOptions() {
        if (!rearrange.active || rearrange.kind !== 'input' || rearrange.index < 0) return true;
        if (!window.SettingsConsoles || !SettingsConsoles.openMenu) return true;
        var idx = rearrange.index;
        SettingsConsoles.openMenu(idx, {
            noMove: true,
            getList: function () { return rearrange.items; },
            apply: function (list) {
                rearrange.items = list;
                rearrange.index = pickVisibleIndex(list, idx);
                renderHome();
                if (rearrange.index >= 0) focusRearrangeTile();
                else if (UI.refreshHints) UI.refreshHints();
            }
        });
        return true;
    }

    function isTopChrome(el) {
        if (!el) return false;
        return isMusicControl(el) || el === $('gear');
    }

    function isMusicControl(el) {
        return el === $('music-btn-prev')
            || el === $('music-btn-play')
            || el === $('music-btn-next');
    }

    function activateHome(item) {
        if (item.kind === 'app') launchApp(item);
        else if (item.kind === 'tvsettings') openTvSettings();
        else if (item.kind === 'all') UI.show('all');
        else if (item.kind === 'input') openInput(item);
        else if (item.kind === 'add-console') {
            if (window.SettingsConsoles && SettingsConsoles.add) SettingsConsoles.add();
        }
        else if (item.kind === 'settings') UI.show('settings');
        else if (item.kind === 'music') {
            if (item.action === 'toggle') Music.toggle();
            else if (item.action === 'next') Music.next();
            else if (item.action === 'prev') Music.prev();
        }
    }

    // Hold OK on All apps: pin to Home (short OK still launches).
    function startHoldAddHome(el) {
        if (holdTimer || holdDone) return;
        holdEl = el;
        holdFired = false;
        holdTimer = setTimeout(function () {
            holdTimer = null;
            holdFired = true;
            holdDone = true;
            var target = holdEl;
            holdEl = null;
            var item = target && target._item;
            if (item) addAppToHome(item);
        }, HOLD_MS);
    }

    function applyInputStatus() {
        UI.children($('inputs-row')).forEach(function (tile) {
            if (!tile._dot || !tile._item) return;
            tile._dot.classList.toggle('on', state.hdmi[tile._item.hdmi] === true);
        });
    }

    function refreshInputStatus() {
        var pending = Inputs.hdmiPorts
            ? Inputs.hdmiPorts().then(function (ports) {
                // Only auto-fill when the user has never edited consoles (null). [] stays empty.
                if (!inputsOwned() && ports && ports.length) {
                    var next = ports.map(inputSeed);
                    var prev = state.discoveredInputs;
                    var same = prev && prev.length === next.length &&
                        prev.every(function (p, i) { return p.hdmi === next[i].hdmi; });
                    state.discoveredInputs = next;
                    if (!same) renderHome();
                }
                return Inputs.hdmiStatus();
            })
            : Inputs.hdmiStatus();
        pending.then(function (status) {
            state.hdmi = status;
            applyInputStatus();
        }).catch(function (err) {
            log('Input status unavailable: ' + DevLog.errorText(err));
        });
    }

    function renderAll() {
        var grid = $('all-grid');
        grid.innerHTML = '';
        UI.resetScroll(grid);
        var items = Apps.allSorted(state.apps, state.showEverything);
        items.forEach(function (item) { grid.appendChild(appTile(item)); });
        $('all-count').textContent = items.length + ' apps';
    }

    function renderLab() {
        var actions = [
            { label: 'Send installed app list to log', run: labDumpApps },
            { label: 'Read inputs', run: labReadInputs },
            { label: 'Open Samsung TV viewer only', run: function () { runLogged('Open TV viewer', Inputs.openViewer()); } }
        ];
        if (window.Sound) actions = actions.concat(Sound.actions());
        if (window.Weather) actions = actions.concat(Weather.actions());
        if (window.RenderProbe) actions = actions.concat(RenderProbe.actions());
        if (window.PlatformProbe) actions = actions.concat(PlatformProbe.actions());
        if (window.Music) actions = actions.concat(Music.actions());
        if (window.Subsonic) actions = actions.concat(Subsonic.actions());
        if (window.LiveWallpaper) actions = actions.concat(LiveWallpaper.actions());
        inputs().forEach(function (input) {
            var item = { kind: 'input', hdmi: input.hdmi, label: input.label };
            var name = input.label + ' (HDMI ' + input.hdmi + ')';
            actions.push({ label: name + ': switch + viewer', run: function () { openInput(item, 'switch+viewer'); } });
            actions.push({ label: name + ': switch only', run: function () { openInput(item, 'switch'); } });
            actions.push({ label: name + ': inside launcher', run: function () { openInput(item, 'inapp'); } });
        });
        var list = $('lab-list');
        list.innerHTML = '';
        UI.resetScroll(list);
        actions.forEach(function (a) {
            var li = el('li', '', a.label);
            li._item = { kind: 'lab', run: a.run };
            list.appendChild(li);
        });
        paintLabLog();
        DevLog.onLine(paintLabLog);
    }

    function paintLabLog() {
        var log = $('lab-log');
        if (!log) return;
        log.textContent = DevLog.lines().slice(-120).join('\n');
        log.scrollTop = log.scrollHeight;
    }

    // ---------- Actions

    function runLogged(what, promise) {
        log(what + '…');
        return UI.busy(promise).then(function (v) {
            log(what + ': ok');
            return v;
        }, function (err) {
            log(what + ': FAILED ' + DevLog.errorText(err));
            throw err;
        });
    }

    function launchApp(item) {
        runLogged('Launch ' + item.id, Apps.launch(item.id)).catch(function (err) {
            UI.toast('Could not open ' + item.label + ': ' + DevLog.errorText(err));
        });
    }

    function openTvSettings() {
        runLogged('TV Settings', Apps.openTvSettings()).catch(function (err) {
            UI.toast('Could not open TV Settings: ' + DevLog.errorText(err));
        });
    }

    function openInput(item, method) {
        method = method || item.method || cfg.inputMethod;
        runLogged('Input HDMI ' + item.hdmi + ' via ' + method, Inputs.open(item.hdmi, method)).then(function (result) {
            log('Current source now: ' + Inputs.describeSource(Inputs.current()));
            if (result === 'inapp') enterTvMode();
        }).catch(function (err) {
            UI.toast('Could not switch to ' + item.label + ': ' + DevLog.errorText(err));
        });
    }

    function enterTvMode() {
        state.tvMode = true;
        document.documentElement.classList.add('tv-mode');
    }

    function exitTvMode() {
        state.tvMode = false;
        document.documentElement.classList.remove('tv-mode');
        Inputs.hide().catch(function (err) { log('Hide input failed: ' + DevLog.errorText(err)); });
    }

    function labDumpApps() {
        runLogged('App list', Apps.getInstalledApps()).then(function (apps) {
            log('apps: ' + apps.length + ' total, ' + apps.filter(function (a) { return a.show; }).length + ' with show=true',
                apps.map(Apps.describe));
            UI.toast('Sent ' + apps.length + ' apps to the log');
        }).catch(function () {});
    }

    function labReadInputs() {
        runLogged('Inputs', Inputs.sources()).then(function (info) {
            var fmt = function (list) { return (list || []).map(Inputs.describeSource).join(', ') || 'none'; };
            log('connected: ' + fmt(info.connected));
            log('disconnected: ' + fmt(info.disconnected));
            log('current: ' + Inputs.describeSource(Inputs.current()));
        }).catch(function () {});
    }

    // ---------- Clock, data, lifecycle

    function updateClock() {
        var d = new Date();
        var t = Appearance.time(d);
        $('time-main').textContent = t.time;
        $('time-suffix').textContent = t.suffix;
        $('date').textContent = Appearance.date(d);
    }

    function updateWeather() {
        var el = $('home-weather');
        var clock = document.querySelector('#home .clock');
        var sep = $('home-music-sep');
        if (!el) return;
        var w = window.Weather && Weather.current();
        el.classList.toggle('hidden', !w);
        if (clock) clock.classList.toggle('with-weather', !!w);
        if (sep) {
            sep.classList.toggle('hidden', !(w && clock && clock.classList.contains('with-music')));
        }
        if (!w) return;
        $('home-wx-icon').innerHTML = w.icon;
        $('home-wx-temp').textContent = w.temp;
        $('home-wx-range').textContent = w.range;
        $('home-wx-detail').textContent = w.detail;
        var week = $('home-wx-week');
        week.innerHTML = '';
        (w.days || []).forEach(function (d) {
            var day = document.createElement('div');
            day.className = 'home-wx-day';
            day.innerHTML =
                '<div class="home-wx-day-label"></div>' +
                '<div class="home-wx-day-icon"></div>' +
                '<div class="home-wx-day-temps"></div>';
            day.querySelector('.home-wx-day-label').textContent = d.label;
            day.querySelector('.home-wx-day-icon').innerHTML = d.icon;
            day.querySelector('.home-wx-day-temps').innerHTML =
                d.max + ' <span>' + d.min + '</span>';
            week.appendChild(day);
        });
    }

    // The TV takes ~4 s to list its ~450 apps, so Home is drawn from the last list we saw
    // and only redrawn if a fresh list differs.
    function readCache() {
        try {
            return JSON.parse(localStorage.getItem(CACHE_KEY));
        } catch (e) {
            return null;
        }
    }

    function writeCache(apps) {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(apps));
        } catch (e) {
            // Without the cache we only lose the fast start.
        }
    }

    var listeners = [];

    function setApps(apps) {
        var sig = apps.map(function (a) { return a.id + '|' + a.name + '|' + a.show; }).join(',');
        if (sig === state.appsSig) return;
        state.appsSig = sig;
        state.apps = apps;
        renderHome();
        if (UI.isVisible('all')) UI.show('all', { back: true });
        listeners.forEach(function (fn) { fn(); });
    }

    function loadApps() {
        state.lastFetch = Date.now();
        return Apps.getInstalledApps().then(function (apps) {
            var list = Apps.launchable(apps).map(function (a) {
                return { id: a.id, name: a.name, show: a.show, iconPath: a.iconPath || '' };
            });
            writeCache(list);
            setApps(list);
        }).catch(function (err) {
            UI.toast('Could not list apps: ' + DevLog.errorText(err));
            log('App list failed: ' + DevLog.errorText(err));
        });
    }

    function registerKeys() {
        try {
            tizen.tvinputdevice.registerKeyBatch(['ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue']);
        } catch (e) {
            log('Colour keys unavailable: ' + DevLog.errorText(e));
        }
    }

    function registerViews() {
        UI.register('home', {
            el: $('home'),
            startRow: 1,
            wrap: true,
            hints: function () {
                if (rearrange.active) {
                    var moveHints = [['◀▶', 'Move'], ['▼', 'Remove']];
                    if (rearrange.kind === 'input' && rearrange.index >= 0) {
                        moveHints.push(['▲', 'Options']);
                    }
                    moveHints.push(['OK', 'Done'], ['Back', 'Cancel']);
                    return moveHints;
                }
                var el = document.querySelector('#home .focused');
                var item = el && el._item;
                var ok = 'Open';
                if (item && item.kind === 'settings') ok = 'Settings';
                else if (item && item.kind === 'music') {
                    if (item.action === 'next') ok = 'Next';
                    else if (item.action === 'prev') ok = 'Previous';
                    else ok = (Music.isPlaying && Music.isPlaying()) ? 'Pause' : 'Play';
                }                 else if (item && item.kind === 'input') ok = 'Switch';
                else if (item && item.kind === 'add-console') ok = 'Add';
                // ▲ Settings only when Up from gear/music opens Settings (not from apps/consoles).
                var hints = [['OK', ok]];
                if (isTopChrome(el)) hints.push(['▲', 'Settings']);
                if (canRearrange(item)) hints.splice(1, 0, ['Hold OK', 'Options']);
                return hints;
            },
            rows: function () {
                // Clock / weather are display-only — configure in Settings.
                var top = [];
                if (window.Music && Music.barVisible()) {
                    top.push($('music-btn-prev'), $('music-btn-play'), $('music-btn-next'));
                }
                top.push($('gear'));
                var rowsOut = [top].concat(appsFocusRows());
                var inputsSection = $('inputs-section');
                if (inputsSection && !inputsSection.classList.contains('hidden')) {
                    rowsOut.push(UI.children($('inputs-row')));
                }
                return rowsOut;
            },
            activate: activateHome,
            // Home is the root: Back cancels rearrange, otherwise does nothing.
            onBack: function () {
                if (rearrange.active) {
                    cancelRearrange();
                    return true;
                }
                return true;
            },
            // ▲ hint is Settings: from apps/consoles Up still moves to the top row; on the top
            // row (gear / music) Up opens Settings instead of doing nothing at the edge.
            // Hold OK on an app/console starts rearrange; while moving, ◀▶ swap and OK places.
            onKey: function (k) {
                if (rearrange.active) {
                    if (k === KEY.LEFT) return rearrangeMove(-1);
                    if (k === KEY.RIGHT) return rearrangeMove(1);
                    if (k === KEY.DOWN) return rearrangeRemove();
                    if (k === KEY.UP) {
                        if (rearrange.kind === 'input' && rearrange.index >= 0) {
                            return openConsoleOptions();
                        }
                        return true;
                    }
                    if (k === KEY.ENTER) {
                        // Ignore repeats from the same hold that entered move mode.
                        if (rearrange.armed) commitRearrange();
                        return true;
                    }
                    return false;
                }
                if (k === KEY.ENTER) {
                    var focused = document.querySelector('#home .focused');
                    if (canRearrange(focused && focused._item) && rearrangeIndexFor(focused) >= 0) {
                        // Swallow repeats while the key is down / after a hold already fired.
                        if (holdTimer || holdDone) return true;
                        startHold(focused);
                        return true;
                    }
                    return false;
                }
                if (k !== KEY.UP) return false;
                var el = document.querySelector('#home .focused');
                if (isTopChrome(el)) {
                    UI.show('settings');
                    return true;
                }
                return false;
            },
            onFocus: function (el) {
                if (window.Music) {
                    if (isMusicControl(el)) Music.showFull();
                    else if (Music.releaseFull) Music.releaseFull();
                }
                syncAllShelfMore();
                if (UI.refreshHints) UI.refreshHints();
            }
        });
        $('gear')._item = { kind: 'settings' };

        document.addEventListener('keyup', function (e) {
            if (e.keyCode !== KEY.ENTER) return;
            if (rearrange.active) rearrange.armed = true;
            if (holdTimer && holdEl) {
                var target = holdEl;
                var fired = holdFired;
                clearHold();
                if (!fired) {
                    var item = target && target._item;
                    if (item && UI.isVisible('home') && !rearrange.active) activateHome(item);
                    else if (item && UI.isVisible('all') && item.kind === 'app') launchApp(item);
                }
            }
            holdDone = false;
            holdFired = false;
            holdEl = null;
        });

        UI.register('all', {
            el: $('all'),
            wrap: true,
            rows: function () {
                var cols = window.Appearance && Appearance.gridCols ? Appearance.gridCols() : GRID_COLS;
                return UI.chunk(UI.children($('all-grid')), cols);
            },
            onShow: renderAll,
            activate: launchApp,
            onKey: function (k) {
                if (k !== KEY.ENTER) return false;
                var focused = document.querySelector('#all .focused');
                var item = focused && focused._item;
                if (!item || item.kind !== 'app') return false;
                if (holdTimer || holdDone) return true;
                startHoldAddHome(focused);
                return true;
            },
            hints: function () {
                return [['OK', 'Open'], ['Hold OK', 'Add to Home'], ['Back', 'Home']];
            }
        });

        UI.register('lab', {
            el: $('lab'),
            wrap: true,
            rows: function () {
                var log = $('lab-log');
                return UI.children($('lab-list')).map(function (li) { return [li, log]; });
            },
            activate: function (item) { if (item && item.run) item.run(); },
            onFocus: function () { UI.refreshHints(); },
            onKey: function (k) {
                var log = $('lab-log');
                // Actions column: ◀ backs to Settings (same as other settings pages).
                if (k === KEY.LEFT && UI.atRowStart && UI.atRowStart()) {
                    UI.back();
                    return true;
                }
                if (!log || !log.classList.contains('focused')) return false;
                if (k === KEY.UP) {
                    log.scrollTop = Math.max(0, log.scrollTop - 56);
                    if (window.Sound) Sound.play('move');
                    return true;
                }
                if (k === KEY.DOWN) {
                    var max = Math.max(0, log.scrollHeight - log.clientHeight);
                    log.scrollTop = Math.min(max, log.scrollTop + 56);
                    if (window.Sound) Sound.play(log.scrollTop >= max ? 'edge' : 'move');
                    return true;
                }
                return false;
            },
            hints: function () {
                var back = window.SettingsCore && SettingsCore.backPair
                    ? SettingsCore.backPair('Settings')
                    : ['Back', 'Settings'];
                var log = $('lab-log');
                if (log && log.classList.contains('focused')) {
                    return [['▲▼', 'Scroll'], ['◀', 'Actions'], back];
                }
                return [['OK', 'Run'], ['▶', 'Log'], ['◀', 'Back'], back];
            }
        });
    }

    function init() {
        registerKeys();
        registerViews();
        UI.setKeyHook(function (k) {
            if (state.tvMode) {
                if (k === KEY.BACK || k === KEY.ESC || k === KEY.BACKSPACE) exitTvMode();
                return true;
            }
            return false;
        });
        Appearance.apply();
        updateClock();
        updateWeather();
        setInterval(updateClock, 10000);
        if (window.Weather) {
            Weather.onUpdate(function () {
                updateWeather();
                updateClock();
            });
        }
        renderLab();
        var cached = readCache();
        if (cached && cached.length) setApps(cached);
        else renderHome();
        UI.show('home');
        Wallpaper.start();

        document.addEventListener('visibilitychange', function () {
            if (document.hidden) {
                if (state.tvMode) exitTvMode();
                return;
            }
            updateClock();
            updateWeather();
            if (window.Weather) Weather.refresh();
            refreshInputStatus();
            if (UI.isVisible('home')) Wallpaper.homeShown();
            if (Date.now() - state.lastFetch > REFRESH_AFTER_MS) setTimeout(loadApps, 1500);
        });
        // With a cache, let the first frames and key presses through before the slow app list.
        setTimeout(loadApps, cached ? 2000 : 0);
        refreshInputStatus();
        log('Launcher started');
    }

    window.Home = {
        init: init,
        apps: function () { return state.apps; },
        homeItems: homeItems,
        setHomeItems: setHomeItems,
        inputs: inputs,
        setInputs: setInputs,
        hdmiStatus: function () { return state.hdmi; },
        // An HDMI input shown inside the launcher: no screen saver over it.
        tvMode: function () { return state.tvMode; },
        refreshInputStatus: refreshInputStatus,
        render: renderHome,
        renderLab: renderLab,
        updateClock: updateClock,
        reloadApps: loadApps,
        miniTile: miniTile,
        miniInputTile: miniInputTile,
        onAppsChanged: function (fn) { listeners.push(fn); }
    };
})();
