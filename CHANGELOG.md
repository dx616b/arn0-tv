# Changelog

## Unreleased

### Settings
- Flat Settings hub with section headers (Home screen, Atmosphere, Samsung, Advanced); OK / ▶ opens, ◀ goes back
- Hub rows show the current value (Background mode, Music, Weather, counts, …)
- Detail pages: clearer panels and focus, Left-at-edge goes back, scroll clearance above the hints bar
- Background Live: Shuffle and Queue size tucked under More options; shorter helper text
- Clear saved pins / Reset / Remove save: Cancel-first confirms with a two-line prompt
- Apps on Home and Consoles match the same row styling
- Appearance → Focus (Both / Scale / Ring) also applies to Settings rows, chips, Lab and screen saver menus (not pop-up menus)

## 0.7.1

### Live wallpaper
- Wallhaven: changing category no longer shows photos from the previous category
- Unsplash: photos come in order from the collection (or popular photos), not one per calendar day; the place is kept across restarts
- Unsplash: a collection shorter than the place it is at starts again from its first page (previously it showed nothing)
- Unsplash: each page's photo count and any error are written to the Lab log
- Immich: the album position (page and place in it) is kept across restarts, so photos are not shown again from the start of a page
- Live wallpaper: every queued photo is kept across restarts, not only part of the queue

## 0.7.0

### Music
- Music settings on one page: On/Off, then Navidrome or Radio, with that source's settings shown below
- Navidrome fields show only whether each is set (no server or user preview)
- Radio stations are SomaFM, Radio Record and Your list
- SomaFM channels come from SomaFM's channel feed, browsed by genre, then channel (cached for a day, built-in fallback)
- Radio Record stations come from Radio Record's station list, browsed by genre, then station (cached for a day, built-in six used only while no list is cached)
- Your list: add a stream by its https address; it is named from the address; Left removes it
- Favourites from any station, SomaFM channel or Your list entry; shown as "Favourites (n)" on the Radio page
- Next goes through: All channels (Radio Record, SomaFM, then Your list), Favourites, or Your list
- Menus: moving onto an entry plays it; OK plays or pauses it and keeps the list open; each row shows ☆ or ★; Right toggles a favourite; Left removes the entry from the list you are in; a tick marks the station only while it plays
- Back from a channel list returns to its genre list
- Next skips stations that do not play ("Not possible to play <name>"), one pass at most; a chosen station that fails stops with the same message
- A stream that has not started after 5 seconds counts as failed
- Radio failover tries each stream mirror in turn; a mirror no longer cancels the next one
- The bar shows "Not possible to play <name>" after a failure; a long title no longer restarts its scroll on every redraw

### Home
- Home no longer falls back to the small preview image (Wallhaven's is 300px) when a full-size photo fails to load
- Portrait photos show whole, with a blurred copy filling the sides (follows the Blur fill setting)

### Screen saver
- Exit freezes mid-pan and syncs the key onto Home; the same photo resumes drift from that pose
- When a photo will not load, the next photo is shown instead of a black screen (after five failures in a row it stops)

### Live wallpaper
- Photos that will not load are remembered for the session and not queued or shown again, for every provider
- Wallhaven: concurrent fills share one search request; after a failed detail request, detail requests pause for ten minutes
- Immich display prefers fullsize→preview (not multi-MP /original) so Home and the screensaver stay responsive on TV

### Lab
- Radio checks: Radio Record and SomaFM lists, the Next list, Your list, favourites
- Navidrome checks: show server (no password), test connection
- Photo checks: list addresses that will not load, forget them and try again

### Code structure
- Radio decisions (Next order, skip budget, what a failed stream does next) in radio-plan.js
- Radio Record and SomaFM feeds in their own modules (radiorecord.js, somafm.js)
- Settings split into one file per page (`src/js/settings-*.js`) with shared helpers in `settings-core.js`
- Live wallpaper split into focused modules; shared helpers `http.js`, `photo-util.js`, `live-core.js`, `live-parsers.js`, `pan-math.js`
- Lab probes are excluded from release builds

### Tooling
- ESLint flat config, `npm run lint` and `npm run check`; CI runs lint and tests
- Tests for radio decisions, SomaFM and Radio Record feeds, Your list and favourites preferences, Navidrome, photo providers and the photo fallback order, live parsers, HTTP helpers and pan maths
- `.nvmrc`, `.editorconfig`, `engines.node >= 20`; `package.json` and `config.xml` versions match

### Fixes
- Consoles page could reference undefined logo and launch-method lists

## 0.6.20

### Music
- Radio stall watchdog: if playback should be on but audio pauses or stops advancing, soft-restart → mirrors → next station; retry after all stations fail
- Kick recovery when waking from screensaver dark

### UI
- Toasts are text-only (no panel background)
- After Use now / Save from Live, mode chip shows Photo (Live picker stays open)
- Screen saver settings: keep block titles visible when focusing On/Off chips; legend wraps

### Live wallpaper
- Remote photos target 1920×1080 (Bing HD; Unsplash w/h fit=max; Wallhaven exact 1920×1080); Unsplash skips portraits
- Wallhaven provider (SFW, category chips; Mix defaults off); selecting it applies Home wallpaper like other sources
- Wallhaven captions: tags + uploader (no resolution); detail polish fills search rows
- Wallhaven category flags forced as 3-char strings + client filter (General no longer admits Anime)
- Mix no longer warms every source to the full Queue size in parallel (shallow ahead/plan; warm next 1–2 only)

## 0.6.19

### Screen saver
- Caption / clock / music / legend fade after idle; next key only shows them again
- Hide text after: 10 s / 20 s / 30 s / 1 min / Never (Settings; default 20 s)
- Go dark options include 5 / 10 / 15 min; default 15 min (was 1 hour)
- Wake from dark restarts the go-dark timer (was blacking out again on the next tick)

### Live wallpaper
- Stop Bing/NASA recycle spin when the upcoming plan already holds the tiny unique pool
- Bing HP archive: one network fetch per calendar day (cached); queue fills reuse that window
- Solo Bing: queue 8 stays selectable; 20/40 visible but locked
- Fix Immich caption polish (was calling /assets with `immich:`-prefixed key, so place/title never enriched)

### Develop
- `npm run build:local` injects Lab → PC `devLogUrl`; `npm run build` (release/CI) keeps it off
- Lab action list and log panel scroll; Right focuses the log
- Reset all settings also clears the weather reading cache

## 0.6.18

### Music
- Curated online Radio (no server): SomaFM + Radio Record house/dance/hip-hop/DnB and more
- Station picker menu; custom HTTPS stream URL; Next switches station
- Dead stream auto-fix (ice mirrors / aac, then next station); remember last good host
- Home bar and screensaver work with Radio alone (same pause/resume as Navidrome)

### Live wallpaper / performance
- Faster photo changes: debounce Live cache writes, skip extra EXIF decode for Bing/NASA/etc., defer plan fill and preload

### Screen saver
- While blacked out: any key (including Back) wakes the picture first; Back again exits
- Freeze photo drift under the black layer to reduce music glitches

## 0.6.17

### Live wallpaper / Mix
- Mix Mode Off = one source (radio); On = multi-select roster for Mix
- NASA APOD restored to science.nasa.gov image-article + media (working TV path)
- Seen-ring recycle so tiny Bing/NASA pools do not lock empty on a new install
- Leaner cold start: defer Live warm, pin hydrate, and weather fetch until after first paint
- Mix boots one ahead per source, sequential warm, then grows the queue

### Screen saver
- Caption and music marquees scroll at most 3 times (no minute replay)
- Weather temperature centered in the clock corner block

## 0.6.16

### Live wallpaper / Mix
- Multi-select Live sources in Settings; one chip alone or several as Mix
- Screen saver ↑↓ focuses a source without rewriting Settings chips
- Mix Shuffle permutes provider order, then plays round-robin (photos stay in fetch order)
- Solo Immich/Bing no longer absorb Mix leftovers (strict source tags + cache scrub)
- NASA APOD via apod-basic / assets.science.nasa.gov; leaner queues and soft Settings refresh

### Screen saver
- ↑↓ Live source, → next photo, ← next track, OK play/pause; on-screen legend
- Side blur pillars for portraits; softer fill; fixed clock/weather corner
- Caption/music marquee advances in place (no paging scroll)

### Photo shelf
- Save up to 20 Live pins; show count and on-device size
- Use now (temporary) or Save permanently from the Live picker
- Remove individual pins; hide unwanted shipped stills (Atmosphere → Restore)
- Clear pins refreshes the size label immediately

### Music / CI
- Start playback sooner; preload next track in the background
- Unit tests for Live multi-select / Mix behavior in CI

## 0.6.15

### Atmosphere / Live wallpaper
- Persist per-source ahead queues, plan, history, and seen keys (metadata only — not image bytes)
- Refill queues from the server; do not drop a slot without a replacement
- Mix picks across sources; Shuffle randomizes within the list
- Preload the next few wallpapers; provider switches keep picker thumbs warm
- Bing archive no longer spam-refetches when the pool is exhausted

### Saved pins
- Save up to 5 Live photos locally (image bytes in IndexedDB)
- Saving applies the photo on Home while the Live picker stays open for more saves
- Clear saved pins from Settings → Atmosphere
- Photo mode lists saved pins plus bundled wallpapers

### Settings / Home
- Settings hub: Home screen, Atmosphere, Samsung, Advanced
- TV Settings tile opens Samsung’s settings via ApplicationControl
- Busy spinner for slow launches and saves
- Fix left-column thumb clipping; drop the redundant Wallpaper heading

## 0.6.14

### Weather
- Auto-detect approximate location (IP geolocation) when enabling weather
- Search any city via Open-Meteo geocoding
- Remove the fixed preset city list from Settings

### Music
- Choose a Navidrome / Subsonic playlist as the playback source (or keep random)
- Fix password entry on Samsung IME (password field no longer saves empty)
- Compact Music settings: on/off, server, source, then icon transport / volume controls

### UI
- Long pop-up menus (playlists, search results) show 10 rows and scroll with Up / Down
