# Readio extensions

`official/` contains source providers shipped with Readio. They implement the same
manifest and resource contracts used by third-party extensions, but are compiled
with the application so they work without downloading executable code.

Third-party extensions are not listed or browsed in the app. A user explicitly
installs one by pasting its HTTPS repository or `reado-extension.json` URL. A
repository URL resolves to the manifest at its root.

Third-party manifests can use declarative or HTTP transports. Script transports
must reference an immutable bundle and include its SHA-256 digest; each platform
must provide a sandbox before such a bundle can run. Readio never executes a raw
TypeScript file or an unverified branch-head script.

The future public extension repository belongs in the `readoi` GitHub organization
as a separate repository. It is intentionally not hard-coded here and is not an
in-app community catalog.

ManyBooks is not bundled because it does not currently provide a documented public
API suitable for this client. Project Gutenberg, Internet Archive, and Open Library
are the initial official sources.
