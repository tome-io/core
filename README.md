# Readio

Readio is a book discovery, download, and library companion inspired by Stremio.
The repository is a Bun workspace containing the Expo mobile client, an Electron
macOS client, shared application packages, and bundled official source extensions.

## Repository layout

```text
apps/
  mobile/                 Expo Router app for Android, iOS, and the current web build
  desktop/                Electron main/preload processes and React DOM renderer
packages/
  application/            Platform-neutral use cases and ports
  contracts/              Typed desktop IPC contracts
  database/               Database driver contract and shared schema migrations
  design/                 Cross-platform design tokens
  domain/                 Book models, identity, and metadata utilities
  extension-protocol/     Extension manifest and book resource contracts
  extension-runtime/      Installation registry and transport loading
  official-extensions/    Bundled source registry
  sources/                Shared source HTTP/cache primitives
  sync/                   Progress sync document and merge rules
extensions/
  official/               Project Gutenberg, Internet Archive, and Open Library
```

Platform code owns platform capabilities. Expo adapters continue to own Android SAF,
Moon+ Reader, SecureStore, and `expo-sqlite`. Electron owns macOS filesystem access,
native dialogs, and its future SQLite adapter in the main process. Neither the DOM
renderer nor shared packages import Node or Expo APIs.

## Development

Install [Bun](https://bun.sh/) and install workspace dependencies from the repository
root:

```bash
bun install
```

Useful commands:

```bash
bun mobile
bun mobile:android
bun mobile:android:release
bun mobile:web
bun desktop
bun desktop:package
```

The package manager is Bun. Application runtimes remain Hermes on native Expo,
Chromium in web/renderer code, and Node in Electron's main process.

See [Architecture](docs/architecture.md) and [Extensions](docs/extensions.md).
