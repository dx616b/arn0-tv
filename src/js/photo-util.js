/*
 * Shared photo helpers for Home (wallpaper.js) and the screen saver.
 */
(function () {
    'use strict';

    // Home is fixed 1920×1080 landscape — shared gate for Use now / Live / Rotate.
    var HOME_MIN_W = 1280;
    var HOME_MIN_H = 720;

    function allowPortrait() {
        try {
            return !!(Prefs.get().wallpaper && Prefs.get().wallpaper.allowPortrait);
        } catch (e) {
            return false;
        }
    }

    function homeFitReason(ow, oh) {
        if (!ow || !oh) return 'unreadable';
        if (!allowPortrait() && oh > ow) return 'portrait';
        if (ow < HOME_MIN_W || oh < HOME_MIN_H) return 'small';
        return '';
    }

    function homeFitMessage(reason) {
        if (reason === 'portrait') return 'Portrait photos are off — enable them in Background';
        if (reason === 'small') return 'Needs at least ' + HOME_MIN_W + '\u00d7' + HOME_MIN_H + ' for Home';
        if (reason === 'unreadable') return 'Could not read photo size';
        return 'Could not use photo';
    }

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
     * a hidden oriented <img> so Home cover-crop / screensaver pillars match what is seen.
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

    // The fields every wallpaper entry carries (pins, temporary photos and live pictures). The
    // caller supplies the title, because each source has its own default for a missing one.
    function entryFields(entry, title) {
        var out = {
            key: entry.key,
            title: title,
            sub: entry.sub || '',
            file: entry.file,
            fileFallback: entry.fileFallback || '',
            fileFallbacks: entry.fileFallbacks || [],
            thumb: entry.thumb || entry.file,
            credit: entry.credit || ''
        };
        // Provider-specific search identity must survive normalization and cache restore.
        if (entry.whCat) out.whCat = entry.whCat;
        if (entry.whTopic) out.whTopic = entry.whTopic;
        return out;
    }

    window.PhotoUtil = {
        HOME_MIN_W: HOME_MIN_W,
        HOME_MIN_H: HOME_MIN_H,
        allowPortrait: allowPortrait,
        homeFitReason: homeFitReason,
        homeFitMessage: homeFitMessage,
        photoUrls: photoUrls,
        orientedSize: orientedSize,
        entryFields: entryFields
    };
})();
