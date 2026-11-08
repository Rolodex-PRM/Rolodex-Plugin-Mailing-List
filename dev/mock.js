(function () {
  const home = { label: 'Home', street: '100 Oak Street', city: 'Austin', region: 'TX', postalCode: '78701', country: 'USA' }
  const contacts = [
    { id: '11111111-1111-4111-8111-111111111111', displayName: 'John Smith', preferredName: '', firstName: 'John', lastName: 'Smith', preferredCommunication: 'email', createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z', emails: [{ label: 'Home', value: 'john@example.com', primary: true }], phones: [], tags: [{ id: 'tag-family', name: 'Family' }], addresses: [home], relationships: [{ contactId: '22222222-2222-4222-8222-222222222222', type: 'spouse' }, { contactId: '33333333-3333-4333-8333-333333333333', type: 'parent' }] },
    { id: '22222222-2222-4222-8222-222222222222', displayName: 'Jane Smith', preferredName: '', firstName: 'Jane', lastName: 'Smith', preferredCommunication: 'email', createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z', emails: [{ label: 'Home', value: 'jane@example.com', primary: true }], phones: [], tags: [{ id: 'tag-family', name: 'Family' }], addresses: [home], relationships: [{ contactId: '11111111-1111-4111-8111-111111111111', type: 'spouse' }] },
    { id: '33333333-3333-4333-8333-333333333333', displayName: 'Sam Smith', preferredName: '', firstName: 'Sam', lastName: 'Smith', preferredCommunication: '', createdAt: '2020-06-01T00:00:00.000Z', updatedAt: '2020-06-01T00:00:00.000Z', emails: [], phones: [], tags: [{ id: 'tag-family', name: 'Family' }], addresses: [home], relationships: [] },
    { id: '44444444-4444-4444-8444-444444444444', displayName: 'Morgan Blake', preferredName: '', firstName: 'Morgan', lastName: 'Blake', preferredCommunication: 'email', createdAt: '2021-01-01T00:00:00.000Z', updatedAt: '2021-01-01T00:00:00.000Z', emails: [{ label: 'Home', value: 'morgan@example.com', primary: true }], phones: [], tags: [], addresses: [{ label: 'Home', street: '100 Oak Street', street2: 'Apt 2', city: 'Austin', region: 'TX', postalCode: '78701', country: 'US' }], relationships: [] },
    { id: '55555555-5555-4555-8555-555555555555', displayName: 'Priya Shah', preferredName: '', firstName: 'Priya', lastName: 'Shah', preferredCommunication: 'email', createdAt: '2022-01-01T00:00:00.000Z', updatedAt: '2022-01-01T00:00:00.000Z', emails: [{ label: 'Home', value: 'priya@example.com', primary: true }], phones: [], tags: [{ id: 'tag-friends', name: 'Friends' }], addresses: [{ label: 'Home', street: '50 Market Street', city: 'San Francisco', region: 'CA', postalCode: '94105', country: 'USA' }], relationships: [] },
    { id: '66666666-6666-4666-8666-666666666666', displayName: 'Chris Lee', preferredName: '', firstName: 'Chris', lastName: 'Lee', preferredCommunication: 'email', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', emails: [{ label: 'Home', value: 'chris@example.com', primary: true }], phones: [], tags: [{ id: 'tag-family', name: 'Family' }], addresses: [], relationships: [] },
  ]
  const documents = new Map()
  const files = new Map()
  const notes = {}
  let sequence = 0
  function clone(value) { return JSON.parse(JSON.stringify(value)) }
  function userName() {
    try { return window.__mailingName || localStorage.getItem('mailing-preview-user') || 'Ada Lovelace' } catch (error) { return 'Ada Lovelace' }
  }
  try {
    const saved = JSON.parse(localStorage.getItem('mailing-preview') || '')
    for (const row of saved.documents || []) documents.set(`${row.collection}/${row.id}`, row)
    Object.assign(notes, saved.notes || {})
    sequence = saved.sequence || 0
  } catch (error) { /* empty preview */ }
  function remember() {
    try { localStorage.setItem('mailing-preview', JSON.stringify({ documents: [...documents.values()], notes, sequence })) } catch (error) { /* preview only */ }
  }
  window.rolodex = {
    contactId: null,
    me: async function () { return { displayName: userName() } },
    contacts: async function () { return contacts.map((person) => ({ id: person.id, displayName: person.displayName })) },
    contactsPage: async function (offset) {
      const start = offset || 0
      return { contacts: contacts.slice(start, start + 100).map(clone), total: contacts.length }
    },
    settings: async function () { return { paper: '' } },
    get: async function (key) { return (notes[userName()] || {})[key] ?? null },
    set: async function (key, value) {
      notes[userName()] = notes[userName()] || {}
      notes[userName()][key] = value
      remember()
      return { ok: true }
    },
    records: {
      list: async function (collection, offset) {
        const rows = [...documents.values()].filter((row) => row.collection === collection && !row.deleted)
        const start = offset || 0
        return { total: rows.length, records: rows.slice(start, start + 100).map((row) => ({ id: row.id, body: clone(row.body) })) }
      },
      get: async function (collection, id) {
        const row = documents.get(`${collection}/${id}`)
        if (!row || row.deleted) throw new Error('Record not found')
        return { id, body: clone(row.body) }
      },
      put: async function (collection, body, id) {
        const key = id || `record-${++sequence}`
        documents.set(`${collection}/${key}`, { collection, id: key, body: clone(body), deleted: false })
        remember()
        return { id: key, body: clone(body) }
      },
      remove: async function (collection, id) {
        const row = documents.get(`${collection}/${id}`)
        if (!row || row.deleted) throw new Error('Record not found')
        row.deleted = true
        remember()
        return { ok: true }
      },
    },
    files: {
      put: async function (file) {
        const id = `file-${++sequence}`
        files.set(id, { id, filename: file.filename, contentType: file.contentType, data: file.data })
        return { id, filename: file.filename }
      },
      list: async function () { return [...files.values()].map((file) => ({ id: file.id, filename: file.filename, contentType: file.contentType })) },
      get: async function (id) { return clone(files.get(id)) },
      download: async function (id, filename) {
        const file = files.get(id)
        if (!file) throw new Error('File not found')
        window.__lastDownload = { id, filename: filename || file.filename, data: file.data, contentType: file.contentType }
        return { ok: true }
      },
    },
    suggest: async function () { return { text: 'Review the household suggestions before changing a list.' } },
  }
  window.__mailingFiles = files
  window.dispatchEvent(new Event('rolodex'))
})()
