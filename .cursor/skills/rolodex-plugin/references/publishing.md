# Listing a plugin

The registry is `registry/` in the Rolodex repository. It stores no HTML.

1. Publish the plugin folder in a public git repository.
2. Add `registry/plugins/<id>.json`. Start from `registry/schema/example-entry.json`.
3. Set `repo` to `owner/name` and `path` to the folder inside that repository. `path` must not contain `..`.
4. Match `id`, `name`, `version`, `description`, `entry`, and `settings` to `rolodex-plugin.json`.
5. Run `node registry/build-index.mjs`. Commit the new entry and the generated `registry/dist/index.json`.

A Rolodex server reads `registry/plugins`. A plugin whose folder is not under `plugins/` shows in Discover with the note to add that folder. Install stays disabled until the folder is on the server. The server does not download plugin code from the registry.
