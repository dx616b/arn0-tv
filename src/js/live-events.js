/*
 * Change notifications for the live wallpaper: listeners registered with LiveWallpaper.onChange are
 * told when the pool or the picker changes. Debounced unless called with immediate = true.
 */
(function () {
    'use strict';

    function notify(immediate) {
        if (immediate) {
            if (LiveState.notifyTimer) {
                clearTimeout(LiveState.notifyTimer);
                LiveState.notifyTimer = null;
            }
            LiveState.listeners.forEach(function (fn) { fn(); });
            return;
        }
        if (LiveState.notifyTimer) return;
        LiveState.notifyTimer = setTimeout(function () {
            LiveState.notifyTimer = null;
            LiveState.listeners.forEach(function (fn) { fn(); });
        }, 120);
    }

    window.LiveEvents = {
        notify: notify
    };
})();
