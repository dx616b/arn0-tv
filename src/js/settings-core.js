/*
 * Shared helpers for the settings pages. Loaded before settings.js and the per-page files
 * (settings-*.js), which read them through window.SettingsCore.
 */
(function () {
    'use strict';

    var $ = UI.$;
    var el = UI.el;
    var THUMB_COLS = 6;

    function chip(label, on, item) {
        var c = el('div', 'chip' + (on ? ' on' : ''), label);
        c._item = item;
        return c;
    }

    // ---------- Generic list pages

    // entries: [{ label, value, mini, run }]
    function renderList(list, entries) {
        list.innerHTML = '';
        entries.forEach(function (e) {
            var li = el('li', 'setting-row');
            if (e.mini) li.appendChild(e.mini);
            li.appendChild(el('span', 'setting-label', e.label));
            if (e.value) li.appendChild(el('span', 'setting-value', e.value));
            li._item = e;
            list.appendChild(li);
        });
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
        var render = function () {
            renderList(list, entries());
            // Set in JS so the split follows the number of entries rather than a hard-coded four.
            if (twoColumn) {
                list.style.gridTemplateRows =
                    'repeat(' + Math.ceil(list.children.length / 2) + ', auto)';
            }
        };
        UI.register(name, {
            el: view,
            rows: function () {
                var items = UI.children(list);
                return twoColumn ? columnRows(items) : items.map(function (li) { return [li]; });
            },
            onShow: render,
            activate: function (item) { item.run(); },
            hints: hints
        });
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
                // Skip spacer nodes (e.g. Controls | Volume gap) so focus stays on real chips.
                var row = UI.children(chips).filter(function (n) {
                    return !n.classList.contains('chip-gap');
                });
                if (row.length) rows.push(row);
            });
        });
        return rows;
    }

    // Live Background page state: the grid, the Live picker mode and the refresh bookkeeping.
    var bgState = {
        gridMode: '',
        photosKeys: {},
        liveRefreshTimer: null,
        keepLivePicker: false,
        softSig: ''
    };

    window.SettingsCore = {
        bgState: bgState, chip: chip, renderList: renderList, columnRows: columnRows,
        registerList: registerList, chipRows: chipRows, renderAtmosphere: null };
})();
