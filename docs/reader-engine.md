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
