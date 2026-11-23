# Changelog

## 0.6.18

### Music
- Curated online Radio (no server): SomaFM + Radio Record house/dance/hip-hop/DnB and more
- Station picker menu; custom HTTPS stream URL; Next switches station
- Dead stream auto-fix (ice mirrors / aac, then next station); remember last good host
- Home bar and screensaver work with Radio alone (same pause/resume as Navidrome)

### Live wallpaper / performance
- Faster photo changes: debounce Live cache writes, skip extra EXIF decode for Bing/NASA/etc., defer plan fill and preload

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
