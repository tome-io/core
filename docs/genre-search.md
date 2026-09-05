# Genre search

Search resources may declare `subjectFilters: [{ id, name }]`. IDs are provider
specific; the mobile picker displays their names and passes `subject` through
the extension query, HTTP transport and declarative workflow values. Older
manifests remain compatible and do not advertise filtering they cannot perform.

Open Library 0.5.0 declares nine filters, including Horror & ghosts. It combines
the selected subject query with the title/author query at the source, preserves
pagination, and supports browsing a genre without typing a title. Horror is also
available as a discovery catalog. Other providers need to implement and declare
their filters before the app offers them.

The picker uses native menus on iOS and the existing option dialog on Android.
Changing a filter invalidates in-flight results and starts at the first page.
Genre selection is retained for subsequent pages; results are never filtered
only after downloading a page.

Run the Open Library search tests and validate genre-only search, combined text
search, pagination, and changing providers. Tests and runtime validation were not
run. Scoped typechecks passed. This branch is independent of onboarding.
