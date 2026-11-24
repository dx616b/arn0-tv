/*
 * Radio decisions with no audio, timers, or UI: which station Next moves to, and what a failed
 * stream does next. music.js does the playing; these functions only decide. Exposed on window.RadioPlan.
 */
(function () {
    'use strict';

    // While Next skips, each station tries only its first mirrors, so a pass stays short.
    var SKIP_MIRRORS = 2;

    // The list Next steps through, from plain inputs:
    //   mode       'all' | 'radio' | 'somafm' | 'favourites' | 'list'
    //   stations   radio stations ({ id, ... })
    //   customs    Your list stations ({ id: 'custom:…', ... })
    //   somaGroups SomaFM groups ({ genre, channels: [{ id, genres, pls, ... }] })
    //   favourites saved entries ({ type: 'station' | 'custom' | 'soma', id, pls? })
    function navList(input) {
        var items = [];
        var stations = input.stations || [];
        var customs = input.customs || [];
        if (input.mode === 'list') {
            customs.forEach(function (st) { items.push({ key: st.id, station: st }); });
            return items;
        }
        if (input.mode === 'favourites') {
            (input.favourites || []).forEach(function (f) {
                if (f.type === 'station') {
                    var st = stations.find(function (s) { return s.id === f.id; });
                    if (st) items.push({ key: st.id, station: st });
                } else if (f.type === 'custom') {
                    var cf = customs.find(function (s) { return s.id === f.id; });
                    if (cf) items.push({ key: cf.id, station: cf });
                } else if (f.type === 'soma' && f.pls) {
                    items.push({ key: 'somafm:' + f.id, soma: { id: f.id, title: f.title, genres: [f.genre], pls: f.pls } });
                }
            });
            return items;
        }
        if (input.mode === 'radio') {
            stations.forEach(function (st) { items.push({ key: st.id, station: st }); });
            return items;
        }
        if (input.mode === 'somafm') {
            (input.somaGroups || []).forEach(function (g) {
                g.channels.forEach(function (c) { items.push({ key: 'somafm:' + c.id, soma: c }); });
            });
            return items;
        }
        stations.forEach(function (st) { items.push({ key: st.id, station: st }); });
        (input.somaGroups || []).forEach(function (g) {
            g.channels.forEach(function (c) { items.push({ key: 'somafm:' + c.id, soma: c }); });
        });
        customs.forEach(function (st) { items.push({ key: st.id, station: st }); });
        return items;
    }

    // Index of the playing station in the list (0 when it is not there).
    function indexOf(list, radioId) {
        var i = list.findIndex(function (it) { return it.key === radioId; });
        return i < 0 ? 0 : i;
    }

    // Index Next moves to. Playing keeps the selected station; only Next (or a skip) moves on.
    function nextIndex(list, radioId) {
        return (indexOf(list, radioId) + 1) % list.length;
    }

    // How many more stations one Next press may skip past: one pass over the list, not counting the
    // station it starts from. A station chosen directly (not Next) gets none.
    function skipBudget(listLength, fromNext) {
        return fromNext ? Math.max(0, listLength - 1) : 0;
    }

    // After one more failed mirror (mirrorIndex already counts it):
    //   'mirror' try the next mirror, 'skip' move to the next station, 'stop' stop and say so.
    function afterFailure(state) {
        var limit = state.skipLeft > 0 ? Math.min(state.mirrorCount, SKIP_MIRRORS) : state.mirrorCount;
        if (state.mirrorIndex < limit) return 'mirror';
        return state.skipLeft > 0 ? 'skip' : 'stop';
    }

    window.RadioPlan = {
        SKIP_MIRRORS: SKIP_MIRRORS,
        navList: navList,
        indexOf: indexOf,
        nextIndex: nextIndex,
        skipBudget: skipBudget,
        afterFailure: afterFailure
    };
})();
