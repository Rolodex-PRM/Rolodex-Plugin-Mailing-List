# Mailing Lists

A Rolodex plugin for households, distribution lists, campaigns, and correspondence exports.

Contacts stay in Rolodex. Households, lists, campaign snapshots, delivery notes, and export files stay in this plugin. The page cannot change people, and it cannot call the network. It still works when no email, AI, or address-validation service is configured.

## Install

Copy this folder onto the Rolodex server as `plugins/mailing-lists`. The folder must contain `rolodex-plugin.json` and `index.html`.

An administrator turns it on under Admin → Plugins. It then appears in the plugin bar. With the `profile:section` permission, the same page also opens on a contact.

To list it for other servers, add `registry-entry.json` to the Rolodex registry as `registry/plugins/mailing-lists.json` and run `node registry/build-index.mjs`. Install stays disabled until the folder is on that server. Set `path` to the directory in this repository that contains `rolodex-plugin.json`.

Permissions:

- `contacts:read` reads names, email, phone, tags, addresses, and relationship types.
- `data:own` stores this plugin's records once for the workspace. Every member who can open the plugin reads the same households, shared lists, and shared campaigns. An editor can change them. A list or campaign can be kept private; other members then do not see it in this page.
- `files:own` stores CSV, spreadsheet, and PDF exports.
- `ai:suggest` asks the workspace AI add-on for text and writes nothing.
- `profile:section` shows the page on a contact.

Administrator settings:

- Automatic grouping, on or off.
- Paper size, `letter` or `a4`.

## What you can do

- Group people into households. A shared residential address is only a suggestion. Grouping happens automatically when the address, surname, and a family relationship agree, and only when automatic grouping is on. You can dismiss a suggestion, undo a grouping, merge, or split.
- Keep more than one address on a household. Replacing an address keeps the previous one.
- Build static lists of people and households, or dynamic lists from tags, place, email, address, dates, household membership, and earlier campaigns. New lists are shared with the workspace so other members can edit the same recipients. Use Keep this private on a list or campaign when it should stay with you.
- Create a campaign from one or more lists. Choose individual, household, or mixed recipients, and physical, digital, or both.
- Preview duplicates and missing addresses or emails before approval. Approval saves a recipient snapshot. Later changes to a household address do not rewrite that snapshot. A completed campaign can be corrected only with a reason, which is kept in the audit log.
- Export CSV, XLSX, Avery-style PDF labels, and envelopes from the snapshot.
- Record delivery by hand after you send the export. The plugin cannot open SMTP or a postal service.
- Ask questions such as who has no mailing address. Changes, such as adding a tag to a list, wait for approval. The optional AI add-on receives list and household names, not street addresses or email addresses.

## Develop

```
npm test
npm run build
npm run preview
```

`npm run preview` serves the page with sample contacts at `http://127.0.0.1:4173`. Domain logic lives in `src/domain.mjs` and `src/export.mjs`. `src/build.mjs` writes `index.html`, which is the file Rolodex serves.

## License

GNU Affero General Public License v3. See `LICENSE`.
