# Changelog

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
