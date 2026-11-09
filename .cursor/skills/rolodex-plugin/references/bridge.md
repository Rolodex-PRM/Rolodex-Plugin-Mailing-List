# Plugin bridge

The host wraps the HTML with a content-security policy (`default-src 'none'`, `connect-src 'none'`, inline script and style, `data:` images) and listens for `postMessage` only from that iframe. The iframe sandbox is `allow-scripts`.

The page posts `rolodex:ready`. The host answers `rolodex:context`, and the bridge dispatches a `rolodex` event. Then:

```js
window.addEventListener('rolodex', function () {
  window.rolodex.me().then(function (person) {
    person.displayName
  })
  window.rolodex.contacts().then(function (people) {
    people.forEach(function (person) {
      person.id
      person.displayName
    })
  })
  window.rolodex.settings().then(function (values) {
    values.heading
  })
  window.rolodex.get('note').then(function (value) {})
  window.rolodex.set('note', 'hello')
})
```

Server method names are `me`, `contacts.list`, `settings`, `storage.get`, and `storage.set`. Any other method returns "That plugin action is not available". Calls are limited to 120 per minute for that person and plugin.

`contacts()` is capped at 200 people in the current workspace, skips deleted people, and uses the same visibility rules as the rest of Rolodex. Owners and administrators see restricted people. Other members see a restricted person when they own that person or have a grant.

`get` and `set` do not read another person's notes or another plugin's notes.

A page opened from a contact has `window.rolodex.contactId`. The same page opened from the plugin bar has `contactId` null. Internal screens such as Households and Campaigns are routes inside this one page.

`files.download(id, filename)` asks the Rolodex window to save the file. The iframe does not receive the session token.
