# Plugin records, files, and contact pages

These calls require the matching permission. A viewer can read. Saving records, files, and suggestions requires an editor.

## Records (`data:own`)

Records are JSON objects scoped to the workspace and this plugin. They are not Rolodex contacts. A removed record stays in the database with a deletion time so a campaign snapshot can keep its own copy.

```js
rolodex.records.put('households', { name: 'The Smiths' }, 'smiths')
rolodex.records.list('households', 0)
rolodex.records.get('households', 'smiths')
rolodex.records.remove('households', 'smiths')
```

`put` accepts one object. To save up to 50 at once, call the `records.put` method with `records: [{ id, body }]`. Each body stays under 100,000 characters. Collection names and ids use lowercase letters, numbers, and dashes.

Store a campaign recipient as its own record, including the address text at send time. Later changes to the contact do not rewrite that record unless the plugin writes it again.

## Contacts (`contacts:read`)

`contactsPage(offset)` returns 100 people at a time and a `total`. Each person includes `preferredName`, `firstName`, `lastName`, `preferredCommunication`, `emails`, `phones`, `tags`, `addresses`, and `relationships` (`contactId`, `type`). Notes, photos, and social accounts are not included. Deleted people and people this member cannot see are omitted.

`contacts()` remains the short id and display name list and does not need `contacts:read`.

## Files (`files:own`)

```js
rolodex.files.put({ filename: 'labels.csv', contentType: 'text/csv', data: btoa(csv) })
rolodex.files.download(id, 'labels.csv')
```

`data` is base64. The file stays under 4 MB. Allowed types are CSV, plain text, JSON, PDF, and XLSX. The host stores the bytes and the browser download uses the signed-in session.

## Suggestions (`ai:suggest`)

`suggest(prompt)` returns `{ text }`. It uses the workspace AI add-on when an administrator has turned it on. The plugin does not receive the API key. The text is a suggestion. The host does not merge contacts, change addresses, or send mail because of it.
