/*
 * Screen saver: photos with a slow zoom, a clock and a caption, after a stretch with no input
 * on Home.
 *
 * Remote (legend on-screen):
 *   Up/Down  Live source among all configured providers (+ Mix when 2+)
 *   Right    next photo (Rotate / Live)
 *   Left     next music track
 *   OK       play / pause music
 *   Back     exit (chrome hidden or black: first key only reveals / wakes)
 *
 * Caption, clock, weather, music, and legend fade out after idle; the next key
 * shows them again without changing photo or track.
 *
 * Adapted from a design mockup rather than ported from it. The mockup's backdrop was nine
 * radial-gradients over a linear-gradient — the exact shape the Lab render probe measured at
 * 4.6 fps with 88 of 90 frames dropped (see the header of css/style.css). Here a photo fills
 * that role, the one gradient left is static and painted once, and everything that moves does
 * so through `transform` and `opacity`, which the compositor animates with no JavaScript per
 * frame. The poll below ticks once a second and only decides what is due.
 *
 * Burn-in is why the photo drifts (and eventually fades to black). Clock + weather stay fixed
 * bottom-right — opposite the caption — so the chrome does not jump around.
 */
(function () {
    'use strict';

    var $ = UI.$;

    var DELAYS = [
        { key: '3m', label: '3 min', ms: 3 * 60 * 1000 },
        { key: '5m', label: '5 min', ms: 5 * 60 * 1000 },
        { key: '10m', label: '10 min', ms: 10 * 60 * 1000 },
        { key: '15m', label: '15 min', ms: 15 * 60 * 1000 }
    ];

    // The design asks for a photo change every 60-90 s; these are the ends and the middle.
    var PHOTO_EVERY = [
        { key: '60s', label: '60 s', ms: 60 * 1000 },
        { key: '75s', label: '75 s', ms: 75 * 1000 },
        { key: '90s', label: '90 s', ms: 90 * 1000 }
    ];

    var DARK_AFTER = [
        { key: '5m', label: '5 min', ms: 5 * 60 * 1000 },
        { key: '10m', label: '10 min', ms: 10 * 60 * 1000 },
        { key: '15m', label: '15 min', ms: 15 * 60 * 1000 },
        { key: '30m', label: '30 min', ms: 30 * 60 * 1000 },
        { key: '1h', label: '1 hour', ms: 60 * 60 * 1000 },
        { key: '2h', label: '2 hours', ms: 2 * 60 * 60 * 1000 },
        { key: 'never', label: 'Never', ms: 0 }
    ];

    // Caption / clock / weather / music / legend idle fade.
    var CHROME_HIDE = [
        { key: '10s', label: '10 s', ms: 10 * 1000 },
        { key: '20s', label: '20 s', ms: 20 * 1000 },
        { key: '30s', label: '30 s', ms: 30 * 1000 },
        { key: '1m', label: '1 min', ms: 60 * 1000 },
        { key: 'never', label: 'Never', ms: 0 }
    ];

    /*
     * The photo drifts rather than zooms. A zoom changes the layer's raster scale, and this
     * engine re-rasterises a scaled 1920x1080 layer in visible steps instead of compositing it
     * smoothly. A translate leaves the raster alone. Drift distance is derived from each photo's
     * size vs the 1920×1080 stage; only speed is user-tunable.
     */
    var VIEW_W = 1920;
    var VIEW_H = 1080;
    var PAN_SPEEDS = [
        { key: 'slow', label: 'Slow', factor: 1.7 },
        { key: 'normal', label: 'Normal', factor: 1 },
        { key: 'fast', label: 'Fast', factor: 0.5 }
    ];
    // Portrait zoom may be cut mid-leg when the photo changes — factor > 1 keeps it slow.
    var ZOOM_LEG_FACTOR = 1.25;
    var HELD_LEG_MS = 90 * 1000;    // one leg of the drift when a single photo is held
    var FADE_MS = 2000;             // crossfade, also set as the default in the stylesheet
    var POLL_MS = 1000;
    var FALLBACK_DRIFT = {
        coverX: 160, coverY: 90, zoom: 1.35,
        containX: 0, containY: 40, padX: 160, padY: 90
    };

    var open = false;
    var returnTo = 'home';
    var lastInput = Date.now();
    var layers = [];
    var front = 0;              // which of the two photo layers is showing
    var photoToken = 0;
    var photoIndex = 0;
    var openedAt = 0;
    var nextPhotoAt = 0;
    var captionText = '';
    var nextPanAt = 0;
    var panSign = 1;            // flipped on each leg, so the drift alternates direction
    var lastClockText = '';
    var dark = false;
    var chromeHidden = false;   // writings faded; next key only reveals them
    var lastChromeAt = 0;       // last time chrome was shown or touched
    var advancing = false;      // one in-flight live takeNext (timer or remote)
    var shownKey = '';          // live polish may update caption after the photo is up
    var providerFlashTimer = 0;
    var captionSub = '';
    var lastMusicSig = '';

    function prefs() { return Prefs.get().screensaver; }

    function panOn() { return prefs().pan !== false; }

    function blurOn() { return prefs().blur !== false; }

    function option(list, key, fallback) {
        return list.find(function (o) { return o.key === key; }) ||
            list.find(function (o) { return o.key === fallback; });
    }

    function delay() { return option(DELAYS, prefs().delay, '5m'); }
    function photoEvery() { return option(PHOTO_EVERY, prefs().photoEvery, '75s'); }
    function darkAfter() { return option(DARK_AFTER, prefs().dark, '15m'); }
    function chromeHide() { return option(CHROME_HIDE, prefs().chromeHide, '20s'); }
    function panSpeed() { return option(PAN_SPEEDS, prefs().panSpeed, 'normal'); }

    function driftOf(layer) {
        return (layer && layer._drift) || FALLBACK_DRIFT;
    }

    /*
     * Pan/zoom budget from photo pixels vs the fixed TV stage. Landscape cover: move within the
     * overflow after cover-fit (near-16:9 gets a little overscan so there is still room). Portrait
     * contain: full stage height, side pillars; zoom toward full-bleed, nudge in leftover spill.
     */
    function computeDrift(ow, oh, portrait) {
        if (!ow || !oh) return FALLBACK_DRIFT;
        if (portrait) {
            var fit = Math.min(VIEW_W / ow, VIEW_H / oh);
            var fw = ow * fit;
            var fh = oh * fit;
            // 1 = contain (full height); fill = scale that would flush width too.
            var fill = Math.max(VIEW_W / fw, VIEW_H / fh);
            var zoom = Math.min(2.15, Math.max(1.15, 1 + (fill - 1) * 0.8));
            var zW = fw * zoom;
            var zH = fh * zoom;
            var spillX = Math.max(0, (zW - VIEW_W) / 2);
            var spillY = Math.max(0, (zH - VIEW_H) / 2);
            return {
                coverX: 0,
                coverY: 0,
                zoom: zoom,
                containX: Math.round(Math.min(64, spillX * 0.45)),
                containY: 0, // never nudge vertically — keeps top/bottom sealed
                padX: 0,
                padY: 0
            };
        }
        var cover = Math.max(VIEW_W / ow, VIEW_H / oh);
        var overflowX = Math.max(0, (ow * cover - VIEW_W) / 2);
        var overflowY = Math.max(0, (oh * cover - VIEW_H) / 2);
        // Fixed Ken Burns travel (matches .ss-photo CSS). Near-16:9 has almost no cover
        // overflow, so invent the same overscan rather than a tiny adaptive nudge.
        var MIN_X = 160;
        var MIN_Y = 90;
        if (overflowX < MIN_X || overflowY < MIN_Y) {
            overflowX = Math.max(overflowX, MIN_X);
            overflowY = Math.max(overflowY, MIN_Y);
        }
        var panX = Math.round(Math.min(220, Math.max(MIN_X, overflowX * 0.7)));
        var panY = Math.round(Math.min(140, Math.max(MIN_Y, overflowY * 0.7)));
        var padX = Math.max(panX, Math.ceil(overflowX));
        var padY = Math.max(panY, Math.ceil(overflowY));
        return { coverX: panX, coverY: panY, zoom: 1, padX: padX, padY: padY };
    }

    function applyLayerPad(layer, drift, contain) {
        if (contain) {
            layer.style.top = '';
            layer.style.left = '';
            layer.style.width = '';
            layer.style.height = '';
            return;
        }
        var padX = drift.padX || 160;
        var padY = drift.padY || 90;
        layer.style.top = (-padY) + 'px';
        layer.style.left = (-padX) + 'px';
        layer.style.width = (VIEW_W + 2 * padX) + 'px';
        layer.style.height = (VIEW_H + 2 * padY) + 'px';
    }

    // Pillar widths for portrait blur strips (oriented aspect → side gaps only).
    function applyPortraitPillars(layer, ow, oh) {
        var left = layer.querySelector('.ss-pillar-left');
        var right = layer.querySelector('.ss-pillar-right');
        if (!left || !right || !ow || !oh) return;
        var dispW = Math.round(VIEW_H * (ow / oh));
        if (dispW > VIEW_W) dispW = VIEW_W;
        var side = Math.max(0, Math.floor((VIEW_W - dispW) / 2));
        left.style.width = side + 'px';
        right.style.width = side + 'px';
    }

    function clearPortraitPillars(layer) {
        var left = layer.querySelector('.ss-pillar-left');
        var right = layer.querySelector('.ss-pillar-right');
        if (left) left.style.width = '';
        if (right) right.style.width = '';
    }

    // ---------- Photos

    function rotating() {
        var mode = Prefs.get().wallpaper.mode;
        if (mode === 'live') return !!window.LiveWallpaper;
        return mode === 'rotate' && Wallpaper.list().length > 1;
    }

    // Active catalog only (live pool or bundled rotate) — never sneak in shipped stills during Live/Mix.
    function playlist() {
        return Wallpaper.list();
    }

    // Right / timer only cycle in Rotate or Live. A held single Photo must stay put
    // (Wallpaper.list() is the full bundled set in that mode — do not walk it).
    function canAdvance() {
        var mode = Prefs.get().wallpaper.mode;
        if (mode === 'live') return !!window.LiveWallpaper;
        if (mode === 'rotate') return playlist().length > 1;
        return false;
    }

    /*
     * The photo follows the Background setting: Off shows no photo, Photo holds the chosen one,
     * Rotate / Live cycle the lot. Prefs.wallpaper is read, never written.
     */
    function photoAt(i) {
        var p = Prefs.get().wallpaper;
        if (p.mode === 'off') return null;
        var list = playlist();
        if (!list.length) return null;
        if (p.mode === 'rotate' || p.mode === 'live') {
            return list[((i % list.length) + list.length) % list.length];
        }
        return Wallpaper.find(p.mode === 'live' ? p.liveKey : p.photo);
    }

    // Continue from whatever is already on Home, so opening the screen saver is not a jump cut.
    function startIndex() {
        var p = Prefs.get().wallpaper;
        var key = p.mode === 'live' ? p.liveKey : p.photo;
        var list = playlist();
        var i = list.findIndex(function (w) { return w.key === key; });
        return i < 0 ? 0 : i;
    }

    // How long one leg lasts: photo interval (or held-photo default), scaled by Drift speed.
    function legMs() {
        var base = rotating() ? photoEvery().ms : HELD_LEG_MS;
        return Math.max(8 * 1000, Math.round(base * panSpeed().factor));
    }

    function zoomLegMs() {
        return Math.max(8 * 1000, Math.round(legMs() * ZOOM_LEG_FACTOR));
    }

    function corner(layer, sign) {
        var d = driftOf(layer);
        return 'translate(' + (sign * d.coverX) + 'px, ' + (sign * d.coverY) + 'px)';
    }

    // sign > 0 = zoomed out (full height); sign < 0 = focus-in.
    // Never nudge vertically — that opened top/bottom gaps where blur leaked through.
    function portraitTransform(layer, sign) {
        var d = driftOf(layer);
        var z = sign > 0 ? 1 : d.zoom;
        var tx = 0;
        if (z > 1) tx = (sign > 0 ? 1 : -1) * (d.containX || 0);
        return 'translate(' + tx + 'px, 0) scale(' + z + ')';
    }

    function sharpEl(layer) {
        return layer.querySelector('.ss-photo-img');
    }

    /*
     * Place a layer at the start of its drift with no animation. The suppression has to be
     * inline rather than a class, because startPan sets `transition` inline and an inline
     * declaration beats a class rule.
     * Contain (live): layer + blur stay fixed. Landscape nudges; portrait focus-zooms.
     */
    function resetPan(layer, sign) {
        var sharp = sharpEl(layer);
        if (!panOn()) {
            layer.style.transition = 'none';
            layer.style.transform = layer.classList.contains('contain') ? 'none' : 'translate(0, 0)';
            if (sharp) {
                sharp.style.transition = 'none';
                sharp.style.transform = 'translate(0, 0)';
                void sharp.offsetWidth;
            } else {
                void layer.offsetWidth;
            }
            return;
        }
        if (layer.classList.contains('contain')) {
            layer.style.transition = 'none';
            layer.style.transform = 'none';
            if (sharp) {
                sharp.style.transition = 'none';
                sharp.style.transform = portraitTransform(layer, sign);
                void sharp.offsetWidth;
            }
            return;
        }
        if (sharp) {
            sharp.style.transition = 'none';
            sharp.style.transform = 'translate(0, 0)';
        }
        layer.style.transition = 'none';
        layer.style.transform = corner(layer, sign);
        // Reading a layout property flushes that, so the transition startPan restores runs from
        // this corner instead of being collapsed into the move away from it.
        void layer.offsetWidth;
    }

    /*
     * The drift is one CSS transition per leg: set once, run by the compositor, no JavaScript
     * per frame. Duration follows Screen saver → photo every (or the held-photo leg), scaled by
     * Drift speed. Drift Off parks the photo centred (no pan / portrait zoom).
     */
    function startPan() {
        var layer = layers[front];
        var sharp = sharpEl(layer);
        if (!panOn()) {
            nextPanAt = 0;
            layer.style.transition = 'opacity ' + FADE_MS + 'ms linear';
            layer.style.transform = layer.classList.contains('contain') ? 'none' : 'translate(0, 0)';
            if (sharp) {
                sharp.style.transition = 'none';
                sharp.style.transform = 'translate(0, 0)';
            }
            return;
        }
        panSign = -panSign;
        nextPanAt = Date.now() + legMs();
        var move = 'transform ' + legMs() + 'ms linear';
        if (layer.classList.contains('contain')) {
            layer.style.transition = 'opacity ' + FADE_MS + 'ms linear';
            layer.style.transform = 'none';
            if (sharp) {
                sharp.style.transition = 'transform ' + zoomLegMs() + 'ms linear';
                sharp.style.transform = portraitTransform(layer, panSign);
            }
            return;
        }
        layer.style.transition = 'opacity ' + FADE_MS + 'ms linear, ' + move;
        layer.style.transform = corner(layer, panSign);
    }

    /*
     * The incoming photo is decoded on the hidden layer before anything fades, so a slow decode
     * cannot show as a flash of empty background. A token abandons a decode that finishes after
     * the next change, or after the screen saver has closed.
     */
    function photoUrls(w) {
        var list = [];
        function add(u) {
            if (u && list.indexOf(u) < 0) list.push(u);
        }
        add(w.file);
        add(w.fileFallback);
        (w.fileFallbacks || []).forEach(add);
        return list;
    }

    /*
     * naturalWidth/Height ignore EXIF rotation; Wikimedia (and many phone JPEGs) store a
     * landscape buffer that displays as portrait with image-orientation: from-image. Measure
     * a hidden oriented <img> so contain+blur matches what the viewer actually sees.
     */
    function orientedSize(url, fallback, done) {
        var probe = document.createElement('img');
        var settled = false;
        var finish = function (w, h) {
            if (settled) return;
            settled = true;
            if (probe.parentNode) probe.parentNode.removeChild(probe);
            if (!w || !h) {
                w = (fallback && fallback.naturalWidth) || 0;
                h = (fallback && fallback.naturalHeight) || 0;
            }
            done(w, h);
        };
        probe.setAttribute('alt', '');
        probe.style.cssText = 'position:fixed;left:0;top:0;margin:0;border:0;padding:0;' +
            'width:auto;height:auto;max-width:none;max-height:none;' +
            'opacity:0;pointer-events:none;image-orientation:from-image;z-index:-1';
        probe.onload = function () {
            document.body.appendChild(probe);
            void probe.offsetWidth;
            finish(probe.offsetWidth, probe.offsetHeight);
        };
        probe.onerror = function () { finish(0, 0); };
        probe.src = url;
        if (probe.complete && probe.naturalWidth) {
            document.body.appendChild(probe);
            void probe.offsetWidth;
            finish(probe.offsetWidth, probe.offsetHeight);
        }
    }

    function showPhoto(w) {
        var token = ++photoToken;
        if (!w) {
            layers[0].style.opacity = '0';
            layers[1].style.opacity = '0';
            nextPanAt = 0;
            return;
        }
        applyTone(w.thumb || w.file, token);
        var swapped = false;
        var urls = photoUrls(w);
        var ui = 0;
        var swap = function (url, ow, oh) {
            if (swapped || token !== photoToken || !open) return;
            swapped = true;
            var back = layers[1 - front];
            var old = layers[front];
            var imgEl = back.querySelector('.ss-photo-img');
            var blurImgs = back.querySelectorAll('.ss-photo-blur');
            // Portrait = taller than wide after EXIF orientation. Full stage height + side
            // pillars (blur fill when On) + focus zoom. Landscape: cover + pan.
            var portrait = !!(ow && oh && oh > ow);
            var contain = portrait;
            var wantBlur = contain && blurOn();
            back._drift = computeDrift(ow, oh, portrait);
            applyLayerPad(back, back._drift, contain);
            back.classList.toggle('contain', contain);
            back.classList.toggle('portrait', portrait);
            back.classList.toggle('landscape', !portrait);
            back.classList.toggle('no-blur', contain && !wantBlur);
            if (portrait) applyPortraitPillars(back, ow, oh);
            else clearPortraitPillars(back);
            if (imgEl) imgEl.src = url;
            else back.style.backgroundImage = 'url("' + url + '")';
            var bi;
            for (bi = 0; bi < blurImgs.length; bi++) {
                (function (blurEl) {
                    // Thumb for blur — full-size + filter:blur is costly on this TV.
                    if (wantBlur) {
                        blurEl.onerror = function () {
                            blurEl.onerror = null;
                            if (blurEl.getAttribute('src') !== url) blurEl.src = url;
                        };
                        blurEl.src = w.thumb || url;
                    } else {
                        blurEl.onerror = null;
                        blurEl.removeAttribute('src');
                    }
                })(blurImgs[bi]);
            }
            // Placed at the corner startPan is about to drift away from, animation suppressed.
            resetPan(back, panSign);
            front = 1 - front;
            // Restores the transition before either property is given a new value, so the
            // crossfade and the drift both animate instead of jumping.
            startPan();
            back.style.opacity = '1';
            old.style.opacity = '0';
        };
        // EXIF re-measure is a second full decode — only needed for Immich / local pins.
        var needOrient = !w.remote || w.source === 'immich';
        var img = new Image();
        img.onload = function () {
            if (!needOrient) {
                swap(urls[ui], img.naturalWidth, img.naturalHeight);
                return;
            }
            orientedSize(urls[ui], img, function (ow, oh) {
                swap(urls[ui], ow, oh);
            });
        };
        img.onerror = function () {
            ui++;
            if (ui < urls.length) {
                img.src = urls[ui];
                return;
            }
            DevLog.log('Screen saver photo failed: ' + w.file);
        };
        img.src = urls[0];
        if (img.complete && img.naturalWidth) {
            if (!needOrient) {
                swap(urls[0], img.naturalWidth, img.naturalHeight);
            } else {
                orientedSize(urls[0], img, function (ow, oh) {
                    swap(urls[0], ow, oh);
                });
            }
        }
    }

    // ---------- Text tone

    // Text is white by default. Where the photo is bright behind the caption, the text switches
    // to dark. The brightness is read from a CORS-enabled copy of the image; a host without CORS
    // headers keeps the white default, and the photo itself is never affected.
    var TONE_W = 64;
    var TONE_H = 36;
    var SCRIM_KEEP = 0.5;        // share of the photo still visible under the caption scrim
    var DARK_TEXT_ABOVE = 0.38;  // relative luminance (after scrim) above which dark text reads better
    var toneCache = {};

    function linear(c) {
        c /= 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }

    function measureTone(url, done) {
        if (toneCache[url]) { done(toneCache[url]); return; }
        var img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = function () {
            var tone = 'white';
            try {
                var c = document.createElement('canvas');
                c.width = TONE_W;
                c.height = TONE_H;
                var ctx = c.getContext('2d');
                ctx.drawImage(img, 0, 0, TONE_W, TONE_H);
                // Bottom-left: where the caption sits.
                var w = Math.round(TONE_W * 0.4);
                var h = Math.round(TONE_H * 0.4);
                var data = ctx.getImageData(0, TONE_H - h, w, h).data;
                var sum = 0;
                for (var i = 0; i < data.length; i += 4) {
                    sum += 0.2126 * linear(data[i]) + 0.7152 * linear(data[i + 1]) + 0.0722 * linear(data[i + 2]);
                }
                var lum = SCRIM_KEEP * sum / (data.length / 4);
                tone = lum > DARK_TEXT_ABOVE ? 'dark' : 'white';
            } catch (e) {
                // Tainted canvas (no CORS on the host): keep the white default.
            }
            toneCache[url] = tone;
            done(tone);
        };
        img.onerror = function () { done('white'); };
        img.src = url;
    }

    function applyTone(url, token) {
        measureTone(url, function (tone) {
            if (token !== photoToken || !open) return;
            $('screensaver').classList.toggle('tone-dark', tone === 'dark');
        });
    }

    // ---------- Text

    // The design asks for "Wed 21 Oct"; Appearance.date is the long form Home uses.
    function shortDate(d) {
        try {
            var text = d.toLocaleDateString(Prefs.get().appearance.locale,
                { weekday: 'short', day: 'numeric', month: 'short' });
            return text.charAt(0).toUpperCase() + text.slice(1);
        } catch (e) {
            return d.toDateString();
        }
    }

    // Called every second, but only writes when the minute turns: repainting the clock text on
    // top of a drifting photo is work the compositor does not need.
    function updateClock() {
        var d = new Date();
        var t = Appearance.time(d);
        var text = t.time + (t.suffix ? ' ' + t.suffix : '');
        if (text === lastClockText) return;
        lastClockText = text;
        $('ss-time').textContent = text;
        $('ss-date').textContent = Prefs.get().appearance.showDate ? shortDate(d) : '';
    }

    function fillLine(el, text, animate) {
        if (!el) return;
        if (window.Music && Music.fillMarquee) Music.fillMarquee(el, text, !!animate);
        else el.textContent = text || '';
    }

    function caption(w) {
        // Title + date/credit from live metadata (title/sub/credit on each wallpaper entry).
        captionText = w ? (w.title || w.credit || '') : '';
        captionSub = '';
        if (w) {
            if (w.sub && w.credit && w.credit !== w.title) captionSub = w.sub + ' · ' + w.credit;
            else captionSub = w.sub || (w.credit && w.credit !== captionText ? w.credit : '') || '';
        }
        // Fixed-width slot + horizontal scroll when the line is longer (does not cover legend).
        fillLine($('ss-title'), captionText, true);
        fillLine($('ss-sub'), captionSub, true);
        $('ss-caption').classList.toggle('hidden', !w || (!captionText && !captionSub));
    }

    // Hidden outright when there is no usable reading: see the note on staleness in weather.js.
    function renderWeather() {
        var w = window.Weather && Weather.current();
        $('ss-clock').classList.toggle('with-weather', !!w);
        $('ss-weather').classList.toggle('hidden', !w);
        if (!w) return;
        $('ss-wx-icon').innerHTML = w.icon;
        $('ss-wx-temp').textContent = w.temp;
        $('ss-wx-detail').textContent = w.detail;
    }

    function musicReady() {
        return !!(window.Music && Music.ready && Music.ready());
    }

    function renderMusic() {
        var el = $('ss-music');
        if (!el) return;
        var show = musicReady();
        el.classList.toggle('hidden', !show);
        if (show) {
            var song = Music.current();
            var sig = song
                ? ('play:' + (song.title || '') + '\0' + (song.artist || song.album || ''))
                : 'idle';
            // Only rebuild marquees when the line text changes (play/pause must not restart scroll).
            // No scroll animation while blacked out — keeps CPU free for audio.
            if (sig !== lastMusicSig) {
                lastMusicSig = sig;
                if (song) {
                    fillLine($('ss-music-title'), song.title, !dark);
                    fillLine($('ss-music-artist'), song.artist || song.album || '', !dark);
                } else {
                    fillLine($('ss-music-title'), 'Not playing', false);
                    fillLine($('ss-music-artist'), '', false);
                }
            }
        } else {
            lastMusicSig = '';
        }
        renderLegend();
    }

    function legendItem(key, label) {
        return '<span class="ss-legend-item"><span class="ss-legend-key">' + key +
            '</span>' + label + '</span>';
    }

    // Small center legend; only the actions that apply right now.
    function renderLegend() {
        var el = $('ss-legend');
        if (!el) return;
        var parts = [];
        if (liveProviderChoices().length > 1) parts.push(legendItem('↑↓', 'Source'));
        if (canAdvance()) parts.push(legendItem('→', 'Photo'));
        if (musicReady()) {
            parts.push(legendItem('←', 'Track'));
            parts.push(legendItem('OK', Music.isPlaying() ? 'Pause' : 'Play'));
        }
        parts.push(legendItem('Back', 'Exit'));
        el.innerHTML = parts.join('');
        el.classList.toggle('hidden', !parts.length);
    }

    /*
     * Live ↑↓ choices:
     * - Configured providers + Mix when Settings has 2+ enabled usable chips.
     * - Mix uses the Settings roster as-is; solo only changes liveProvider.
     * - Photo / Rotate / Off: no source list.
     */
    function liveProviderChoices() {
        if (Prefs.get().wallpaper.mode !== 'live' || !window.LiveWallpaper) return [];
        if (LiveWallpaper.switchableProviders) return LiveWallpaper.switchableProviders();
        return [];
    }

    function providerLabel(key) {
        if (window.LiveWallpaper && LiveWallpaper.providerLabelFor) {
            return LiveWallpaper.providerLabelFor(key);
        }
        return key;
    }

    // Center-screen name only (no toast plate) when ↑↓ changes Live source.
    function flashProvider(name) {
        var el = $('ss-provider');
        if (!el) return;
        el.textContent = name || '';
        el.classList.add('on');
        clearTimeout(providerFlashTimer);
        providerFlashTimer = setTimeout(function () {
            el.classList.remove('on');
        }, 1600);
    }

    function cycleLiveProvider(delta) {
        var choices = liveProviderChoices();
        if (choices.length < 2 || advancing) return false;
        if (!LiveWallpaper.selectLiveProvider) return false;
        var cur = Prefs.get().wallpaper.liveProvider || choices[0];
        var i = choices.indexOf(cur);
        if (i < 0) i = 0;
        var next = choices[(i + delta + choices.length * 8) % choices.length];
        if (next === cur) return false;
        if (!LiveWallpaper.selectLiveProvider(next)) return false;
        flashProvider(providerLabel(next));
        renderLegend();
        advancing = true;
        LiveWallpaper.takeNext().then(function (w) {
            advancing = false;
            if (!open) return;
            if (w) applyPhoto(w);
            else if (LiveWallpaper.needsSetup && LiveWallpaper.needsSetup()) {
                UI.toast(LiveWallpaper.status());
            }
        }, function () {
            advancing = false;
        });
        return true;
    }

    // ---------- Open, tick, close

    function openSaver() {
        if (open) return;
        returnTo = UI.current() || 'home';
        open = true;
        dark = false;
        front = 0;
        photoIndex = startIndex();
        panSign = 1;
        lastClockText = '';
        layers[0].style.opacity = '0';
        layers[1].style.opacity = '0';
        resetPan(layers[0], panSign);
        resetPan(layers[1], panSign);
        var rootOpen = $('screensaver');
        if (rootOpen) rootOpen.classList.remove('is-dark');
        var veilOpen = $('ss-dark');
        if (veilOpen) veilOpen.style.opacity = '0';

        var now = Date.now();
        openedAt = now;
        nextPhotoAt = now + photoEvery().ms;
        nextPanAt = 0;

        UI.show('screensaver');
        showChrome();
        updateClock();
        // Shows the cached reading at once, and asks for a new one only if the hour is up.
        renderWeather();
        renderMusic();
        renderLegend();
        if (window.Weather) Weather.refresh();
        var w = photoAt(photoIndex);
        shownKey = (w && w.key) || '';
        caption(w);
        showPhoto(w);
        DevLog.log('Screen saver on');
    }

    function showChrome() {
        chromeHidden = false;
        lastChromeAt = Date.now();
        var root = $('screensaver');
        if (root) root.classList.remove('chrome-off');
    }

    function hideChrome() {
        if (!open || dark || chromeHidden) return;
        chromeHidden = true;
        var root = $('screensaver');
        if (root) root.classList.add('chrome-off');
    }

    function touchChrome() {
        if (chromeHidden) return;
        lastChromeAt = Date.now();
    }

    // Park drift under the black layer — ongoing CSS transforms fight the audio decoder on this SoC.
    function freezePan() {
        nextPanAt = 0;
        if (!layers || !layers.length) return;
        layers.forEach(function (layer) {
            if (!layer) return;
            var sharp = sharpEl(layer);
            var lt = window.getComputedStyle(layer).transform;
            layer.style.transition = 'none';
            if (lt && lt !== 'none') layer.style.transform = lt;
            if (sharp) {
                var st = window.getComputedStyle(sharp).transform;
                sharp.style.transition = 'none';
                if (st && st !== 'none') sharp.style.transform = st;
            }
        });
    }

    function goDark() {
        if (dark) return;
        dark = true;
        hideChrome();
        freezePan();
        var root = $('screensaver');
        if (root) root.classList.add('is-dark');
        var veil = $('ss-dark');
        if (veil) veil.style.opacity = '1';
        DevLog.log('Screen saver dark after ' + darkAfter().label);
    }

    // Returns true when this call cleared the black screen.
    function wakeFromDark() {
        if (!dark) return false;
        dark = false;
        // Restart the go-dark clock — otherwise the next tick blacks out again immediately.
        openedAt = Date.now();
        var root = $('screensaver');
        if (root) root.classList.remove('is-dark');
        var veil = $('ss-dark');
        if (veil) veil.style.opacity = '0';
        showChrome();
        // Resume drift on the visible layer without fetching a new photo.
        if (layers && layers[front]) {
            resetPan(layers[front], panSign);
            startPan();
        }
        return true;
    }

    function applyPhoto(w) {
        if (!open || !w) return;
        var list = playlist();
        var ni = list.findIndex(function (x) { return x.key === w.key; });
        photoIndex = ni < 0 ? photoIndex : ni;
        shownKey = w.key || '';
        caption(w);
        showPhoto(w);
        // After the crossfade — do not compete with the current decode on this SoC.
        setTimeout(function () {
            if (open && Wallpaper.preloadAhead) Wallpaper.preloadAhead();
        }, 800);
    }

    // Immich (and similar) polish place/title after paint; refresh only the caption in place.
    function refreshCaptionIfShown() {
        if (!open || !shownKey) return;
        var w = Wallpaper.find(shownKey);
        if (w) caption(w);
    }

    // Timer and remote Right both land here so the interval resets after a manual skip.
    function advancePhoto(fromRemote) {
        if (advancing) return false;
        if (!(fromRemote ? canAdvance() : rotating())) return false;
        nextPhotoAt = Date.now() + photoEvery().ms;
        // Live/Mix: always takeNext (timer and Right) so we never cycle shipped bundled stills.
        if (Prefs.get().wallpaper.mode === 'live' && window.LiveWallpaper) {
            advancing = true;
            LiveWallpaper.takeNext().then(function (w) {
                advancing = false;
                if (!open) return;
                if (!w) {
                    // playlist() is already scoped to the current Live focus (solo vs Mix).
                    var hist = playlist();
                    if (!hist.length) return;
                    var cur = photoAt(photoIndex);
                    w = hist.length > 1
                        ? Wallpaper.pickNext(hist, cur && cur.key, false)
                        : hist[0];
                    if (!w || (cur && w.key === cur.key && hist.length < 2)) return;
                }
                applyPhoto(w);
            }, function () { advancing = false; });
            return true;
        }
        if (Prefs.get().wallpaper.mode !== 'rotate') return false;
        var list = playlist();
        if (list.length < 2) return false;
        var cur = photoAt(photoIndex);
        var next = Wallpaper.pickNext(list, cur && cur.key, !!Prefs.get().wallpaper.random);
        var ni = next ? list.findIndex(function (x) { return x.key === next.key; }) : -1;
        photoIndex = ni < 0 ? photoIndex + 1 : ni;
        applyPhoto(next || photoAt(photoIndex));
        return true;
    }

    function tick() {
        var now = Date.now();
        updateClock();
        var until = darkAfter().ms;
        if (!dark && until && now - openedAt >= until) goDark();
        // Behind an opaque black layer there is nothing worth moving.
        if (dark) return;
        var hideAfter = chromeHide().ms;
        if (hideAfter && !chromeHidden && now - lastChromeAt >= hideAfter) hideChrome();
        if (rotating() && now >= nextPhotoAt) {
            advancePhoto();
        } else if (nextPanAt && now >= nextPanAt) {
            // A held photo has reached the far corner; send it back the other way.
            startPan();
        }
    }

    function close() {
        if (!open) return;
        open = false;
        advancing = false;
        chromeHidden = false;
        dark = false;
        shownKey = '';
        lastInput = Date.now();
        photoToken++;
        clearTimeout(providerFlashTimer);
        captionSub = '';
        lastMusicSig = '';
        var root = $('screensaver');
        if (root) root.classList.remove('chrome-off', 'is-dark');
        var veil = $('ss-dark');
        if (veil) veil.style.opacity = '0';
        var flash = $('ss-provider');
        if (flash) {
            flash.classList.remove('on');
            flash.textContent = '';
        }
        // Dropping the images releases full-screen textures on a 2 GB device.
        layers.forEach(function (l) {
            l.style.opacity = '0';
            l.style.backgroundImage = '';
            l.classList.remove('contain', 'portrait', 'landscape', 'no-blur');
            l._drift = null;
            applyLayerPad(l, FALLBACK_DRIFT, true);
            clearPortraitPillars(l);
            var imgEl = l.querySelector('.ss-photo-img');
            if (imgEl) imgEl.removeAttribute('src');
            var blurImgs = l.querySelectorAll('.ss-photo-blur');
            var bi;
            for (bi = 0; bi < blurImgs.length; bi++) {
                blurImgs[bi].onerror = null;
                blurImgs[bi].removeAttribute('src');
            }
        });
        UI.show(returnTo, { back: true });
    }

    // Never over a console input or another screen, and never while the app is in the background.
    function eligible() {
        return prefs().enabled && UI.isVisible('home') && !document.hidden &&
            !(window.Home && Home.tvMode());
    }

    /*
     * One poll for everything. The dismissing key is swallowed by the view's onKey below, so it
     * only closes the screen saver; this listener exists to notice input while it is closed.
     */
    document.addEventListener('keydown', function () {
        if (!open) lastInput = Date.now();
    });

    document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
            if (open) close();
            return;
        }
        // Coming back from another app is not idle time: JavaScript was paused, not waiting.
        lastInput = Date.now();
    });

    function init() {
        layers = [$('ss-photo-a'), $('ss-photo-b')];
        // A reading that lands mid-session should appear without waiting for the next photo.
        if (window.Weather) {
            Weather.onUpdate(function () {
                if (open) renderWeather();
            });
        }
        if (window.Music) {
            Music.onUpdate(function () {
                if (open) renderMusic();
            });
        }
        if (window.LiveWallpaper && LiveWallpaper.onChange) {
            LiveWallpaper.onChange(refreshCaptionIfShown);
        }
        UI.register('screensaver', {
            el: $('screensaver'),
            hints: [],
            rows: function () { return []; },
            onKey: function (k) {
                // Black screen: wake only. Chrome hidden: show writings only.
                if (dark) {
                    wakeFromDark();
                    return true;
                }
                if (chromeHidden) {
                    showChrome();
                    return true;
                }
                touchChrome();
                if (k === UI.KEY.UP && cycleLiveProvider(-1)) return true;
                if (k === UI.KEY.DOWN && cycleLiveProvider(1)) return true;
                if (k === UI.KEY.RIGHT && canAdvance()) {
                    advancePhoto(true);
                    return true;
                }
                if (k === UI.KEY.LEFT && musicReady()) {
                    Music.next();
                    return true;
                }
                if (k === UI.KEY.ENTER && musicReady()) {
                    Music.toggle();
                    return true;
                }
                // Unused arrows / OK stay on the saver; other keys exit.
                if (k === UI.KEY.UP || k === UI.KEY.DOWN ||
                        k === UI.KEY.LEFT || k === UI.KEY.RIGHT ||
                        k === UI.KEY.ENTER) {
                    return true;
                }
                close();
                return true;
            },
            onBack: function () {
                if (dark) {
                    wakeFromDark();
                    return true;
                }
                if (chromeHidden) {
                    showChrome();
                    return true;
                }
                close();
                return true;
            }
        });
        setInterval(function () {
            if (open) {
                tick();
                return;
            }
            if (eligible() && Date.now() - lastInput >= delay().ms) openSaver();
        }, POLL_MS);
    }

    window.Screensaver = {
        DELAYS: DELAYS,
        PHOTO_EVERY: PHOTO_EVERY,
        DARK_AFTER: DARK_AFTER,
        CHROME_HIDE: CHROME_HIDE,
        PAN_SPEEDS: PAN_SPEEDS,
        delay: delay,
        photoEvery: photoEvery,
        darkAfter: darkAfter,
        chromeHide: chromeHide,
        init: init,
        open: openSaver,
        close: close,
        isOpen: function () { return open; },
        // Settings should not leave a countdown that started before the change.
        poke: function () { lastInput = Date.now(); }
    };
})();
