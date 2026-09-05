# Onboarding

A full-bleed welcome screen layers the Tomeio icon and wordmark over responsive columns
of bundled book covers. Columns move in alternating directions at different
speeds and fade into the same background gradient used by book detail screens.
The rotating wall extends beyond the viewport to keep its corners covered.
Artwork works offline; sources and licensing are recorded alongside the assets.
Motion stops off-screen and in the background, and respects Reduce Motion.

Three short, illustrated steps follow: providers, book storage, and optional
account sync. Back and Continue stay side by side in a bottom dock; Skip stays
at the top. Content scrolls independently on smaller screens. Native iOS actions
and menus are retained; Android uses the existing app controls. Background library
activity toasts are hidden during onboarding, while setup errors remain visible.

Provider choices use enabled extensions and the existing provider setters. The
extension manager and account dialog are shared with Settings, including email
verification and password recovery. Folder selection uses the existing native
picker and picker lock. App storage works without configuration. Choices and the
current step persist; Settings can reopen onboarding. Accounts remain optional.

## Preview on iOS

With a development build already installed in the simulator, run from the repo:

```sh
bun run ios:onboarding
```

This starts a dedicated Metro server on port 8082, clears its transform cache and
opens the iOS development client. The development-only flag forces the welcome
screen on launch/reload, even if onboarding was already completed or the app opens
on another route. Preview step/completion state stays in memory; existing saved
onboarding progress is preserved. Provider, folder and account choices are real
and persist as usual. Get started, Back, Skip and finish remain usable. Reload to
start the preview again. Stop this command and use the normal development server
to return to normal startup. No native rebuild is required for this UI change.

Validation: mobile TypeScript and scoped ESLint checks. No tests, builds,
simulator interaction or visual QA were run. On-device review should cover the
cover motion/fade, Reduce Motion, small screens and larger text, fixed controls,
folder cancellation, extension return navigation, optional sign-in and preview
relaunch after completing onboarding.
