# OR3 Tasks

Version 0.3.2 is a Plugin Runtime V2 candidate, `or3sal.tasks`, prepared for
staging publication on
OR3 Chat 0.3.x with Plugin API 2.x and `or3-portable-workspace-v1` support.

The OR3 sidebar contains lists and open counts. Selecting a list opens the Tasks
workspace tab with compact completion rows, quick add, search, filters and sorting.
The plugin includes a custom Tasks icon at `assets/tasks-icon.webp`.
Task details stay beside the list: notes, a date picker, priority, label and subtasks.
List and task deletion require confirmation and offer undo during the session.
Eleven optional chat tools use the same storage and require `tools.register.client`;
the host registers them disabled by default. No network or AI requests originate
from the plugin. No assignees, comments, attachments or reminders are simulated.

Storage supports 40 lists, up to 300 tasks and 20 subtasks per task, subject to
the 30 KiB per-list document limit. Large notes can reach that limit earlier;
failed writes report an error. Rows are paginated in batches of 60.
The 0.2.0 `task-lists-v1` snapshot is preserved when converting to an index and
per-list v2 documents. Rollback sees that original snapshot, not subsequent edits.

## Install

Install the reviewed `or3sal.tasks` release through the marketplace in OR3 Chat,
approve its grants and finish setup. Select **Open**, then choose a sidebar list.
This release is initially being
qualified against the staging marketplace and the local Chat development host.

## Develop and package

Use Bun 1.3.6 or newer. The matching local SDK candidate is
`.authoring/vendor/or3-plugin-sdk-2.0.1-dev.20260920.3.tgz`.
It includes the host workspace primitives and view-key forwarding, built from
the accompanying OR3 Chat SDK source. This is a development artifact, not an npm release.
The SDK's license and third-party notices are included in that tarball.

```sh
bun install --frozen-lockfile
bun test
bun run profile:check
bun run build
bun run pack
bun --bun node_modules/.bin/or3-plugin inspect .artifacts/or3sal.tasks-0.3.2.or3pkg
```

Build bundles the worker and SDK into `dist/client.mjs`. Pack **the built dist
tree**, never the unbundled source; the result is
`.artifacts/or3sal.tasks-0.3.2.or3pkg`. Tests and `.authoring`/`.legacy` are excluded
from the runtime package. Submit an exact source archive alongside it.

The manifest, package policy and setup descriptor are generated together from
`.authoring/profile.config.mjs`. Run `bun run profile:generate` after changing
that configuration; `profile:check` detects stale generated files.

## Legacy compatibility

The old Nuxt module is archived under `.legacy` for reference. It is not shipped
or registered by this package. Sidebar, pane and chat tools now use the portable
host contract. Legacy posts/meta records are not migrated or modified; this
namespaced plugin has its own storage. Due-date notifications are not implemented.
Do not add this package as a Nuxt module.

## License

GPL-3.0-only. The runtime includes the GPL-3.0 OR3 SDK; see `LICENSE` and
`THIRD_PARTY_NOTICES`. Archived legacy source retains its original MIT declaration.
