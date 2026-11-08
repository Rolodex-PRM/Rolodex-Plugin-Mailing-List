const state = {
  ready: false,
  error: '',
  notice: '',
  me: '',
  member: null,
  settings: {},
  prefs: null,
  contacts: [],
  households: [],
  lists: [],
  campaigns: [],
  recipients: [],
  deliveries: [],
  exports: [],
  suggestions: [],
  templates: [],
  suppressions: [],
  audit: [],
  notes: [],
  contactId: null,
  screen: 'overview',
  tab: 'overview',
  selectedId: '',
  edit: null,
  query: '',
  forms: { householdName: '', listName: '', listType: 'static', campaignName: '', campaignType: 'holiday', suppression: '', question: '', splitName: '', mergeId: '', listPick: '', templateName: '' },
  addressDraft: blankAddress(),
  replacingId: '',
  proposal: null,
  aiText: '',
  confirm: '',
  page: 0,
}

let confirmRun = null
const app = document.getElementById('app')

function M() { return window.Mailing }
function api() { return window.rolodex }
function blankAddress() {
  return { line1: '', line2: '', city: '', region: '', postalCode: '', country: '', type: 'residential' }
}
function defaultPrefs() {
  return { autoGroup: true, recipientMode: 'household', delivery: 'physical', salutation: 'preferred', paper: 'letter', templateId: 'avery-5160', envelopeId: 'envelope-10', blockedPairs: [] }
}
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
}
function setPath(object, path, value) {
  const parts = path.split('.')
  let cursor = object
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index]
    if (cursor[key] == null || typeof cursor[key] !== 'object') cursor[key] = /^\d+$/.test(parts[index + 1]) ? [] : {}
    cursor = cursor[key]
  }
  cursor[parts[parts.length - 1]] = value
}
function upsert(list, record) {
  const index = list.findIndex((row) => row.id === record.id)
  if (index === -1) list.push(record)
  else list[index] = record
}
function world() {
  const campaigns = visibleCampaigns()
  const campaignIds = new Set(campaigns.map((row) => row.id))
  return { contacts: state.contacts, households: state.households, lists: visibleLists(), campaigns, recipients: state.recipients.filter((row) => !row.campaignId || campaignIds.has(row.campaignId)), suggestions: state.suggestions, suppressions: state.suppressions }
}
function contact(id) { return state.contacts.find((row) => row.id === id) }
function nameOf(id) {
  const person = contact(id)
  return person ? M().personName(person).full : 'Unknown contact'
}
function autoOn() {
  if (state.settings['auto-group'] === 'false') return false
  if (state.settings['auto-group'] === 'true') return true
  return state.prefs.autoGroup !== false
}
function activeHouseholds() { return state.households.filter((row) => !row.archived) }
function visibleLists() { return state.lists.filter((row) => !row.archived && M().canSeeShared(row, state.member?.id)) }
function visibleCampaigns() { return state.campaigns.filter((row) => M().canSeeCampaign(row, state.lists, state.member?.id)) }

async function loadAll(collection) {
  const rows = []
  let offset = 0
  for (;;) {
    const page = await api().records.list(collection, offset)
    const batch = page.records || []
    rows.push(...batch.map((row) => ({ ...row.body, id: row.id })))
    offset += batch.length
    if (!batch.length || offset >= (page.total || 0)) break
  }
  return rows
}
async function loadContacts() {
  const rows = []
  let offset = 0
  let total = 0
  for (;;) {
    const page = await api().contactsPage(offset)
    const batch = page.contacts || []
    total = page.total || 0
    rows.push(...batch)
    offset += batch.length
    setStatus(total ? `Reading contacts, ${Math.min(offset, total)} of ${total}` : 'Reading contacts')
    if (!batch.length || offset >= total) break
  }
  state.contacts = rows
}
async function saveRecord(collection, record) {
  record.updatedAt = M().nowIso()
  const saved = await api().records.put(collection, record, record.id)
  return { ...saved.body, id: saved.id }
}
async function writeAudit(action, targetType, targetId, detail) {
  const entry = M().auditEntry({ action, actor: state.me || 'Someone', targetType, targetId, detail })
  entry.id = M().createId()
  const saved = await saveRecord('audit', entry)
  state.audit.unshift(saved)
}
async function savePrefs() {
  const record = { ...state.prefs, id: 'workspace' }
  await api().records.put('preferences', record, 'workspace')
}

function setStatus(text) {
  state.notice = text
  const node = document.getElementById('status')
  if (node) node.textContent = text
}

async function boot() {
  const host = api()
  const person = await host.me()
  state.me = person?.displayName || ''
  state.member = { id: '', name: state.me || 'Someone' }
  try {
    const identity = M().memberIdentity(await host.get('member'), state.me)
    if (identity.changed) await host.set('member', identity.token)
    state.member = { id: identity.id, name: identity.name }
  } catch (error) { /* personal storage is optional; shared lists still open */ }
  state.settings = await host.settings()
  state.contactId = host.contactId || null
  state.prefs = defaultPrefs()
  try {
    const saved = await host.records.get('preferences', 'workspace')
    state.prefs = { ...defaultPrefs(), ...saved.body, blockedPairs: saved.body.blockedPairs || [] }
  } catch (error) { /* first visit */ }
  if (state.settings.paper === 'a4' || state.settings.paper === 'letter') state.prefs.paper = state.settings.paper
  const collections = ['households', 'lists', 'campaigns', 'recipients', 'deliveries', 'exports', 'suggestions', 'templates', 'suppressions', 'audit', 'contact-notes']
  const loaded = await Promise.all(collections.map((name) => loadAll(name)))
  ;[state.households, state.lists, state.campaigns, state.recipients, state.deliveries, state.exports, state.suggestions, state.templates, state.suppressions, state.audit, state.notes] = loaded
  state.ready = true
  if (state.contactId) state.screen = 'contact'
  render()
  await loadContacts()
  await scanHouseholds()
  setStatus('')
  render()
}

async function scanHouseholds() {
  const plan = M().planHouseholds(state.contacts, state.households, state.suggestions, autoOn(), state.prefs.blockedPairs || [])
  for (const household of plan.create) {
    household.createdAt = M().nowIso()
    household.updatedAt = household.createdAt
    const saved = await saveRecord('households', household)
    upsert(state.households, saved)
    await writeAudit('household.group', 'household', saved.id, `Grouped ${saved.name} because ${household.match.reasons.join(', ')} (${household.match.confidence}%).`)
  }
  for (const suggestion of plan.suggest) {
    if (state.suggestions.some((row) => row.id === suggestion.id)) continue
    const saved = await saveRecord('suggestions', suggestion)
    upsert(state.suggestions, saved)
  }
}

function rememberPair(left, right) {
  const key = M().pairKey(left, right)
  state.prefs.blockedPairs = state.prefs.blockedPairs || []
  if (!state.prefs.blockedPairs.includes(key)) state.prefs.blockedPairs.push(key)
}

function render() {
  const active = document.activeElement
  const key = active && active.id
  const pos = active && typeof active.selectionStart === 'number' ? active.selectionStart : null
  const main = document.querySelector('.main')
  const top = main ? main.scrollTop : 0
  app.innerHTML = shell()
  const nextMain = document.querySelector('.main')
  if (nextMain) nextMain.scrollTop = top
  if (key) {
    const node = document.getElementById(key)
    if (node) {
      node.focus()
      if (pos != null && node.setSelectionRange) node.setSelectionRange(pos, pos)
    }
  }
}

function shell() {
  if (!state.ready) return `<p class="muted">${esc(state.error || 'Loading mailing lists…')}</p>`
  const screens = [['overview', 'Overview'], ['households', 'Households'], ['lists', 'Lists'], ['campaigns', 'Campaigns'], ['history', 'History'], ['exports', 'Exports'], ['settings', 'Settings']]
  if (state.contactId) screens.unshift(['contact', 'This person'])
  return `<div class="shell">
    <div class="top"><h1>Mailing Lists</h1><p class="lede">${esc(state.me ? `Signed in as ${state.me}. ` : '')}Shared lists are the same for everyone in this workspace. People in Rolodex are left unchanged.</p></div>
    <nav class="nav">${screens.map(([id, label]) => `<button type="button" data-action="nav" data-id="${id}" ${state.screen === id ? 'aria-current="page"' : ''}>${label}</button>`).join('')}</nav>
    <main class="main">
      <p id="status" class="muted">${esc(state.notice)}</p>
      ${state.error ? `<p class="banner bad">${esc(state.error)}</p>` : ''}
      ${state.confirm ? `<div class="banner warn"><p>${esc(state.confirm)}</p><div class="split"><button type="button" class="primary" data-action="confirm-yes">Continue</button><button type="button" class="ghost" data-action="confirm-no">Cancel</button></div></div>` : ''}
      ${view()}
    </main>
  </div>`
}

function view() {
  if (state.screen === 'contact') return contactView()
  if (state.screen === 'household') return householdView()
  if (state.screen === 'households') return householdsView()
  if (state.screen === 'list') return listView()
  if (state.screen === 'lists') return listsView()
  if (state.screen === 'campaign') return campaignView()
  if (state.screen === 'campaigns') return campaignsView()
  if (state.screen === 'history') return historyView()
  if (state.screen === 'exports') return exportsView()
  if (state.screen === 'settings') return settingsView()
  return overviewView()
}

function overviewView() {
  const homes = activeHouseholds()
  const people = new Set()
  homes.forEach((home) => M().currentMembers(home).forEach((member) => people.add(member.contactId)))
  const campaigns = visibleCampaigns().filter((row) => row.status !== 'archived')
  const active = campaigns.filter((row) => row.status === 'ready' || row.status === 'active')
  const upcoming = campaigns.filter((row) => row.scheduledAt && row.status !== 'completed')
  const missing = M().missingAddressContacts(state.contacts)
  const review = state.suggestions.filter((row) => row.status === 'pending' && row.level === 'review')
  const recent = campaigns.filter((row) => row.status === 'completed').slice(0, 5)
  return `<section class="grid">
      ${stat(homes.length, 'Households')}${stat(people.size, 'People in households')}${stat(visibleLists().length, 'Lists')}${stat(active.length, 'Active campaigns')}
    </section>
    ${review.length ? `<section class="card"><h2>Review these household matches</h2>${review.map(suggestionCard).join('')}</section>` : ''}
    <section class="card"><h2>Needs attention</h2>
      <div class="row"><div><b>${missing.length}</b> contacts have no mailing address</div><button type="button" class="ghost" data-action="nav" data-id="households">Review</button></div>
      <div class="row"><div><b>${upcoming.length}</b> campaigns have a schedule</div><button type="button" class="ghost" data-action="nav" data-id="campaigns">Campaigns</button></div>
      ${missing.slice(0, 8).map((row) => `<div class="row"><span>${esc(row.name)}</span><button type="button" class="ghost" data-action="new-household-for" data-id="${esc(row.id)}">Make a household</button></div>`).join('')}
    </section>
    <section class="card"><h2>Recent correspondence</h2>
      ${recent.length ? recent.map((row) => `<div class="row"><span>${esc(row.name)}</span><span class="pill">${esc(row.status)}</span></div>`).join('') : '<p class="muted">Completed campaigns will be listed here.</p>'}
    </section>
    ${assistantHtml()}`
}
function stat(value, label) { return `<div class="stat"><b>${value}</b><span>${label}</span></div>` }

function suggestionCard(row) {
  const people = row.contactIds.map(nameOf).join(' and ')
  const home = state.households.find((item) => item.id === row.householdId)
  const title = row.kind === 'add' ? `Add ${people} to ${home?.name || 'a household'}` : row.kind === 'merge' ? `These may be one household: ${people}` : `Possible household: ${people}`
  return `<div class="row"><div><b>${esc(title)}</b><div class="muted">${esc(row.reasons.join(' · '))} · ${row.confidence}%</div></div><div class="split"><button type="button" class="primary" data-action="accept-suggestion" data-id="${esc(row.id)}">Approve</button><button type="button" class="ghost" data-action="dismiss-suggestion" data-id="${esc(row.id)}">Not a household</button></div></div>`
}

function assistantHtml() {
  const answer = state.proposal ? `<div class="banner"><b>${esc(state.proposal.title)}</b><p>${esc(state.proposal.detail || '')}</p>${(state.proposal.rows || []).slice(0, 30).map((row) => `<div class="row"><span>${esc(row.label)}</span><span class="muted">${esc(row.meta || '')}</span></div>`).join('')}${state.proposal.type === 'mutate' ? '<button type="button" class="primary" data-action="apply-proposal">Approve this change</button>' : ''}</div>` : ''
  const ai = state.aiText ? `<div class="banner"><b>Suggestion only</b><p>${esc(state.aiText)}</p><p class="muted">Nothing was changed.</p></div>` : ''
  return `<section class="card"><h2>Ask about these lists</h2><p class="muted">Questions run on your records. A change is shown first and waits for your approval.</p><div class="split"><input id="question" data-scope="forms" data-bind="question" value="${esc(state.forms.question)}" placeholder="Find contacts without mailing addresses"><button type="button" class="primary" data-action="ask">Ask</button></div>${answer}${ai}</section>`
}

function householdsView() {
  const needle = state.query.trim().toLowerCase()
  const pending = state.suggestions.filter((row) => row.status === 'pending')
  const rows = activeHouseholds().filter((home) => !needle || `${home.name} ${home.salutation}`.toLowerCase().includes(needle))
  return `<section class="card"><div class="split"><input id="search" data-live="query" value="${esc(state.query)}" placeholder="Search households"><button type="button" class="ghost" data-action="scan">Look for households</button></div>
      <div class="split"><input id="household-name" data-scope="forms" data-bind="householdName" value="${esc(state.forms.householdName)}" placeholder="New household name"><button type="button" class="primary" data-action="new-household">Create household</button></div>
    </section>
    ${pending.length ? `<section class="card"><h2>Suggested matches</h2>${pending.map(suggestionCard).join('')}</section>` : ''}
    <section class="card">${rows.length ? rows.map((home) => householdRow(home)).join('') : '<p class="muted">No households yet. Create one, or look for people who share a home.</p>'}</section>`
}
function householdRow(home) {
  const members = M().currentMembers(home)
  const address = M().primaryAddress(home)
  return `<div class="row"><button type="button" class="ghost" data-action="open-household" data-id="${esc(home.id)}">${esc(home.name)}</button><span class="muted">${members.length} people · ${esc(address ? address.formatted || M().formatAddress(address).join(', ') : 'No address')}</span></div>`
}

function householdView() {
  const home = state.edit
  if (!home) return '<p class="muted">Choose a household.</p>'
  const members = M().currentMembers(home).slice().sort((a, b) => a.displayOrder - b.displayOrder)
  const matches = state.query.trim().toLowerCase()
  const choices = matches ? state.contacts.filter((person) => M().personName(person).full.toLowerCase().includes(matches)).slice(0, 8) : []
  const others = activeHouseholds().filter((row) => row.id !== home.id)
  return `<section class="card stack">
      <div class="split"><button type="button" class="ghost" data-action="nav" data-id="households">All households</button><span class="pill">${home.match ? `${home.match.confidence}% match` : 'Manual'}</span></div>
      <div class="fields">
        <label>Name<input data-bind="name" value="${esc(home.name)}"></label>
        <label>Preferred salutation<input data-bind="salutation" value="${esc(home.salutation || '')}"></label>
      </div>
      <label>Notes<textarea data-bind="notes">${esc(home.notes || '')}</textarea></label>
      <div class="split"><button type="button" class="primary" data-action="save-household">Save household</button><button type="button" class="ghost" data-action="archive-household">Archive</button>${home.match ? '<button type="button" class="ghost" data-action="undo-group">Undo grouping</button>' : ''}</div>
    </section>
    <section class="card"><h2>Members</h2>
      ${members.map((member) => `<div class="row"><div><b>${esc(nameOf(member.contactId))}</b><div class="muted">${member.primary ? 'Primary contact' : 'Member'}</div></div><div class="split">${member.primary ? '' : `<button type="button" class="ghost" data-action="make-primary" data-id="${esc(member.contactId)}">Make primary</button>`}<button type="button" class="ghost" data-action="remove-member" data-id="${esc(member.contactId)}">Remove</button></div></div>`).join('')}
      <input id="member-search" data-live="query" value="${esc(state.query)}" placeholder="Add a person by name">
      <div class="people">${choices.map((person) => `<button type="button" data-action="add-member" data-id="${esc(person.id)}">${esc(M().personName(person).full)}</button>`).join('')}</div>
    </section>
    <section class="card"><h2>Addresses</h2>
      ${M().currentAddresses(home).map((address) => `<div class="row"><div><b>${esc(M().formatAddress(address).join(', ') || 'Empty address')}</b><div class="muted">${esc(address.type)} · ${esc(address.validationStatus || 'unverified')}${address.id === home.primaryAddressId ? ' · Default' : ''}</div></div><div class="split"><button type="button" class="ghost" data-action="primary-address" data-id="${esc(address.id)}">Make default</button><button type="button" class="ghost" data-action="check-address" data-id="${esc(address.id)}">Mark checked</button><button type="button" class="ghost" data-action="edit-address" data-id="${esc(address.id)}">Update</button></div></div>`).join('') || '<p class="muted">No address yet.</p>'}
      <h3>${state.replacingId ? 'Replace an address' : 'Add an address'}</h3>
      <p class="muted">Replacing an address keeps the previous one for history. Completed campaigns keep the address they already saved.</p>
      ${addressFields()}
      <button type="button" class="primary" data-action="save-address">${state.replacingId ? 'Save replacement' : 'Add address'}</button>
      ${(home.addresses || []).some((address) => address.replacedAt) ? `<h3>Previous addresses</h3>${home.addresses.filter((address) => address.replacedAt).map((address) => `<p class="muted">${esc(M().formatAddress(address).join(', '))} · replaced ${esc(address.replacedAt.slice(0, 10))}</p>`).join('')}` : ''}
    </section>
    <section class="card stack"><h2>Merge or split</h2>
      <div class="split"><select data-scope="forms" data-bind="mergeId">${others.map((row) => `<option value="${esc(row.id)}" ${state.forms.mergeId === row.id ? 'selected' : ''}>${esc(row.name)}</option>`).join('')}</select><button type="button" class="ghost" data-action="merge-household">Merge selected into this one</button></div>
      <div class="split"><input data-scope="forms" data-bind="splitName" value="${esc(state.forms.splitName)}" placeholder="Name for the new household"><button type="button" class="ghost" data-action="split-household">Split selected members</button></div>
      ${members.map((member) => `<label class="row"><span><input type="checkbox" data-scope="forms" data-bind="split-${member.contactId}" ${state.forms[`split-${member.contactId}`] ? 'checked' : ''}> ${esc(nameOf(member.contactId))}</span></label>`).join('')}
    </section>`
}
function addressFields() {
  const draft = state.addressDraft
  const field = (bind, label, value) => `<label>${label}<input data-scope="addressDraft" data-bind="${bind}" value="${esc(value || '')}"></label>`
  return `<div class="fields">${field('line1', 'Address line 1', draft.line1)}${field('line2', 'Address line 2', draft.line2)}${field('city', 'City', draft.city)}${field('region', 'Region', draft.region)}${field('postalCode', 'Postal code', draft.postalCode)}${field('country', 'Country', draft.country)}</div>
    <label>Type<select data-scope="addressDraft" data-bind="type">${['residential', 'business', 'vacation', 'seasonal', 'mailing-only', 'other'].map((type) => `<option ${draft.type === type ? 'selected' : ''}>${type}</option>`).join('')}</select></label>`
}

function listsView() {
  return `<section class="card stack"><div class="fields"><label>Name<input data-scope="forms" data-bind="listName" value="${esc(state.forms.listName)}"></label>
      <label>Type<select data-scope="forms" data-bind="listType"><option value="static" ${state.forms.listType === 'static' ? 'selected' : ''}>Static</option><option value="dynamic" ${state.forms.listType === 'dynamic' ? 'selected' : ''}>Dynamic</option></select></label></div>
      <button type="button" class="primary" data-action="new-list">Create list</button>
      <p class="muted">A new list is shared with this workspace. Other members can add and remove recipients.</p></section>
    <section class="card">${visibleLists().map(listRow).join('') || '<p class="muted">No lists yet.</p>'}</section>`
}
function listRow(list) {
  const members = M().listMembership(list, world())
  const shared = list.sharing !== 'private'
  return `<div class="row"><button type="button" class="ghost" data-action="open-list" data-id="${esc(list.id)}">${esc(list.name)}</button><span class="muted">${esc(list.listType)} · ${members.households.length} households · ${members.contacts.length} people</span><span class="pill">${shared ? 'Shared' : 'Private'}</span></div>`
}
function sharingPanel(record, noun) {
  const shared = record.sharing !== 'private'
  const mine = !record.ownerId || record.ownerId === state.member?.id
  const names = M().editorNames(record)
  const button = shared && !mine
    ? `<p class="muted">${esc(record.ownerName || 'The person who created it')} can stop sharing this ${noun}.</p>`
    : `<button type="button" class="ghost" data-action="set-sharing" data-id="${shared ? 'private' : 'workspace'}">${shared ? 'Keep this private' : 'Share with workspace'}</button>`
  return `<section class="card stack"><h2>Who can work on this ${noun}</h2>
      <p>${shared ? `Everyone in this workspace can open and edit this ${noun}.` : `Only you can see this ${noun}.`}</p>
      ${names.length ? `<p class="muted">Worked on by ${esc(names.join(', '))}${record.updatedBy ? `. Last saved by ${esc(record.updatedBy)}` : ''}.</p>` : ''}
      ${button}
    </section>`
}

function listView() {
  const list = state.edit
  if (!list) return '<p class="muted">Choose a list.</p>'
  const members = M().listMembership(list, world())
  const matches = state.query.trim().toLowerCase()
  const people = matches ? state.contacts.filter((person) => M().personName(person).full.toLowerCase().includes(matches)).slice(0, 8) : []
  return `<section class="card stack">
      <button type="button" class="ghost" data-action="nav" data-id="lists">All lists</button>
      <div class="fields"><label>Name<input data-bind="name" value="${esc(list.name)}"></label><label>Description<input data-bind="description" value="${esc(list.description || '')}"></label></div>
      <div class="fields">${modeSelect(list)}${deliverySelect(list)}</div>
      <div class="split"><button type="button" class="primary" data-action="save-list">Save list</button><button type="button" class="ghost" data-action="duplicate-list">Duplicate</button><button type="button" class="ghost" data-action="archive-list">Archive</button></div>
    </section>
    ${sharingPanel(list, 'list')}
    ${list.listType === 'dynamic' ? rulesEditor(list) : ''}
    <section class="card"><h2>Preview</h2>
      <p>${members.households.length} households and ${members.contacts.length} people. A campaign copies this preview when you approve it.</p>
      ${members.households.map((home) => `<div class="row">${esc(home.name)}</div>`).join('')}
      ${members.contacts.map((person) => `<div class="row">${esc(M().personName(person).full)}</div>`).join('')}
      ${members.problem ? `<p class="banner bad">${esc(members.problem)}</p>` : ''}
    </section>
    ${list.listType === 'static' ? `<section class="card"><h2>People and households</h2>
      ${(list.members || []).map((member) => `<div class="row"><span>${esc(member.type === 'household' ? (state.households.find((home) => home.id === member.id)?.name || 'Household') : nameOf(member.id))}${member.status === 'excluded' ? ' · excluded' : ''}</span><button type="button" class="ghost" data-action="remove-list-member" data-id="${esc(member.type)}:${esc(member.id)}">Remove</button></div>`).join('') || '<p class="muted">Nobody on this list yet.</p>'}
      <input id="list-search" data-live="query" value="${esc(state.query)}" placeholder="Search people">
      <div class="people">${people.map((person) => `<button type="button" data-action="add-list-contact" data-id="${esc(person.id)}">${esc(M().personName(person).full)}</button>`).join('')}</div>
      <div class="split"><select data-scope="forms" data-bind="listPick">${activeHouseholds().map((home) => `<option value="${esc(home.id)}">${esc(home.name)}</option>`).join('')}</select><button type="button" class="ghost" data-action="add-list-household">Add household</button></div>
    </section>` : ''}`
}
function modeSelect(record, scope) {
  const attr = scope ? ` data-scope="${scope}"` : ''
  return `<label>Recipients<select${attr} data-bind="recipientMode">${['household', 'individual', 'mixed'].map((mode) => `<option value="${mode}" ${record.recipientMode === mode ? 'selected' : ''}>${mode}</option>`).join('')}</select></label>`
}
function deliverySelect(record, scope) {
  const attr = scope ? ` data-scope="${scope}"` : ''
  const field = scope === 'prefs' ? 'delivery' : 'deliveryMethod'
  const current = record[field]
  return `<label>Delivery<select${attr} data-bind="${field}">${['physical', 'digital', 'both'].map((mode) => `<option value="${mode}" ${current === mode ? 'selected' : ''}>${mode}</option>`).join('')}</select></label>`
}
function rulesEditor(list) {
  const rules = list.rules || M().emptyRules()
  const fields = ['tag', 'country', 'region', 'city', 'has-address', 'has-email', 'created', 'in-household', 'last-correspondence', 'campaign']
  return `<section class="card stack"><h2>Rules</h2>
    <label>Match<select data-bind="rules.match"><option value="all" ${rules.match === 'all' ? 'selected' : ''}>All conditions</option><option value="any" ${rules.match === 'any' ? 'selected' : ''}>Any condition</option></select></label>
    ${(rules.conditions || []).map((condition, index) => `<div class="fields">
      <select data-bind="rules.conditions.${index}.field">${fields.map((field) => `<option ${condition.field === field ? 'selected' : ''}>${field}</option>`).join('')}</select>
      <select data-bind="rules.conditions.${index}.op">${['is', 'is-not', 'before', 'after', 'never', 'participated', 'not-participated'].map((op) => `<option ${condition.op === op ? 'selected' : ''}>${op}</option>`).join('')}</select>
      <input data-bind="rules.conditions.${index}.value" value="${esc(condition.value || '')}" placeholder="Value">
      <button type="button" class="ghost" data-action="remove-condition" data-id="${index}">Remove</button>
    </div>`).join('')}
    <button type="button" class="ghost" data-action="add-condition">Add condition</button>
    <p class="muted">Use yes or no for address and email. Exclusions stay on the list even when someone matches.</p>
  </section>`
}

function campaignsView() {
  const rows = visibleCampaigns().filter((row) => row.status !== 'archived')
  return `<section class="card stack"><div class="fields"><label>Name<input data-scope="forms" data-bind="campaignName" value="${esc(state.forms.campaignName)}" placeholder="Christmas 2026"></label>
      <label>Type<select data-scope="forms" data-bind="campaignType">${M().CAMPAIGN_TYPES.map(([id, label]) => `<option value="${id}" ${state.forms.campaignType === id ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div>
      <button type="button" class="primary" data-action="new-campaign">Create campaign</button></section>
    <section class="card">${rows.map((row) => `<div class="row"><button type="button" class="ghost" data-action="open-campaign" data-id="${esc(row.id)}">${esc(row.name)}</button><span class="pill">${esc(row.status)}</span></div>`).join('') || '<p class="muted">No campaigns yet.</p>'}</section>`
}

function campaignView() {
  const campaign = state.edit
  if (!campaign) return '<p class="muted">Choose a campaign.</p>'
  const tabs = [['overview', 'Overview'], ['recipients', 'Recipients'], ['delivery', 'Delivery'], ['exports', 'Exports'], ['history', 'History']]
  return `<div class="tab">${tabs.map(([id, label]) => `<button type="button" data-action="tab" data-id="${id}" ${state.tab === id ? 'aria-current="page"' : ''}>${label}</button>`).join('')}</div>
    ${state.tab === 'recipients' ? recipientsTab(campaign) : state.tab === 'delivery' ? deliveryTab(campaign) : state.tab === 'exports' ? exportTab(campaign) : state.tab === 'history' ? historyView(campaign.id) : campaignOverview(campaign)}`
}
function campaignOverview(campaign) {
  return `<section class="card stack">
      <div class="split"><button type="button" class="ghost" data-action="nav" data-id="campaigns">All campaigns</button><span class="pill">${esc(campaign.status)}</span></div>
      <div class="fields"><label>Name<input data-bind="name" value="${esc(campaign.name)}"></label><label>Type<select data-bind="campaignType">${M().CAMPAIGN_TYPES.map(([id, label]) => `<option value="${id}" ${campaign.campaignType === id ? 'selected' : ''}>${label}</option>`).join('')}<option value="custom" ${!M().CAMPAIGN_TYPES.some(([id]) => id === campaign.campaignType) ? 'selected' : ''}>Custom</option></select></label></div>
      ${campaign.campaignType === 'custom' || !M().CAMPAIGN_TYPES.some(([id]) => id === campaign.campaignType) ? `<label>Custom type<input data-bind="customType" value="${esc(campaign.customType || campaign.campaignType || '')}"></label>` : ''}
      <label>Description<textarea data-bind="description">${esc(campaign.description || '')}</textarea></label>
      <div class="fields">${modeSelect(campaign)}${deliverySelect(campaign)}
        <label>Salutation<select data-bind="salutationStyle">${M().SALUTATION_STYLES.map(([id, label]) => `<option value="${id}" ${campaign.salutationStyle === id ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <label>Schedule<input type="date" data-bind="scheduledAt" value="${esc((campaign.scheduledAt || '').slice(0, 10))}"></label>
      </div>
      <h2>Lists</h2>
      ${visibleLists().map((list) => `<label class="row"><span><input type="checkbox" data-action="toggle-source" data-id="${esc(list.id)}" ${ (campaign.sourceListIds || []).includes(list.id) ? 'checked' : ''}> ${esc(list.name)}</span><span class="muted">${esc(list.listType)}${list.sharing === 'private' ? ' · private' : ''}</span></label>`).join('') || '<p class="muted">Create a list first.</p>'}
      <div class="split"><button type="button" class="primary" data-action="save-campaign">Save</button><button type="button" class="ghost" data-action="duplicate-campaign">Duplicate for next year</button><button type="button" class="ghost" data-action="archive-campaign">Archive</button></div>
    </section>
    ${sharingPanel(campaign, 'campaign')}`
}
function recipientsTab(campaign) {
  const prepared = M().prepareCampaign(campaign, world())
  const stored = state.recipients.filter((row) => row.campaignId === campaign.id)
  const locked = campaign.status === 'completed' || campaign.status === 'archived'
  const showingStored = stored.length && campaign.status !== 'draft'
  const rows = showingStored ? stored : prepared.recipients
  const unresolved = prepared.duplicates.filter((row) => M().duplicateGroupNeedsChoice(row) && row.resolution === 'pending')
  return `<section class="card stack">
      <p>${locked ? 'This campaign is complete. The saved recipient list does not follow later address changes.' : showingStored ? 'This is the approved snapshot. Rebuild it if the lists changed.' : 'This is a preview. Approving saves a copy of each recipient.'}</p>
      ${prepared.duplicates.map((row) => `<div class="banner ${row.resolution === 'pending' ? 'warn' : ''}"><b>${esc(row.reason)}</b><div>${(row.labels || []).map(esc).join(' · ')}</div><div class="muted">${row.resolution === 'combine' ? 'One delivery' : row.resolution === 'separate' ? 'Separate deliveries' : 'Choose one'}</div>${row.resolution === 'pending' ? `<div class="split"><button type="button" class="primary" data-action="resolve-duplicate" data-id="${esc(row.id)}" data-choice="combine">Combine</button><button type="button" class="ghost" data-action="resolve-duplicate" data-id="${esc(row.id)}" data-choice="separate">Keep separate</button></div>` : ''}</div>`).join('')}
      ${prepared.missing ? `<p class="banner warn">${prepared.missing} recipients are missing an address or email. They are left out of the approved list until the information is added.</p>` : ''}
      <div class="split">${locked ? '' : `<button type="button" class="primary" data-action="approve">${showingStored ? 'Rebuild approved list' : 'Approve recipients'}</button>`}${campaign.status === 'ready' || campaign.status === 'active' ? '<button type="button" class="ghost" data-action="complete">Mark complete</button>' : ''}</div>
      ${unresolved.length && !locked ? `<p class="muted">${unresolved.length} duplicate groups still need a choice.</p>` : ''}
    </section>
    <section class="card"><table><thead><tr><th>Recipient</th><th>Members</th><th>Destination</th></tr></thead><tbody>
      ${rows.slice(state.page * 20, state.page * 20 + 20).map((row) => `<tr><td><b>${esc(row.salutation || row.displayName)}</b><div class="muted">${esc(row.recipientType)}${row.excluded ? ' · left out' : ''}${row.suppressed ? ' · suppressed' : ''}</div></td><td>${esc((row.memberNames || []).join(', '))}</td><td>${esc((row.address ? M().formatAddress(row.address) : []).join(', ') || row.email || 'Missing')}${(row.missing || []).length ? `<div class="muted">Missing ${esc(row.missing.join(', '))}</div>` : ''}</td></tr>`).join('')}
    </tbody></table>
    <div class="split">${state.page ? '<button type="button" class="ghost" data-action="page" data-id="prev">Previous</button>' : ''}${rows.length > (state.page + 1) * 20 ? '<button type="button" class="ghost" data-action="page" data-id="next">Next</button>' : ''}</div>
    </section>
    ${locked ? correctionForm(stored) : ''}`
}
function correctionForm(rows) {
  const included = rows.filter((row) => !row.excluded)
  if (!included.length) return ''
  return `<section class="card stack"><h2>Correct a saved recipient</h2><p class="muted">A correction is recorded with your name and does not change the person in Rolodex.</p>
    <select data-scope="forms" data-bind="correctId">${included.map((row) => `<option value="${esc(row.id)}">${esc(row.salutation || row.displayName)}</option>`).join('')}</select>
    <input data-scope="forms" data-bind="correctReason" value="${esc(state.forms.correctReason || '')}" placeholder="Reason">
    <input data-scope="forms" data-bind="correctLine" value="${esc(state.forms.correctLine || '')}" placeholder="Replacement address line 1">
    <button type="button" class="ghost" data-action="correct">Save correction</button></section>`
}
function deliveryTab(campaign) {
  const rows = state.recipients.filter((row) => row.campaignId === campaign.id && !row.excluded)
  return `<section class="card stack"><p>Direct email and postal sending are not available inside the plugin. Export the file, send it with your own tools, then record what happened. Suppressed addresses are omitted.</p>
      ${rows.map((row) => `<div class="row"><div><b>${esc(row.salutation || row.displayName)}</b><div class="muted">${esc(row.deliveryStatus || 'pending')}</div></div><div class="split">${statusButtons(row)}</div></div>`).join('') || '<p class="muted">Approve recipients before recording delivery.</p>'}
    </section>`
}
function statusButtons(row) {
  const channel = row.deliveryMethod === 'digital' ? 'email' : 'physical'
  return (M().DELIVERY_STATUSES[channel] || []).slice(0, 6).map((status) => `<button type="button" class="ghost" data-action="set-status" data-id="${esc(row.id)}" data-choice="${status}">${status}</button>`).join('')
}
function exportTab(campaign) {
  const templates = [...M().TEMPLATES, ...state.templates]
  const selected = M().templateById(state.prefs.templateId, state.templates)
  const preview = M().templateSlots(selected)
  const rows = state.recipients.filter((row) => row.campaignId === campaign.id && !row.excluded)
  const slots = preview.slots.map((slot, index) => {
    const row = rows[index]
    const style = `left:${slot.x / preview.width * 100}%;top:${slot.y / preview.height * 100}%;width:${slot.w / preview.width * 100}%;height:${slot.h / preview.height * 100}%`
    return `<div class="slot" style="${style}">${esc(row ? row.salutation : '')}</div>`
  }).join('')
  return `<section class="card stack"><p>Exports use the approved snapshot, so a later address change does not rewrite the file.</p>
      <label>Label or envelope<select data-scope="prefs" data-bind="templateId">${templates.map((template) => `<option value="${esc(template.id)}" ${state.prefs.templateId === template.id ? 'selected' : ''}>${esc(template.name)}</option>`).join('')}</select></label>
      <div class="sheet" style="aspect-ratio:${preview.width} / ${preview.height}">${slots}</div>
      <div class="split"><button type="button" class="primary" data-action="export" data-id="csv">CSV</button><button type="button" class="primary" data-action="export" data-id="xlsx">Spreadsheet</button><button type="button" class="primary" data-action="export" data-id="labels">Address labels</button><button type="button" class="primary" data-action="export" data-id="envelopes">Envelopes</button></div>
      ${exportRows(campaign.id)}
    </section>`
}

function historyView(campaignId) {
  const visible = new Set(visibleCampaigns().map((row) => row.id))
  const rows = state.recipients.filter((row) => visible.has(row.campaignId) && (!campaignId || row.campaignId === campaignId)).map((row) => {
    const campaign = state.campaigns.find((item) => item.id === row.campaignId)
    return { row, campaign }
  }).filter((item) => item.campaign && item.campaign.status !== 'draft')
  const needle = state.query.trim().toLowerCase()
  const filtered = rows.filter((item) => !needle || `${item.row.salutation} ${item.campaign.name}`.toLowerCase().includes(needle))
  return `<section class="card stack"><input id="history-search" data-live="query" value="${esc(state.query)}" placeholder="Search history">
      ${filtered.slice(0, 50).map((item) => `<div class="row"><div><b>${esc(item.row.salutation || item.row.displayName)}</b><div class="muted">${esc(item.campaign.name)} · ${esc(item.row.deliveryStatus || '')}</div><div class="muted">${esc(item.row.address ? M().formatAddress(item.row.address).join(', ') : item.row.email || '')}</div></div><span class="muted">${esc((item.row.sentAt || item.row.exportedAt || item.row.includedAt || '').slice(0, 10))}</span></div>`).join('') || '<p class="muted">Approved campaigns will show their saved recipients here.</p>'}
    </section>
    ${campaignId ? '' : `<section class="card"><h2>Changes</h2>${state.audit.slice(0, 20).map((entry) => `<div class="row"><div><b>${esc(entry.action)}</b><div class="muted">${esc(entry.detail)}</div></div><span class="muted">${esc(entry.actor)} · ${esc((entry.at || '').slice(0, 10))}</span></div>`).join('') || '<p class="muted">Merges, approvals, and exports are recorded here.</p>'}</section>`}`
}
function exportsView() {
  return `<section class="card">${exportRows('') || '<p class="muted">No files yet.</p>'}</section>`
}
function exportRows(campaignId) {
  const rows = state.exports.filter((row) => !campaignId || row.campaignId === campaignId)
  return rows.map((row) => `<div class="row"><div><b>${esc(row.filename)}</b><div class="muted">${esc(row.exportType)} · ${row.recipientCount} recipients · ${esc((row.generatedAt || '').slice(0, 10))}</div></div><button type="button" class="ghost" data-action="download-export" data-id="${esc(row.fileId)}" data-choice="${esc(row.filename)}">Download</button></div>`).join('')
}

function settingsView() {
  const prefs = state.prefs
  return `<section class="card stack"><h2>Preferences</h2>
      <label class="row"><span>Group households when the evidence is strong</span><input type="checkbox" data-scope="prefs" data-bind="autoGroup" ${prefs.autoGroup ? 'checked' : ''} ${state.settings['auto-group'] ? 'disabled' : ''}></label>
      <p class="muted">${state.settings['auto-group'] ? 'An administrator set automatic grouping for this workspace.' : 'Automatic grouping never runs on address similarity alone.'}</p>
      <div class="fields">${modeSelect(prefs, 'prefs')}${deliverySelect(prefs, 'prefs')}
        <label>Salutation<select data-scope="prefs" data-bind="salutation">${M().SALUTATION_STYLES.map(([id, label]) => `<option value="${id}" ${prefs.salutation === id ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      </div>
      <button type="button" class="primary" data-action="save-settings">Save preferences</button>
      <button type="button" class="ghost" data-action="clear-blocked">Allow previous grouping suggestions again</button>
    </section>
    <section class="card stack"><h2>Do not email</h2>
      ${(state.suppressions || []).map((row) => `<div class="row"><span>${esc(row.email)}</span><button type="button" class="ghost" data-action="remove-suppression" data-id="${esc(row.id)}">Remove</button></div>`).join('') || '<p class="muted">Suppressed emails are left out of digital campaigns.</p>'}
      <div class="split"><input data-scope="forms" data-bind="suppression" value="${esc(state.forms.suppression)}" placeholder="name@example.com"><button type="button" class="ghost" data-action="add-suppression">Add</button></div>
    </section>
    <section class="card stack"><h2>Custom label</h2>
      <div class="fields">
        <label>Name<input data-scope="forms" data-bind="templateName" value="${esc(state.forms.templateName)}"></label>
        <label>Paper<select data-scope="forms" data-bind="templatePaper"><option>letter</option><option>a4</option></select></label>
        <label>Columns<input data-scope="forms" data-bind="templateColumns" value="${esc(state.forms.templateColumns || '3')}"></label>
        <label>Rows<input data-scope="forms" data-bind="templateRows" value="${esc(state.forms.templateRows || '10')}"></label>
        <label>Width (in)<input data-scope="forms" data-bind="templateWidth" value="${esc(state.forms.templateWidth || '2.625')}"></label>
        <label>Height (in)<input data-scope="forms" data-bind="templateHeight" value="${esc(state.forms.templateHeight || '1')}"></label>
        <label>Font<select data-scope="forms" data-bind="templateFont"><option>Helvetica</option><option>Times-Roman</option><option>Courier</option></select></label>
      </div>
      <button type="button" class="ghost" data-action="save-template">Save template</button>
    </section>
    <section class="card"><h2>Without other services</h2><p>You can group households, build lists, approve campaigns, and export files with no email provider, AI add-on, or address checker. Mark an address checked when you have verified it yourself.</p></section>`
}

function contactView() {
  const person = contact(state.contactId)
  const homes = activeHouseholds().filter((home) => M().currentMembers(home).some((member) => member.contactId === state.contactId))
  const lists = visibleLists().filter((list) => {
    const members = M().listMembership(list, world())
    return members.contacts.some((row) => row.id === state.contactId) || members.households.some((home) => M().currentMembers(home).some((member) => member.contactId === state.contactId))
  })
  const note = state.notes.find((row) => row.id === state.contactId) || { notes: '', salutation: '', delivery: 'physical' }
  const visibleIds = new Set(visibleCampaigns().map((row) => row.id))
  const history = state.recipients.filter((row) => visibleIds.has(row.campaignId) && ((row.memberIds || []).includes(state.contactId) || row.recipientId === state.contactId))
  if (!person) return `<section class="card"><p class="muted">This person is not in the contacts this plugin can read.</p></section>`
  const addresses = M().residentialAddresses(person)
  return `<section class="card stack"><h2>${esc(M().personName(person).full)}</h2>
      <h3>Households</h3>${homes.map((home) => `<button type="button" class="ghost" data-action="open-household" data-id="${esc(home.id)}">${esc(home.name)}</button>`).join('') || '<p class="muted">Not in a household yet.</p>'}
      <button type="button" class="ghost" data-action="new-household-for" data-id="${esc(person.id)}">Create a household for this person</button>
      <h3>Mailing addresses</h3>${addresses.map((address) => `<p>${esc(M().formatAddress(M().normalizeStoredAddress(address)).join(', '))}</p>`).join('') || '<p class="muted">No residential address on the contact.</p>'}
      <h3>Lists</h3>${lists.map((list) => `<p>${esc(list.name)}</p>`).join('') || '<p class="muted">Not on a list.</p>'}
      <div class="split"><select data-scope="forms" data-bind="listPick">${visibleLists().filter((list) => list.listType !== 'dynamic').map((list) => `<option value="${esc(list.id)}">${esc(list.name)}</option>`).join('')}</select><button type="button" class="primary" data-action="add-contact-to-list">Add to list</button></div>
      <h3>Correspondence</h3>
      <label>Preferred salutation<input id="contact-salutation" data-scope="forms" data-bind="contactSalutation" value="${esc(state.forms.contactSalutation ?? note.salutation ?? '')}"></label>
      <label>Notes<textarea id="contact-notes" data-scope="forms" data-bind="contactNotes">${esc(state.forms.contactNotes ?? note.notes ?? '')}</textarea></label>
      <button type="button" class="primary" data-action="save-contact-note">Save mailing notes</button>
      ${history.map((row) => `<div class="row"><span>${esc(row.salutation || row.displayName)}</span><span class="muted">${esc(row.deliveryStatus || '')}</span></div>`).join('') || '<p class="muted">No campaign history yet.</p>'}
    </section>`
}

const actions = {
  nav(id) { state.screen = id; state.edit = null; state.selectedId = ''; state.page = 0; state.notice = ''; render() },
  tab(id) { state.tab = id; state.page = 0; render() },
  page(id) { state.page = Math.max(0, state.page + (id === 'next' ? 1 : -1)); render() },
  async scan() { await scanHouseholds(); render() },
  async 'new-household'() { await createHousehold(state.forms.householdName, []); state.forms.householdName = ''; },
  async 'new-household-for'(id) { await createHousehold(nameOf(id), [id]); },
  'open-household'(id) { openRecord('household', 'households', id) },
  async 'save-household'() { await persistEdit('households', state.households); },
  'archive-household'() { ask('Archive this household? Campaign history is kept.', archiveHousehold) },
  'undo-group'() { ask('Undo this grouping? These people will not be grouped automatically again.', undoGroup) },
  async 'add-member'(id) { await addMember(id, false) },
  async 'remove-member'(id) { await endMember(id) },
  async 'make-primary'(id) { await makePrimary(id) },
  'edit-address'(id) {
    const address = (state.edit.addresses || []).find((row) => row.id === id)
    state.addressDraft = { ...blankAddress(), ...address }
    state.replacingId = id
    render()
  },
  async 'save-address'() { await saveAddress() },
  async 'primary-address'(id) { state.edit.primaryAddressId = id; await persistEdit('households', state.households) },
  async 'check-address'(id) {
    state.edit.addresses = state.edit.addresses.map((address) => address.id === id ? { ...address, validationStatus: 'checked', lastVerifiedAt: M().nowIso() } : address)
    await persistEdit('households', state.households)
    await writeAudit('address.check', 'household', state.edit.id, 'Marked an address as checked.')
  },
  'merge-household'(_id, node) {
    const select = node.parentElement?.querySelector('select')
    if (select?.value) state.forms.mergeId = select.value
    ask('Merge the selected household into this one? The other household is archived.', mergeCurrent)
  },
  async 'split-household'() { await splitCurrent() },
  async 'accept-suggestion'(id) { await acceptSuggestion(id) },
  async 'dismiss-suggestion'(id) { await dismissSuggestion(id) },
  async 'new-list'() { await createList() },
  'open-list'(id) { openRecord('list', 'lists', id) },
  async 'save-list'() { await persistEdit('lists', state.lists) },
  async 'set-sharing'(id) { await setSharing(id) },
  async 'duplicate-list'() { await duplicateList() },
  'archive-list'() { ask('Archive this list? Campaign history is kept.', () => archiveRecord('lists', state.lists, 'list.archive')) },
  async 'add-list-contact'(id) { await addListMember('contact', id) },
  async 'add-list-household'(_id, node) {
    const select = node.parentElement?.querySelector('select')
    const id = select?.value || state.forms.listPick
    if (id) await addListMember('household', id)
  },
  async 'remove-list-member'(id) {
    const [type, memberId] = id.split(':')
    state.edit.members = (state.edit.members || []).filter((member) => !(member.type === type && member.id === memberId))
    await persistEdit('lists', state.lists)
  },
  'add-condition'() {
    state.edit.rules = state.edit.rules || M().emptyRules()
    state.edit.rules.conditions.push({ field: 'tag', op: 'is', value: '' })
    render()
  },
  'remove-condition'(id) { state.edit.rules.conditions.splice(Number(id), 1); render() },
  async 'new-campaign'() { await createCampaign() },
  'open-campaign'(id) { state.tab = 'overview'; openRecord('campaign', 'campaigns', id) },
  async 'save-campaign'() { await saveCampaignEdit() },
  async 'duplicate-campaign'() { await duplicateCampaign() },
  'archive-campaign'() { ask('Archive this campaign? Its recipient history is kept.', () => archiveRecord('campaigns', state.campaigns, 'campaign.archive')) },
  'toggle-source'(id, node) {
    const list = new Set(state.edit.sourceListIds || [])
    if (node.checked) list.add(id)
    else list.delete(id)
    state.edit.sourceListIds = [...list]
    render()
  },
  'resolve-duplicate'(id, node) {
    const choice = node.dataset.choice
    state.edit.confirmedKeys = [...new Set([...(state.edit.confirmedKeys || []), id])]
    state.edit.separateKeys = (state.edit.separateKeys || []).filter((key) => key !== id)
    if (choice === 'separate') state.edit.separateKeys.push(id)
    render()
  },
  async approve() { await approveCampaign() },
  async complete() { await completeCampaign() },
  async correct() { await correctRecipient() },
  async 'set-status'(id, node) { await setStatusOn(id, node.dataset.choice) },
  async export(id) { await exportCampaign(id) },
  async 'download-export'(id, node) { await api().files.download(id, node.dataset.choice || 'export') },
  async 'save-settings'() { await savePrefs(); state.notice = 'Preferences saved.'; render() },
  async 'clear-blocked'() { state.prefs.blockedPairs = []; await savePrefs(); state.notice = 'Earlier grouping suggestions can appear again.'; render() },
  async 'add-suppression'() { await addSuppression() },
  async 'remove-suppression'(id) {
    await api().records.remove('suppressions', id)
    state.suppressions = state.suppressions.filter((row) => row.id !== id)
    render()
  },
  async 'save-template'() { await saveTemplate() },
  async ask() { await askQuestion() },
  async 'apply-proposal'() { await applyProposal() },
  'confirm-yes'() { const run = confirmRun; confirmRun = null; state.confirm = ''; return run ? run() : render() },
  'confirm-no'() { confirmRun = null; state.confirm = ''; render() },
  async 'add-contact-to-list'(_id, node) {
    const select = node.parentElement?.querySelector('select')
    if (select?.value) state.forms.listPick = select.value
    await addContactToList()
  },
  async 'save-contact-note'() { await saveContactNote() },
}

function ask(text, run) { confirmRun = run; state.confirm = text; render() }
function openRecord(screen, collection, id) {
  const record = state[collection].find((row) => row.id === id)
  if (!record) return
  if (collection === 'lists' && !M().canSeeShared(record, state.member?.id)) return
  if (collection === 'campaigns' && !M().canSeeCampaign(record, state.lists, state.member?.id)) return
  state.edit = M().clone(record)
  state.screen = screen
  state.selectedId = id
  state.query = ''
  state.page = 0
  render()
}
async function persistEdit(collection, list) {
  if (state.edit?.customType) state.edit.campaignType = slug(state.edit.customType)
  if (collection === 'lists' || collection === 'campaigns') {
    const sharing = collection === 'campaigns' ? M().campaignSharing(state.edit, state.lists) : state.edit.sharing
    state.edit = M().withAccess(state.edit, state.member, sharing)
  }
  const saved = await saveRecord(collection, state.edit)
  upsert(list, saved)
  state.edit = M().clone(saved)
  state.notice = 'Saved.'
  render()
}
async function archiveHousehold() {
  if (state.edit.match) {
    const members = M().currentMembers(state.edit).map((member) => member.contactId)
    for (let left = 0; left < members.length; left += 1) {
      for (let right = left + 1; right < members.length; right += 1) rememberPair(members[left], members[right])
    }
    await savePrefs()
  }
  await archiveRecord('households', state.households, 'household.archive')
}
async function archiveRecord(collection, list, action) {
  state.edit.archived = true
  state.edit.status = state.edit.status ? 'archived' : state.edit.status
  const saved = await saveRecord(collection, state.edit)
  upsert(list, saved)
  await writeAudit(action, collection, saved.id, `Archived ${saved.name || saved.id}.`)
  state.edit = null
  state.screen = collection === 'households' ? 'households' : collection === 'lists' ? 'lists' : 'campaigns'
  render()
}
async function createHousehold(name, contactIds) {
  const people = contactIds.map(contact).filter(Boolean)
  const address = people.length ? M().residentialAddresses(people[0])[0] : null
  const stored = address ? M().normalizeStoredAddress(address, { sourceContactId: people[0].id }) : null
  const household = {
    id: M().createId(),
    name: name || (people.length ? M().householdTitle(people) : 'New household'),
    salutation: name || '',
    notes: '',
    primaryAddressId: stored?.id || '',
    addresses: stored ? [stored] : [],
    members: people.map((person, index) => ({ contactId: person.id, relationshipType: 'member', displayOrder: index, primary: index === 0, validFrom: M().nowIso(), validUntil: '' })),
    archived: false,
    createdAt: M().nowIso(),
  }
  const saved = await saveRecord('households', household)
  upsert(state.households, saved)
  await writeAudit('household.create', 'household', saved.id, `Created ${saved.name}.`)
  openRecord('household', 'households', saved.id)
}
async function addMember(contactId, force) {
  const others = activeHouseholds().filter((home) => home.id !== state.edit.id && M().currentMembers(home).some((member) => member.contactId === contactId))
  if (others.length && !force) {
    ask(`${nameOf(contactId)} already belongs to ${others[0].name}. Add them to this household as well?`, () => addMember(contactId, true))
    return false
  }
  if (M().currentMembers(state.edit).some((member) => member.contactId === contactId)) { render(); return true }
  state.edit.members.push({ contactId, relationshipType: 'member', displayOrder: state.edit.members.length, primary: state.edit.members.length === 0, validFrom: M().nowIso(), validUntil: '' })
  await persistEdit('households', state.households)
  await writeAudit('household.member', 'household', state.edit.id, `Added ${nameOf(contactId)}.`)
  return true
}
async function endMember(contactId) {
  state.edit.members = state.edit.members.map((member) => member.contactId === contactId && !member.validUntil ? { ...member, validUntil: M().nowIso(), primary: false } : member)
  if (!M().currentMembers(state.edit).some((member) => member.primary)) {
    const first = M().currentMembers(state.edit)[0]
    if (first) state.edit.members = state.edit.members.map((member) => member.contactId === first.contactId && !member.validUntil ? { ...member, primary: true } : member)
  }
  await persistEdit('households', state.households)
}
async function makePrimary(contactId) {
  state.edit.members = state.edit.members.map((member) => !member.validUntil ? { ...member, primary: member.contactId === contactId } : member)
  await persistEdit('households', state.households)
}
async function saveAddress() {
  const draft = state.addressDraft
  if (state.replacingId) state.edit = M().replaceAddress(state.edit, state.replacingId, draft)
  else {
    const stored = M().normalizeStoredAddress(draft)
    state.edit.addresses = [...(state.edit.addresses || []), stored]
    if (!state.edit.primaryAddressId) state.edit.primaryAddressId = stored.id
  }
  state.addressDraft = blankAddress()
  state.replacingId = ''
  await persistEdit('households', state.households)
  await writeAudit('address.update', 'household', state.edit.id, 'Updated a household address and kept the previous one.')
}
async function undoGroup() {
  const members = M().currentMembers(state.edit).map((member) => member.contactId)
  for (let left = 0; left < members.length; left += 1) for (let right = left + 1; right < members.length; right += 1) rememberPair(members[left], members[right])
  await savePrefs()
  state.edit.archived = true
  await persistEdit('households', state.households)
  await writeAudit('household.undo', 'household', state.edit.id, 'Reversed an automatic grouping.')
  state.screen = 'households'
  state.edit = null
  render()
}
async function mergeCurrent() {
  const source = state.households.find((home) => home.id === state.forms.mergeId)
  if (!source) return
  const merged = M().mergeHouseholds(state.edit, source)
  state.edit = merged.target
  await persistEdit('households', state.households)
  const archived = await saveRecord('households', merged.source)
  upsert(state.households, archived)
  await writeAudit('household.merge', 'household', state.edit.id, `Merged ${source.name} into ${state.edit.name}.`)
}
async function splitCurrent() {
  const ids = M().currentMembers(state.edit).map((member) => member.contactId).filter((id) => state.forms[`split-${id}`])
  if (!ids.length) throw new Error('Choose the people to move.')
  const result = M().splitHousehold(state.edit, ids, state.forms.splitName || 'New household')
  state.edit = result.stay
  await persistEdit('households', state.households)
  const created = await saveRecord('households', result.created)
  upsert(state.households, created)
  await writeAudit('household.split', 'household', created.id, `Split ${ids.length} people into ${created.name}.`)
  openRecord('household', 'households', created.id)
}
async function acceptSuggestion(id) {
  const suggestion = state.suggestions.find((row) => row.id === id)
  if (!suggestion) return
  if (suggestion.kind === 'create') {
    await createHousehold('', suggestion.contactIds)
    const created = state.households.find((home) => home.id === state.selectedId)
    if (created) {
      created.match = { confidence: suggestion.confidence, reasons: suggestion.reasons, at: M().nowIso() }
      const saved = await saveRecord('households', created)
      upsert(state.households, saved)
    }
  } else if (suggestion.kind === 'add') {
    openRecord('household', 'households', suggestion.householdId)
    const added = await addMember(suggestion.contactIds[0], false)
    if (!added) return
  } else if (suggestion.kind === 'merge') {
    const target = state.households.find((home) => home.id === suggestion.householdId)
    const source = state.households.find((home) => home.id === suggestion.otherHouseholdId)
    if (target && source) {
      const merged = M().mergeHouseholds(target, source)
      await saveRecord('households', merged.target)
      await saveRecord('households', merged.source)
      upsert(state.households, merged.target)
      upsert(state.households, merged.source)
      await writeAudit('household.merge', 'household', target.id, `Merged ${source.name} into ${target.name}.`)
    }
  }
  suggestion.status = 'accepted'
  await saveRecord('suggestions', suggestion)
  upsert(state.suggestions, suggestion)
  render()
}
async function dismissSuggestion(id) {
  const suggestion = state.suggestions.find((row) => row.id === id)
  if (!suggestion) return
  suggestion.status = 'dismissed'
  if (suggestion.contactIds.length === 2) rememberPair(suggestion.contactIds[0], suggestion.contactIds[1])
  await savePrefs()
  await saveRecord('suggestions', suggestion)
  upsert(state.suggestions, suggestion)
  await writeAudit('household.dismiss', 'suggestion', id, suggestion.reasons.join(', '))
  render()
}
async function setSharing(sharing) {
  if (!state.edit) return
  const noun = state.screen === 'campaign' ? 'campaign' : 'list'
  if (sharing === 'private' && state.edit.ownerId && state.edit.ownerId !== state.member?.id) {
    throw new Error('The person who created this can stop sharing it.')
  }
  if (noun === 'campaign' && sharing === 'workspace' && M().campaignSharing({ ...state.edit, sharing: 'workspace' }, state.lists) === 'private') {
    throw new Error('Share each private list on this campaign before sharing the campaign.')
  }
  state.edit.sharing = sharing === 'private' ? 'private' : 'workspace'
  const collection = noun === 'campaign' ? 'campaigns' : 'lists'
  await persistEdit(collection, state[collection])
  await writeAudit(`${noun}.share`, noun, state.edit.id, sharing === 'private' ? `Kept ${state.edit.name} private.` : `Shared ${state.edit.name} with this workspace.`)
  state.notice = sharing === 'private' ? 'Only you can see this now.' : 'Shared with this workspace. Other members can edit it.'
  render()
}
async function createList() {
  const list = M().withAccess({
    id: M().createId(),
    name: state.forms.listName || 'New list',
    description: '',
    listType: state.forms.listType || 'static',
    recipientMode: state.prefs.recipientMode,
    deliveryMethod: state.prefs.delivery,
    members: [],
    rules: M().emptyRules(),
    archived: false,
    createdAt: M().nowIso(),
  }, state.member, 'workspace')
  const saved = await saveRecord('lists', list)
  upsert(state.lists, saved)
  state.forms.listName = ''
  openRecord('list', 'lists', saved.id)
}
async function addListMember(type, id) {
  state.edit.members = state.edit.members || []
  if (state.edit.members.some((member) => member.type === type && member.id === id)) return
  state.edit.members.push({ type, id, status: 'included', addedAt: M().nowIso(), addedBy: state.me, notes: '' })
  await persistEdit('lists', state.lists)
}
async function duplicateList() {
  const copy = M().clone(state.edit)
  copy.id = M().createId()
  copy.name = `${state.edit.name} copy`
  copy.createdAt = M().nowIso()
  copy.ownerId = ''
  copy.ownerName = ''
  copy.editors = []
  const saved = await saveRecord('lists', M().withAccess(copy, state.member, copy.sharing === 'private' ? 'private' : 'workspace'))
  upsert(state.lists, saved)
  openRecord('list', 'lists', saved.id)
}
async function createCampaign() {
  const campaign = {
    id: M().createId(),
    name: state.forms.campaignName || 'New campaign',
    description: '',
    campaignType: state.forms.campaignType || 'general',
    status: 'draft',
    deliveryMethod: state.prefs.delivery,
    recipientMode: state.prefs.recipientMode,
    salutationStyle: state.prefs.salutation,
    scheduledAt: '',
    sourceListIds: [],
    includes: [],
    excludes: [],
    separateKeys: [],
    confirmedKeys: [],
    emailChoices: {},
    addressChoices: {},
    createdAt: M().nowIso(),
    approvedAt: '',
    completedAt: '',
  }
  const saved = await saveRecord('campaigns', M().withAccess(campaign, state.member, 'workspace'))
  upsert(state.campaigns, saved)
  state.forms.campaignName = ''
  state.tab = 'overview'
  openRecord('campaign', 'campaigns', saved.id)
}
async function saveCampaignEdit() {
  if (state.edit.customType) state.edit.campaignType = slug(state.edit.customType)
  await persistEdit('campaigns', state.campaigns)
}
function slug(value) {
  const text = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return text || 'general'
}
async function duplicateCampaign() {
  const copy = M().clone(state.edit)
  copy.id = M().createId()
  copy.name = `${state.edit.name} copy`
  copy.status = 'draft'
  copy.approvedAt = ''
  copy.completedAt = ''
  copy.confirmedKeys = []
  copy.separateKeys = []
  copy.createdAt = M().nowIso()
  copy.ownerId = ''
  copy.ownerName = ''
  copy.editors = []
  const saved = await saveRecord('campaigns', M().withAccess(copy, state.member, M().campaignSharing(copy, state.lists)))
  upsert(state.campaigns, saved)
  await writeAudit('campaign.duplicate', 'campaign', saved.id, `Duplicated ${state.edit.name}. Earlier recipient snapshots were not copied.`)
  state.tab = 'overview'
  openRecord('campaign', 'campaigns', saved.id)
}
async function approveCampaign() {
  const campaign = state.edit
  if (campaign.status === 'completed' || campaign.status === 'archived') throw new Error('A completed campaign stays as it was.')
  await saveCampaignEdit()
  const prepared = M().prepareCampaign(state.edit, world())
  const unresolved = prepared.duplicates.filter((row) => M().duplicateGroupNeedsChoice(row) && row.resolution === 'pending')
  if (unresolved.length) throw new Error('Choose combine or keep separate for each shared address or email.')
  const built = M().buildSnapshots(campaign.id, prepared)
  const existing = state.recipients.filter((row) => row.campaignId === campaign.id)
  const synced = M().syncSnapshots(existing, built)
  for (const previous of existing) {
    if (!previous.locked && !synced.some((row) => row.id === previous.id)) {
      await api().records.remove('recipients', previous.id)
      state.recipients = state.recipients.filter((row) => row.id !== previous.id)
    }
  }
  for (const row of synced) {
    if (row.locked) continue
    const saved = await saveRecord('recipients', row)
    upsert(state.recipients, saved)
  }
  state.edit.status = 'ready'
  state.edit.approvedAt = state.edit.approvedAt || M().nowIso()
  await persistEdit('campaigns', state.campaigns)
  await writeAudit('campaign.approve', 'campaign', campaign.id, `Approved ${synced.filter((row) => !row.excluded).length} recipients for ${campaign.name}.`)
}
async function completeCampaign() {
  if (state.edit.status === 'completed') { state.notice = 'This campaign is already complete.'; render(); return }
  if (state.edit.status !== 'ready' && state.edit.status !== 'active') throw new Error('Approve the recipients first.')
  for (const row of state.recipients.filter((item) => item.campaignId === state.edit.id)) {
    if (row.locked) continue
    row.locked = true
    const saved = await saveRecord('recipients', row)
    upsert(state.recipients, saved)
  }
  state.edit.status = 'completed'
  state.edit.completedAt = M().nowIso()
  await persistEdit('campaigns', state.campaigns)
  await writeAudit('campaign.complete', 'campaign', state.edit.id, `Completed ${state.edit.name}.`)
}
async function correctRecipient() {
  const row = state.recipients.find((item) => item.id === state.forms.correctId) || state.recipients.find((item) => item.campaignId === state.edit.id && !item.excluded)
  if (!row) throw new Error('Choose a recipient.')
  const patch = {}
  if (state.forms.correctLine) patch.address = { ...(row.address || {}), line1: state.forms.correctLine, formatted: '' }
  const next = M().applySnapshotEdit(row, patch, { reason: state.forms.correctReason, actor: state.me, at: M().nowIso() })
  if (next.address) next.address.formatted = M().formatAddress(next.address).join(', ')
  const saved = await saveRecord('recipients', next)
  upsert(state.recipients, saved)
  await writeAudit('recipient.correct', 'recipient', saved.id, state.forms.correctReason)
  state.notice = 'Correction saved.'
  render()
}
async function setStatusOn(id, status) {
  const row = state.recipients.find((item) => item.id === id)
  if (!row || row.deliveryStatus === status) return
  const at = M().nowIso()
  const delivery = { id: M().createId(), campaignId: row.campaignId, campaignRecipientId: row.id, channel: row.deliveryMethod === 'digital' ? 'email' : 'physical', deliveryStatus: status, provider: 'manual', providerReference: '', attemptedAt: at, completedAt: at, errorMessage: '', metadata: {} }
  const savedDelivery = await saveRecord('deliveries', delivery)
  state.deliveries.push(savedDelivery)
  row.deliveryStatus = status
  if (status === 'exported') row.exportedAt = at
  if (status === 'sent' || status === 'queued') row.sentAt = at
  if (status === 'delivered' || status === 'received') row.deliveredAt = at
  const saved = await saveRecord('recipients', row)
  upsert(state.recipients, saved)
  const campaign = state.campaigns.find((item) => item.id === row.campaignId)
  if (campaign && campaign.status === 'ready') {
    campaign.status = 'active'
    const savedCampaign = await saveRecord('campaigns', campaign)
    upsert(state.campaigns, savedCampaign)
    if (state.edit?.id === campaign.id) state.edit.status = 'active'
  }
  render()
}
async function exportCampaign(kind) {
  const campaign = state.edit
  if (!['ready', 'active', 'completed'].includes(campaign.status)) throw new Error('Approve the recipient list before exporting.')
  const rows = state.recipients.filter((row) => row.campaignId === campaign.id && !row.excluded)
  if (!rows.length) throw new Error('There are no included recipients to export.')
  const printable = rows.map((row) => (row.deliveryStatus === 'pending' || row.deliveryStatus === 'approved' ? { ...row, deliveryStatus: 'exported' } : row))
  const base = M().safeFilename(campaign.name)
  let filename = `${base}.csv`
  let contentType = 'text/csv'
  let data = ''
  if (kind === 'csv') data = M().utf8Base64(M().recipientCsv(printable))
  if (kind === 'xlsx') {
    filename = `${base}.xlsx`
    contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    data = M().bytesToBase64(M().recipientXlsx(printable))
  }
  if (kind === 'labels' || kind === 'envelopes') {
    const chosen = M().templateById(state.prefs.templateId, state.templates)
    const template = kind === 'envelopes'
      ? (chosen.kind === 'envelope' ? chosen : M().templateById('envelope-10', state.templates))
      : (chosen.kind === 'label' ? chosen : M().templateById('avery-5160', state.templates))
    filename = `${base}-${kind}.pdf`
    contentType = 'application/pdf'
    data = M().bytesToBase64(M().labelPdf(printable, template))
  }
  if (data.length > 5600000) throw new Error('That export is over 4 MB. Approve a smaller recipient list and try again.')
  const file = await api().files.put({ filename, contentType, data })
  const record = { id: M().createId(), campaignId: campaign.id, exportType: kind, fileFormat: contentType, templateId: state.prefs.templateId, generatedAt: M().nowIso(), generatedBy: state.me, recipientCount: rows.length, configuration: { templateId: state.prefs.templateId }, fileId: file.id, filename }
  const saved = await saveRecord('exports', record)
  state.exports.unshift(saved)
  for (const row of rows) {
    if (row.deliveryStatus === 'pending' || row.deliveryStatus === 'approved') await setStatusOn(row.id, 'exported')
  }
  await api().files.download(file.id, filename)
  await writeAudit('campaign.export', 'campaign', campaign.id, `Exported ${rows.length} recipients as ${filename}.`)
  state.notice = `Exported ${filename}.`
  render()
}
async function addSuppression() {
  const email = state.forms.suppression.trim().toLowerCase()
  if (!email.includes('@')) throw new Error('Enter an email address.')
  const record = { id: M().createId(), email, reason: 'opt-out', createdAt: M().nowIso() }
  const saved = await saveRecord('suppressions', record)
  state.suppressions.push(saved)
  state.forms.suppression = ''
  render()
}
async function saveTemplate() {
  const template = {
    id: M().createId(),
    name: state.forms.templateName || 'Custom labels',
    kind: 'label',
    paper: state.forms.templatePaper || 'letter',
    columns: Number(state.forms.templateColumns) || 3,
    rows: Number(state.forms.templateRows) || 10,
    labelWidth: Number(state.forms.templateWidth) || 2.625,
    labelHeight: Number(state.forms.templateHeight) || 1,
    marginTop: 0.5,
    marginLeft: 0.19,
    gapX: 0.12,
    gapY: 0,
    font: state.forms.templateFont || 'Helvetica',
    fontSize: 10,
  }
  const saved = await saveRecord('templates', template)
  state.templates.push(saved)
  state.prefs.templateId = saved.id
  await savePrefs()
  state.notice = 'Template saved.'
  render()
}
async function askQuestion() {
  const text = state.forms.question.trim()
  state.aiText = ''
  state.proposal = M().interpret(text, world())
  if (state.proposal) { render(); return }
  const summary = [
    `Households: ${activeHouseholds().map((home) => `${home.name} (${M().currentMembers(home).length})`).join(', ') || 'none'}`,
    `Lists: ${visibleLists().map((list) => `${list.name} (${list.listType})`).join(', ') || 'none'}`,
    `Campaigns: ${visibleCampaigns().map((row) => `${row.name} (${row.status})`).join(', ') || 'none'}`,
    'Do not invent addresses, emails, or household merges. Describe a suggestion only.',
    `Question: ${text}`,
  ].join('\n')
  const result = await api().suggest(summary.slice(0, 8000))
  state.aiText = result?.text || 'The assistant did not return a suggestion.'
  render()
}
async function applyProposal() {
  const proposal = state.proposal
  if (!proposal || proposal.type !== 'mutate' || proposal.action !== 'add-tag') return
  const people = M().contactsForTag(state.contacts, proposal.payload.tag)
  const target = proposal.payload.target
  const list = visibleLists().find((row) => row.name.toLowerCase() === target.toLowerCase())
  const campaign = visibleCampaigns().find((row) => row.name.toLowerCase() === target.toLowerCase() && row.status !== 'completed' && row.status !== 'archived')
  if (list?.listType === 'dynamic') throw new Error('That list is dynamic. Add a tag condition instead of copying people into it.')
  if (list) {
    list.members = list.members || []
    for (const person of people) {
      if (!list.members.some((member) => member.type === 'contact' && member.id === person.id)) list.members.push({ type: 'contact', id: person.id, status: 'included', addedAt: M().nowIso(), addedBy: state.me, notes: '' })
    }
    const saved = await saveRecord('lists', M().withAccess(list, state.member, list.sharing))
    upsert(state.lists, saved)
    await writeAudit('list.members', 'list', list.id, `Added ${people.length} people tagged ${proposal.payload.tag}.`)
  } else if (campaign) {
    campaign.includes = campaign.includes || []
    for (const person of people) {
      if (!campaign.includes.some((member) => member.id === person.id)) campaign.includes.push({ type: 'contact', id: person.id })
    }
    const saved = await saveRecord('campaigns', M().withAccess(campaign, state.member, M().campaignSharing(campaign, state.lists)))
    upsert(state.campaigns, saved)
    await writeAudit('campaign.include', 'campaign', campaign.id, `Added ${people.length} people tagged ${proposal.payload.tag}.`)
  } else {
    state.forms.listName = target
    state.forms.listType = 'static'
    await createList()
    for (const person of people) await addListMember('contact', person.id)
  }
  state.proposal = null
  state.notice = `Added ${people.length} people after your approval.`
  render()
}
async function addContactToList() {
  const list = visibleLists().find((row) => row.id === state.forms.listPick)
  if (!list || list.listType === 'dynamic') throw new Error('Choose a static list.')
  list.members = list.members || []
  if (!list.members.some((member) => member.type === 'contact' && member.id === state.contactId)) {
    list.members.push({ type: 'contact', id: state.contactId, status: 'included', addedAt: M().nowIso(), addedBy: state.me, notes: '' })
    const saved = await saveRecord('lists', M().withAccess(list, state.member, list.sharing))
    upsert(state.lists, saved)
    await writeAudit('list.members', 'list', list.id, `Added ${nameOf(state.contactId)} from the contact profile.`)
  }
  state.notice = 'Added to the list.'
  render()
}
async function saveContactNote() {
  const id = M().asId(state.contactId)
  const existing = state.notes.find((row) => row.id === id)
  const record = { id, contactId: state.contactId, salutation: state.forms.contactSalutation ?? existing?.salutation ?? '', notes: state.forms.contactNotes ?? existing?.notes ?? '', delivery: 'physical' }
  const saved = await saveRecord('contact-notes', record)
  upsert(state.notes, saved)
  state.notice = 'Mailing notes saved in this plugin.'
  render()
}

function onClick(event) {
  const node = event.target.closest('[data-action]')
  if (!node || !app.contains(node)) return
  if (node.tagName === 'INPUT') return
  event.preventDefault()
  run(node.dataset.action, node.dataset.id || '', node)
}
function onField(event) {
  const node = event.target
  if (!node?.dataset) return
  if (node.dataset.action === 'toggle-source' && event.type === 'change') {
    run('toggle-source', node.dataset.id || '', node)
    return
  }
  if (node.dataset.bind) {
    const scope = node.dataset.scope || 'edit'
    if (state[scope]) setPath(state[scope], node.dataset.bind, node.type === 'checkbox' ? node.checked : node.value)
    if (node.dataset.bind === 'templateId' && event.type === 'change') render()
  }
  if (node.dataset.live && event.type === 'input') {
    state[node.dataset.live] = node.value
    render()
  }
}
function run(action, id, node) {
  const fn = actions[action]
  if (!fn) return
  state.error = ''
  Promise.resolve(fn(id, node)).catch((error) => { state.error = error.message || 'Something went wrong.'; render() })
}

app.addEventListener('click', onClick)
app.addEventListener('input', onField)
app.addEventListener('change', onField)
window.addEventListener('rolodex', () => { boot().catch((error) => { state.error = error.message || 'Mailing Lists could not open.'; render() }) })
setTimeout(() => { if (!state.ready && !window.rolodex) state.error = 'Open Mailing Lists from Rolodex.'; render() }, 2000)
