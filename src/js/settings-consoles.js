/*
 * Settings → Consoles page (input names, logos and launch methods for each console). Entry points
 * are exposed on window.SettingsConsoles and wired up by settings.js.
 */
(function () {
    'use strict';


    var LOGOS = [
        { key: 'playstation', label: 'PlayStation' },
        { key: 'xbox', label: 'Xbox' },
        { key: 'switch', label: 'Nintendo Switch' },
        { key: '', label: 'None' }
    ];

    var METHODS = [
        { key: 'switch+viewer', label: 'TV input', hint: 'Game Mode works' },
        { key: 'inapp', label: 'Inside the launcher', hint: 'Back returns here' }
    ];

    var renderConsoles = null;

    function methodOf(input) {
        var key = input.method || window.LAUNCHER_CONFIG.inputMethod;
        return METHODS.find(function (m) { return m.key === key; }) || METHODS[0];
    }

    function logoOf(input) {
        return LOGOS.find(function (l) { return l.key === (input.brand || ''); }) || LOGOS[3];
    }

    function consoleEntries() {
        var entries = Home.inputs().map(function (input, i) {
            return {
                label: input.label,
                value: input.hidden ? 'Hidden' : 'HDMI ' + input.hdmi + ' · ' + methodOf(input).label,
                mini: Home.miniInputTile(input),
                run: function () { consoleMenu(i); }
            };
        });
        entries.push({ label: '+ Add a console', value: '', run: addConsole });
        return entries;
    }

    function editInputs(change) {
        var list = Home.inputs().map(function (i) { return Object.assign({}, i); });
        change(list);
        Home.setInputs(list);
        renderConsoles();
        UI.refresh();
    }

    function consoleMenu(i) {
        var c = Home.inputs()[i];
        var count = Home.inputs().length;
        var status = Home.hdmiStatus();
        var options = [
            {
                label: 'Rename', run: function () {
                    SettingsCore.rename(c.label, function (name) { editInputs(function (l) { l[i].label = name; }); });
                }
            },
            {
                label: 'HDMI port · HDMI ' + c.hdmi, run: function () {
                    UI.menu('HDMI port', [1, 2, 3, 4].map(function (n) {
                        return {
                            label: 'HDMI ' + n + (status[n] ? ' · connected' : ''),
                            checked: n === c.hdmi,
                            run: function () { editInputs(function (l) { l[i].hdmi = n; }); }
                        };
                    }));
                }
            },
            {
                label: 'Logo · ' + logoOf(c).label, run: function () {
                    UI.menu('Logo', LOGOS.map(function (logo) {
                        return {
                            label: logo.label,
                            checked: logo.key === (c.brand || ''),
                            run: function () { editInputs(function (l) { l[i].brand = logo.key; }); }
                        };
                    }));
                }
            },
            {
                label: 'Opens · ' + methodOf(c).label, run: function () {
                    UI.menu('Opens', METHODS.map(function (m) {
                        return {
                            label: m.label + ' · ' + m.hint,
                            checked: m.key === methodOf(c).key,
                            run: function () { editInputs(function (l) { l[i].method = m.key; }); }
                        };
                    }));
                }
            },
            {
                label: c.hidden ? 'Show on Home' : 'Hide from Home',
                run: function () { editInputs(function (l) { l[i].hidden = !c.hidden; }); }
            }
        ];
        if (i > 0) {
            options.push({ label: 'Move earlier', run: function () { editInputs(function (l) { l.splice(i - 1, 0, l.splice(i, 1)[0]); }); } });
        }
        if (i < count - 1) {
            options.push({ label: 'Move later', run: function () { editInputs(function (l) { l.splice(i + 1, 0, l.splice(i, 1)[0]); }); } });
        }
        options.push({
            label: 'Remove', run: function () {
                UI.menu('Remove ' + c.label + '?', [
                    { label: 'Remove', run: function () { editInputs(function (l) { l.splice(i, 1); }); } },
                    { label: 'Cancel' }
                ]);
            }
        });
        options.push({ label: 'Cancel' });
        UI.menu(c.label, options);
    }

    function addConsole() {
        var used = {};
        Home.inputs().forEach(function (i) { used[i.hdmi] = true; });
        var port = [1, 2, 3, 4].find(function (n) { return !used[n]; }) || 1;
        editInputs(function (l) { l.push({ hdmi: port, label: 'Console', brand: '' }); });
        var index = Home.inputs().length - 1;
        SettingsCore.rename('Console', function (name) { editInputs(function (l) { l[index].label = name; }); });
    }

    function setRender(fn) { renderConsoles = fn; }

    window.SettingsConsoles = { entries: consoleEntries, setRender: setRender };
})();
