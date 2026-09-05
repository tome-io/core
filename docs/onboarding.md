# Setup guide

The initial route opens a four-step guide: introduction, provider choices, book
folder, and optional account sync. Choices and the current step persist in the
existing settings store. Every step can be skipped; completion returns to Home.
Settings can reopen the guide. Direct links into books remain usable without
forcing account creation or a setup detour.

Provider choices use enabled extensions and the existing provider setters. The
add-on manager and account dialog are shared with Settings, including extension
configuration, email verification and password recovery. iOS uses the existing
native action/menu controls; Android uses the existing custom controls.

Folder selection uses the existing native picker and picker lock. It persists
only a user-selected location. The primary folder can remain app storage; optional
Android mirroring stays in Settings. Accounts are optional and guest session
history remains local.

No Expo route generation, tests, app execution or device validation ran. The local
`.expo/types/router.d.ts` predates `/onboarding` and `/onboarding/extensions`, so
the typecheck reports those new paths until Expo refreshes its generated types.
After refreshing those declarations, run the mobile typecheck and validate skip,
resume, folder cancellation, add-on return navigation, and optional sign-in.
