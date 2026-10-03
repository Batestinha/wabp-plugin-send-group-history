# Send Group History

Deliver retained group history to arriving members using host-generated archives and authorized delivery actions.

Standalone WABS package `official.send-group-history` version `0.5.1`, requiring WABP core API `^0.3.6`. The archive includes the SDK, Zod and Portuguese translations. Existing scope settings retain their identifiers, selected export formats, custom captions, exclusions, history window and enabled state.

WABP owns archive queries, rendering, identity resolution, localization, deduplication storage and delivery authorization. The plugin contains no archive database or browser renderer. Automatic arrivals return declared delivery and audit actions. Manual administration uses the host-provided transport and archive capabilities; neither path imports host source.

Install through a trusted WABS registry entry. Installation and scope enablement are separate operations. The publisher signs exact archive bytes; registry branding alone does not establish trust.

For development, run `npm ci --ignore-scripts`, `npm test`, then `npm run release:archive`. Tests use synthetic identities and archive buffers, with mocked host capabilities. CI checks Node22.23.2 and24.15.0, archive reproducibility and execution outside the repository.

`provenance.json` records imported source history and the exact SDK archive. Compiled runtime dependencies and their licenses are included in every release.

Manual archive delivery and console readiness, preflight and preparation now belong to this package. The host checks account and scope coverage for every export and enforces document limits. The saved ensureArchivePolicy setting controls enrollment on enablement; existing capture coverage, privacy and retention settings are preserved.

## Typed templates and WhatsApp mentions

Message editors support exact choice and text comparisons, numeric thresholds,
boolean values, availability checks, nested All/Any rules and Otherwise branches.
Existing bare conditions retain their original presence meaning. Comparisons use
canonical values separately from translated display text; missing values do not
satisfy negative comparisons, while zero and false remain available.

Type `@` in a supported message body or caption to insert a person, a group link,
or a contextual recipient. Group links and native all-members mentions are distinct;
the editor only offers targets supported by that destination. Mentions in hidden
branches do not resolve or notify anyone. Native poll titles/options, group names
and calendar text remain plain text. Durable delivery stores rendered text and
recipient metadata together so retries keep the original notification intent.

## Group archive link

Use `{archiveUrl}` in the Archive caption editor, for example:

```text
History for {groupDisplayName}: {archiveUrl}
```

The host supplies the matching group's internal archive chat ID and connected
workspace in the configured Chat Archive URL. Automatic arrivals and manual
history delivery use the same value. Opening the link requires the viewer's
normal login and archive access. If the host has no published archive for the
group, the value is empty; use `{{#if archiveUrl}}Read online: {archiveUrl}{{/if}}`
to show text only when a link is available. The editor preview uses example IDs.
Existing captions are preserved until edited.
