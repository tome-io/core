# Discord release announcements

## Draft for the next release — not posted

**Pagebound comes to Tomeio, with faster book browsing**

- Connect the Pagebound community extension to browse discovery feeds and your reading shelves, with book ratings and written reviews featuring reader avatars.
- Book lists appear while missing ratings load, and reviews avoid restarting as book details arrive.
- Pagebound keeps you signed in between visits and signs in again when your saved session is no longer valid.
- Download and review sections stay hidden when a source has no results.

This release also includes guided setup, improved reading estimates and page counts,
genre and series browsing, and smoother library sync with shared progress and cover
choices for matching books across devices.

Use the updated Tomeio app with Pagebound 0.1.4 for session reuse. Browsing Pagebound
shelves does not automatically import your library or synchronize reading progress.
Store submission and availability for this release have not yet been confirmed.

## Previously published announcements

Published through Omnicord on 5 September 2026. Both releases were described as pending store rollout. Twelve legacy documentation and release-preview messages were updated in place. All sixteen posted/edited messages were read back and verified.

## General

[Discord message](https://discord.com/channels/1542824348447014912/1542824349395066962/1545874910751232003)

@everyone A new Tomeio update is in the pipeline for both iOS and Android! Store processing is still underway, so it may not appear for you yet.

There's a fresh guided welcome, better reading estimates and page counts, genre browsing, and improvements to library sync. Matching book files can share one library entry and progress, and your chosen cover provider follows you across devices when available.

Full details are in <#1542831111842041878>, with rollout news in <#1542831109232926824>. The setup guides and <#1542831114245242993> have also been updated.

Thanks for the feedback that helped shape this release. Once it reaches your device, let us know how it's working in <#1542831118393409556>!

## Announcements

[Discord message](https://discord.com/channels/1542824348447014912/1542831109232926824/1545874907152384192)

**Tomeio update: iOS and Android releases submitted**

Both releases are now in the store pipelines. Availability is not yet confirmed.

This update brings a new guided welcome, clearer reader counts and steadier estimates, genre browsing with supported sources, matching books across different files, synced cover preferences, and smoother library refreshes.

We've updated the setup and sync guides, including what to expect when different editions share progress. The reported duplicate-book, reading-estimate, and screen-dimming issues are addressed in the pending builds; see <#1542831114245242993>.

Full release notes: https://discord.com/channels/1542824348447014912/1542831111842041878/1545874403500490772

## Release notes

[Discord message](https://discord.com/channels/1542824348447014912/1542831111842041878/1545874403500490772)

**Coming next to Tomeio on iOS and Android**

Both releases have been submitted and are in the store pipelines.

- **A warmer welcome:** animated book covers and a short setup for your book sources, library folder, and optional sync account.
- **A clearer reader:** steadier time-left estimates, cleaner chapter and total counts, improved position restoration, and a screen that stays awake while reading.
- **One book across devices:** matching EPUB files can share a library entry and progress without deleting your local files. Positions across different editions are approximate.
- **Your cover choice, everywhere:** your selected cover provider syncs to other devices when that provider is available there.
- **Find your next read:** browse genres with supported sources, including Open Library, even without entering a search term.
- **Better library updates:** improved series enrichment and fewer unnecessary sync uploads or repeated metadata reads.


Reading-session tracking is also included as groundwork for future daily totals and streaks; widgets and a history screen are not included yet.

Please report any remaining problems in <#1542831118393409556> with your app version, device, and steps to reproduce.

## Known issues

[Discord message](https://discord.com/channels/1542824348447014912/1542831114245242993/1545874903029522484)

**Update on the reported issues — fixes in the pending release**

The iOS and Android builds in the store pipelines include changes addressing:
- Duplicate library entries and disconnected progress for matching books with different file hashes.
- Time-left estimates that stay on “estimating” or jump dramatically between pages.
- The screen dimming while the built-in reader is active.

The update also improves restored page counts and reduces unnecessary sync uploads. Matching editions can share a library entry, but positions between different EPUBs remain approximate; KOReader still needs an anchor for its own file.

These changes are awaiting store rollout, so the reports may still apply to your installed build. Once updated, please report any remaining problems in <#1542831118393409556> with your version and reproduction steps.

Release notes: https://discord.com/channels/1542824348447014912/1542831111842041878/1545874403500490772
