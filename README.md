<![CDATA[<div align="center">

# 📋 OR3 Tasks Plugin

**A fully-featured, installable Tasks workspace plugin for OR3 Chat.**

![Version](https://img.shields.io/badge/version-0.1.0-blue?style=flat-square)
![OR3](https://img.shields.io/badge/OR3-Plugin-ff1744?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)

</div>

---

## Overview

The OR3 Tasks Plugin brings a complete task management ecosystem directly into the OR3 Chat workspace. It runs as both a native Nuxt module for developers and a dynamic workspace plugin that can be uploaded via the OR3 Admin Panel's extension system.

### Features

- 🗂️ **Tasks Pane App:** A dedicated multi-pane application for managing task lists.
- 📌 **Sidebar Integration:** A top-level Tasks page accessible right from the main sidebar.
- 🔔 **Background Notifications:** Automatically scans for due tasks and pushes native OR3 notifications, complete with quick actions like "Open list" and "Mark complete".
- 🤖 **AI Tooling Suite:** Gives LLMs full access to your tasks context. Includes tools for:
  - Creating, updating, and deleting task lists
  - Adding, updating, and reordering items
  - Managing subtasks
  - Searching across task lists
  - 🧠 *AI-Powered Difficulty Sorting:* Ask the AI to automatically analyze and sort tasks by how difficult they are.

### What's Included

```
or3-plugin-tasks/
├── or3.manifest.json     # Plugin manifest (required for admin install)
├── package.json          # NPM package config for Nuxt module install
├── plugin.client.ts      # Nuxt client plugin entry point
├── src/                  # Full runtime tree (components, composables, tools)
└── scripts/              # Build scripts
```

---

## Installation

This plugin supports two installation paths: via the **Admin Panel** (for running OR3 instances) or via **NPM / Local Link** (for developers building OR3 from source).

### Option 1 — Install via Admin Panel (Recommended)

1. **Build the ZIP archive:**
   ```bash
   bun run build:zip
   ```
2. **Open the Admin Panel:**
   Navigate to `https://your-or3-instance.com/admin` and log in.
3. **Upload the Plugin:**
   - Go to the **Plugins** or **Extensions** page in the admin sidebar.
   - Click **Install Extension**.
   - Upload the generated `dist/or3-tasks.zip`.
4. **Restart & Activate:**
   Restart your OR3 server so the plugin can be auto-discovered and mounted into the workspace.

---

### Option 2 — Install via NPM (Nuxt Module)

For developers compiling OR3 from source:

1. Add the package to your OR3 workspace:
   ```bash
   bun add or3-plugin-tasks
   ```
2. Enable it in your OR3 `nuxt.config.ts`:
   ```ts
   export default defineNuxtConfig({
     modules: [
       'or3-plugin-tasks/nuxt',
     ],
   });
   ```

*Note for local monorepo development: You can use `file:../or3-plugin-tasks` in your `package.json` or link it via `bun link`.*

---

### Option 3 — API Installation

Upload the built `.zip` programmatically using `curl`:

```bash
curl -X POST https://your-or3-instance.com/api/admin/extensions/install \
  -H "Cookie: <admin-session-cookie>" \
  -F "file=@dist/or3-tasks.zip" \
  -F "force=false"
```

---

## Plugin ID Compliance

- **ID:** `or3-tasks`

If you are modifying this plugin, ensure the ID remains stable across:
- `or3.manifest.json`
- `plugin.client.ts`
- The runtime registration inside `src/tasks/runtime/register.ts`

---

## Building the ZIP

To package the plugin for the admin panel:

```bash
bun run build:zip
```

This script bundles `or3.manifest.json`, `plugin.client.ts`, and the `src/` directory into a clean, admin-ready `dist/or3-tasks.zip` archive.

---

## Uninstalling

If installed via the admin panel:
1. Open the Admin Panel → **Extensions**.
2. Click **Uninstall** on the `OR3 Tasks` plugin.
3. Restart the server.

If installed via NPM:
1. Remove `'or3-plugin-tasks/nuxt'` from your `nuxt.config.ts`.
2. Run `bun remove or3-plugin-tasks`.

---

## License

MIT
]]>
