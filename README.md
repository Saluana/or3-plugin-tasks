# OR3 Tasks Plugin (development-only)

The OR3 Tasks Plugin adds task lists, a sidebar page, notifications, and task
tools to an OR3 Chat source checkout. It is not a managed Cloud extension:
immutable Cloud images do not rebuild uploaded source. The package is marked
private so an unqualified archive cannot be published accidentally.

## Source-checkout installation

From an OR3 Chat checkout, add this repository as a local module and enable
`or3-plugin-tasks/nuxt` in `nuxt.config.ts`:

```bash
bun add file:../or3-plugin-tasks
bun run build:zip
```

The ZIP is useful for archive inspection and development fixtures only. Do not
upload it to a managed OR3 Cloud instance. Run the source application and open
the Tasks page after restarting the dev server.

## Qualification

```bash
bun run type-check
bun run build:zip
```

The typecheck currently requires the Chat source contract because this plugin
imports Chat composables and Nuxt virtual modules. Until a standalone contract
fixture is added, this repository remains development-only and has no release
workflow.

## Plugin identity

Keep the stable ID `or3-tasks` in `or3.manifest.json`, `plugin.client.ts`, and
`src/tasks/runtime/register.ts`.

## Uninstalling

Remove `or3-plugin-tasks/nuxt` from the source checkout's `nuxt.config.ts` and
run `bun remove or3-plugin-tasks`.

## License

MIT
