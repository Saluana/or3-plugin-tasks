# or3-plugin-tasks

Installable Tasks plugin for OR3 Chat.

It supports two install paths:

1. **NPM / local link** (Nuxt module)
2. **Admin panel ZIP upload** (workspace extension)

## Install via NPM (or local link)

```bash
bun add or3-plugin-tasks
```

Then enable in [nuxt.config.ts](nuxt.config.ts):

```ts
export default defineNuxtConfig({
  modules: [
    'or3-plugin-tasks/nuxt',
  ],
});
```

For local development in the monorepo:

- use `file:../or3-plugin-tasks` in [package.json](package.json)
- or `bun link`/`npm link`

## Install via Admin Panel ZIP

Build the zip:

```bash
bun run build:zip
```

Upload:

- [dist/or3-tasks.zip](dist/or3-tasks.zip) in the OR3 admin extension installer

The archive includes:

- [or3.manifest.json](or3.manifest.json)
- [plugin.client.ts](plugin.client.ts)
- full [src](src) runtime tree

## Plugin ID

- `or3-tasks`

Keep this ID stable across:

- [or3.manifest.json](or3.manifest.json)
- [plugin.client.ts](plugin.client.ts)
- runtime registration in [src/tasks/runtime/register.ts](src/tasks/runtime/register.ts)
