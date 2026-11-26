/*
 * Settings → Weather page (location search and units). Entry points are exposed on
 * window.SettingsWeather and wired up by settings.js.
 */
(function () {
    'use strict';

    var $ = UI.$;
    var el = UI.el;
    var chip = SettingsCore.chip;

    var weatherBusy = false;

    function applyWeatherPlace(resolved) {
        var p = Prefs.get().weather;
        p.place = resolved.place;
        p.latitude = resolved.latitude;
        p.longitude = resolved.longitude;
        p.label = resolved.label;
        p.timezone = resolved.timezone || null;
        Prefs.save();
        Weather.applySettings();
        SettingsCore.withFocusRestore($('weather-body'), renderWeather);
        if (window.Home && Home.updateClock) Home.updateClock();
    }

    function redrawWeather() {
        SettingsCore.withFocusRestore($('weather-body'), renderWeather);
    }

    function renderWeather() {
        var p = Prefs.get().weather;
        var body = $('weather-body');
        body.innerHTML = '';
        var auto = p.place === 'auto';
        var custom = p.place === 'custom' && Weather.configured();
        var label = Weather.placeLabel();

        var placeBlock = el('div', 'setting-block');
        placeBlock.appendChild(el('h2', '', 'Place'));
        var placeChips = el('div', 'chips wrap');
        placeChips.appendChild(chip('Off', p.place === 'off', { kind: 'place', value: 'off' }));
        placeChips.appendChild(chip(
            auto && label ? ('Auto · ' + label) : 'Automatic',
            auto,
            { kind: 'place', value: 'auto' }
        ));
        if (custom) {
            placeChips.appendChild(chip(label || 'Custom', true, { kind: 'place', value: 'current' }));
        }
        placeChips.appendChild(chip('Search city…', false, { kind: 'search' }));
        placeBlock.appendChild(placeChips);
        body.appendChild(placeBlock);

        var unitBlock = el('div', 'setting-block');
        unitBlock.appendChild(el('h2', '', 'Unit'));
        var unitChips = el('div', 'chips');
        unitChips.appendChild(chip('Celsius', p.unit === 'celsius', { kind: 'unit', value: 'celsius' }));
        unitChips.appendChild(chip('Fahrenheit', p.unit === 'fahrenheit', { kind: 'unit', value: 'fahrenheit' }));
        unitBlock.appendChild(unitChips);
        body.appendChild(unitBlock);

        var tz = Weather.timeZone && Weather.timeZone();
        var note = el('p', 'setting-note muted',
            tz
                ? ('Home clock follows this place (' + tz + ').')
                : 'Home clock follows this place when set; Off uses the TV clock.');
        body.appendChild(note);
    }

    function activateWeather(item) {
        var p = Prefs.get().weather;
        if (item.kind === 'search') {
            SettingsCore.rename('', function (query) {
                if (weatherBusy) return;
                weatherBusy = true;
                UI.busyShow();
                Weather.searchPlaces(query, function (err, results) {
                    weatherBusy = false;
                    UI.busyHide();
                    if (err) {
                        UI.toast('Search failed');
                        DevLog.log('Weather search failed: ' + err);
                        return;
                    }
                    if (!results || !results.length) {
                        UI.toast('No cities found');
                        return;
                    }
                    UI.menu('Cities', results.map(function (r) {
                        return {
                            label: r.label,
                            run: function () {
                                applyWeatherPlace(
                                    Weather.resolvePlace(
                                        r.latitude, r.longitude, r.label, r.timezone
                                    )
                                );
                                UI.toast('Weather: ' + Weather.summary());
                            }
                        };
                    }).concat([{ label: 'Cancel', kind: 'action' }]));
                });
            }, { title: 'City name', maxLength: 64 });
            return;
        }
        if (item.kind === 'place') {
            if (item.value === 'current') return;
            if (item.value === 'auto') {
                if (weatherBusy) return;
                p.place = 'auto';
                p.latitude = null;
                p.longitude = null;
                p.label = null;
                p.timezone = null;
                Prefs.save();
                Weather.applySettings();
                weatherBusy = true;
                UI.busyShow();
                Weather.detectLocation(function (err, loc) {
                    weatherBusy = false;
                    UI.busyHide();
                    if (err || !loc) {
                        UI.toast('Could not find location');
                        DevLog.log('Weather detect failed: ' + (err || 'unknown'));
                        redrawWeather();
                        return;
                    }
                    Weather.applyDetected(loc);
                    redrawWeather();
                    if (window.Home && Home.updateClock) Home.updateClock();
                    UI.toast('Weather: ' + Weather.summary());
                });
                return;
            }
            if (item.value !== 'off') return;
            p.place = 'off';
            p.latitude = null;
            p.longitude = null;
            p.label = null;
            p.timezone = null;
        } else if (item.kind === 'unit') {
            p.unit = item.value;
        } else {
            return;
        }
        Prefs.save();
        Weather.applySettings();
        redrawWeather();
        if (window.Home && Home.updateClock) Home.updateClock();
    }


    // Compact place picker for Home (Automatic / city / Off).
    function openPlaceMenu() {
        var p = Prefs.get().weather;
        var label = Weather.placeLabel();
        // Selections first, then actions (same shape as console menus).
        var options = [
            {
                label: p.place === 'auto' && label ? ('Automatic · ' + label) : 'Automatic',
                checked: p.place === 'auto',
                run: function () { activateWeather({ kind: 'place', value: 'auto' }); }
            },
            {
                label: 'Off',
                checked: p.place === 'off',
                run: function () { activateWeather({ kind: 'place', value: 'off' }); }
            },
            {
                label: 'Enter city…',
                kind: 'action',
                run: function () { activateWeather({ kind: 'search' }); }
            },
            { label: 'Cancel', kind: 'action' }
        ];
        UI.menu('Weather', options);
    }

    window.SettingsWeather = {
        render: renderWeather,
        activate: activateWeather,
        openPlaceMenu: openPlaceMenu
    };
})();
