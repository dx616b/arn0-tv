/*
 * UI core: screens ("views"), remote focus, keys, toast, busy spinner, pop-up menu.
 *
 * A view is registered with UI.register(name, def):
 *   el          its root element
 *   rows()      focusable elements as rows: [[a, b, c], [d, e]] (generic arrow navigation)
 *   onShow(opts) called when the view appears (render here); opts.back when returning to it
 *   activate(item, el)   OK on an element whose `_item` is set
 *   onKey(code) handle a key first; return true if handled (for custom navigation),
 *               or 'pass' to leave it to the browser (e.g. typing in a text field)
 *   onBack()    return true if Back was handled inside the view
 *   onFocus(el) called after focus moves
 *   overlay     shown on top of the previous view instead of replacing it
 *   hints       remote keys to show along the bottom: [['OK', 'Open'], ['Back', 'Home']].
 *               A function instead of an array is called on every show, for hints that depend
 *               on state. Omit for no bar.
 */
(function () {
    'use strict';

    var KEY = {
        LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 10009,
        // Desktop preview equivalent: Esc/Backspace = Back
        ESC: 27, BACKSPACE: 8
    };

    var views = {};
    var focus = {};
    var current = null;

    function $(id) { return document.getElementById(id); }

    function el(tag, className, text) {
        var e = document.createElement(tag);
        if (className) e.className = className;
        if (text !== undefined) e.textContent = text;
        return e;
    }

    function children(parent) { return Array.prototype.slice.call(parent.children); }

    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    function chunk(items, n) {
        var rows = [];
        for (var i = 0; i < items.length; i += n) rows.push(items.slice(i, i + n));
        return rows;
    }

    function register(name, def) {
        views[name] = def;
        focus[name] = { r: def.startRow || 0, c: 0, last: {} };
    }

    /*
     * The hint bar sits outside the views so it survives view switches. An overlay keeps its own
     * hints if it declares them and otherwise leaves the bar beneath it alone, so a pop-up over
     * Home does not blank Home's shortcuts.
     */
    function renderHints(def) {
        var bar = $('hints');
        if (!bar) return;
        var list = typeof def.hints === 'function' ? def.hints() : def.hints;
        if (!list && def.overlay) return;
        bar.innerHTML = '';
        if (!list || !list.length) {
            bar.classList.add('hidden');
            return;
        }
        list.forEach(function (h) {
            var group = el('div', 'hint');
            group.appendChild(el('span', 'hint-key', h[0]));
            group.appendChild(el('span', 'hint-label', h[1]));
            bar.appendChild(group);
        });
        bar.classList.remove('hidden');
    }

    // opts.back: returning to this view (do not remember where we came from)
    function show(name, opts) {
        opts = opts || {};
        var def = views[name];
        if (!opts.back && !def.overlay && current && current !== name) def.from = current;
        if (def.overlay) def.from = current;
        current = name;
        Object.keys(views).forEach(function (n) {
            var v = views[n];
            if (!v.el) return;
            var visible = n === name || (def.overlay && n === def.from);
            v.el.classList.toggle('hidden', !visible);
        });
        if (def.onShow) def.onShow(opts);
        // After onShow, so hints that read state see the state this view just rendered.
        renderHints(def);
        refresh();
    }

    function back() {
        var def = views[current];
        if (def.onBack && def.onBack()) return;
        if (def.from) show(def.from, { back: true });
    }

    function rows() {
        var def = views[current];
        return def.rows ? def.rows().filter(function (r) { return r.length; }) : [];
    }

    function focusedEl() {
        var r = rows();
        if (!r.length) return null;
        var f = focus[current];
        f.r = clamp(f.r, 0, r.length - 1);
        f.c = clamp(f.c, 0, r[f.r].length - 1);
        return r[f.r][f.c];
    }

    function setFocus(target) {
        var prev = document.querySelectorAll('.focused');
        for (var i = 0; i < prev.length; i++) prev[i].classList.remove('focused');
        if (!target) return;
        target.classList.add('focused');
        ensureVisible(target);
        var def = views[current];
        if (def.onFocus) def.onFocus(target);
    }

    function refresh() {
        var def = views[current];
        setFocus(def.focusEl ? def.focusEl() : focusedEl());
    }

    // Point generic focus at an element (e.g. after re-rendering).
    function focusOn(target) {
        var r = rows();
        for (var i = 0; i < r.length; i++) {
            var c = r[i].indexOf(target);
            if (c >= 0) {
                focus[current].r = i;
                focus[current].c = c;
            }
        }
        refresh();
    }

    function centerX(e) {
        var b = e.getBoundingClientRect();
        return b.left + b.width / 2;
    }

    function rowIsThumbs(row) {
        return !!(row && row[0] && row[0].classList && row[0].classList.contains('thumb'));
    }

    function firstThumbRow(rowsList) {
        for (var i = 0; i < rowsList.length; i++) {
            if (rowIsThumbs(rowsList[i])) return i;
        }
        return -1;
    }

    function lastThumbRow(rowsList) {
        for (var i = rowsList.length - 1; i >= 0; i--) {
            if (rowIsThumbs(rowsList[i])) return i;
        }
        return -1;
    }

    function move(dr, dc) {
        var r = rows();
        if (!r.length) return;
        var f = focus[current];
        focusedEl();
        // Remembered so the sound can tell a real move from a clamp at the edge of a row.
        var wasR = f.r;
        var wasC = f.c;
        // 'start' | 'end' when wrap jumps across the list — scroll must jump too, not nudge.
        var wrapJump = '';
        if (dc) {
            var nc = f.c + dc;
            var rowLen = r[f.r].length;
            // Photo grids: ◀/▶ snake through every thumb; last → first and first → last.
            if (views[current] && views[current].wrap && rowIsThumbs(r[f.r])) {
                if (nc < 0) {
                    var pr = f.r - 1;
                    while (pr >= 0 && !rowIsThumbs(r[pr])) pr--;
                    if (pr < 0) pr = lastThumbRow(r);
                    if (pr >= 0) {
                        f.last[f.r] = f.c;
                        f.r = pr;
                        f.c = r[pr].length - 1;
                    }
                } else if (nc >= rowLen) {
                    var nrThumb = f.r + 1;
                    while (nrThumb < r.length && !rowIsThumbs(r[nrThumb])) nrThumb++;
                    if (nrThumb >= r.length) nrThumb = firstThumbRow(r);
                    if (nrThumb >= 0) {
                        f.last[f.r] = f.c;
                        f.r = nrThumb;
                        f.c = 0;
                    }
                } else {
                    f.c = nc;
                }
            } else if (views[current] && views[current].wrap && rowLen > 1) {
                // Wrap within the row (Home apps / consoles, Settings chip rows).
                if (nc < 0) {
                    nc = rowLen - 1;
                    wrapJump = 'end';
                } else if (nc >= rowLen) {
                    nc = 0;
                    wrapJump = 'start';
                }
                f.c = nc;
            } else {
                f.c = clamp(nc, 0, rowLen - 1);
            }
        }
        if (dr) {
            var nr = f.r + dr;
            // One more Down past the bottom → top (and Up past top → bottom).
            if (views[current] && views[current].wrap) {
                if (nr < 0) {
                    nr = r.length - 1;
                    wrapJump = 'end';
                } else if (nr >= r.length) {
                    nr = 0;
                    wrapJump = 'start';
                }
            } else {
                nr = clamp(nr, 0, r.length - 1);
            }
            if (nr !== f.r) {
                f.last[f.r] = f.c;
                var best = 0;
                // Leaving a single-item row (e.g. the gear) returns to where we were in the target row.
                if (r[f.r].length === 1 && f.last[nr] !== undefined) {
                    best = clamp(f.last[nr], 0, r[nr].length - 1);
                } else {
                    var x = centerX(r[f.r][f.c]);
                    r[nr].forEach(function (e, i) {
                        if (Math.abs(centerX(e) - x) < Math.abs(centerX(r[nr][best]) - x)) best = i;
                    });
                }
                f.r = nr;
                f.c = best;
            }
        }
        if (window.Sound) Sound.play(f.r === wasR && f.c === wasC ? 'edge' : 'move');
        refresh();
        if (wrapJump) scrollAfterWrap(focusedEl(), wrapJump);
    }

    // After wrap, jump the scroller/track so the focused edge item is on screen (nudge is not enough).
    function scrollAfterWrap(item, jump) {
        if (!item) return;
        var scroller = item.closest && item.closest('.scroll-y');
        if (scroller) {
            // Thumb wraps stay mid-page — only nudge the item. Yanking scrollTop to 0/max
            // made the whole Background page jump when wrapping on row 2+.
            if (!(item.classList && item.classList.contains('thumb'))) {
                scroller.scrollTop = jump === 'start' ? 0 : scroller.scrollHeight;
            }
            ensureVisible(item);
            return;
        }
        var track = item.parentNode;
        if (!track) return;
        var horizontal = track.classList.contains('row-track');
        var vertical = track.classList.contains('grid') || track.classList.contains('vtrack');
        if (!horizontal && !vertical) return;
        if (jump === 'start') {
            track._pos = 0;
            track.style.transform = '';
            ensureVisible(item);
            return;
        }
        ensureVisible(item);
    }

    // Scrolls the focused element's track with a transform (no layout scrolling).
    // Horizontal for .row-track, vertical for .grid and .vtrack.
    function ensureVisible(item) {
        var scroller = item.closest && item.closest('.scroll-y');
        if (scroller) {
            // Prefer the whole setting block so the h2 is not clipped above On/Off chips.
            // Photo thumbs and other tall grids scroll the focused item only — never the whole
            // block, and never yank the h2 back (that made the gallery jump on every move).
            var p = scroller.getBoundingClientRect();
            var block = item.closest && item.closest('.setting-block');
            var isThumb = item.classList && item.classList.contains('thumb');
            var target = (!isThumb && block && block.getBoundingClientRect().height <= p.height)
                ? block
                : item;
            // Measure the thumb box (img scale does not expand the parent's border box).
            var r = target.getBoundingClientRect();
            // Room for focus rings + sticky section titles; keep clear of the hints bar.
            var padTop = isThumb ? 16 : 64;
            var padBottom = isThumb ? 20 : 56;
            if (r.bottom > p.bottom - padBottom) scroller.scrollTop += r.bottom - (p.bottom - padBottom);
            else if (r.top < p.top + padTop) scroller.scrollTop -= (p.top + padTop) - r.top;
            // Short chip blocks only: keep the section heading on screen with the controls.
            if (!isThumb && block && target === item) {
                var head = block.querySelector('h2');
                if (head) {
                    p = scroller.getBoundingClientRect();
                    var hr = head.getBoundingClientRect();
                    if (hr.top < p.top + 8) {
                        scroller.scrollTop -= (p.top + 8) - hr.top;
                        r = item.getBoundingClientRect();
                        p = scroller.getBoundingClientRect();
                        if (r.bottom > p.bottom - padBottom) {
                            scroller.scrollTop += r.bottom - (p.bottom - padBottom);
                        }
                    }
                }
            }
            return;
        }
        var track = item.parentNode;
        var horizontal = track.classList.contains('row-track');
        var vertical = track.classList.contains('grid') || track.classList.contains('vtrack');
        if (!horizontal && !vertical) return;
        var port = track.parentNode;
        var cs = getComputedStyle(port);
        var size = horizontal
            ? port.clientWidth - (parseInt(cs.paddingLeft, 10) || 0) - (parseInt(cs.paddingRight, 10) || 0)
            : port.clientHeight - (parseInt(cs.paddingTop, 10) || 0);
        var start = horizontal ? item.offsetLeft : item.offsetTop;
        var len = horizontal ? item.offsetWidth : item.offsetHeight;
        var pos = track._pos || 0;
        if (start < pos) pos = start;
        else if (start + len > pos + size) pos = start + len - size;
        if (pos !== track._pos) {
            track._pos = pos;
            track.style.transform = horizontal ? 'translateX(' + (-pos) + 'px)' : 'translateY(' + (-pos) + 'px)';
        }
        if (port && port._syncMore) port._syncMore();
    }

    function resetScroll(track) {
        track._pos = 0;
        track.style.transform = '';
        var port = track && track.parentNode;
        if (port && port._syncMore) port._syncMore();
    }

    var keyHook = null;   // e.g. HDMI shown inside the launcher swallows keys

    function onKey(e) {
        var k = e.keyCode;
        if (keyHook && keyHook(k)) {
            e.preventDefault();
            return;
        }
        var def = views[current];
        var handled = def.onKey ? def.onKey(k) : false;
        if (handled === 'pass') return;
        if (handled) {
            e.preventDefault();
            return;
        }
        switch (k) {
            case KEY.UP: move(-1, 0); break;
            case KEY.DOWN: move(1, 0); break;
            case KEY.LEFT: move(0, -1); break;
            case KEY.RIGHT: move(0, 1); break;
            case KEY.ENTER:
                var cur = def.focusEl ? def.focusEl() : focusedEl();
                if (cur && cur._item && def.activate) def.activate(cur._item, cur);
                break;
            case KEY.BACK: case KEY.ESC: case KEY.BACKSPACE: back(); break;
        }
        e.preventDefault();
    }

    var toastTimer = null;
    function toast(msg) {
        $('toast').textContent = msg;
        $('toast').classList.add('visible');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { $('toast').classList.remove('visible'); }, 3500);
    }

    // Spinner with a short delay so fast launches do not flash. Nested calls share one ring.
    var busyDepth = 0;
    var busyDelay = null;
    var BUSY_DELAY_MS = 180;

    function busyShow() {
        busyDepth++;
        if (busyDepth !== 1) return;
        busyDelay = setTimeout(function () {
            busyDelay = null;
            var el = $('busy');
            if (el) el.classList.add('visible');
        }, BUSY_DELAY_MS);
    }

    function busyHide() {
        if (busyDepth > 0) busyDepth--;
        if (busyDepth > 0) return;
        if (busyDelay) {
            clearTimeout(busyDelay);
            busyDelay = null;
        }
        var el = $('busy');
        if (el) el.classList.remove('visible');
    }

    // Show the spinner while `promise` runs; always clears afterward.
    function busy(promise) {
        busyShow();
        return Promise.resolve(promise).then(function (value) {
            busyHide();
            return value;
        }, function (err) {
            busyHide();
            throw err;
        });
    }

    // Small pop-up list. Long lists show MENU_PAGE rows and slide the window on ▲/▼.
    var MENU_PAGE = 10;
    var menuOpts = [];
    var menuFocus = 0;
    var menuStart = 0;

    function renderMenuList() {
        var list = $('menu-list');
        var box = list.parentNode;
        list.innerHTML = '';
        var end = Math.min(menuStart + MENU_PAGE, menuOpts.length);
        var i;
        for (i = menuStart; i < end; i++) {
            var o = menuOpts[i];
            var cls = o.checked ? 'checked' : '';
            if (o.mini) cls = (cls ? cls + ' ' : '') + 'has-mini';
            // Settings-style rows: value set, or kind action/danger (Rename / Remove / …).
            var isSetting = o.value != null || o.kind === 'action' || o.kind === 'danger';
            if (isSetting) {
                cls = (cls ? cls + ' ' : '') + 'menu-setting';
                if (o.kind === 'action') cls += ' menu-setting-action';
                if (o.kind === 'danger') cls += ' menu-setting-action menu-setting-danger';
            }
            var li = el('li', cls);
            if (o.mini) {
                li.appendChild(o.mini);
                li.appendChild(el('span', 'menu-label', o.label));
            } else if (isSetting) {
                li.appendChild(el('span', 'setting-label', o.label));
                if (o.value) li.appendChild(el('span', 'setting-value', o.value));
                if (!o.checked && o.kind !== 'action' && o.kind !== 'danger') {
                    li.appendChild(el('span', 'setting-chevron', '\u203A'));
                }
            } else {
                li.textContent = o.label;
            }
            li._item = o;
            list.appendChild(li);
        }
        if (box) {
            box.classList.toggle('more-above', menuStart > 0);
            box.classList.toggle('more-below', end < menuOpts.length);
        }
        focus.menu = { r: menuFocus - menuStart, c: 0, last: {} };
    }

    // options: [{ label, run, checked, mini, kind, value }]
    // opts.onBack: ◀ one-level-up callback (reopen parent). Back key always cancels the stack.
    // opts.detail: second prompt row under the title (muted supporting text).
    var menuBack = null;

    function menu(title, options, opts) {
        opts = opts || {};
        menuBack = opts.onBack || null;
        menuOpts = options || [];
        menuFocus = 0;
        for (var i = 0; i < menuOpts.length; i++) {
            if (menuOpts[i].checked || menuOpts[i].current) {
                menuFocus = i;
                break;
            }
        }
        var maxStart = Math.max(0, menuOpts.length - MENU_PAGE);
        menuStart = clamp(menuFocus - Math.floor((MENU_PAGE - 1) / 2), 0, maxStart);
        var titleEl = $('menu-title');
        var detailEl = $('menu-detail');
        titleEl.textContent = title;
        if (detailEl) {
            var detail = opts.detail || '';
            detailEl.textContent = detail;
            detailEl.classList.toggle('hidden', !detail);
            titleEl.classList.toggle('menu-title-solo', !detail);
        }
        var box = $('menu-list') && $('menu-list').parentNode;
        if (box) {
            var hasMini = menuOpts.some(function (o) { return !!o.mini; });
            var hasSetting = menuOpts.some(function (o) {
                return o.value != null || o.kind === 'action' || o.kind === 'danger';
            });
            box.classList.toggle('menu-with-minis', hasMini);
            box.classList.toggle('menu-with-settings', hasSetting && !hasMini);
        }
        renderMenuList();
        show('menu');
        if (menuOpts[menuFocus] && menuOpts[menuFocus].focus) menuOpts[menuFocus].focus();
    }

    // Redraw the open menu after its rows changed (labels, hints); keeps the focused row.
    function refreshMenu() {
        renderMenuList();
        renderHints(views.menu);
        refresh();
    }

    function menuMove(delta) {
        if (!menuOpts.length) return true;
        var next = menuFocus + delta;
        var wrapped = false;
        if (next < 0) {
            next = menuOpts.length - 1;
            wrapped = true;
        } else if (next >= menuOpts.length) {
            next = 0;
            wrapped = true;
        }
        if (next === menuFocus) {
            if (window.Sound) Sound.play('edge');
            return true;
        }
        menuFocus = next;
        // Wrap must reset the window — incremental slide leaves the wrong page on screen.
        if (wrapped && delta > 0) menuStart = 0;
        else if (wrapped && delta < 0) menuStart = Math.max(0, menuOpts.length - MENU_PAGE);
        else {
            if (menuFocus < menuStart) menuStart = menuFocus;
            if (menuFocus >= menuStart + MENU_PAGE) menuStart = menuFocus - MENU_PAGE + 1;
        }
        renderMenuList();
        renderHints(views.menu);
        refresh();
        if (menuOpts[menuFocus] && menuOpts[menuFocus].focus) menuOpts[menuFocus].focus();
        if (window.Sound) Sound.play('move');
        return true;
    }

    function init() {
        register('menu', {
            el: $('menu'),
            overlay: true,
            // Back = cancel the whole menu stack (do not reopen a parent submenu).
            onBack: function () {
                menuBack = null;
                return false;
            },
            hints: function () {
                var cur = menuOpts[menuFocus] || {};
                var keys = menuOpts.length > MENU_PAGE ? [['▲ ▼', 'Scroll']] : [];
                keys.push(cur.keep ? ['OK', 'Play / pause'] : ['OK', 'Confirm']);
                if (cur.alt) keys.push(['Right', cur.altLabel || 'More']);
                if (cur.alt2 && !menuBack) keys.push(['Left', cur.alt2Label || 'More']);
                else keys.push(['◀', menuBack ? 'Back' : 'Close']);
                keys.push(['Back', 'Cancel']);
                return keys;
            },
            rows: function () { return children($('menu-list')).map(function (li) { return [li]; }); },
            onKey: function (k) {
                if (k === KEY.UP) return menuMove(-1);
                if (k === KEY.DOWN) return menuMove(1);
                var cur = menuOpts[menuFocus];
                if (cur && cur.alt && k === KEY.RIGHT) { cur.alt(); return true; }
                // ◀: one level back when nested; otherwise close the menu.
                if (k === KEY.LEFT) {
                    if (cur && cur.alt2 && !menuBack) { cur.alt2(); return true; }
                    if (menuBack) {
                        var up = menuBack;
                        menuBack = null;
                        show(views.menu.from, { back: true });
                        up();
                        return true;
                    }
                    show(views.menu.from, { back: true });
                    return true;
                }
                // ▶ opens the focused row when it has a run (Settings-style drill-in).
                if (k === KEY.RIGHT && cur && cur.run && !cur.keep && !cur.alt) {
                    if (views.menu.activate) views.menu.activate(cur);
                    return true;
                }
                return false;
            },
            activate: function (o) {
                if (o.keep) {
                    if (o.run) o.run();
                    return;
                }
                show(views.menu.from, { back: true });
                if (o.run) o.run();
            }
        });
        document.addEventListener('keydown', onKey);
    }

    window.UI = {
        KEY: KEY,
        $: $,
        el: el,
        children: children,
        clamp: clamp,
        chunk: chunk,
        register: register,
        show: show,
        back: back,
        refresh: refresh,
        setFocus: setFocus,
        focusOn: focusOn,
        resetScroll: resetScroll,
        // For state changes that redraw hints without switching view.
        refreshHints: function () { renderHints(views[current]); },
        toast: toast,
        busy: busy,
        busyShow: busyShow,
        busyHide: busyHide,
        menu: menu,
        init: init,
        current: function () { return current; },
        from: function () { return views[current] && views[current].from; },
        // True when focus is on the first item of its row (for ◀ = Back on detail pages).
        atRowStart: function () {
            var f = focus[current];
            return !f || f.c === 0;
        },
        isVisible: function (name) { return current === name; },
        refreshMenu: refreshMenu,
        setKeyHook: function (fn) { keyHook = fn; },
    };
})();
