# Changelog

## Unreleased

### Home
- The screensaver shows the next photo when one will not load, instead of a black screen (after five failures in a row it stops)
- Home no longer falls back to the small preview image (Wallhaven's is 300px) when a full-size photo fails to load; it moves on to the next photo instead, and logs the failed address

### Music
- Radio Record stations come from Radio Record's own station list (cached for a day), grouped by genre like SomaFM; the built-in six are used only while no list is cached
- Music settings: Source chooses Navidrome or Radio; the chosen source's settings show on the same page
- Music: a station that can't play shows "Can't play <name>" until something plays
- Radio: stations are SomaFM, Radio Record and Your list; Your list holds streams you add by URL
- Moving onto any station, SomaFM channel, or Your list entry plays it (or says "Not possible to play"); OK plays or pauses the entry and keeps the list open; each row shows ☆ or ★; Right toggles the favourite; Left removes it from the list you are in
- Next goes through: All channels, Favourites, or Your list
- Favourites: save stations and SomaFM channels from the station menu; they appear at the top of the menu
- Next goes through all channels (Radio Record, then SomaFM) or only your favourites; choose in the Music settings
- The curated list now holds only Radio Record stations; SomaFM comes from the SomaFM channel list
- SomaFM channels are listed from SomaFM's own channel feed (cached for a day, offline fallback): pick a genre, then a channel; long menus scroll and rows stay on one line
- Radio failover tries each stream mirror in turn; a mirror no longer cancels the next one
- Next skips stations that do not play ("Not possible to play <name>") until one plays, one pass at most; a chosen station that fails stops with the same message
- A stream that has not started after 5 seconds counts as failed

### Code structure
- Radio decisions (Next order, skip budget, what a failed stream does next) moved out of music.js into radio-plan.js, with tests
- Settings split into one file per page (`src/js/settings-*.js`) with shared helpers in `settings-core.js`
- Shared helpers: `http.js` (requests), `photo-util.js` (photo fields and orientation), `live-core.js`, `live-parsers.js`, `pan-math.js`
- Lab probes are excluded from release builds

### Tooling
- ESLint flat config (`eslint.config.mjs`), `npm run lint` and `npm run check`; CI runs lint and tests
- Unit tests for pan maths, live parsers, HTTP helpers and wallpaper field mapping
- `.nvmrc`, `.editorconfig`, `engines.node >= 20`; `package.json` version matches `config.xml`

### Fixes
- Consoles page could reference undefined logo and launch-method lists

### Home
- Portrait photos show whole (no zoomed crop), with a blurred copy filling the sides (follows the Blur fill setting)

### Screen saver
- Exit freezes mid-pan (logical landscape/portrait progress) and syncs the key onto Home; same photo resumes drift from that pose

### Live wallpaper
- Immich display prefers fullsize→preview (not multi-MP /original) so Home/saver stay responsive on TV

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
