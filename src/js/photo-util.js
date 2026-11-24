/*
 * Shared photo helpers for Home (wallpaper.js) and the screen saver.
 */
(function () {
    'use strict';

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

    // The fields every wallpaper entry carries (pins, temporary photos and live pictures). The
    // caller supplies the title, because each source has its own default for a missing one.
    function entryFields(entry, title) {
        return {
            key: entry.key,
            title: title,
            sub: entry.sub || '',
            file: entry.file,
            fileFallback: entry.fileFallback || '',
            fileFallbacks: entry.fileFallbacks || [],
            thumb: entry.thumb || entry.file,
            credit: entry.credit || ''
        };
    }

    window.PhotoUtil = { photoUrls: photoUrls, orientedSize: orientedSize, entryFields: entryFields };
})();
