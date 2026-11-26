/* Clock, date and font settings (Prefs.appearance). */
(function () {
    'use strict';

    var FONTS = [
        { key: 'manrope', label: 'Manrope', family: '"Manrope"' },
        { key: 'inter', label: 'Inter', family: '"Inter"' },
        { key: 'outfit', label: 'Outfit', family: '"Outfit"' },
        { key: 'dm-sans', label: 'DM Sans', family: '"DM Sans"' }
    ];

    var LOCALES = [
        { key: 'en-GB', label: 'English' },
        { key: 'es-ES', label: 'Español' },
        { key: 'fr-FR', label: 'Français' }
    ];

    var FALLBACK = ', "SamsungOne", "Helvetica Neue", Arial, sans-serif';

    function prefs() { return Prefs.get().appearance; }

    function font(key) {
        return FONTS.find(function (f) { return f.key === key; }) || FONTS[0];
    }

    function pad(n) { return String(n).padStart(2, '0'); }

    // Weather place timezone when set; otherwise the TV's local zone.
    function clockZone() {
        return (window.Weather && Weather.timeZone && Weather.timeZone()) || undefined;
    }

    // Returns { time: '16:05', suffix: '' } or { time: '4:05', suffix: 'PM' }.
    function time(d) {
        var tz = clockZone();
        if (tz) {
            try {
                var twelve = prefs().clock === '12h';
                var parts = new Intl.DateTimeFormat('en-GB', {
                    timeZone: tz,
                    hour: 'numeric',
                    minute: '2-digit',
                    hourCycle: twelve ? 'h12' : 'h23'
                }).formatToParts(d);
                var hour = '';
                var minute = '';
                var period = '';
                parts.forEach(function (p) {
                    if (p.type === 'hour') hour = p.value;
                    else if (p.type === 'minute') minute = p.value;
                    else if (p.type === 'dayPeriod') period = p.value;
                });
                if (twelve) {
                    return { time: hour + ':' + minute, suffix: (period || '').toUpperCase() };
                }
                return { time: pad(parseInt(hour, 10)) + ':' + minute, suffix: '' };
            } catch (e) {
                // Fall through to TV-local time if the zone string is unknown.
            }
        }
        if (prefs().clock === '12h') {
            var h = d.getHours() % 12 || 12;
            return { time: h + ':' + pad(d.getMinutes()), suffix: d.getHours() < 12 ? 'AM' : 'PM' };
        }
        return { time: pad(d.getHours()) + ':' + pad(d.getMinutes()), suffix: '' };
    }

    function date(d) {
        try {
            var opts = { weekday: 'long', day: 'numeric', month: 'long' };
            var tz = clockZone();
            if (tz) opts.timeZone = tz;
            var text = d.toLocaleDateString(prefs().locale, opts);
            return text.charAt(0).toUpperCase() + text.slice(1);
        } catch (e) {
            return d.toDateString();
        }
    }

    function resolveFocus(p) {
        if (p.focus === 'scale' || p.focus === 'ring') return p.focus;
        return 'both';
    }

    function gridCols() {
        return prefs().tiles === 'compact' ? 6 : 5;
    }

    // Two rows only with Compact tiles — Comfortable stays a single shelf row.
    function homeRows() {
        var p = prefs();
        if (p.tiles !== 'compact') return 1;
        return Number(p.homeRows) === 2 ? 2 : 1;
    }

    function apply() {
        var p = prefs();
        // Comfortable + two rows is invalid; keep Comfortable as one row.
        if (p.tiles !== 'compact' && Number(p.homeRows) === 2) {
            p.homeRows = 1;
            if (window.Prefs && Prefs.save) Prefs.save();
        }
        document.documentElement.style.setProperty('--font', font(p.font).family + FALLBACK);
        var home = document.getElementById('home');
        home.classList.toggle('names-focused', p.names === 'focused');
        home.classList.toggle('names-never', p.names === 'never');
        home.classList.toggle('no-date', !p.showDate);
        var root = document.documentElement;
        var focus = resolveFocus(p);
        root.classList.remove('motion-full', 'motion-reduced', 'motion-off', 'focus-off');
        root.classList.toggle('focus-both', focus === 'both');
        root.classList.toggle('focus-scale', focus === 'scale');
        root.classList.toggle('focus-ring', focus === 'ring');
        var tiles = p.tiles === 'compact' ? 'compact' : 'comfortable';
        root.classList.toggle('tiles-comfortable', tiles === 'comfortable');
        root.classList.toggle('tiles-compact', tiles === 'compact');
    }

    window.Appearance = {
        FONTS: FONTS,
        LOCALES: LOCALES,
        font: font,
        gridCols: gridCols,
        homeRows: homeRows,
        time: time,
        date: date,
        apply: apply
    };
})();
