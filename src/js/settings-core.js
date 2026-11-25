/*
 * Shared helpers for the settings pages. Loaded before settings.js and the per-page files
 * (settings-*.js), which read them through window.SettingsCore.
 */
(function () {
    'use strict';

    var $ = UI.$;
    var el = UI.el;
    var THUMB_COLS = 6;

    var BACK_TITLES = {
        settings: 'Settings',
        'settings-home': 'Home screen',
        'settings-atmosphere': 'Atmosphere',
        'settings-samsung': 'Samsung',
        advanced: 'Advanced',
        home: 'Home'
    };

    function chip(label, on, item) {
        var c = el('div', 'chip' + (on ? ' on' : ''), label);
        c._item = item;
        return c;
    }

    // Stable identity for restoring focus after a chip/list rebuild.
    function itemId(item) {
        if (!item) return '';
        var parts = [];
        if (item.kind != null) parts.push('k:' + item.kind);
        if (item.key != null) parts.push('key:' + item.key);
        if (item.value != null) parts.push('v:' + String(item.value));
        if (item.id != null) parts.push('id:' + item.id);
        return parts.join('|');
    }

    function findByItemId(root, id) {
        if (!root || !id) return null;
        var nodes = root.querySelectorAll('.chip, .thumb, .setting-row, .ed-item');
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i]._item && itemId(nodes[i]._item) === id) return nodes[i];
        }
        return null;
    }

    function withFocusRestore(root, renderFn) {
        var focused = root && root.querySelector('.focused');
        var id = focused && focused._item ? itemId(focused._item) : '';
        renderFn();
        if (!id) {
            UI.refresh();
            return;
        }
        var match = findByItemId(root, id);
        if (match) UI.focusOn(match);
        else UI.refresh();
    }

    function backHint(fallback) {
        var from = UI.from && UI.from();
        if (from && BACK_TITLES[from]) return BACK_TITLES[from];
        return fallback || 'Settings';
    }

    function backPair(fallback) {
        return ['Back', backHint(fallback)];
    }

    // ---------- Generic list pages

    // entries: [{ section }] headers, or [{ label, value, mini, kind, run }] rows
    function renderList(list, entries) {
        list.innerHTML = '';
        entries.forEach(function (e) {
            if (e.section) {
                var head = el('li', 'settings-section');
                head.appendChild(el('span', 'settings-section-label', e.section));
                list.appendChild(head);
                return;
            }
            var cls = 'setting-row';
            if (e.kind === 'action') cls += ' setting-row-action';
            if (e.kind === 'danger') cls += ' setting-row-action setting-row-danger';
            var li = el('li', cls);
            if (e.mini) li.appendChild(e.mini);
            li.appendChild(el('span', 'setting-label', e.label));
            if (e.value) li.appendChild(el('span', 'setting-value', e.value));
            else if (e.kind !== 'action' && e.kind !== 'danger') {
                li.appendChild(el('span', 'setting-chevron', '\u203A'));
            }
            li._item = e;
            list.appendChild(li);
        });
    }

    function focusableListItems(list) {
        return UI.children(list).filter(function (li) { return !!li._item; });
    }

    /*
     * A two-column list fills the first column before the second, so visual row r holds items
     * r and r + rowCount. The focus grid has to be built that way round or Down would jump
     * across columns.
     */
    function columnRows(items) {
        var rowCount = Math.ceil(items.length / 2);
        var rows = [];
        for (var r = 0; r < rowCount; r++) {
            var row = [items[r]];
            if (items[r + rowCount]) row.push(items[r + rowCount]);
            rows.push(row);
        }
        return rows;
    }

    function registerList(name, entries, hints, twoColumn) {
        var view = $(name);
        var list = view.querySelector('ul');
        var KEY = UI.KEY;
        var render = function () {
            renderList(list, entries());
            if (twoColumn) {
                list.style.gridTemplateRows =
                    'repeat(' + Math.ceil(focusableListItems(list).length / 2) + ', auto)';
            }
        };
        var def = {
            el: view,
            rows: function () {
                var items = focusableListItems(list);
                return twoColumn ? columnRows(items) : items.map(function (li) { return [li]; });
            },
            onShow: render,
            activate: function (item) { item.run(); },
            // Single-column lists: ▶ opens, ◀ goes back (chip pages still use Left/Right to move).
            onKey: twoColumn ? undefined : function (k) {
                if (k === KEY.RIGHT) {
                    var cur = view.querySelector('.focused');
                    if (cur && cur._item && cur._item.run) {
                        if (window.Sound) Sound.play('select');
                        cur._item.run();
                    }
                    return true;
                }
                if (k === KEY.LEFT) {
                    UI.back();
                    return true;
                }
                return false;
            },
            hints: hints
        };
        if (typeof hints === 'function') {
            def.onFocus = function () { UI.refreshHints(); };
        }
        UI.register(name, def);
        return render;
    }

    function chipRows(container) {
        var rows = [];
        UI.children(container).forEach(function (block) {
            if (block.classList.contains('hidden')) return;
            var parts = block.querySelectorAll('.chips, .thumbs');
            if (!parts.length) return;
            Array.prototype.forEach.call(parts, function (chips) {
                if (chips.classList.contains('hidden')) return;
                if (chips.classList.contains('thumbs')) {
                    rows = rows.concat(UI.chunk(UI.children(chips), THUMB_COLS));
                    return;
                }
                var row = UI.children(chips).filter(function (n) {
                    return !n.classList.contains('chip-gap') && !n.classList.contains('disabled');
                });
                if (row.length) rows.push(row);
            });
        });
        return rows;
    }

    // ◀ at the start of a chip/thumb row returns to the Settings hub.
    function chipDetailOnKey(k) {
        if (k === UI.KEY.LEFT && UI.atRowStart()) {
            UI.back();
            return true;
        }
        return false;
    }

    // okLabel: string, or function () → string for focus-dependent OK text.
    function chipDetailHints(okLabel) {
        return function () {
            var ok = typeof okLabel === 'function' ? okLabel() : (okLabel || 'Select');
            var hints = [['OK', ok]];
            if (UI.atRowStart && UI.atRowStart()) hints.push(['◀', 'Back']);
            else hints.push(['◀ ▶', 'Move']);
            hints.push(backPair());
            return hints;
        };
    }

    /*
     * Chip/thumb detail page: same focus grid as chipRows, Left-at-edge backs out.
     * opts: { el, body, onShow, activate, hints|okLabel, onFocus }
     */
    function registerChipPage(name, opts) {
        var body = opts.body;
        var hints = opts.hints || chipDetailHints(opts.okLabel || 'Select');
        UI.register(name, {
            el: opts.el,
            rows: function () { return chipRows(body); },
            onShow: opts.onShow,
            activate: opts.activate,
            onKey: chipDetailOnKey,
            onFocus: opts.onFocus || function () { UI.refreshHints(); },
            hints: hints
        });
    }

    var bgState = {
        gridMode: '',
        photosKeys: {},
        liveRefreshTimer: null,
        keepLivePicker: false,
        softSig: ''
    };

    window.SettingsCore = {
        bgState: bgState,
        chip: chip,
        itemId: itemId,
        withFocusRestore: withFocusRestore,
        backHint: backHint,
        backPair: backPair,
        renderList: renderList,
        focusableListItems: focusableListItems,
        columnRows: columnRows,
        registerList: registerList,
        chipRows: chipRows,
        chipDetailOnKey: chipDetailOnKey,
        chipDetailHints: chipDetailHints,
        registerChipPage: registerChipPage,
        renderAtmosphere: null,
        renderHub: null
    };
})();
