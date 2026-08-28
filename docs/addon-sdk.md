# Add-on SDK architecture

## Repository boundary

The public package is published from `tome-io/addon-sdk`:

```text
@tomeio/addon-sdk
├── protocol types and manifest validation
├── defineAddon(manifest, handlers)
├── defineWorkflow(definition)
├── defineDeviceWorkflow(definition)
├── createAddonHandler(addon)
├── readAddonConfiguration(request)
└── framework-independent Request/Response transport
```

The standalone package is published from `tome-io/addon-sdk`; `packages/addon-sdk` is its
in-tree compatibility copy for core development. External repositories pin a GitHub SDK
release, so they have no `workspace:*` dependencies and do not require npm publication.

The SDK is an authoring convenience, not the security boundary. The JSON protocol and
client interpreter are the boundary, so other languages can implement it without
executing inside Tomeio.

## Request flow

```text
search add-on ── BookMetadata/identifiers ──► Tomeio
                                                   │
                                                   ▼
download add-on ◄── resolve(BookReference) ── Tomeio
        │
        └── acquisition(providerBookId) ─────► normalized options ──► host download
```

This separates discovery identity from provider identity. Providers own their ids;
Tomeio carries known identifiers through the handoff instead of forcing every download
provider to reverse-engineer another provider's ids.

## Reader integrations

Reader integrations use the reviewed `device` transport. Their TypeScript source exports
a `defineDeviceWorkflow(...)` value and publishes the resulting JSON from GitHub. Tomeio
never downloads or evaluates the TypeScript or JavaScript.

Version 1 exposes fixed, bounded primitives:

- scan a user-selected directory;
- read a discovered text, JSON, or binary file;
- read a ZIP entry;
- run allow-listed read-only `SELECT` statements against discovered SQLite data;
- parse Android SharedPreferences XML;
- open a Tomeio-supplied local book URI in a declared Android package.

Every primitive requires a manifest capability. File reads are limited to URIs supplied
by Tomeio or returned by an earlier approved directory scan. Device workflows cannot
make network requests, inject UI, or return executable code. They map reader data to
provider-neutral `ExtensionReaderBook` records; Tomeio owns matching, persistence,
metadata enrichment, progress merging, and action rendering.

## Versioning

Manifest and response schemas are versioned independently from npm package releases.
Changes that only add optional fields are minor SDK releases. Removing a field, changing
endpoint semantics, or expanding a host permission requires a new manifest protocol
version and an explicit client compatibility range.

## Community registry

The community registry is published from `tome-io/extensions`. Each entry contains the
reviewed manifest URL, repository, minimum client version, review timestamp, and reviewed
device capabilities. The client fetches and validates its manifests for community
discovery; Moon+ Reader is not statically registered in the app.

The Moon+ integration itself lives in `tome-io/extensions/community/moon-reader` as a
manifest and device workflow. Core contains only the generic interpreter and Expo-backed
capability host. Existing `moonreader_*` SQLite names are retained solely for compatible
on-device schema evolution and are used as the shared reader-integration catalog.
