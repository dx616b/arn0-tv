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
 * Caption, music, and legend (tap / hold) fade out after idle; the clock stays on.
 * While chrome is off, a new photo peeks its caption and a new track/station peeks
 * now-playing for a short flash (not the full Hide-text wait), then fade again. The clock
 * drifts horizontally with the photo (no vertical) for burn-in; when chrome returns it
 * snaps home. The next key shows chrome again without changing photo or track.
 *
 * Adapted from a design mockup rather than ported from it. The mockup's backdrop was nine
 * radial-gradients over a linear-gradient — the exact shape the Lab render probe measured at
 * 4.6 fps with 88 of 90 frames dropped (see the header of css/style.css). Here a photo fills
 * that role, the one gradient left is static and painted once, and everything that moves does
 * so through `transform` and `opacity`, which the compositor animates with no JavaScript per
 * frame. The poll below ticks once a second and only decides what is due.
 *
 * Burn-in is why the photo drifts (and eventually fades to black). With chrome visible the
 * clock stays put in its rectangle; with chrome off it shares the photo’s horizontal pan.
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

    // Caption / music / legend idle fade (clock stays).
    var CHROME_HIDE = [
        { key: '10s', label: '10 s', ms: 10 * 1000 },
        { key: '20s', label: '20 s', ms: 20 * 1000 },
        { key: '30s', label: '30 s', ms: 30 * 1000 },
        { key: '1m', label: '1 min', ms: 60 * 1000 },
        { key: 'never', label: 'Never', ms: 0 }
    ];

    // Photo / music peeks while chrome is off — short flash, capped by Hide text.
    var PEEK_MS = 10 * 1000;

    /*
     * The photo drifts rather than zooms. A zoom changes the layer's raster scale, and this
     * engine re-rasterises a scaled 1920x1080 layer in visible steps instead of compositing it
     * smoothly. A translate leaves the raster alone. Drift distance is derived from each photo's
     * size vs the 1920×1080 stage; only speed is user-tunable.
     */
    var VIEW_W = PanMath.VIEW_W;
    var VIEW_H = PanMath.VIEW_H;
    var PAN_SPEEDS = [
        { key: 'slow', label: 'Slow', factor: 1.7 },
        { key: 'normal', label: 'Normal', factor: 1 },
        { key: 'fast', label: 'Fast', factor: 0.5 }
    ];
    // Portrait zoom legs run slower than landscape pan (factor > 1).
    var ZOOM_LEG_FACTOR = 1.6;
    var HELD_LEG_MS = 90 * 1000;    // one leg of the drift when a single photo is held
    var FADE_MS = 2000;             // crossfade, also set as the default in the stylesheet
    var POLL_MS = 1000;
    var FALLBACK_DRIFT = PanMath.FALLBACK_DRIFT;

    var open = false;
    var returnTo = 'home';
    var lastInput = Date.now();
    var layers = [];
    var front = 0;              // which of the two photo layers is showing
    var failStreak = 0;        // photos in a row that would not load; stops a run of bad ones
    var photoToken = 0;
    var photoIndex = 0;
    var openedAt = 0;
    var nextPhotoAt = 0;
    var captionText = '';
    var nextPanAt = 0;
    var panSign = 1;            // flipped on each leg, so the drift alternates direction
    var lastClockText = '';
    var dark = false;
    var chromeHidden = false;   // caption/music/legend faded; clock stays; next key reveals chrome
    var lastChromeAt = 0;       // last time chrome was shown or touched
    var captionPeekTimer = 0;   // brief description-only reveal while chrome-off
    var musicPeekTimer = 0;     // brief now-playing reveal on song/station change
    var advancing = false;      // one in-flight live takeNext (timer or remote)
    var shownKey = '';          // live polish may update caption after the photo is up
    var providerFlashTimer = 0;
    var captionSub = '';
    var lastMusicSig = '';
    var lastMusicLine = '';

    function prefs() { return Prefs.get().screensaver; }

    function panOn() { return prefs().pan !== false; }

    function blurOn() { return prefs().blur !== false; }

    function durationLabel(ms) {
        if (ms % (60 * 60 * 1000) === 0) {
            var hours = ms / (60 * 60 * 1000);
            return hours + (hours === 1 ? ' hour' : ' hours');
        }
        if (ms % (60 * 1000) === 0) return (ms / (60 * 1000)) + ' min';
        return Math.round(ms / 1000) + ' s';
    }

    function option(list, key, fallback) {
        var found = list.find(function (o) { return o.key === key; });
        if (found) return found;
        var custom = String(key || '').match(/^custom:(\d+)$/);
        if (custom && Number(custom[1]) > 0) {
            var ms = Number(custom[1]);
            return { key: key, label: durationLabel(ms), ms: ms };
        }
        return list.find(function (o) { return o.key === fallback; });
    }

    function delay() { return option(DELAYS, prefs().delay, '5m'); }
    function photoEvery() { return option(PHOTO_EVERY, prefs().photoEvery, '75s'); }
    function darkAfter() { return option(DARK_AFTER, prefs().dark, '15m'); }
    function chromeHide() { return option(CHROME_HIDE, prefs().chromeHide, '20s'); }

    // Peek shorter than Hide text when that wait is long; never longer than Hide text.
    function peekMs() {
        var hide = chromeHide().ms;
        if (!hide) return PEEK_MS;
        return Math.min(PEEK_MS, hide);
    }
    function panSpeed() { return option(PAN_SPEEDS, prefs().panSpeed, 'normal'); }

    function driftOf(layer) {
        return (layer && layer._drift) || FALLBACK_DRIFT;
    }

    var computeDrift = PanMath.computeDrift;

    function applyLayerPad(layer, drift, contain) {
        if (contain) {
            layer.style.top = '';
            layer.style.left = '';
            layer.style.width = '';
            layer.style.height = '';
            return;
        }
        var padX = drift.padX || 96;
        var padY = drift.padY || 54;
        layer.style.top = (-padY) + 'px';
        layer.style.left = (-padX) + 'px';
        layer.style.width = (VIEW_W + 2 * padX) + 'px';
        layer.style.height = (VIEW_H + 2 * padY) + 'px';
    }

    // ---------- Photos

    function rotating() {
        var p = Prefs.get().wallpaper;
        if (p.mode === 'live') {
            // Photos rotate only when Rotate is On; other Live providers always rotate.
            return !!window.LiveWallpaper && (p.liveProvider !== 'photos' || p.rotateOn === true);
        }
        return p.mode === 'rotate' && Wallpaper.list().length > 1;
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
     * Shared picture stream (Background mode / liveKey / photo). Saver owns pan presentation.
     * On exit the leg is frozen at its exact pose (see pose()/legU()) and kept for the same key;
     * reopening that key continues the same leg with the remaining time.
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

    /*
     * Every pose is one number u in [-1, 1]: landscape moves from corner(-1) to corner(+1);
     * portrait goes from focus-in (-1) to zoomed out (+1). The timing is linear, so a pose at
     * any moment is a plain lerp and can be written back without reading computed styles.
     * Portrait never nudges vertically — that opened top/bottom gaps where blur leaked through.
     */
    function pose(layer, u) {
        return PanMath.poseTransform(driftOf(layer), layer.classList.contains('contain'), u);
    }

    function sharpEl(layer) {
        return layer.querySelector('.ss-photo-img');
    }

    // Writes a pose with no transition. Landscape moves the layer, portrait moves the sharp img.
    function applyPose(layer, u) {
        var sharp = sharpEl(layer);
        layer.style.transition = 'none';
        if (layer.classList.contains('contain')) {
            layer.style.transform = 'none';
            if (sharp) {
                sharp.style.transition = 'none';
                sharp.style.transform = pose(layer, u);
            }
        } else {
            if (sharp) {
                sharp.style.transition = 'none';
                sharp.style.transform = 'translate3d(0,0,0)';
            }
            layer.style.transform = pose(layer, u);
        }
        void layer.offsetWidth;
    }

    // Where the layer is right now along its leg; the leg itself is the only source of truth.
    var legU = PanMath.legU;

    /*
     * Place a layer at the start of its drift with no animation. The suppression has to be
     * inline rather than a class, because startPan sets `transition` inline and an inline
     * declaration beats a class rule.
     * Contain (live): layer + blur stay fixed. Landscape nudges; portrait focus-zooms.
     */
    function resetPan(layer, sign) {
        var sharp = sharpEl(layer);
        layer._leg = null;
        layer._frozen = null;
        if (!panOn()) {
            layer.style.transition = 'none';
            layer.style.transform = layer.classList.contains('contain') ? 'none' : 'translate3d(0,0,0)';
            if (sharp) {
                sharp.style.transition = 'none';
                sharp.style.transform = 'translate3d(0,0,0)';
                void sharp.offsetWidth;
            } else {
                void layer.offsetWidth;
            }
            return;
        }
        applyPose(layer, sign);
    }

    /*
     * The drift is one CSS transition per leg: set once, run by the compositor, no JavaScript
     * per frame. Duration follows Screen saver → photo every (or the held-photo leg), scaled by
     * Drift speed. Drift Off parks the photo centred (no pan / portrait zoom).
     */
    function startPan() {
        if (!panOn() || paused) {
            nextPanAt = 0;
            var layer0 = layers[front];
            var sharp0 = sharpEl(layer0);
            layer0.style.transition = 'opacity ' + FADE_MS + 'ms linear';
            layer0.style.transform = layer0.classList.contains('contain') ? 'none' : 'translate3d(0,0,0)';
            if (sharp0) {
                sharp0.style.transition = 'none';
                sharp0.style.transform = 'translate3d(0,0,0)';
            }
            syncClockDrift();
            return;
        }
        var from = currentU();
        panSign = -panSign;
        runPanLeg(legMs(), from);
    }

    // Where the front layer is now: mid-leg if a leg is running, otherwise the corner it rests at.
    function currentU() {
        var layer = layers[front];
        if (layer && layer._leg) return legU(layer._leg, Date.now());
        return panSign;
    }

    // Follow the photo's travel speed, stopping at the clock's smaller boundary.
    var CLOCK_DRIFT_MAX = 24;
    function clockXAt(layer, u) {
        if (!layer) return 0;
        var d = driftOf(layer);
        var x = layer.classList.contains('contain')
            ? -(1 - u) / 2 * (d.containX || 0)
            : u * (d.coverX || 0);
        return Math.round(Math.max(-CLOCK_DRIFT_MAX, Math.min(CLOCK_DRIFT_MAX, x)));
    }

    // Each new leg starts at the clock's actual boundary/pose. Travel at the photo's speed,
    // then hold; no per-frame JS or delayed catch-up when the photo reverses.
    function clockTravelMs(layer, fromU, toU, fromX, toX, legMs) {
        var d = driftOf(layer);
        var travel = Math.abs(toU - fromU) * Math.abs(layer.classList.contains('contain')
            ? (d.containX || 0) / 2
            : (d.coverX || 0));
        if (!travel) return 0;
        return Math.round(legMs * Math.min(1, Math.abs(toX - fromX) / travel));
    }

    var clockLeg = null;

    function clockPosition() {
        if (!clockLeg) return null;
        var t = clockLeg.dur > 0
            ? Math.max(0, Math.min(1, (Date.now() - clockLeg.start) / clockLeg.dur))
            : 1;
        return clockLeg.from + (clockLeg.to - clockLeg.from) * t;
    }

    function clockHome() {
        clockLeg = null;
        var el = $('ss-clock');
        if (!el) return;
        var transform = el.style.transform;
        if (el.style.transition === 'none' &&
                (transform === 'translate3d(0px, 0px, 0px)' || transform === 'translate3d(0,0,0)')) return;
        el.style.transition = 'none';
        el.style.transform = 'translate3d(0,0,0)';
        // No flush needed until a new animated leg is started by syncClockDrift.
    }

    /*
     * Chrome visible / pan off / dark: clock parked at 0.
     * Chrome off: clock X follows photo pose u (and optionally animates to `toU`).
     */
    function syncClockDrift(opts) {
        opts = opts || {};
        var el = $('ss-clock');
        if (!el) return;
        if (!open || !chromeHidden || !panOn() || dark) {
            clockHome();
            return;
        }
        var layer = layers && layers[front];
        if (!layer) {
            clockHome();
            return;
        }
        var fromU = opts.fromU;
        var toU = opts.toU != null ? opts.toU : currentU();
        var anim = opts.animMs || 0;
        var currentX = clockPosition();
        if (anim > 0 && fromU != null) {
            var fromX = currentX != null ? currentX : clockXAt(layer, fromU);
            var toX = clockXAt(layer, toU);
            var travelMs = clockTravelMs(layer, fromU, toU, fromX, toX, anim);
            el.style.transition = 'none';
            el.style.transform = 'translate3d(' + fromX + 'px,0,0)';
            void el.offsetWidth;
            el.style.transition = travelMs > 0 ? 'transform ' + travelMs + 'ms linear' : 'none';
            el.style.transform = 'translate3d(' + toX + 'px,0,0)';
            clockLeg = { from: fromX, to: toX, start: Date.now(), dur: travelMs };
            return;
        }
        var parkedX = currentX != null ? currentX : clockXAt(layer, toU);
        el.style.transition = 'none';
        el.style.transform = 'translate3d(' + parkedX + 'px,0,0)';
        clockLeg = { from: parkedX, to: parkedX, start: Date.now(), dur: 0 };
    }

    // Animate from fromU toward the corner/zoom for panSign. flipMs is when the next leg
    // starts; animMs is how long this leg's transition runs (portrait zoom runs longer).
    function runPanLeg(flipMs, fromU, animMs) {
        var layer = layers[front];
        var sharp = sharpEl(layer);
        if (!panOn() || !layer) {
            nextPanAt = 0;
            syncClockDrift();
            return;
        }
        var now = Date.now();
        var contain = layer.classList.contains('contain');
        var flip = Math.max(800, flipMs || legMs());
        // Slow portrait zoom: stretch the schedule unless resume passed an explicit anim.
        if (contain && animMs == null) flip = Math.round(flip * ZOOM_LEG_FACTOR);
        nextPanAt = now + flip;
        var anim = Math.max(800, animMs != null ? animMs : flip);
        layer._leg = { from: fromU, to: panSign, start: now, dur: anim };
        // Opacity and transform on separate transitions — combining them on Tizen caused scan lines.
        if (contain) {
            layer.style.transition = 'opacity ' + FADE_MS + 'ms linear';
            layer.style.transform = 'none';
            if (sharp) {
                // Pin the start pose, then transition — otherwise some Tizen builds skip the zoom.
                sharp.style.transition = 'none';
                sharp.style.transform = pose(layer, fromU);
                void sharp.offsetWidth;
                sharp.style.transition = 'transform ' + anim + 'ms linear';
                sharp.style.transform = pose(layer, panSign);
            }
            syncClockDrift({ fromU: fromU, toU: panSign, animMs: anim });
            return;
        }
        layer.style.transition = 'transform ' + anim + 'ms linear';
        layer.style.transform = pose(layer, panSign);
        syncClockDrift({ fromU: fromU, toU: panSign, animMs: anim });
    }

    // Logical mid-leg pose for the current photo (same key → restore + continue).
    var panResume = null;

    function clearPanResume() { panResume = null; }

    // After freezePan(): the frozen leg is already in animator terms, so just keep it.
    function capturePanResume(key) {
        clearPanResume();
        if (!key || !panOn() || !layers || !layers.length) return;
        var layer = layers[front];
        var fz = layer && layer._frozen;
        if (!fz) return;
        panResume = {
            key: key,
            u: fz.u,
            toU: fz.toU,
            flipIn: fz.flipIn,
            animIn: fz.animIn,
            portrait: layer.classList.contains('contain')
        };
    }

    // Lets a frozen leg carry on from where it stopped; a leg that already ended starts the next.
    function continueFrozen(layer, fz) {
        applyPose(layer, fz.u);
        panSign = fz.toU;
        if (fz.flipIn > 0) runPanLeg(fz.flipIn, fz.u, fz.animIn);
        else startPan();
    }

    // Same photo after Home: continue the frozen leg rather than resetting to a corner.
    function resumePanFromFreeze(resume) {
        if (!resume || !panOn()) return false;
        var layer = layers[front];
        if (!layer) return false;
        if (layer.classList.contains('contain') !== resume.portrait) return false;
        continueFrozen(layer, resume);
        return true;
    }


    /*
     * The incoming photo is decoded on the hidden layer before anything fades, so a slow decode
     * cannot show as a flash of empty background. A token abandons a decode that finishes after
     * the next change, or after the screen saver has closed.
     */
    var photoUrls = PhotoUtil.photoUrls;
    var orientedSize = PhotoUtil.orientedSize;

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
            failStreak = 0;
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
            back._leg = null;
            back._frozen = null;
            applyLayerPad(back, back._drift, contain);
            back.classList.toggle('contain', contain);
            back.classList.toggle('portrait', portrait);
            back.classList.toggle('landscape', !portrait);
            back.classList.toggle('no-blur', contain && !wantBlur);
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
            var resume = (panResume && w.key && panResume.key === w.key) ? panResume : null;
            if (resume) clearPanResume();
            front = 1 - front;
            if (!(resume && resumePanFromFreeze(resume))) {
                // Placed at the corner startPan is about to drift away from, animation suppressed.
                resetPan(back, panSign);
                // Restores the transition before either property is given a new value, so the
                // crossfade and the drift both animate instead of jumping.
                startPan();
            }
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
            DevLog.log('Screen saver photo failed: ' + urls.join(' | '));
            if (window.LiveHistory) LiveHistory.markFailed(w);
            // Show the next photo rather than a black screen (give up after a run of failures).
            failStreak++;
            if (failStreak <= 5) advancePhoto(true);
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
        var text = t.time + '|' + (t.suffix || '') + '|' + (Prefs.get().appearance.showDate ? '1' : '0');
        if (text === lastClockText) return;
        lastClockText = text;
        var main = $('ss-time-main');
        var suffix = $('ss-time-suffix');
        if (main) main.textContent = t.time;
        else $('ss-time').textContent = t.time + (t.suffix ? ' ' + t.suffix : '');
        if (suffix) {
            suffix.textContent = t.suffix || '';
            suffix.classList.toggle('hidden', !t.suffix);
        }
        $('ss-date').textContent = Prefs.get().appearance.showDate ? shortDate(d) : '';
        renderClockWeather();
    }

    function fillLine(el, text, animate, loop, force) {
        if (!el) return;
        if (window.Music && Music.fillMarquee) {
            Music.fillMarquee(el, text, !!animate, { loop: !!loop, force: !!force });
        } else {
            el.textContent = text || '';
        }
    }

    // Clean caption text; keep full length — fillLine marquees overflow (no ellipsis).
    function cleanCaption(text) {
        return String(text || '').replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
    }

    // "Provider - detail" on one line; either side alone if the other is empty.
    function metaLine(provider, detail) {
        provider = String(provider || '').trim();
        detail = String(detail || '').trim();
        if (provider && detail) return provider + ' - ' + detail;
        return provider || detail;
    }

    // Prefer the photo’s own source (Bing / NASA / …) so Mix captions are not “Mix - …”.
    function captionProvider(w) {
        if (w && w.source && w.source !== 'mix') return sourceLabel(w.source);
        return pictureMenuLabel();
    }

    function caption(w) {
        var detail = w ? cleanCaption(w.title || w.credit || '') : '';
        captionText = metaLine(captionProvider(w), detail);
        captionSub = w ? String(w.sub || '').replace(/\s+/g, ' ').trim() : '';
        // Keep provider details on a second marquee line; Hide text cuts both off together.
        fillLine($('ss-title'), captionText, true, true);
        fillLine($('ss-sub'), captionSub, !!captionSub, !!captionSub);
        $('ss-caption').classList.toggle('has-sub', !!captionSub);
        $('ss-caption').classList.toggle('hidden', !captionText && !captionSub);
    }

    // Weather icon sits after the date under the clock (top strip stays unused).
    function renderWeatherTop() {
        var top = $('ss-weather-top');
        if (top) {
            top.classList.add('hidden');
            top.innerHTML = '';
        }
        renderClockWeather();
    }

    function renderClockWeather() {
        var row = $('ss-date-wx');
        var icon = $('ss-wx-icon');
        var temp = $('ss-wx-temp');
        if (!row || !icon) return;
        var w = window.Weather && Weather.current();
        if (!w || !w.icon) {
            row.classList.add('hidden');
            icon.innerHTML = '';
            if (temp) temp.textContent = '';
            return;
        }
        icon.innerHTML = w.icon;
        if (temp) temp.textContent = w.temp || '';
        row.classList.remove('hidden');
    }

    function musicReady() {
        return !!(window.Music && Music.ready && Music.ready());
    }

    function renderMusic(force) {
        // Music.onUpdate may pass state; only an explicit true requests a restart.
        force = force === true;
        var el = $('ss-music');
        if (!el) return;
        var show = musicReady();
        el.classList.toggle('hidden', !show);
        if (show) {
            var song = Music.current();
            var provider = Music.providerLabel ? Music.providerLabel() : '';
            // Full line: provider - station, or provider - track · artist.
            var detail = '';
            if (Music.isRadio && Music.isRadio()) {
                detail = (Music.sourceLabel && Music.sourceLabel()) || (song && song.title) || '';
            } else if (song) {
                detail = song.title || '';
                if (song.artist) detail = detail ? (detail + ' · ' + song.artist) : song.artist;
            } else {
                detail = 'Not playing';
            }
            var line = metaLine(provider, detail);
            var sig = 'play:' + line + (dark ? '|dark' : '');
            // Rebuild when text or dark state changes. Loop on screensaver so the full
            // line keeps rotating in the fixed side column.
            if (force || sig !== lastMusicSig) {
                var lineChanged = line !== lastMusicLine;
                lastMusicSig = sig;
                lastMusicLine = line;
                fillLine($('ss-music-title'), line, !dark, true, force);
                fillLine($('ss-music-artist'), '', false);
                // Chrome idle-hidden: flash the new track/station like a photo caption peek.
                if (lineChanged && !dark) peekMusic();
            }
        } else {
            lastMusicSig = '';
            lastMusicLine = '';
            clearMusicPeek();
        }
        renderLegend();
    }

    // key + tap label, optional hold after “ / ”.
    function legendItem(key, tap, hold) {
        var label = hold
            ? (tap + '<span class="ss-legend-sep"> / </span>' + hold)
            : tap;
        return '<span class="ss-legend-item"><span class="ss-legend-key">' + key +
            '</span><span class="ss-legend-label">' + label + '</span></span>';
    }

    // Legend centred on screen; tap / hold on the same key.
    function renderLegend() {
        var el = $('ss-legend');
        if (!el) return;
        var parts = [];
        if (canAdvance()) parts.push(legendItem('←→', 'Photo', 'Pictures'));
        if (musicReady()) parts.push(legendItem('↑↓', 'Track', 'Music'));
        parts.push(legendItem('OK', 'Pause', 'Menu'));
        parts.push(legendItem('Back', 'Exit'));
        el.innerHTML = parts.join('');
        el.classList.toggle('hidden', !parts.length);
        var shortcuts = $('ss-shortcuts');
        if (shortcuts) {
            shortcuts.innerHTML = '';
            shortcuts.classList.add('hidden');
        }
    }

    // ---------- Pause, info, picture steps, and the quick menu (OK held)

    var paused = false;
    var pausedLeg = null;
    var musicWasPlaying = false;
    var enterTimer = null;
    var HOLD_MS = 600;
    var shownPhoto = null;
    var menuOpen = false;
    var menuArmed = false;
    var menuIndex = 0;
    var menuItems = [];
    var menuParent = null;
    var menuTimer = null;
    var MENU_IDLE_MS = 20000;

    function togglePause() {
        var now = Date.now();
        if (!paused) {
            var layer = layers && layers[front];
            var leg = layer && layer._leg;
            pausedLeg = leg ? {
                u: legU(leg, now),
                to: leg.to,
                flip: Math.max(0, nextPanAt - now),
                anim: Math.max(0, leg.start + leg.dur - now)
            } : null;
            paused = true;
            freezePan();
        } else {
            paused = false;
            nextPhotoAt = now + photoEvery().ms;
            if (open && !dark) resumePan();
        }
        UI.toast(paused ? 'Paused' : 'Playing');
        DevLog.log('Screen saver ' + (paused ? 'paused' : 'resumed'));
    }

    // OK: pauses or resumes the slideshow and the music together.
    function togglePlay() {
        if (!paused) {
            musicWasPlaying = musicReady() && Music.isPlaying();
            togglePause();
            if (musicWasPlaying) Music.pause();
        } else {
            togglePause();
            if (musicWasPlaying) Music.play();
            musicWasPlaying = false;
        }
    }

    function resumePan() {
        var p = pausedLeg;
        pausedLeg = null;
        if (!p) {
            startPan();
            return;
        }
        panSign = p.to;
        runPanLeg(p.flip, p.u, p.anim);
    }

    // Back and forward follow the list of photos already shown (Wallpaper.list), by position.
    function stepPhoto(delta) {
        var list = playlist();
        var i = list.findIndex(function (x) { return x.key === shownKey; });
        if (i < 0) return false;
        var target = list[i + delta];
        if (!target) return false;
        applyPhoto(target);
        return true;
    }

    function prevPhoto() {
        if (!stepPhoto(-1)) UI.toast('No earlier picture');
    }

    function stepForward() {
        if (stepPhoto(1)) return true;
        return advancePhoto(true);
    }

    // Holding a key opens its list; a quick press does its normal action on release.
    var holdKey = 0;
    var holdFired = false;

    function startHold(key, onHold) {
        if (enterTimer) return;
        holdKey = key;
        holdFired = false;
        enterTimer = setTimeout(function () {
            enterTimer = null;
            holdFired = true;
            onHold();
        }, HOLD_MS);
    }

    function openShortcut(items) {
        menuItems = items;
        menuParent = null;
        menuIndex = 0;
        menuOpen = true;
        menuArmed = false;
        renderMenu();
    }

    function shortPress(key) {
        if (key === UI.KEY.ENTER) togglePlay();
        else if (key === UI.KEY.UP) {
            if (musicReady()) Music.next();
        } else if (key === UI.KEY.RIGHT) {
            if (canAdvance()) stepForward();
        }
    }

    document.addEventListener('keyup', function (e) {
        if (!open) return;
        if (menuOpen) {
            // The key that opened the menu is released: from now on the keys act on the menu.
            menuArmed = true;
            return;
        }
        if (!enterTimer || e.keyCode !== holdKey) return;
        clearTimeout(enterTimer);
        enterTimer = null;
        if (!holdFired) shortPress(holdKey);
    });

    // Current Live provider key, or '' when Background is not Live.
    function sourceNow() {
        var p = Prefs.get().wallpaper;
        return p.mode === 'live' ? (p.liveProvider || '') : '';
    }

    function sourceLabel(key) {
        if (key === 'mix') return 'Mix';
        return LiveWallpaper.providerLabelFor ? LiveWallpaper.providerLabelFor(key) : key;
    }

    // Live provider name, or Background mode when not Live.
    function pictureMenuLabel() {
        var p = Prefs.get().wallpaper;
        if (p.mode === 'live') return sourceLabel(p.liveProvider || '');
        if (p.mode === 'photo') return 'Photo';
        if (p.mode === 'off') return 'Off';
        return '—';
    }

    function setSource(key) {
        var p = Prefs.get().wallpaper;
        if (!window.LiveWallpaper || !LiveWallpaper.selectLiveProvider) return;
        p.mode = 'live';
        Prefs.save();
        if (!LiveWallpaper.selectLiveProvider(key)) {
            UI.toast(sourceLabel(key) + ' is not set up');
            return;
        }
        advancePhoto(true);
    }

    // Live providers (Photos = local pool; Rotate is a separate row when Photos is active).
    function sourceRows() {
        var p = Prefs.get().wallpaper;
        var keys = window.LiveWallpaper && LiveWallpaper.switchableProviders ? LiveWallpaper.switchableProviders() : [];
        var liveKey = sourceNow();
        var rows = keys.map(function (key) {
            return {
                label: (p.mode === 'live' && key === liveKey ? '● ' : '   ') + sourceLabel(key),
                run: function () { setSource(key); }
            };
        });
        rows.push(backRow());
        return rows;
    }

    // A list opened from a hold has nowhere to go back to, so its last row exits the menu.
    function backRow() {
        if (menuParent) return { label: '‹ Back', sub: true, run: backMenu };
        return { label: 'Exit', run: closeMenu };
    }

    function openSourceMenu() {
        menuParent = menuItems;
        menuItems = sourceRows();
        menuIndex = 0;
        renderMenu();
    }

    function backMenu() {
        if (!menuParent) {
            closeMenu();
            return;
        }
        menuItems = menuParent;
        menuParent = null;
        menuIndex = 0;
        renderMenu();
    }

    // Same Music prefs as Settings: Radio (+ Next list) or Navidrome Random / Playlist.
    function musicMenuLabel() {
        var p = Prefs.get().music;
        if (p.source === 'radio') {
            var nav = Music.currentRadioNav();
            var hit = Music.radioNavOptions().filter(function (o) { return o.nav === nav; })[0];
            return hit ? 'Radio · ' + hit.label : 'Radio';
        }
        if (p.source === 'playlist' && p.playlistId) return p.playlistName || 'Playlist';
        return 'Navidrome · Random';
    }

    function menuList() {
        var items = [{
            label: 'Picture source: ' + pictureMenuLabel(),
            sub: true,
            run: openSourceMenu
        }];
        if (sourceNow() === 'photos') {
            items.push(rotateRow());
        } else if (Prefs.get().wallpaper.mode === 'live') {
            items.push({
                label: 'Keep this picture',
                run: function () {
                    var w = shownPhoto;
                    if (!w || !window.Wallpaper || !Wallpaper.pinLive) return;
                    Wallpaper.pinLive(w, true).then(function (ok) {
                        UI.toast(ok ? 'Kept in saved pictures' : 'Could not save this picture');
                    });
                }
            });
        }
        if (window.Music) {
            items.push({
                label: 'Music source: ' + musicMenuLabel(),
                sub: true,
                run: openMusicMenu
            });
            if (Music.isRadio()) items.push(favouriteRow());
        }
        return items;
    }

    function toggleRotate() {
        var p = Prefs.get().wallpaper;
        p.rotateOn = p.rotateOn !== true;
        p.lastChange = Date.now();
        Prefs.save();
    }

    function rotateRow() {
        return {
            label: 'Rotate: ' + (Prefs.get().wallpaper.rotateOn === true ? 'On' : 'Off'),
            toggle: toggleRotate
        };
    }

    function favouriteRow() {
        return {
            label: Music.isCurrentFavourite() ? 'Un-favorite station' : 'Favorite station',
            run: function () {
                var on = Music.favouriteCurrent();
                UI.toast(on === null ? 'Not available for this station'
                    : (on ? 'Added to favourites' : 'Removed from favourites'));
            }
        };
    }

    function musicRows() {
        var rows = [];
        var p = Prefs.get().music;
        var now = Music.currentRadioNav();
        Music.radioNavOptions().forEach(function (o) {
            rows.push({
                label: (p.source === 'radio' && o.nav === now ? '● ' : '   ') + o.label,
                run: function () { Music.selectRadioNav(o.nav); }
            });
        });
        rows.push({
            label: (p.source === 'random' ? '● ' : '   ') + 'Navidrome · Random',
            run: function () { Music.setSource('random'); }
        });
        if (p.playlistId) {
            rows.push({
                label: (p.source === 'playlist' ? '● ' : '   ') + (p.playlistName || 'Playlist'),
                run: function () {
                    var m = Prefs.get().music;
                    if (!m.playlistId) return;
                    Music.setSource('playlist', { id: m.playlistId, name: m.playlistName || 'Playlist' });
                }
            });
        }
        rows.push(backRow());
        return rows;
    }

    function openMusicMenu() {
        menuParent = menuItems;
        menuItems = musicRows();
        menuIndex = 0;
        renderMenu();
    }

    function renderMenu() {
        if (!menuOpen) return;
        // Idle time closes the menu; every menu change restarts the count.
        clearTimeout(menuTimer);
        menuTimer = setTimeout(closeMenu, MENU_IDLE_MS);
        var root = $('screensaver');
        var box = $('ss-menu');
        if (!box && root) {
            box = document.createElement('div');
            box.id = 'ss-menu';
            box.className = 'ss-menu';
            root.appendChild(box);
        }
        if (!box) return;
        box.innerHTML = '';
        menuItems.forEach(function (it, i) {
            var row = document.createElement('div');
            row.className = 'ss-menu-row' + (i === menuIndex ? ' is-focus' : '');
            row.textContent = it.label;
            box.appendChild(row);
        });
        box.style.display = 'block';
    }

    function openMenu() {
        menuItems = menuList();
        menuIndex = 0;
        menuOpen = true;
        menuArmed = false;
        renderMenu();
    }

    function closeMenu() {
        clearTimeout(menuTimer);
        menuTimer = null;
        menuOpen = false;
        menuParent = null;
        menuArmed = false;
        var box = $('ss-menu');
        if (box) box.style.display = 'none';
    }

    // Up/Down move, OK runs the item, Right toggles rows that support it, else Back/Left closes.
    function menuKey(k) {
        // Keys held down to open the menu must not act on it until they are released.
        if (!menuArmed) return true;
        if (k === UI.KEY.UP) menuIndex = (menuIndex - 1 + menuItems.length) % menuItems.length;
        else if (k === UI.KEY.DOWN) menuIndex = (menuIndex + 1) % menuItems.length;
        else if (k === UI.KEY.RIGHT) {
            var row = menuItems[menuIndex];
            if (row && row.toggle) {
                var keep = menuIndex;
                row.toggle();
                menuItems = menuList();
                menuParent = null;
                menuIndex = Math.min(keep, menuItems.length - 1);
                renderMenu();
                return true;
            }
            if (menuParent) backMenu();
            else closeMenu();
            return true;
        }         else if (k === UI.KEY.ENTER) {
            // Held OK repeats while the menu is open must not run an item.
            if (!menuArmed) return true;
            var it = menuItems[menuIndex];
            if (it && it.sub) {
                it.run();
                renderMenu();
                return true;
            }
            // Toggle rows (Rotate): Right flips the value; OK does nothing.
            if (it && it.toggle) return true;
            closeMenu();
            if (it) it.run();
            return true;
        } else {
            if (menuParent) backMenu();
            else closeMenu();
            return true;
        }
        renderMenu();
        return true;
    }

    // ---------- Open, tick, close

    function openSaver() {
        if (open) return;
        returnTo = UI.current() || 'home';
        open = true;
        paused = false;
        pausedLeg = null;
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
        renderMusic();
        renderWeatherTop();
        renderLegend();
        var w = photoAt(photoIndex);
        shownKey = (w && w.key) || '';
        shownPhoto = w || null;
        caption(w);
        showPhoto(w);
        DevLog.log('Screen saver on');
    }

    function clearCaptionPeek() {
        if (captionPeekTimer) clearTimeout(captionPeekTimer);
        captionPeekTimer = 0;
        var root = $('screensaver');
        if (root) root.classList.remove('caption-peek');
    }

    function clearMusicPeek() {
        if (musicPeekTimer) clearTimeout(musicPeekTimer);
        musicPeekTimer = 0;
        var root = $('screensaver');
        if (root) root.classList.remove('music-peek');
    }

    function clearPeeks() {
        clearCaptionPeek();
        clearMusicPeek();
    }

    // While chrome is idle-hidden, briefly show only the picture description (not clock/…).
    function peekCaption() {
        if (!open || dark || !chromeHidden) return;
        if (!captionText && !captionSub) return;
        var root = $('screensaver');
        if (!root) return;
        root.classList.add('caption-peek');
        if (captionPeekTimer) clearTimeout(captionPeekTimer);
        captionPeekTimer = setTimeout(function () {
            captionPeekTimer = 0;
            if (root) root.classList.remove('caption-peek');
        }, peekMs());
    }

    // Same idea for now-playing: flash on song / station change, then fade again.
    function peekMusic() {
        if (!open || dark || !chromeHidden) return;
        if (!musicReady()) return;
        var root = $('screensaver');
        if (!root) return;
        root.classList.add('music-peek');
        if (musicPeekTimer) clearTimeout(musicPeekTimer);
        musicPeekTimer = setTimeout(function () {
            musicPeekTimer = 0;
            if (root) root.classList.remove('music-peek');
        }, peekMs());
    }

    function showChrome() {
        chromeHidden = false;
        lastChromeAt = Date.now();
        clearPeeks();
        var root = $('screensaver');
        if (root) root.classList.remove('chrome-off');
        clockHome();
    }

    function hideChrome() {
        if (!open || dark || chromeHidden) return;
        chromeHidden = true;
        clearPeeks();
        var root = $('screensaver');
        if (root) root.classList.add('chrome-off');
        // Join the in-flight pan leg so the clock tracks the photo from here.
        var layer = layers && layers[front];
        var leg = layer && layer._leg;
        if (leg && panOn()) {
            var now = Date.now();
            var left = Math.max(0, leg.start + leg.dur - now);
            syncClockDrift({
                fromU: legU(leg, now),
                toU: leg.to,
                animMs: left
            });
        } else {
            syncClockDrift();
        }
    }

    function touchChrome() {
        if (chromeHidden) return;
        lastChromeAt = Date.now();
    }

    // Snap the motion now, at the exact pose the leg has reached — no computed-style reads.
    function freezePan() {
        var now = Date.now();
        var flipIn = nextPanAt ? Math.max(0, nextPanAt - now) : 0;
        nextPanAt = 0;
        if (!layers || !layers.length) return;
        layers.forEach(function (layer, i) {
            if (!layer) return;
            var leg = layer._leg;
            if (leg) {
                var u = legU(leg, now);
                applyPose(layer, u);
                if (i === front) {
                    layer._frozen = {
                        u: u,
                        toU: leg.to,
                        flipIn: flipIn,
                        animIn: Math.max(0, leg.start + leg.dur - now)
                    };
                }
                layer._leg = null;
            } else {
                layer.style.transition = 'none';
            }
            // Visible layer stays up; the other stays hidden (no leftover crossfade).
            layer.style.opacity = (i === front) ? '1' : '0';
        });
        syncClockDrift();
    }


    function goDark() {
        if (dark) return;
        dark = true;
        hideChrome();
        clearPeeks();
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
        // A track may be unchanged throughout black mode, so no music update is guaranteed.
        // Explicitly rebuild its marquee after restoring visibility, bypassing text caching.
        renderMusic(true);
        updateClock();
        // Already frozen mid-pose — continue the same leg from here (do not reset to a corner).
        var layer = layers && layers[front];
        var fz = layer && layer._frozen;
        if (layer) layer._frozen = null;
        if (fz) continueFrozen(layer, fz);
        else if (layer) startPan();
        // Long dark stretches can stall ice streams without an Audio error — nudge recovery.
        if (window.Music && Music.kick) Music.kick();
        return true;
    }

    function applyPhoto(w) {
        if (!open || !w) return;
        // A different photo invalidates any frozen mid-leg pose from a prior session.
        if (panResume && w.key && panResume.key !== w.key) clearPanResume();
        var list = playlist();
        var ni = list.findIndex(function (x) { return x.key === w.key; });
        photoIndex = ni < 0 ? photoIndex : ni;
        shownPhoto = w;
        shownKey = w.key || '';
        caption(w);
        showPhoto(w);
        // Description only — do not bring back clock / music / shortcuts.
        if (!dark) peekCaption();
        // After the crossfade — do not compete with the current decode on this SoC.
        setTimeout(function () {
            if (open && Wallpaper.preloadAhead) Wallpaper.preloadAhead();
        }, 800);
    }

    // Immich (and similar) polish place/title after paint; refresh only the caption in place.
    function refreshCaptionIfShown() {
        if (!open || !shownKey) return;
        var w = Wallpaper.find(shownKey);
        if (!w) return;
        caption(w);
        // Polished description arrived — peek caption only if chrome is already idle-hidden.
        if (!dark) peekCaption();
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
        // Behind the black veil, neither text updates nor repeated clock resets are visible.
        if (dark) return;
        var until = darkAfter().ms;
        if (until && now - openedAt >= until) {
            goDark();
            return;
        }
        updateClock();
        var hideAfter = chromeHide().ms;
        if (hideAfter && !chromeHidden && now - lastChromeAt >= hideAfter) hideChrome();
        if (!paused && rotating() && now >= nextPhotoAt) {
            advancePhoto();
        } else if (nextPanAt && now >= nextPanAt) {
            // A held photo has reached the far corner; send it back the other way.
            startPan();
        }
    }

    // Write the last saver frame into the shared picture stream, then paint Home.
    function syncHomeFromSaver(key) {
        if (!key || !window.Prefs || !window.Wallpaper) return;
        var p = Prefs.get().wallpaper;
        if (p.mode === 'off') return;
        var cur = p.mode === 'live' ? p.liveKey : p.photo;
        if (key !== cur) {
            if (p.mode === 'live') p.liveKey = key;
            else if (p.mode === 'rotate' || p.mode === 'photo') p.photo = key;
            p.lastChange = Date.now();
            Prefs.save();
        }
        if (Wallpaper.apply) Wallpaper.apply();
    }

    function close() {
        if (!open) return;
        open = false;
        advancing = false;
        paused = false;
        shownPhoto = null;
        closeMenu();
        if (enterTimer) clearTimeout(enterTimer);
        enterTimer = null;
        chromeHidden = false;
        dark = false;
        clockHome();
        var keepKey = shownKey;
        // Snap mid-leg matrix, then store pose for the next saver open on this key.
        freezePan();
        capturePanResume(keepKey);
        syncHomeFromSaver(keepKey);
        shownKey = '';
        lastInput = Date.now();
        photoToken++;
        clearTimeout(providerFlashTimer);
        clearPeeks();
        captionSub = '';
        lastMusicSig = '';
        lastMusicLine = '';
        var root = $('screensaver');
        if (root) root.classList.remove('chrome-off', 'is-dark', 'caption-peek', 'music-peek');
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
            l._leg = null;
            l._frozen = null;
            applyLayerPad(l, FALLBACK_DRIFT, true);
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

    // Any launcher screen after idle — not while HDMI/TV input is up, or the app is backgrounded.
    function eligible() {
        if (!prefs().enabled || document.hidden) return false;
        if (window.Home && Home.tvMode()) return false;
        var cur = UI.current && UI.current();
        return !!(cur && cur !== 'screensaver');
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
        if (window.Music) {
            Music.onUpdate(function () {
                if (open) renderMusic();
            });
        }
        if (window.Weather) {
            Weather.onUpdate(function () {
                if (open) renderWeatherTop();
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
                if (menuOpen) return menuKey(k);
                touchChrome();
                if (k === UI.KEY.UP) {
                    startHold(k, function () { openShortcut(musicRows()); });
                    return true;
                }
                if (k === UI.KEY.DOWN) {
                    if (musicReady()) Music.prev();
                    return true;
                }
                if (k === UI.KEY.LEFT) {
                    if (canAdvance()) prevPhoto();
                    return true;
                }
                if (k === UI.KEY.RIGHT) {
                    startHold(k, function () { openShortcut(sourceRows()); });
                    return true;
                }
                if (k === UI.KEY.ENTER) {
                    startHold(k, openMenu);
                    return true;
                }
                close();
                return true;
            },
            onBack: function () {
                if (menuOpen) {
                    if (menuParent) backMenu();
                    else closeMenu();
                    return true;
                }
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
