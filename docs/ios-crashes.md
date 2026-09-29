# iOS crash investigation — September 29, 2026

## Launch failure on iOS 27

Five local Organizer reports from September 28–29 show build 6 terminating in
`UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption` on iOS 27.
The app used the legacy AppDelegate window startup without a scene manifest.

The app now opts into Expo SDK 57 scene support through
`expo-build-properties` (`ios.enableSceneSupport`). Expo and build-properties
are upgraded to versions supporting this migration. Shared native dependencies
are aligned with the upgraded Expo package to avoid duplicate native modules.
The plugin generates the scene manifest and moves window startup to Expo's
scene delegate while retaining AppDelegate event forwarding.

References:

- [Expo migration guide](https://github.com/expo/fyi/blob/main/ios-scene-lifecycle.md)
- [Apple scene lifecycle requirement](https://developer.apple.com/documentation/uikit/transitioning-to-the-uikit-scene-based-life-cycle)

### Before distributing

This requires regenerated native code and a new archive. An extension refresh
or JavaScript update cannot change the lifecycle of an installed binary.

For a local Xcode archive, from `apps/mobile` run:

```sh
bunx expo prebuild --clean --platform ios
```

Then open `ios/Tomeio.xcworkspace`, select the next build number, and archive.
Clean prebuild replaces the generated iOS project; preserve any intentional
manual native changes first. The existing `bun ios:ipa:production` command
already performs clean iOS prebuild before its EAS build.

Validate cold launch on iOS 27, background/foreground transitions, cold and warm
deep links, and background download completion before distributing. Native
generation, builds, and device validation were not run during this change.

## Text-selection exception on iOS 26.6.1

Two local reports from September 3 affect build 3. The exception originates in
`NSTextContentStorage offsetFromLocation:toLocation:` during SwiftUI text-field
selection updates. These reports do not identify which app field triggered it.
There are no newer occurrences in the local export; that does not establish
that the issue is resolved.

The app's native search field still mirrors React text into an Expo observable.
The installed `@expo/ui` 57.0.14 already includes selection clamping and clearing
for external writes from 57.0.8. The related
[upstream issue](https://github.com/expo/expo/issues/48274) has a different fatal
stack, so it is not sufficient evidence to attribute or close this exception.
No speculative text-field workaround is included in the lifecycle fix.

Keep this crash open pending reproduction or a report from the next binary.
Exercise typing, autocorrection, selection, clearing, and navigating away from
a focused search field on an affected iOS version. A fresh report should include
the exception reason and the screen/action that preceded it.
