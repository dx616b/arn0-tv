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

    // Cancel-first confirm for discard / remove / clear. opts: { detail, onBack }.
    function confirmDanger(title, confirmLabel, onConfirm, opts) {
        opts = opts || {};
        var rows = [
            { label: 'Cancel', kind: 'action', current: true, run: opts.onBack },
            { label: confirmLabel, kind: 'danger', run: onConfirm }
        ];
        var menuOpts = {};
        if (opts.onBack) menuOpts.onBack = opts.onBack;
        if (opts.detail) menuOpts.detail = opts.detail;
        UI.menu(title, rows, menuOpts);
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
        // Restore is not destructive, but still Cancel-first like other confirms.
        UI.menu('Restore ' + n + ' bundled photo' + (n === 1 ? '' : 's') + '?', [
            { label: 'Cancel', kind: 'action', current: true },
            {
                label: 'Restore',
                kind: 'action',
                run: function () {
                    Wallpaper.restoreBundled();
                    UI.toast('Bundled photos restored');
                    afterPinChange(Prefs.get().wallpaper.photo);
                    if (typeof SettingsCore.renderAtmosphere === 'function') SettingsCore.renderAtmosphere();
                }
            }
        ]);
    }

    function confirmRemovePin(key, opts) {
        opts = opts || {};
        confirmDanger('Remove this saved photo?', 'Remove', function () {
            removeOnePin(key);
        }, {
            onBack: opts.onBack,
            detail: opts.detail || 'It will be deleted from Photos.'
        });
    }

    function confirmHideBundled(key, opts) {
        opts = opts || {};
        confirmDanger('Hide this bundled photo?', 'Hide', function () {
            hideOneBundled(key);
        }, {
            onBack: opts.onBack,
            detail: opts.detail || 'You can restore hidden bundled photos later.'
        });
    }

    function confirmDiscardTemp(entry, opts) {
        opts = opts || {};
        var key = entry && entry.key;
        confirmDanger('Discard temporary photo?', 'Discard', function () {
            if (Wallpaper.clearTempPhoto) Wallpaper.clearTempPhoto();
            var next = Prefs.get().wallpaper.photo;
            if (key && next === key) {
                var pins = (Wallpaper.pinsList && Wallpaper.pinsList()) || [];
                var ship = (Wallpaper.bundledVisible && Wallpaper.bundledVisible()) ||
                    Wallpaper.bundled();
                next = (pins[0] && pins[0].key) || (ship[0] && ship[0].key) || next;
                Prefs.get().wallpaper.photo = next;
                Prefs.save();
                Wallpaper.apply();
            }
            UI.toast('Discarded');
            afterPinChange(Prefs.get().wallpaper.photo);
        }, {
            onBack: opts.onBack,
            detail: opts.detail || 'It will not be saved to Photos.'
        });
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
        if (!Wallpaper.useTemporary) {
            UI.toast('Could not use photo');
            return;
        }
        UI.busy(Wallpaper.useTemporary(entry)).then(function (fit) {
            if (!fit || !fit.ok) {
                UI.toast((Wallpaper.homeFitMessage && Wallpaper.homeFitMessage(fit && fit.reason)) ||
                    'Could not use photo');
                return;
            }
            bgState.keepLivePicker = true;
            UI.toast('Using now (not saved)');
            afterPinChange(entry.key);
        }, function () {
            UI.toast('Could not use photo');
        });
    }

    function saveLivePermanent(entry) {
        UI.busy(Wallpaper.pinLive(entry)).then(function (ok) {
            bgState.keepLivePicker = true;
            var sum = pinStorageLabel();
            UI.toast(ok
                ? ('Saved permanently' + (sum ? ' · ' + sum : ''))
                : 'Saved (online only)');
            afterPinChange(entry.key);
        }, function (err) {
            UI.toast((err && err.homeFit && Wallpaper.homeFitMessage &&
                Wallpaper.homeFitMessage(err.homeFit.reason)) ||
                (err && err.message) ||
                'Could not save');
        });
    }

    function livePhotoMenu(entry) {
        if (!entry) {
            UI.toast('Could not use photo');
            return;
        }
        if (isPinnedKey(entry.key)) {
            var reopen = function () { livePhotoMenu(entry); };
            UI.menu(entry.title || 'Saved photo', [
                {
                    label: 'Use',
                    kind: 'action',
                    run: function () { usePhotoKey(entry.key); }
                },
                {
                    label: 'Remove save',
                    kind: 'danger',
                    run: function () {
                        // ◀ returns here; Back cancels the whole menu stack.
                        confirmRemovePin(entry.key, { onBack: reopen });
                    }
                },
                { label: 'Cancel', kind: 'action' }
            ]);
            return;
        }
        UI.menu(entry.title || 'Photo', [
            {
                label: 'Use now',
                kind: 'action',
                run: function () { useLiveNow(entry); }
            },
            {
                label: 'Save permanently',
                kind: 'action',
                run: function () { saveLivePermanent(entry); }
            },
            { label: 'Cancel', kind: 'action' }
        ]);
    }

    function clearSavedPins() {
        var pins = (Wallpaper.pinsList && Wallpaper.pinsList()) || [];
        if (!pins.length) {
            UI.toast('No saved pins');
            return;
        }
        var size = pinStorageLabel();
        confirmDanger('Clear all saved pins?', 'Clear pins', function () {
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
                    if (SettingsBackground.redraw) SettingsBackground.redraw();
                    else {
                        renderBackground();
                        UI.refresh();
                    }
                } else {
                    UI.refresh();
                }
            });
        }, {
            detail: size
                ? 'Deletes every permanently saved photo (' + size + ').'
                : 'Deletes every permanently saved photo.'
        });
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
        confirmDanger: confirmDanger,
        confirmRemovePin: confirmRemovePin,
        confirmHideBundled: confirmHideBundled,
        confirmDiscardTemp: confirmDiscardTemp,
        restoreBundledPhotos: restoreBundledPhotos,
        usePhotoKey: usePhotoKey,
        useLiveNow: useLiveNow,
        saveLivePermanent: saveLivePermanent,
        livePhotoMenu: livePhotoMenu,
        clearSavedPins: clearSavedPins,
    };
})();
