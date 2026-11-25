/*
 * Pure pan/zoom math for the screen saver. No DOM, so it can be unit-tested under node:test.
 *
 * Every pose is one number u in [-1, 1]: landscape moves from corner(-1) to corner(+1);
 * portrait goes from focus-in (-1) to zoomed out (+1). Timing is linear, so a pose at any
 * moment is a plain lerp and can be written back without reading computed styles.
 */
(function () {
    'use strict';

    var VIEW_W = 1920;
    var VIEW_H = 1080;
    var FALLBACK_DRIFT = {
        coverX: 96, coverY: 54, zoom: 1.35,
        containX: 48, containY: 0, padX: 96, padY: 54
    };

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
            var fillZoom = Math.min(2.15, Math.max(1.15, 1 + (fill - 1) * 0.8));
            // Milder than full-bleed (~45% of the way to fill), still clearly visible.
            var zoom = Math.min(1.55, Math.max(1.22, 1 + (fillZoom - 1) * 0.45));
            var zW = fw * zoom;
            var spillX = Math.max(0, (zW - VIEW_W) / 2);
            return {
                coverX: 0,
                coverY: 0,
                zoom: zoom,
                containX: Math.round(Math.min(72, spillX * 0.5)),
                containY: 0, // never nudge vertically — keeps top/bottom sealed
                padX: 0,
                padY: 0
            };
        }
        var cover = Math.max(VIEW_W / ow, VIEW_H / oh);
        var overflowX = Math.max(0, (ow * cover - VIEW_W) / 2);
        var overflowY = Math.max(0, (oh * cover - VIEW_H) / 2);
        // Mild Ken Burns travel (matches .ss-photo CSS). Keep overscan modest (~1.10×) so
        // landscape still looks sharp; near-16:9 invents a small pad so there is room to drift.
        var MIN_X = 96;
        var MIN_Y = 54;
        if (overflowX < MIN_X || overflowY < MIN_Y) {
            overflowX = Math.max(overflowX, MIN_X);
            overflowY = Math.max(overflowY, MIN_Y);
        }
        var panX = Math.round(Math.min(128, Math.max(MIN_X, overflowX * 0.55)));
        var panY = Math.round(Math.min(72, Math.max(MIN_Y, overflowY * 0.55)));
        var padX = Math.max(panX, Math.ceil(overflowX));
        var padY = Math.max(panY, Math.ceil(overflowY));
        return { coverX: panX, coverY: panY, zoom: 1, padX: padX, padY: padY };
    }

    function clamp(n, lo, hi) {
        return n < lo ? lo : (n > hi ? hi : n);
    }

    /*
     * CSS transform for pose u.
     * Landscape: integer translate3d only (no scale — TV re-rasterises animated scale as scan lines).
     * Portrait: horizontal nudge + animated zoom from contain (u=+1) to drift.zoom (u=-1).
     */
    function poseTransform(drift, contain, u) {
        if (contain) {
            var t = (1 - u) / 2; // u=-1 focus-in, u=+1 zoomed out
            var x = Math.round(-t * (drift.containX || 0));
            var zMax = drift.zoom > 1 ? drift.zoom : 1.22;
            var z = Math.round((1 + t * (zMax - 1)) * 1000) / 1000;
            return 'translate3d(' + x + 'px,0,0) scale(' + z + ')';
        }
        var tx = Math.round(u * drift.coverX);
        var ty = Math.round(u * drift.coverY);
        return 'translate3d(' + tx + 'px,' + ty + 'px,0)';
    }

    // Where a leg is at `now`: clamped progress from `from` to `to` over `dur` ms.
    function legU(leg, now) {
        var p = leg.dur > 0 ? clamp((now - leg.start) / leg.dur, 0, 1) : 1;
        return leg.from + (leg.to - leg.from) * p;
    }

    window.PanMath = {
        VIEW_W: VIEW_W,
        VIEW_H: VIEW_H,
        FALLBACK_DRIFT: FALLBACK_DRIFT,
        computeDrift: computeDrift,
        poseTransform: poseTransform,
        legU: legU
    };
})();
