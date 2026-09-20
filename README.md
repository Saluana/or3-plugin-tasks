# OR3 Tasks

Version 0.2.0 is an installable Plugin Runtime V2 package, `or3sal.tasks`, for
OR3 Chat 0.3.x with Plugin API 2.x and `or3-portable-client-v1` support.

It provides task lists, notes, due dates, work/home/health labels, difficulty,
subtasks, completion tracking, search, and manual/due/difficulty sorting. Tasks
persist in host-managed plugin storage. The isolated browser worker requests
only `storage.read` and `storage.write`; it makes no network or AI requests.
Deletion of a task or list requires confirmation. Limits are 12 lists, 100 tasks,
12 subtasks per task and 60 KB of stored JSON. Long titles are abbreviated in
summaries; the task editor retains the complete title.

## Install

Install the reviewed `or3sal.tasks` release through the marketplace in OR3 Chat,
approve its storage grants and finish setup. Open the portable plugin view and
select **Open your task lists**, then add a task. This release is initially being
qualified against the staging marketplace and the local Chat development host.

## Develop and package

Use Bun 1.3.6 or newer. The current SDK source is 2.0.0 and is not yet available
on npm. This repository pins a packed copy from the OR3 Chat SDK at commit
`e3147331` in `.authoring/vendor/or3-plugin-sdk-2.0.0.tgz` (SHA-256
`dbb5e6846d1e1e7cb7a669ed1ca6250e53d97a55fd7c723415a91d7826cd68e6`).
The SDK's license and third-party notices are included in that tarball.

```sh
bun install --frozen-lockfile
bun test
bun run profile:check
bun run build
bun run pack
bun --bun node_modules/.bin/or3-plugin inspect .artifacts/or3sal.tasks-0.2.0.or3pkg
```

Build bundles the worker and SDK into `dist/client.mjs`. Pack **the built dist
tree**, never the unbundled source; the result is
`.artifacts/or3sal.tasks-0.2.0.or3pkg`. Tests and `.authoring`/`.legacy` are excluded
from the runtime package. Submit an exact source archive alongside it.

The manifest, package policy and setup descriptor are generated together from
`.authoring/profile.config.mjs`. Run `bun run profile:generate` after changing
that configuration; `profile:check` detects stale generated files.

## Legacy compatibility

The old Nuxt module is archived under `.legacy` for reference. It is not shipped
or registered by this package. Its private Chat AI tools, sidebar integration
and due-date notifications are not supported by the portable plugin contract.
Existing `or3-tasks` data is not migrated or modified; this namespaced plugin has
its own versioned storage. Do not add this package as a Nuxt module.

## License

GPL-3.0-only. The runtime includes the GPL-3.0 OR3 SDK; see `LICENSE` and
`THIRD_PARTY_NOTICES`. Archived legacy source retains its original MIT declaration.
