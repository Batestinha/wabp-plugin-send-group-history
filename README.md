# Send Group History

Deliver retained group history to arriving members using host-generated archives and authorized delivery actions.

Standalone WABS package `official.send-group-history` version `0.4.4`, requiring WABP core API `^0.3.5`. The archive includes the SDK, Zod and Portuguese translations. Existing scope settings retain their identifiers, selected export formats, custom captions, exclusions, history window and enabled state.

WABP owns archive queries, rendering, identity resolution, localization, deduplication storage and delivery authorization. The plugin contains no archive database or browser renderer. Automatic arrivals return declared delivery and audit actions. Manual administration uses the host-provided transport and archive capabilities; neither path imports host source.

Install through a trusted WABS registry entry. Installation and scope enablement are separate operations. The publisher signs exact archive bytes; registry branding alone does not establish trust.

For development, run `npm ci --ignore-scripts`, `npm test`, then `npm run release:archive`. Tests use synthetic identities and archive buffers, with mocked host capabilities. CI checks Node22.23.2 and24.15.0, archive reproducibility and execution outside the repository.

`provenance.json` records imported source history and the exact SDK archive. Compiled runtime dependencies and their licenses are included in every release.

Manual archive delivery and console readiness, preflight and preparation now belong to this package. The host checks account and scope coverage for every export and enforces document limits. The saved ensureArchivePolicy setting controls enrollment on enablement; existing capture coverage, privacy and retention settings are preserved.
