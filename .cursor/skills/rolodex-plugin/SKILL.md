---
name: rolodex-plugin
description: >-
  Build, validate, and list a Rolodex plugin page. Use when the user asks for a
  Rolodex plugin, rolodex-plugin.json, window.rolodex, the plugin registry, or
  a sandboxed plugin page that must not change people, calendars, or settings.
---

# Rolodex plugins

A plugin is one HTML page. Rolodex serves it in a sandboxed iframe and injects `window.rolodex`. The page cannot change Rolodex.

## Build

1. From the Rolodex repo, scaffold with `pnpm --filter @rolodex/plugin-sdk cli -- create <id>`.
2. Edit `rolodex-plugin.json` and `index.html`. Keep the entry file inside the plugin folder.
3. Run `pnpm --filter @rolodex/plugin-sdk cli -- validate <directory>` and fix every line it prints.
4. To try the bridge without a server, call `createMockHost()` from `@rolodex/plugin-sdk`.
5. Copy the folder to the server's `plugins/` directory. An administrator installs it under Admin → Plugins.

## Rules

- Call the bridge only after the `rolodex` event. `window.rolodex.contactId` is set when the page is opened on a person.
- Declare every extra permission in `rolodex-plugin.json`. The host rejects a call the manifest does not list.
- `contacts()` returns `id` and `displayName` only. `contactsPage()` is the paged mailing view, and it requires `contacts:read`.
- Do not write Rolodex contacts, households, calendars, or members. Plugin records stay in the plugin's own collections.
- `get` / `set` store text for this plugin, this person, and this workspace. Keys are lowercase letters, numbers, and dashes. Values stay under 8000 characters.
- `settings()` reads administrator values. The page does not write them.
- Do not add `fetch`, XHR, WebSocket, or form actions. The frame's content-security policy blocks the network.
- Do not add a server entrypoint, a child process, or a permission that writes people, calendars, tasks, files, or members.

## List it

When the plugin should appear on other servers, add one file to the Rolodex registry: `registry/plugins/<id>.json`. The HTML stays in the plugin's own repository. Then run `node registry/build-index.mjs`.

Read `references/manifest.md`, `references/bridge.md`, `references/data.md`, and `references/publishing.md` before changing a manifest, the page script, or a registry entry.
