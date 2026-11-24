# Screen saver pan resume (agent handoff)

## Goal

When the user leaves the screen saver and later returns **on the same photo**, drift must continue from the **exact mid-leg pose** where it was frozen — not from a corner reset.

Desired loop:

1. Saver is drifting (landscape pan **or** portrait focus-zoom).
2. User exits → **freeze** motion at the current pose.
3. Home shows (shared picture stream key is synced so Home’s current photo matches).
4. Saver opens again on that **same key** → first frame is that frozen pose, then drift **continues from there**.

Home vs saver may still differ in presentation (Home cover / portrait bias vs saver pan / pillars). That is fine. Do **not** park saver layers under Home.

## Non-goals

- Do not keep a live `#ss-still` overlay under Home UI (tried; rejected).
- Do not require Home to visually match the saver crop on exit.
- Different photo on reopen → normal `resetPan` + `startPan` (discard resume).

## Architecture (intended)

Two streams:

| Stream | Owner | Notes |
|--------|--------|--------|
| Picture | `Prefs.wallpaper` (`liveKey` / `photo`) + `LiveWallpaper` / `Wallpaper` | Shared. Exit writes the shown key; Home `apply()` uses it. |
| UI + pan | `#screensaver` layers only | Pan/zoom is saver-only. Freeze/resume is about this motion state. |

Pan model today (`src/js/screensaver.js`):

- **Landscape:** layer `translate(sign * coverX, sign * coverY)`; `startPan()` flips `panSign` and CSS-transitions to the other corner.
- **Portrait (`contain`):** layer fixed; **sharp img** uses `portraitTransform(sign)` → `translate(…) scale(…)` between zoomed-out (`sign > 0` → scale 1) and focus-in (`sign < 0` → scale `drift.zoom`).
- Drift budgets live on `layer._drift` from `computeDrift(ow, oh, portrait)` after decode in `showPhoto` → `swap`.

## Current code status (broken / incomplete)

Implemented in `src/js/screensaver.js` (unreleased; local `.wgt` only so far):

| Piece | Status |
|--------|--------|
| `syncHomeFromSaver(key)` on `close()` | Works — writes `liveKey`/`photo`, calls `Wallpaper.apply()`. |
| `freezePan()` on exit / go-dark | Works — snaps computed transform, clears `nextPanAt`. |
| `panResume` capture/restore | **Not accepted by user** — landscape/portrait resume still wrong in practice (esp. portrait). |
| `#ss-still` under Home | **Removed** — do not bring back. |
| Immich fullsize-first (separate issue) | Done in `live-wallpaper.js` — prefer fullsize→preview over `/original`. |

### What the current resume attempt does

On `close()`:

1. `freezePan()`
2. `capturePanResume(key)` — reads `getComputedStyle` matrix, derives:
   - landscape: `s ∈ [-1, 1]` from `tx / coverX`
   - portrait: `t ∈ [0, 1]` from `(scale - 1) / (zoom - 1)`
3. Tear down layer pixels; show Home.

On `showPhoto` → `swap` when `panResume.key === w.key`:

1. Layout photo (`_drift`, pillars, classes) on the back layer, flip `front`.
2. `applyResumePose` — rebuild `translate`/`scale` from `s`/`t` using **new** `_drift`.
3. Immediate `startPan()` (flips `panSign`, starts next leg).

Also: wake-from-dark no longer `resetPan`s; it only `startPan()` from the frozen layer.

### Why it still fails (likely)

1. **Portrait + `transform-origin: center`** (`.ss-photo.portrait .ss-photo-img`) — matrix → `(scale, tx)` decomposition / re-apply does not match the mid-transition visual; restore jumps or looks wrong.
2. **Progress measured against `_drift` at freeze**, restored against **recomputed** `_drift` after a new decode — zoom/cover can differ slightly (orient probe, URL fallback).
3. **Immediate `startPan()`** after restore can hide a bad restore (jump then move) or fight opacity crossfade onto the other layer.
4. Earlier iterations (raw matrix strings, `#ss-still`, “finish old leg”, artificial 1.2s hold) were rejected; do not revive them.

User feedback chronology: motion didn’t resume → resume jumped / didn’t keep still → portrait specifically broken → “do it properly” → current logical `s`/`t` approach still **“nope”**.

## What “done” looks like (acceptance)

On TV (Tizen), Drift On:

1. Open saver on a **landscape** live/rotate photo; wait until mid-pan; exit to Home; reopen saver → image starts at the same crop offset and keeps drifting (no corner reset, no jump).
2. Same for a **portrait** Immich/live photo (contain + side pillars + focus zoom).
3. Advance to another photo (Right / timer) → resume state cleared; normal pan from corner.
4. Exit does not leave saver motion running in the background.
5. No parked saver DOM under Home.

## Suggested approach for the next agent

Prefer **animator-owned progress**, not CSS matrix archaeology:

1. While a leg runs, track explicit progress (or `fromSign` / `toSign` + `legStartedAt` / `legDurationMs`) updated when `startPan`/`runPanLeg` begins — freeze just reads that, no `getComputedStyle`.
2. On resume, after `swap` has set `_drift` for **this** decode: `applyPose(progress)` using the same helpers as `corner` / `portraitTransform`, then `runPanLeg(remainingMs)` **without** flipping sign if finishing the same leg — or flip only when starting the next leg. Be consistent with one model.
3. For portrait, apply transforms only in the form `portraitTransform` already uses; keep `transform-origin: center`; do not round-trip through matrix.
4. Restore pose **before** fading the layer to opacity 1; optionally one frame still, then start motion — but the pose must already be correct.
5. Clear `panResume` whenever the shown key changes (`applyPhoto` / failed resume).
6. Verify on device with Immich portraits (orient probe + contain path) and Bing/Unsplash landscape.

## Key files

- `src/js/screensaver.js` — pan, freeze, `panResume`, `close`, `showPhoto`/`swap`
- `src/js/wallpaper.js` — Home `apply` / `display` (no still hooks anymore)
- `src/js/live-wallpaper.js` — Immich URL order (fullsize first); unrelated but in same worktree
- `CHANGELOG.md` — Unreleased screen saver / Immich notes

## Worktree note

Changes are local/uncommitted relative to the Mix throttle already shipped in **v0.6.20**. Pan-resume + Immich fullsize + Home key sync on saver exit are all still in the working tree pending a proper fix and release.
