# One library book, multiple files

The catalog retains each device's file records. Library cards group their shared
references using validated ISBNs, exact normalized title/author pairs, or aliases
confirmed by hosted sync. Each grouped card retains its linked book keys and local
file references and prefers an available local file. No EPUB files are deleted or
rewritten. Embedded EPUB ISBNs now survive metadata enrichment.

Sync registers all known file hashes as aliases of the logical book. Multiple
matches no longer fail merely because their MD5s differ. A later ISBN/metadata
match can bridge multiple existing groups, preserving their furthest progress.
Alias changes must be acknowledged by the service even when percentage is unchanged.

Exact Readium locators remain file-specific. Across different EPUBs, Tomeio restores
the shared percentage using the destination publication's own positions. This is
an approximate corresponding location; different forewords, chapter divisions or
editions can shift it. A work-level text-anchor mapping would be a separate feature.

Deploy the companion sync migration and identity implementation first. Review
`sync/docs/logical-books.md` for KOReader's file-anchor limitation and Kobo/Moon+
behavior. Run the focused identity/hosted-record/merge tests and validate two EPUB
variants across devices before merging; these checks were not executed here.
