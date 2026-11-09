# rolodex-plugin.json

```json
{
  "id": "my-page",
  "name": "My page",
  "version": "1.0.0",
  "description": "What this page is for.",
  "entry": "index.html",
  "settings": [
    { "key": "heading", "label": "Heading", "type": "text" }
  ]
}
```

- `id`: lowercase letters, numbers, and dashes, at most 40 characters. It matches the registry file name.
- `name`: at most 40 characters. `version`: at most 20. `description`: at most 200.
- `entry`: one HTML file in this folder. `index.html` is the default. A path with a slash or `..` is rejected.
- `settings`: optional, at most 12 items. Each item has `key`, `label` (at most 40 characters), and `type` of `text` or `boolean`.

`permissions` is optional. Each entry is one of:

- `contacts:read` — paged people with name, email, phone, tags, addresses, and relationship type
- `data:own` — workspace records that belong to this plugin
- `files:own` — CSV, spreadsheet, PDF, JSON, or text exports stored for this plugin
- `ai:suggest` — one text suggestion from the workspace AI add-on, with no writes
- `profile:section` — show this page on a contact, with `contactId` set

`explainPluginManifest` keeps the page when a single setting or permission is malformed and drops that item. `rolodex-plugin validate` still fails until it is fixed.

Installed plugins show these fields under Settings in Admin → Plugins. Saved values are per workspace.
