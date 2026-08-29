# Architecture

## Dependency direction

```text
Expo Router screens ──┐
                     ├── application ── domain
Electron renderer ───┘        │
                              ├── extension protocol/runtime
Expo adapters ───────── database/sync contracts ───────── Electron main adapters
```

The shared packages contain data models, deterministic merge rules, source contracts,
and use cases. UI and operating-system integrations remain in their application. This
keeps the product behaviour shared without forcing React Native view primitives into a
DOM renderer or leaking Node APIs into mobile bundles.

## Mobile

`apps/mobile` remains an Expo Router application. Existing mobile database and library
code is intentionally kept operational while it is moved behind the shared repository
interfaces incrementally. Android SAF, extension-scoped secure storage, and Expo SQLite
remain mobile adapters.

Remote add-ons run behind HTTPS and exchange versioned JSON resources with the host. The
app does not download or execute third-party JavaScript. Reviewed native integrations
publish JSON device workflows interpreted through fixed directory, file, archive,
SQLite, preferences, and Android-intent primitives.

The Moon+ Reader community add-on contains only its package ids, MIME types, and
local-file action definition. Moon+ progress uses Tomeio Sync's first-party WebDAV
compatibility endpoint. Legacy backup-database parsing is not part of the live sync path.

## Desktop

`apps/desktop` uses Electron with three boundaries:

- `main` owns filesystem, dialogs, persistence, networking credentials, and future
  SQLite access.
- `preload` exposes a narrow typed API defined by `@tomeio/contracts`.
- `renderer` is a sandboxed React DOM client with no Node access.

`contextIsolation`, sandboxing, and disabled Node integration are defaults. New desktop
capabilities must be added as explicit IPC methods rather than exposing `ipcRenderer`.

## Database evolution

`@tomeio/database` defines the portable driver and normalized core schema. The existing
mobile schema is not destructively migrated by this restructuring. The next database
step is an Expo SQLite driver and an Electron main-process SQLite driver, followed by
repository-by-repository migration of library orchestration out of React context.

## Web

Expo web remains available during the desktop transition. It should use browser-safe
storage and networking adapters; Node-only PDF and filesystem implementations must be
loaded behind platform entry points. The Electron renderer is not the place for native
database or filesystem dependencies.
