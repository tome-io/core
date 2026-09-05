# Reading sessions

The built-in reader keeps an append-only SQLite session outbox. A reading session
starts when the reader is focused, active and displaying a book. Thirty-second
checkpoints and the final background/exit interval share a session ID. Intervals
split at local midnight and retain UTC timestamps and the local timezone offset.
Loading, background time, and suspended heartbeat gaps over one minute are excluded.

Signed-in sessions retain the account ID at recording time. Uploads use the
existing authenticated sync queue and acknowledge each immutable interval only
after the service confirms its ID. Offline failures retain the outbox for retry;
normal sync passes drain up to 100 intervals. Guest sessions stay local and are
not silently assigned to an account on a later login. Logout/account switching
does not upload another account's history.

Deploy the companion `tome-io/sync` session migration and routes first. D1's daily
endpoint rolls up intervals across devices and removes overlapping time. Widgets
and session-history UI are deferred. Existing lifetime counters are not converted
into sessions because they cannot establish which days were read.

Validation to run: mobile reader/session tests, service session tests, and device
checks for background/return, offline retry, midnight, account switching, and
force-close recovery. No runtime validation or migrations ran during implementation.
