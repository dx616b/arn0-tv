/*
 * Console / HDMI helpers shared by Home (Options while rearranging, Add console tile).
 * Prefs still live in Home.setInputs — there is no Settings → Consoles page.
 */
(function () {
    'use strict';

    var LOGOS = [
        { key: 'hdmi', label: 'HDMI' },
        { key: 'hdmi1', label: 'HDMI 1' },
        { key: 'hdmi2', label: 'HDMI 2' },
        { key: 'hdmi3', label: 'HDMI 3' },
        { key: 'hdmi4', label: 'HDMI 4' },
        { key: 'playstation', label: 'PlayStation' },
        { key: 'xbox', label: 'Xbox' },
        { key: 'switch', label: 'Nintendo Switch' },
        { key: 'steamdeck', label: 'Steam Deck' },
        { key: 'steam', label: 'Steam' },
        { key: 'nvidia', label: 'NVIDIA Shield' },
        { key: 'appletv', label: 'Apple TV' },
        { key: 'chromecast', label: 'Chromecast' },
        { key: 'raspberrypi', label: 'Raspberry Pi' },
        { key: 'pc', label: 'PC' },
        { key: '', label: 'None' }
    ];

    var METHODS = [
        { key: 'switch+viewer', label: 'TV input', hint: 'Game Mode works' },
        { key: 'inapp', label: 'Inside the launcher', hint: 'Back returns here' }
    ];

    function methodOf(input) {
        var key = input.method || window.LAUNCHER_CONFIG.inputMethod;
        return METHODS.find(function (m) { return m.key === key; }) || METHODS[0];
    }

    function logoOf(input) {
        return LOGOS.find(function (l) { return l.key === (input.brand || ''); })
            || LOGOS.find(function (l) { return l.key === ''; });
    }

    function colorOf(input) {
        return findConsoleColor(input.color);
    }

    function logoMini(logo, input) {
        if (!logo.key) {
            var empty = document.createElement('div');
            empty.className = 'mini';
            var tile = document.createElement('div');
            tile.className = 'tile';
            tile.style.background = 'rgba(255,255,255,0.12)';
            empty.appendChild(tile);
            return empty;
        }
        var brand = findBrand(logo.key);
        if (!brand) return null;
        return Home.miniTile({
            label: logo.label,
            brand: {
                key: brand.key,
                bg: consoleTileBg(input || {}, brand.bg),
                fg: brand.fg,
                mark: brand.mark,
                text: brand.text,
                pad: brand.pad
            }
        });
    }

    function colorMini(color, input) {
        var brand = findBrand((input && input.brand) || '') || { bg: '#2a2f3a', fg: '#fff' };
        var bg = color.key ? color.bg : brand.bg;
        var empty = document.createElement('div');
        empty.className = 'mini';
        var tile = document.createElement('div');
        tile.className = 'tile';
        tile.style.background = bg;
        empty.appendChild(tile);
        return empty;
    }

    /*
     * opts.getList / opts.apply: edit a working copy (Home rearrange) instead of prefs.
     * opts.noMove: unused here (Home has ◀▶); kept so openMenu callers stay stable.
     */
    function editInputs(change, opts) {
        opts = opts || {};
        var source = opts.getList ? opts.getList() : Home.inputs();
        var list = source.map(function (i) { return Object.assign({}, i); });
        change(list);
        if (opts.apply) {
            opts.apply(list);
            return;
        }
        Home.setInputs(list);
    }

    function openMenu(i, opts) {
        opts = opts || {};
        var list = opts.getList ? opts.getList() : Home.inputs();
        var c = list[i];
        if (!c) return;
        var status = Home.hdmiStatus();
        var edit = function (change) { editInputs(change, opts); };
        var reopen = function () { openMenu(i, opts); };

        // Submenus: ◀ returns here; Back cancels the whole menu stack.
        function sub(title, options) {
            UI.menu(title, options, { onBack: reopen });
        }

        // Compact table for settings, then action rows underneath.
        var options = [
            {
                label: 'HDMI port',
                value: 'HDMI ' + c.hdmi + (status[c.hdmi] ? ' · on' : ''),
                run: function () {
                    sub('HDMI port', [1, 2, 3, 4].map(function (n) {
                        return {
                            label: 'HDMI ' + n,
                            value: status[n] ? 'Connected' : '',
                            checked: n === c.hdmi,
                            run: function () {
                                edit(function (l) { l[i].hdmi = n; });
                                reopen();
                            }
                        };
                    }));
                }
            },
            {
                label: 'Logo',
                value: logoOf(c).label,
                run: function () {
                    sub('Logo', LOGOS.map(function (logo) {
                        return {
                            label: logo.label,
                            checked: logo.key === (c.brand || ''),
                            mini: logoMini(logo, c),
                            run: function () {
                                edit(function (l) { l[i].brand = logo.key; });
                                reopen();
                            }
                        };
                    }));
                }
            },
            {
                label: 'Color',
                value: colorOf(c).label,
                run: function () {
                    sub('Color', CONSOLE_COLORS.map(function (color) {
                        return {
                            label: color.label,
                            checked: color.key === (c.color || ''),
                            mini: colorMini(color, c),
                            run: function () {
                                edit(function (l) {
                                    if (color.key) l[i].color = color.key;
                                    else delete l[i].color;
                                });
                                reopen();
                            }
                        };
                    }));
                }
            },
            {
                label: 'Opens',
                value: methodOf(c).label,
                run: function () {
                    sub('Opens', METHODS.map(function (m) {
                        return {
                            label: m.label,
                            value: m.hint,
                            checked: m.key === methodOf(c).key,
                            run: function () {
                                edit(function (l) { l[i].method = m.key; });
                                reopen();
                            }
                        };
                    }));
                }
            },
            {
                label: 'Rename',
                kind: 'action',
                run: function () {
                    SettingsCore.rename(c.label, function (name) {
                        name = (name || '').slice(0, window.CONSOLE_NAME_MAX || 16);
                        edit(function (l) {
                            l[i].label = name;
                            // Logo follows the name when it matches a preset (PlayStation, Xbox, …).
                            var key = brandKeyFromLabel(name);
                            if (key) l[i].brand = key;
                        });
                        reopen();
                    }, { maxLength: window.CONSOLE_NAME_MAX || 16, title: 'Console name' });
                }
            },
            {
                label: c.hidden ? 'Show on Home' : 'Hide from Home',
                kind: 'action',
                run: function () {
                    edit(function (l) { l[i].hidden = !c.hidden; });
                    // Still in the working list while rearranging — reopen with new label.
                    reopen();
                }
            },
            {
                label: 'Remove',
                kind: 'danger',
                run: function () {
                    sub('Remove ' + c.label + '?', [
                        { label: 'Cancel', kind: 'action', current: true, run: reopen },
                        {
                            label: 'Remove',
                            kind: 'danger',
                            run: function () {
                                edit(function (l) { l.splice(i, 1); });
                            }
                        }
                    ]);
                }
            },
            { label: 'Cancel', kind: 'action' }
        ];
        UI.menu(c.label, options);
    }

    function add() {
        var used = {};
        Home.inputs().forEach(function (i) { used[i.hdmi] = true; });
        var status = Home.hdmiStatus();
        var free = [1, 2, 3, 4].filter(function (n) { return !used[n]; });
        var ports = free.length ? free : [1, 2, 3, 4];

        function create(port) {
            editInputs(function (l) {
                l.push({ hdmi: port, label: 'Console', brand: 'hdmi' + port });
            });
            var index = Home.inputs().length - 1;
            SettingsCore.rename('Console', function (name) {
                editInputs(function (l) {
                    if (!l[index]) return;
                    var label = (name || ('HDMI ' + port)).slice(0, window.CONSOLE_NAME_MAX || 16);
                    l[index].label = label;
                    var key = brandKeyFromLabel(label);
                    if (key) l[index].brand = key;
                });
            }, { maxLength: window.CONSOLE_NAME_MAX || 16, title: 'Console name' });
        }

        if (ports.length === 1) {
            create(ports[0]);
            return;
        }
        UI.menu('HDMI port', ports.map(function (n) {
            return {
                label: 'HDMI ' + n,
                value: status[n] ? 'Connected' : '',
                run: function () { create(n); }
            };
        }).concat([{ label: 'Cancel', kind: 'action' }]));
    }

    window.SettingsConsoles = {
        openMenu: openMenu,
        add: add
    };
})();
