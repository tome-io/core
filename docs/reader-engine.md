# Tomeio reader experiment

Tomeio owns the reading model. `react-native-readium` is an adapter for opening an
EPUB, rendering it, reporting locators and selections, and accepting navigation
commands. Reader state must remain usable if the rendering engine is replaced.

## Ownership

| Concern | Owner |
| --- | --- |
| Book identity, local file, collections, sync | Tomeio library |
| Last locator, reading time, preferences, highlights | Tomeio reader state |
| Progress merge and hosted synchronization | Tomeio library/sync |
| EPUB layout, pagination, selection geometry | Readium adapter |
| Reader chrome and interaction policy | Tomeio UI |

`src/lib/reader-state.ts` deliberately contains no Readium types. The mapping into
Readium locators, preferences, and decorations lives in `src/lib/readium-engine.ts`.

## KOReader interaction decisions used here

- Paginated reading is the default.
- Directional page turns are delegated to the native navigator.
- The top-center zone toggles reader chrome.
- The bottom-center zone opens typography and layout controls.
- Reading progress remains visible in a compact footer.
- Contents and typography are primary reader actions rather than nested app settings.
- Position, reading time, and annotations are saved continuously and flushed when the
  app backgrounds or the reader closes.

The zone proportions follow KOReader's defaults: the top and bottom menu areas are
kept shallow, while navigation remains available at the page edges. Tomeio uses native
Expo Router toolbars and SwiftUI sheets on iOS, and its existing React Native visual
language on Android.

## Experiment limits

- The integrated Readium package is currently enabled for downloaded EPUB files only.
- A development client rebuild is required because Readium and Nitro include native
  code.
- PDF/CBZ rendering needs a separate renderer adapter unless upstream support is made
  production-ready.
- Search and notes are intentionally deferred; highlights already persist in Tomeio's
  state so those features can be layered on without changing engine ownership.

## Footer and restoration follow-up

The footer shows only time remaining, chapter viewport count, and total publication position count. Readium's separate iOS position label is hidden by the dependency patch. The total remains Readium's stable publication-position count, not a screen-page total that changes with typography.

Restoration accepts the viewport containing the saved text offset, while sync equality remains exact. A matching already-observed location can complete restoration even when navigating to the same page emits no new event. On timeout the last actual navigator event is retained instead of leaving the footer without counts.

After installing the updated patch, rebuild the native iOS app; Metro reload alone cannot hide the native label. Runtime validation remains developer-controlled.

The iOS prebuild command now verifies that the installed Readium source includes the hidden native position label. A tracked patch alone is insufficient if node_modules was installed before the patch changed. The installed source was brought into agreement with the tracked hide-label change; rebuilding the native client remains required. Merely pressing i in Metro opens the existing binary and cannot change that native label.
