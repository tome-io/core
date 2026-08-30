<p align="center">
  <img src="apps/mobile/assets/images/icon.png" width="152" alt="Tomeio logo" />
</p>

<h1 align="center">Tomeio</h1>

<p align="center">
  A book discovery, download, and library app built around extensions.
</p>

Tomeio brings catalogs, search, downloads, reading lists, and a local book library into one
application. It is inspired by [Stremio](https://www.stremio.com/), with book sources taking the
place of media add-ons.

## tomeio-core

`tomeio-core` contains the shared application logic, platform clients, and official extensions used
to build Tomeio. It is a Bun workspace with an Expo client for Android, iOS, and web, plus an early
Electron client for macOS.

### Goals

- Share book, library, extension, and progress-sync logic between clients.
- Keep operating-system APIs behind platform-specific adapters.
- Make catalogs and downloads extensible through a small resource protocol.
- Keep shared packages independent of React Native, Electron, and Node APIs.
- Preserve deterministic data and sync behavior across platforms.

### Apps

- `apps/mobile` — Expo Router client for Android, iOS, and web.
- `apps/desktop` — Electron main/preload processes and React renderer for macOS.

### Modules

- `application` — platform-neutral use cases and ports.
- `contracts` — typed IPC contracts shared by Electron processes.
- `database` — portable database driver contract and core schema.
- `design` — shared colors and design tokens.
- `domain` — book metadata, identity, acquisition, and progress models.
- `addon-sdk` — public TypeScript authoring API for declarative and HTTP add-ons.
- `extension-protocol` — manifest, resource, query, and response types.
- `extension-runtime` — extension installation, registry, and transport loading.
- `official-extensions` — registry of extensions bundled with Tomeio.
- `sources` — shared provider HTTP and cache utilities.
- `sync` — progress documents and deterministic merge rules.

The main dependency direction is:

```text
Expo screens ──────┐
                   ├── application ── domain
Electron renderer ─┘        │
                            ├── extension protocol/runtime
Platform adapters ──────────┴── database and sync contracts
```

Platform integrations stay in their clients. Expo owns Android Storage Access Framework,
SecureStore, external reader integration, and Expo SQLite. Electron's main process owns filesystem,
dialog, and native persistence access; its renderer does not have Node access.

## Extensions

Tomeio add-ons expose capability resources:

- `catalog` — discovery shelves and paged catalogs.
- `search` — provider search.
- `meta` — book details and metadata enrichment.
- `resolve` — provider-neutral search-to-download handoff.
- `acquisition` — downloadable formats or external open actions.
- `reader` — external reader progress.
- `libraryAction` — buttons rendered and controlled by Tomeio.

The official extensions are Open Library and Project Gutenberg. Open Library also provides
rights-verified downloads for its unrestricted Internet Archive scans.
They implement the common extension contract and are compiled with the app.

See [extensions/README.md](extensions/README.md) for the source layout and
[docs/extensions.md](docs/extensions.md) for the protocol.

## Development

Tomeio uses [Bun](https://bun.sh/) `1.4.x` and
[Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/).

```bash
bun install
```

Common commands:

```bash
bun mobile:start
bun mobile:android
bun mobile:ios
bun mobile:web
bun desktop
bun desktop:package
```

Workspace validation:

```bash
bun test
bun typecheck
bun lint
```

More detail is available in [docs/architecture.md](docs/architecture.md).

## License

Tomeio core is available under the [MIT License](LICENSE).
