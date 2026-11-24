/*
 * Settings → Background: pinned photos, saved Live pictures and the actions on a photo (use it, keep
 * it, hide a bundled one). Entry points are exposed on window.SettingsBackgroundPins; the page itself
 * is settings-background.js.
 */
(function () {
    'use strict';

    var $ = UI.$;
    var bgState = SettingsCore.bgState;

    function renderBackground() { return SettingsBackground.render.apply(null, arguments); }

    function pinStorageLabel() {
        if (!window.Wallpaper || !Wallpaper.pinsStorageSummary) return '';
        return Wallpaper.pinsStorageSummary();
    }

    function isPinnedKey(key) {
        var list = (window.Wallpaper && Wallpaper.pinsList && Wallpaper.pinsList()) || [];
        return list.some(function (pin) { return pin.key === key; });
    }

    function afterPinChange(focusKey) {
        bgState.gridMode = '';
        bgState.photosKeys = {};
        if (typeof SettingsCore.renderAtmosphere === 'function') SettingsCore.renderAtmosphere();
        renderBackground();
        if (focusKey) focusBgThumb(focusKey);
        else UI.refresh();
    }

    function removeOnePin(key) {
        if (!window.Wallpaper || !Wallpaper.removePin) return;
        UI.busy(Wallpaper.removePin(key)).then(function (ok) {
            if (!ok) {
                UI.toast('Could not remove');
                return;
            }
            var sum = pinStorageLabel();
            UI.toast(sum ? 'Removed · ' + sum : 'Removed');
            afterPinChange(Prefs.get().wallpaper.photo);
        }, function () {
            UI.toast('Could not remove');
        });
    }

    function hideOneBundled(key) {
        if (!window.Wallpaper || !Wallpaper.hideBundled) return;
        if (!Wallpaper.hideBundled(key)) {
            UI.toast('Keep at least one photo');
            return;
        }
        UI.toast('Hidden from Photo / Rotate');
        afterPinChange(Prefs.get().wallpaper.photo);
        if (typeof SettingsCore.renderAtmosphere === 'function') SettingsCore.renderAtmosphere();
    }

    function restoreBundledPhotos() {
        if (!window.Wallpaper || !Wallpaper.restoreBundled) return;
        var n = Wallpaper.hiddenBundledCount ? Wallpaper.hiddenBundledCount() : 0;
        if (!n) {
            UI.toast('No hidden bundled photos');
            return;
        }
        UI.menu('Restore ' + n + ' bundled photo' + (n === 1 ? '' : 's') + '?', [
            {
                label: 'Restore', run: function () {
                    Wallpaper.restoreBundled();
                    UI.toast('Bundled photos restored');
                    afterPinChange(Prefs.get().wallpaper.photo);
                    if (typeof SettingsCore.renderAtmosphere === 'function') SettingsCore.renderAtmosphere();
                }
            },
            { label: 'Cancel' }
        ]);
    }

    function usePhotoKey(key) {
        var p = Prefs.get().wallpaper;
        bgState.keepLivePicker = false;
        // Switching to a pin or shipped still drops the temporary Live use.
        if (p.tempPhoto && p.tempPhoto.key !== key && Wallpaper.clearTempPhoto) {
            Wallpaper.clearTempPhoto();
        }
        p.photo = key;
        p.mode = 'photo';
        Prefs.save();
        Wallpaper.apply();
        afterPinChange(key);
    }

    function useLiveNow(entry) {
        if (!Wallpaper.useTemporary || !Wallpaper.useTemporary(entry)) {
            UI.toast('Could not use photo');
            return;
        }
        bgState.keepLivePicker = true;
        UI.toast('Using now (not saved)');
        afterPinChange(entry.key);
    }

    function saveLivePermanent(entry) {
        UI.busy(Wallpaper.pinLive(entry)).then(function (ok) {
            bgState.keepLivePicker = true;
            var sum = pinStorageLabel();
            UI.toast(ok
                ? ('Saved permanently' + (sum ? ' · ' + sum : ''))
                : 'Saved (online only)');
            afterPinChange(entry.key);
        }, function () {
            UI.toast('Could not save');
        });
    }

    function livePhotoMenu(entry) {
        if (!entry) {
            UI.toast('Could not use photo');
            return;
        }
        if (isPinnedKey(entry.key)) {
            UI.menu(entry.title || 'Saved photo', [
                {
                    label: 'Use', run: function () { usePhotoKey(entry.key); }
                },
                {
                    label: 'Remove save', run: function () { removeOnePin(entry.key); }
                },
                { label: 'Cancel' }
            ]);
            return;
        }
        UI.menu(entry.title || 'Photo', [
            {
                label: 'Use now', run: function () { useLiveNow(entry); }
            },
            {
                label: 'Save permanently', run: function () { saveLivePermanent(entry); }
            },
            { label: 'Cancel' }
        ]);
    }

    function clearSavedPins() {
        var pins = (Wallpaper.pinsList && Wallpaper.pinsList()) || [];
        if (!pins.length) {
            UI.toast('No saved pins');
            return;
        }
        var size = pinStorageLabel();
        UI.menu(size ? 'Clear saved pins (' + size + ')?' : 'Clear saved pins?', [
            {
                label: 'Clear', run: function () {
                    UI.busy(Wallpaper.clearPins()).then(function () {
                        var p = Prefs.get().wallpaper;
                        var visible = (Wallpaper.bundledVisible && Wallpaper.bundledVisible()) ||
                            Wallpaper.bundled();
                        if (visible.length) {
                            p.photo = visible[0].key;
                            Prefs.save();
                            Wallpaper.apply();
                        }
                        bgState.gridMode = '';
                        bgState.photosKeys = {};
                        UI.toast('Saved pins cleared');
                        // Atmosphere list label + Background storage note both bake size at render.
                        if (typeof SettingsCore.renderAtmosphere === 'function') SettingsCore.renderAtmosphere();
                        if ($('bg-settings') && !$('bg-settings').classList.contains('hidden')) {
                            renderBackground();
                        }
                        UI.refresh();
                    });
                }
            },
            { label: 'Cancel' }
        ]);
    }

    function focusBgThumb(key) {
        var photos = $('bg-photos');
        if (!photos) {
            UI.refresh();
            return;
        }
        var nodes = UI.children(photos);
        var i;
        for (i = 0; i < nodes.length; i++) {
            if (nodes[i]._item && nodes[i]._item.key === key) {
                UI.focusOn(nodes[i]);
                return;
            }
        }
        UI.refresh();
    }

    window.SettingsBackgroundPins = {
        focusBgThumb: focusBgThumb,
        pinStorageLabel: pinStorageLabel,
        isPinnedKey: isPinnedKey,
        afterPinChange: afterPinChange,
        removeOnePin: removeOnePin,
        hideOneBundled: hideOneBundled,
        restoreBundledPhotos: restoreBundledPhotos,
        usePhotoKey: usePhotoKey,
        useLiveNow: useLiveNow,
        saveLivePermanent: saveLivePermanent,
        livePhotoMenu: livePhotoMenu,
        clearSavedPins: clearSavedPins,
    };
})();
