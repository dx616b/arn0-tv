/* HDMI inputs via tizen.systeminfo (VIDEOSOURCE) and tizen.tvwindow. */
(function () {
    'use strict';

    var VIEWER_APP = 'org.tizen.tv-viewer';
    var FULL = ['0px', '0px', '1920px', '1080px'];

    function call(fn, what) {
        return Apps.withTimeout(new Promise(function (resolve, reject) {
            try { fn(resolve, reject); } catch (e) { reject(e); }
        }), 8000, what);
    }

    function sources() {
        return call(function (ok, err) {
            tizen.systeminfo.getPropertyValue('VIDEOSOURCE', ok, err);
        }, 'Input list');
    }

    function describeSource(s) {
        return s ? s.type + (s.type === 'TV' ? '' : ' ' + s.number) : 'unknown';
    }

    function current() {
        try {
            return tizen.tvwindow.getSource('MAIN');
        } catch (e) {
            return null;
        }
    }

    // Returns { 1: true, 2: false, ... } for HDMI ports the TV reports.
    function hdmiStatus() {
        return sources().then(function (info) {
            var status = {};
            (info.disconnected || []).forEach(function (s) { if (s.type === 'HDMI') status[s.number] = false; });
            (info.connected || []).forEach(function (s) { if (s.type === 'HDMI') status[s.number] = true; });
            return status;
        });
    }

    function sourceDisplayName(source) {
        if (!source) return '';
        var objects = [source, source.device, source.deviceInfo, source.sourceInfo];
        var fields = ['deviceName', 'sourceName', 'displayName', 'name', 'label', 'productName'];
        for (var i = 0; i < objects.length; i++) {
            var obj = objects[i];
            if (!obj || typeof obj !== 'object') continue;
            for (var j = 0; j < fields.length; j++) {
                var value = obj[fields[j]];
                if (typeof value !== 'string') continue;
                value = value.trim();
                if (!value || /^(HDMI\s*\d*|TV|VIDEO)$/i.test(value)) continue;
                return value;
            }
        }
        return '';
    }

    // Every HDMI port the TV exposes, with a best-effort device label if Samsung provides one.
    function hdmiInputs() {
        return sources().then(function (info) {
            var byPort = {};
            function add(source) {
                if (!source || source.type !== 'HDMI' || typeof source.number !== 'number') return;
                var input = byPort[source.number] || { hdmi: source.number, name: '' };
                var name = sourceDisplayName(source);
                if (name && !input.name) input.name = name;
                byPort[source.number] = input;
            }
            (info.connected || []).forEach(add);
            (info.disconnected || []).forEach(add);
            return Object.keys(byPort).map(function (port) { return byPort[port]; })
                .sort(function (a, b) { return a.hdmi - b.hdmi; });
        });
    }

    // Every HDMI port the TV exposes (connected + disconnected), sorted.
    function hdmiPorts() {
        return hdmiInputs().then(function (inputs) {
            return inputs.map(function (input) { return input.hdmi; });
        });
    }

    function findHdmi(n) {
        return sources().then(function (info) {
            var all = (info.connected || []).concat(info.disconnected || []);
            var src = all.find(function (s) { return s.type === 'HDMI' && s.number === n; });
            if (!src) throw new Error('HDMI ' + n + ' is not reported by the TV');
            return src;
        });
    }

    function setSource(src) {
        return call(function (ok, err) { tizen.tvwindow.setSource(src, ok, err, 'MAIN'); }, 'Switch input');
    }

    function showFull() {
        return call(function (ok, err) { tizen.tvwindow.show(ok, err, FULL, 'MAIN'); }, 'Show input');
    }

    function hide() {
        return call(function (ok, err) { tizen.tvwindow.hide(ok, err, 'MAIN'); }, 'Hide input');
    }

    function openViewer() {
        return Apps.launch(VIEWER_APP);
    }

    // Resolves to 'inapp' when the input is now showing inside the launcher, otherwise 'external'.
    function open(hdmi, method) {
        return findHdmi(hdmi).then(function (src) {
            return setSource(src).then(function () {
                if (method === 'switch') return 'external';
                if (method === 'inapp') return showFull().then(function () { return 'inapp'; });
                return openViewer().then(function () { return 'external'; });
            });
        });
    }

    window.Inputs = {
        sources: sources,
        hdmiStatus: hdmiStatus,
        hdmiPorts: hdmiPorts,
        hdmiInputs: hdmiInputs,
        current: current,
        describeSource: describeSource,
        open: open,
        hide: hide,
        openViewer: openViewer
    };
})();
