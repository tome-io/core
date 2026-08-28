# Store releases

Tomeio store binaries are built and signed on local compute. EAS manages the signing credentials and build numbers, but no EAS build worker is used.

## Android

The app is linked to the `@luke1999/tomeio` EAS project. The first build can create or select the Android upload key interactively. EAS downloads that credential for the local Gradle build, and the remote app-version source increments the Play version code.

Build an AAB from the repository root:

```sh
bun run android:aab
```

The script performs a clean Android prebuild and then invokes `eas build --local`. The signed bundle is written to `apps/mobile/dist/`. The production filename variant is available through `bun run android:aab:production`.

Validate the bundle and store metadata with the repository-local Google Play configuration:

```sh
bun run play:validate
```

Google requires the first artifact and Play App Signing enrollment to be completed in Play Console. After that first release exists, future internal releases can be uploaded through the official API:

```sh
bun run play:release:internal
```

The Google Play service-account key is stored outside the repository at `~/.gplay/tomeio-play-console.json`. Local authentication state in `.gplay/config.json` is ignored by Git.

Consumer-facing copy and writing rules are maintained in [`release-notes/google-play.md`](release-notes/google-play.md). Keep `.gplay/release-notes.json` synchronized with its **Current release** section before publishing.

## iOS

The iOS bundle identifier is `org.tomeio.app`. EAS can manage the distribution certificate, provisioning profile, and build number while compiling and signing the archive on this Mac. The first build may ask for Apple Developer credentials and permission to create the App ID and signing assets.

```sh
bun run ios:ipa
```

The signed IPA is written to `apps/mobile/dist/`. The production filename variant is available through `bun run ios:ipa:production`.

TestFlight's **What's new** and **What to test** copy is maintained in [`release-notes/testflight.md`](release-notes/testflight.md).

App Store Connect and Play Console privacy details, tester groups, screenshots, and review information are managed in their respective store consoles. Tomeio's text listing metadata is stored in `.gplay/metadata` and can be synchronized with `gplay`.
