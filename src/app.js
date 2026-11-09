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
  revisions: [],
  contactId: null,
  navOpen: true,
  screen: 'overview',
  tab: 'overview',
  selectedId: '',
  edit: null,
  query: '',
  forms: { householdName: '', householdSearch: '', householdFilterName: '', householdFilterLabel: '', householdFilterAddress: '', householdFilterPeople: '', listName: '', listSearch: '', listType: 'static', memberFilterName: '', memberFilterAddress: '', pickSearch: '', campaignName: '', campaignType: 'holiday', campaignListName: '', campaignListShare: '', shareName: '', shareRole: 'editor', suppression: '', question: '', splitName: '', mergeId: '', listPick: '', templateName: '', recipientName: '', recipientMembers: '', recipientDestination: '', recipientAddress: '', recipientQuery: '' },
  addressDraft: blankAddress(),
  replacingId: '',
  recipientEdit: '',
  createOpen: false,
  suggestionPage: 0,
  proposal: null,
  aiText: '',
  confirm: '',
  page: 0,
  scanning: false,
  addMembersOpen: false,
  pickedMembers: [],
  pickPage: 0,
  sourcePage: 0,
}

let confirmRun = null
let revisionCheckpoint = false
const app = document.getElementById('app')

function M() { return window.Mailing }
function api() { return window.rolodex }
function blankAddress() {
  return { line1: '', line2: '', city: '', region: '', postalCode: '', country: '', type: 'residential', email: '' }
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
    state.navOpen = (await host.get('sidebar')) !== 'closed'
  } catch (error) { /* personal storage is optional; shared lists still open */ }
  state.settings = await host.settings()
  state.contactId = host.contactId || null
  state.prefs = defaultPrefs()
  try {
    const saved = await host.records.get('preferences', 'workspace')
    state.prefs = { ...defaultPrefs(), ...saved.body, blockedPairs: saved.body.blockedPairs || [] }
  } catch (error) { /* first visit */ }
  if (state.settings.paper === 'a4' || state.settings.paper === 'letter') state.prefs.paper = state.settings.paper
  const collections = ['households', 'lists', 'campaigns', 'recipients', 'deliveries', 'exports', 'suggestions', 'templates', 'suppressions', 'audit', 'contact-notes', 'revisions']
  const loaded = await Promise.all(collections.map((name) => loadAll(name)))
  ;[state.households, state.lists, state.campaigns, state.recipients, state.deliveries, state.exports, state.suggestions, state.templates, state.suppressions, state.audit, state.notes, state.revisions] = loaded
  state.ready = true
  if (state.contactId) state.screen = 'contact'
  render()
  await loadContacts()
  await scanHouseholds()
  await copyMemberAddresses()
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

function icon(name) {
  const paths = {
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    overview: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
    households: '<path d="M4 11 12 4l8 7"/><path d="M7 10v10h10V10"/>',
    lists: '<path d="M8 7h12M8 12h12M8 17h12"/><path d="M4 7h.01M4 12h.01M4 17h.01"/>',
    campaigns: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    history: '<circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2"/>',
    exports: '<path d="M12 4v10"/><path d="m8 10 4 4 4-4"/><path d="M5 19h14"/>',
    settings: '<path d="M10.2 2.4h3.6l.5 2.2a6.8 6.8 0 0 1 1.9 1.1l2.1-1 1.8 3-1.6 1.7a6.8 6.8 0 0 1 0 2.2l1.6 1.7-1.8 3-2.1-1a6.8 6.8 0 0 1-1.9 1.1l-.5 2.2h-3.6l-.5-2.2a6.8 6.8 0 0 1-1.9-1.1l-2.1 1-1.8-3 1.6-1.7a6.8 6.8 0 0 1 0-2.2L4 7.7l1.8-3 2.1 1a6.8 6.8 0 0 1 1.9-1.1l.5-2.2z"/><circle cx="12" cy="12" r="2.4"/>',
    contact: '<circle cx="12" cy="8" r="3"/><path d="M5 19c1.5-3 3.8-4.5 7-4.5S17.5 16 19 19"/>',
    back: '<path d="M15 6 9 12l6 6"/><path d="M20 12H9"/>',
  }
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || ''}</svg>`
}
function shell() {
  if (!state.ready) return `<p class="muted">${esc(state.error || 'Loading mailing lists…')}</p>`
  const screens = [['overview', 'Overview', 'overview'], ['households', 'Households', 'households'], ['lists', 'Lists', 'lists'], ['campaigns', 'Campaigns', 'campaigns'], ['history', 'History', 'history'], ['exports', 'Exports', 'exports'], ['settings', 'Settings', 'settings']]
  if (state.contactId) screens.unshift(['contact', 'This person', 'contact'])
  return `<div class="shell ${state.navOpen ? '' : 'nav-closed'}">
    <aside class="side">
      <button type="button" data-action="toggle-nav" aria-label="${state.navOpen ? 'Collapse navigation' : 'Expand navigation'}">${icon('menu')}<span class="label">${state.navOpen ? 'Hide' : 'Menu'}</span></button>
      ${screens.map(([id, label, glyph]) => `<button type="button" data-action="nav" data-id="${id}" ${state.screen === id ? 'aria-current="page"' : ''} title="${esc(label)}">${icon(glyph)}<span class="label">${esc(label)}</span></button>`).join('')}
    </aside>
    <div class="work">
      <div class="top"><h1>Mailing Lists</h1><p class="lede">Group people into households, put them on a list, and mail them together.</p></div>
      <main class="main">
        <p id="status" class="muted">${esc(state.notice)}</p>
        ${state.error ? `<p class="banner bad">${esc(state.error)}</p>` : ''}
        ${state.confirm ? `<div class="banner warn"><p>${esc(state.confirm)}</p><div class="split"><button type="button" class="primary" data-action="confirm-yes">Continue</button><button type="button" class="ghost" data-action="confirm-no">Cancel</button></div></div>` : ''}
        ${view()}
      </main>
    </div>
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
  const bad = badAddressRows()
  const review = state.suggestions.filter((row) => row.status === 'pending' && row.level === 'review')
  const recent = campaigns.filter((row) => row.status === 'completed').slice(0, 5)
  return `<section class="grid">
      ${stat(homes.length, 'Households')}${stat(people.size, 'People in households')}${stat(visibleLists().length, 'Lists')}${stat(active.length, 'Active campaigns')}
    </section>
    ${review.length ? `<section class="card"><h2>Review these household matches</h2>${review.map(suggestionCard).join('')}</section>` : ''}
    <section class="card"><h2>Needs attention</h2>
      <div class="row"><div><b>${bad.length}</b> addresses are marked bad</div><button type="button" class="ghost" data-action="nav" data-id="households">Fix</button></div>
      ${bad.slice(0, 6).map((row) => `<div class="row"><span>${esc(row.home.name)} · ${esc(M().formatAddress(row.address).join(', '))}</span><button type="button" class="bad-btn" data-action="open-household" data-id="${esc(row.home.id)}">Fix</button></div>`).join('')}
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

function badAddressRows() {
  const rows = []
  for (const home of activeHouseholds()) {
    for (const address of M().currentAddresses(home)) {
      if (address.validationStatus === 'bad') rows.push({ home, address })
    }
  }
  return rows
}
function saluteStyle(home) {
  if (home.salutationStyle) return home.salutationStyle
  if (home.salutation) return 'custom'
  return 'household'
}
function saluteHome(home) {
  const people = M().currentMembers(home).map((member) => contact(member.contactId)).filter(Boolean)
  const style = saluteStyle(home)
  const named = style === 'custom' && !home.salutationFormat ? { ...home, salutationFormat: home.salutation } : home
  return M().formatSalutation(style, people, named).salutation
}
function householdPeopleText(home) {
  return M().currentMembers(home).map((member) => nameOf(member.contactId)).join(' ')
}
function householdMatches(home) {
  const search = state.forms.householdSearch.trim().toLowerCase()
  const name = state.forms.householdFilterName.trim().toLowerCase()
  const label = state.forms.householdFilterLabel.trim().toLowerCase()
  const addressText = state.forms.householdFilterAddress.trim().toLowerCase()
  const people = state.forms.householdFilterPeople.trim().toLowerCase()
  const salute = saluteHome(home).toLowerCase()
  const address = M().formatAddress(M().primaryAddress(home)).join(' ').toLowerCase()
  const members = householdPeopleText(home).toLowerCase()
  const count = String(M().currentMembers(home).length)
  const blob = `${home.name} ${salute} ${address} ${members}`.toLowerCase()
  if (search && !blob.includes(search)) return false
  if (name && !String(home.name || '').toLowerCase().includes(name)) return false
  if (label && !salute.includes(label)) return false
  if (addressText && !address.includes(addressText)) return false
  if (people && !members.includes(people) && count !== people) return false
  return true
}
function householdsView() {
  const pending = state.suggestions.filter((row) => row.status === 'pending')
  const page = Math.min(state.suggestionPage, Math.max(0, Math.ceil(pending.length / 3) - 1))
  state.suggestionPage = page
  const shown = pending.slice(page * 3, page * 3 + 3)
  const rows = activeHouseholds().filter(householdMatches)
  const housePage = Math.min(state.page, Math.max(0, Math.ceil(rows.length / 10) - 1))
  state.page = housePage
  const visible = rows.slice(housePage * 10, housePage * 10 + 10)
  return `<section class="card stack">
      <p>A household groups people who should get one mailing and one label.</p>
      <div class="toolbar"><input id="household-search" data-scope="forms" data-bind="householdSearch" value="${esc(state.forms.householdSearch)}" placeholder="Search households"><button type="button" class="primary" data-action="open-create-household">Create household</button></div>
    </section>
    <section class="card">
      <div class="heading"><h2>${pending.length} suggestion${pending.length === 1 ? '' : 's'}</h2><button type="button" class="ghost" data-action="scan" ${state.scanning ? 'disabled aria-busy="true"' : ''}>${state.scanning ? '<span class="spinner" aria-hidden="true"></span>Looking…' : 'Look for households'}</button></div>
      ${state.scanning ? '<p class="muted"><span class="spinner" aria-hidden="true"></span>Looking for households…</p>' : shown.map(suggestionCard).join('') || '<p class="muted">No suggestions yet.</p>'}
      ${pending.length > 3 ? `<div class="split">${page ? '<button type="button" class="ghost" data-action="suggestion-page" data-id="prev">Previous</button>' : ''}<span class="muted">${page * 3 + 1}–${Math.min(pending.length, page * 3 + 3)} of ${pending.length}</span>${page * 3 + 3 < pending.length ? '<button type="button" class="ghost" data-action="suggestion-page" data-id="next">Next</button>' : ''}</div>` : ''}
    </section>
    <section class="card">
      <table>
        <thead>
          <tr><th>Household</th><th>Salutation</th><th>Address</th><th>People</th><th class="actions">Actions</th></tr>
          <tr class="filters">
            <th><input id="household-filter-name" data-scope="forms" data-bind="householdFilterName" value="${esc(state.forms.householdFilterName)}" placeholder="Smith"></th>
            <th><input id="household-filter-label" data-scope="forms" data-bind="householdFilterLabel" value="${esc(state.forms.householdFilterLabel)}" placeholder="Mr. and Mrs."></th>
            <th><input id="household-filter-address" data-scope="forms" data-bind="householdFilterAddress" value="${esc(state.forms.householdFilterAddress)}" placeholder="City or street"></th>
            <th><input id="household-filter-people" data-scope="forms" data-bind="householdFilterPeople" value="${esc(state.forms.householdFilterPeople)}" placeholder="Name or count"></th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${visible.map((home) => {
            const address = M().primaryAddress(home)
            const bad = address?.validationStatus === 'bad'
            return `<tr><td><button type="button" class="ghost" data-action="open-household" data-id="${esc(home.id)}">${esc(home.name)}</button></td><td>${esc(saluteHome(home))}</td><td>${esc(address ? M().formatAddress(address).join(', ') : 'No address')}${bad ? ' <span class="pill">Bad address</span>' : ''}</td><td>${M().currentMembers(home).length}</td><td class="actions"><button type="button" class="ghost" data-action="open-household" data-id="${esc(home.id)}">Edit</button><button type="button" class="danger" data-action="delete-household" data-id="${esc(home.id)}">Delete</button></td></tr>`
          }).join('') || '<tr><td colspan="5"><span class="muted">No households match.</span></td></tr>'}
        </tbody>
      </table>
      <div class="split">${housePage ? '<button type="button" class="ghost" data-action="page" data-id="prev">Previous</button>' : ''}<span class="muted">${rows.length ? `${housePage * 10 + 1}–${Math.min(rows.length, housePage * 10 + visible.length)} of ${rows.length}` : '0 households'}</span>${housePage * 10 + 10 < rows.length ? '<button type="button" class="ghost" data-action="page" data-id="next">Next</button>' : ''}</div>
    </section>
    ${state.createOpen ? `<div class="modal-back" data-action="close-create-household"><div class="modal stack" data-action="stay"><h2>Create household</h2><p class="muted">Group the people who should share one mailing and one label.</p><label>Name<input id="household-name" data-scope="forms" data-bind="householdName" value="${esc(state.forms.householdName)}" placeholder="The Smith Household"></label><div class="split"><button type="button" class="primary" data-action="new-household">Create household</button><button type="button" class="ghost" data-action="close-create-household">Cancel</button></div></div></div>` : ''}`
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
        <label>Salutation<select data-bind="salutationStyle">${[['mr-mrs', 'Mr. and Mrs. {last}'], ['names', 'Names'], ['household', 'The {last} Household'], ['custom', 'Custom format']].map(([id, label]) => `<option value="${id}" ${saluteStyle(home) === id ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      </div>
      ${saluteStyle(home) === 'custom' ? `<label>Format<input id="salutation-format" data-bind="salutationFormat" value="${esc(home.salutationFormat || home.salutation || '')}" placeholder="Mr. and Mrs. {last}"></label><p class="muted">Use {household}, {last}, {names}, or {mr-mrs}.</p>` : ''}
      <p>Mailing name: <b>${esc(saluteHome(home))}</b></p>
      <label>Notes<textarea data-bind="notes">${esc(home.notes || '')}</textarea></label>
      <div class="split"><button type="button" class="primary" data-action="save-household">Save household</button><button type="button" class="ghost" data-action="archive-household">Archive</button>${home.match ? '<button type="button" class="ghost" data-action="undo-group">Undo grouping</button>' : ''}</div>
    </section>
    <section class="card"><h2>Members</h2>
      ${members.map((member) => `<div class="row"><div><b>${esc(nameOf(member.contactId))}</b><div class="muted">${member.primary ? 'Primary contact' : 'Member'}</div></div><div class="split">${member.primary ? '' : `<button type="button" class="ghost" data-action="make-primary" data-id="${esc(member.contactId)}">Make primary</button>`}<button type="button" class="ghost" data-action="remove-member" data-id="${esc(member.contactId)}">Remove</button></div></div>`).join('')}
      <input id="member-search" data-live="query" value="${esc(state.query)}" placeholder="Add a person by name">
      <div class="people">${choices.map((person) => `<button type="button" data-action="add-member" data-id="${esc(person.id)}">${esc(M().personName(person).full)}</button>`).join('')}</div>
    </section>
    <section class="card"><h2>Addresses</h2>
      ${addressCard(home)}
    </section>
    <section class="card stack"><h2>Merge or split</h2>
      <div class="split"><select data-scope="forms" data-bind="mergeId">${others.map((row) => `<option value="${esc(row.id)}" ${state.forms.mergeId === row.id ? 'selected' : ''}>${esc(row.name)}</option>`).join('')}</select><button type="button" class="ghost" data-action="merge-household">Merge selected into this one</button></div>
      <div class="split"><input data-scope="forms" data-bind="splitName" value="${esc(state.forms.splitName)}" placeholder="Name for the new household"><button type="button" class="ghost" data-action="split-household">Split selected members</button></div>
      ${members.map((member) => `<label class="row"><span><input type="checkbox" data-scope="forms" data-bind="split-${member.contactId}" ${state.forms[`split-${member.contactId}`] ? 'checked' : ''}> ${esc(nameOf(member.contactId))}</span></label>`).join('')}
    </section>`
}
function contactEmail(person) {
  const rows = Array.isArray(person?.emails) ? person.emails : []
  const chosen = rows.find((row) => row.primary) || rows[0]
  return String(chosen?.value || '').trim()
}
function memberPeople(home) {
  return M().currentMembers(home).map((member) => contact(member.contactId)).filter(Boolean)
}
function memberEmails(home) {
  const seen = new Set()
  const rows = []
  for (const person of memberPeople(home)) {
    const email = contactEmail(person)
    const key = email.toLowerCase()
    if (!email || seen.has(key)) continue
    seen.add(key)
    rows.push({ email, name: M().personName(person).full })
  }
  const extra = String(home?.email || '').trim()
  if (extra && !seen.has(extra.toLowerCase())) rows.push({ email: extra, name: '' })
  return rows
}
function addressCard(home) {
  const stored = M().currentAddresses(home).filter((address) => M().addressKey(address))
  const emails = memberEmails(home)
  const replacing = Boolean(state.replacingId)
  const emailLine = emails.map((row) => `<p>${esc(row.email)}${row.name ? ` <span class="muted">from ${esc(row.name)}</span>` : ''}</p>`).join('')
  const rows = stored.map((address) => {
    const from = address.sourceContactId ? nameOf(address.sourceContactId) : ''
    return `<div class="row"><div><b>${esc(M().formatAddress(address).join(', '))}</b><div class="muted">${from ? `From ${esc(from)} · ` : ''}${esc(address.type)} · ${esc(address.validationStatus || 'unverified')}${address.id === home.primaryAddressId ? ' · Default' : ''}</div></div><div class="split"><button type="button" class="bad-btn" data-action="bad-address" data-id="${esc(address.id)}">${address.validationStatus === 'bad' ? 'Address is bad' : 'Bad address'}</button><button type="button" class="ghost" data-action="primary-address" data-id="${esc(address.id)}">Make default</button><button type="button" class="ghost" data-action="check-address" data-id="${esc(address.id)}">Mark checked</button><button type="button" class="ghost" data-action="edit-address" data-id="${esc(address.id)}">Update</button></div></div>`
  }).join('')
  const history = (home.addresses || []).some((address) => address.replacedAt) ? `<h3>Previous addresses</h3>${home.addresses.filter((address) => address.replacedAt).map((address) => `<p class="muted">${esc(M().formatAddress(address).join(', '))} · replaced ${esc(address.replacedAt.slice(0, 10))}</p>`).join('')}` : ''
  if (stored.length && !replacing) {
    return `${rows}${emailLine}<p class="muted">Taken from the contacts in this household.</p>${history}`
  }
  const prompt = replacing
    ? '<h3>Replace an address</h3><p class="muted">Replacing an address keeps the previous one for history. Completed campaigns keep the address they already saved.</p>'
    : `<p class="muted">${memberPeople(home).length ? 'No address on these contacts.' : 'Add a person and their contact address is used here.'}</p><h3>Add an address or email</h3><p class="muted">Use this when the contacts have no mailing address. An email is enough for a digital list.</p>`
  return `${rows}${emailLine}${prompt}${addressFields(!replacing)}<button type="button" class="primary" data-action="save-address">${replacing ? 'Save replacement' : 'Add address or email'}</button>${history}`
}
function addressFields(includeEmail) {
  const draft = state.addressDraft
  const field = (bind, label, value) => `<label>${label}<input data-scope="addressDraft" data-bind="${bind}" value="${esc(value || '')}"></label>`
  const email = includeEmail ? `<label>Email<input data-scope="addressDraft" data-bind="email" value="${esc(draft.email || '')}" placeholder="name@example.com"></label>` : ''
  return `<div class="fields">${field('line1', 'Address line 1', draft.line1)}${field('line2', 'Address line 2', draft.line2)}${field('city', 'City', draft.city)}${field('region', 'Region', draft.region)}${field('postalCode', 'Postal code', draft.postalCode)}${field('country', 'Country', draft.country)}</div>
    <label>Type<select data-scope="addressDraft" data-bind="type">${['residential', 'business', 'vacation', 'seasonal', 'mailing-only', 'other'].map((type) => `<option ${draft.type === type ? 'selected' : ''}>${type}</option>`).join('')}</select></label>${email}`
}

function listsView() {
  const query = state.forms.listSearch.trim().toLowerCase()
  const rows = visibleLists()
    .filter((list) => !query || `${list.name} ${list.description || ''}`.toLowerCase().includes(query))
    .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))
  return `<section class="card stack">
      <p>A distribution list is a group of households and people you can mail again.</p>
      <div class="toolbar"><input id="list-search-all" data-scope="forms" data-bind="listSearch" value="${esc(state.forms.listSearch)}" placeholder="Search lists"><button type="button" class="primary" data-action="open-create-list">Create list</button></div>
    </section>
    <section class="card">
      <table>
        <thead><tr><th>Name</th><th>Households | People</th><th>Last modified</th><th>Campaigns</th><th>Users</th></tr></thead>
        <tbody>
          ${rows.map(listRow).join('') || '<tr><td colspan="5"><span class="muted">No lists yet.</span></td></tr>'}
        </tbody>
      </table>
    </section>
    ${state.createOpen ? `<div class="modal-back" data-action="close-create-list"><div class="modal stack" data-action="stay"><h2>Create list</h2><p class="muted">A new list stays private until you share it.</p><label>Name<input id="list-name" data-scope="forms" data-bind="listName" value="${esc(state.forms.listName)}" placeholder="Christmas cards"></label><div class="split"><button type="button" class="primary" data-action="new-list">Create list</button><button type="button" class="ghost" data-action="close-create-list">Cancel</button></div></div></div>` : ''}`
}
function listRow(list) {
  const counts = M().listAudience(list, world())
  return `<tr>
      <td><button type="button" class="ghost" data-action="open-list" data-id="${esc(list.id)}">${esc(list.name)}</button></td>
      <td>${counts.households} <span class="muted">|</span> ${counts.people}</td>
      <td>${esc(formatWhen(list.updatedAt || list.createdAt))}</td>
      <td>${campaignPills(list)}</td>
      <td>${accessAvatars(list)}</td>
    </tr>`
}
function formatWhen(value) {
  const date = new Date(value || '')
  if (!value || Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
function campaignPills(list) {
  const rows = visibleCampaigns().filter((row) => row.status !== 'archived' && (row.sourceListIds || []).includes(list.id))
  if (!rows.length) return '<span class="muted">None yet</span>'
  const shown = rows.slice(0, 3)
  const extra = rows.length - shown.length
  return `<span class="pills">${shown.map((row) => `<span class="pill">${esc(row.name || campaignTypeLabel(row.campaignType))}</span>`).join('')}${extra ? `<span class="pill">+${extra}</span>` : ''}</span>`
}
function campaignTypeLabel(type) {
  return M().CAMPAIGN_TYPES.find(([id]) => id === type)?.[1] || type || 'Campaign'
}
function accessAvatars(list) {
  const people = M().listAccess(list).map((person) => person.id === state.member?.id && (!person.name || person.name === 'Co-owner') ? { ...person, name: state.member.name } : person)
  if (!people.length) return '<span class="muted">Just you</span>'
  return `<span class="avatars">${people.map((person) => {
    const label = `${person.name}, ${roleLabel(person.role)}`
    return `<span class="avatar" style="background:${avatarColor(person.id)}" title="${esc(label)}">${esc(initials(person.name))}<span class="tip">${esc(label)}</span></span>`
  }).join('')}</span>`
}
function roleLabel(role) {
  if (role === 'co-owner') return 'Co-owner'
  if (role === 'viewer') return 'Viewer'
  return 'Editor'
}
function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}
function avatarColor(id) {
  const colors = ['#334155', '#0f766e', '#1d4ed8', '#7c3aed', '#b45309', '#be123c']
  let hash = 0
  const text = String(id || '')
  for (let index = 0; index < text.length; index += 1) hash = (hash + text.charCodeAt(index)) % colors.length
  return colors[hash]
}
function shareField(list) {
  const shared = list.sharing === 'workspace'
  const mine = !list.ownerId || list.ownerId === state.member?.id
  if (shared && !mine) return '<label>Share with<input value="Workspace" readonly></label>'
  const current = shared ? 'workspace' : 'private'
  return `<label>Share with<select data-action="set-sharing">${[['private', 'Only me'], ['workspace', 'Workspace']].map(([id, label]) => `<option value="${id}" ${current === id ? 'selected' : ''}>${label}</option>`).join('')}</select></label>`
}
function listView() {
  const list = state.edit
  if (!list) return '<p class="muted">Choose a list.</p>'
  const revisions = state.revisions.filter((row) => row.listId === list.id).sort((a, b) => String(b.at).localeCompare(String(a.at)))
  return `<section class="card stack">
      <button type="button" class="ghost back" data-action="nav" data-id="lists">${icon('back')} Back to all lists</button>
      <div class="fields"><label>Name<input data-bind="name" value="${esc(list.name)}"></label><label>Description<input data-bind="description" value="${esc(list.description || '')}"></label>${shareField(list)}</div>
      <div class="fields">${modeSelect(list)}${deliverySelect(list)}</div>
      <div class="split"><button type="button" class="primary" data-action="save-list">Save list</button><button type="button" class="ghost" data-action="duplicate-list">Duplicate</button><button type="button" class="ghost" data-action="archive-list">Archive</button></div>
    </section>
    ${rulesEditor(list)}
    ${memberTable(list)}
    <section class="card stack"><h2>Versions</h2>
      <p class="muted">A version is saved when members are added or the rules change.</p>
      ${revisions.slice(0, 20).map((row) => `<div class="row"><div><b>${esc(row.summary || 'Updated')}</b><div class="muted">${esc(row.actor || '')} · ${esc((row.at || '').slice(0, 16).replace('T', ' '))}</div></div>${row.members ? `<button type="button" class="ghost" data-action="restore-revision" data-id="${esc(row.id)}">Restore</button>` : ''}</div>`).join('') || '<p class="muted">Versions show up after a membership or rules change.</p>'}
    </section>
    ${state.addMembersOpen ? addMembersDialog() : ''}`
}
function memberTable(list) {
  const nameQuery = state.forms.memberFilterName.trim().toLowerCase()
  const addressQuery = state.forms.memberFilterAddress.trim().toLowerCase()
  const rows = listMemberRows(list).filter((row) => (!nameQuery || row.name.toLowerCase().includes(nameQuery)) && (!addressQuery || row.address.toLowerCase().includes(addressQuery)))
  const page = Math.min(state.page, Math.max(0, Math.ceil(rows.length / 10) - 1))
  state.page = page
  const visible = rows.slice(page * 10, page * 10 + 10)
  return `<section class="card">
      <h2>List members</h2>
      <p class="muted">People and households on this list.</p>
      <table>
        <thead>
          <tr><th>Name</th><th>Address</th><th class="actions">Action</th></tr>
          <tr class="filters">
            <th><input id="member-filter-name" data-scope="forms" data-bind="memberFilterName" value="${esc(state.forms.memberFilterName)}" placeholder="Name"></th>
            <th><input id="member-filter-address" data-scope="forms" data-bind="memberFilterAddress" value="${esc(state.forms.memberFilterAddress)}" placeholder="City or street"></th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${visible.map((row) => `<tr><td>${esc(row.name)}</td><td>${esc(row.address || 'No address')}</td><td class="actions"><button type="button" class="danger" data-action="remove-list-member" data-id="${esc(row.type)}:${esc(row.id)}">Remove</button></td></tr>`).join('') || '<tr><td colspan="3"><span class="muted">No members match.</span></td></tr>'}
        </tbody>
      </table>
      <div class="split">${page ? '<button type="button" class="ghost" data-action="page" data-id="prev">Previous</button>' : ''}<span class="muted">${rows.length ? `${page * 10 + 1}–${Math.min(rows.length, page * 10 + visible.length)} of ${rows.length}` : '0 members'}</span>${page * 10 + 10 < rows.length ? '<button type="button" class="ghost" data-action="page" data-id="next">Next</button>' : ''}</div>
      <button type="button" class="primary" data-action="open-add-members">Add member</button>
    </section>`
}
function addMembersDialog() {
  const query = state.forms.pickSearch.trim().toLowerCase()
  const rows = addableMembers().filter((row) => !query || `${row.name} ${row.address} ${row.kind}`.toLowerCase().includes(query))
  const page = Math.min(state.pickPage, Math.max(0, Math.ceil(rows.length / 8) - 1))
  state.pickPage = page
  const visible = rows.slice(page * 8, page * 8 + 8)
  return `<div class="modal-back" data-action="close-add-members"><div class="modal modal-wide stack" data-action="stay"><h2>Add members</h2><p class="muted">Choose households and people who are not already in a household.</p><input id="pick-search" data-scope="forms" data-bind="pickSearch" value="${esc(state.forms.pickSearch)}" placeholder="Search"><table class="pick"><thead><tr><th></th><th>Name</th><th>Kind</th><th>Address</th></tr></thead><tbody>${visible.map((row) => `<tr><td><input type="checkbox" data-action="toggle-member-pick" data-id="${esc(row.key)}" ${state.pickedMembers.includes(row.key) ? 'checked' : ''}></td><td>${esc(row.name)}</td><td>${esc(row.kind)}</td><td>${esc(row.address || 'No address')}</td></tr>`).join('') || '<tr><td colspan="4"><span class="muted">Nobody left to add.</span></td></tr>'}</tbody></table><div class="split">${page ? '<button type="button" class="ghost" data-action="pick-page" data-id="prev">Previous</button>' : ''}<span class="muted">${rows.length ? `${page * 8 + 1}–${Math.min(rows.length, page * 8 + visible.length)} of ${rows.length}` : '0 people'}</span>${page * 8 + 8 < rows.length ? '<button type="button" class="ghost" data-action="pick-page" data-id="next">Next</button>' : ''}</div><div class="split"><button type="button" class="primary" data-action="add-picked-members" ${state.pickedMembers.length ? '' : 'disabled'}>Add selected</button><button type="button" class="ghost" data-action="close-add-members">Cancel</button></div></div></div>`
}
function listMemberRows(list) {
  const members = M().listMembership(list, world())
  const rows = []
  for (const home of members.households || []) rows.push({ type: 'household', id: home.id, name: home.name, address: householdAddressLine(home) })
  for (const person of members.contacts || []) rows.push({ type: 'contact', id: person.id, name: M().personName(person).full, address: contactAddressLine(person) })
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}
function addableMembers() {
  const current = new Set(listMemberRows(state.edit).map((row) => `${row.type}:${row.id}`))
  const housed = new Set()
  for (const home of activeHouseholds()) {
    for (const member of M().currentMembers(home)) if (member.contactId) housed.add(member.contactId)
  }
  const rows = []
  for (const home of activeHouseholds()) {
    const key = `household:${home.id}`
    if (current.has(key)) continue
    rows.push({ key, type: 'household', id: home.id, kind: 'Household', name: home.name, address: householdAddressLine(home) })
  }
  for (const person of state.contacts) {
    if (housed.has(person.id)) continue
    const key = `contact:${person.id}`
    if (current.has(key)) continue
    rows.push({ key, type: 'contact', id: person.id, kind: 'Person', name: M().personName(person).full, address: contactAddressLine(person) })
  }
  return rows.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
}
function householdAddressLine(home) {
  const address = M().primaryAddress(home)
  return address ? M().formatAddress(address).join(', ') : ''
}
function contactAddressLine(person) {
  const address = M().residentialAddresses(person)[0]
  return address ? M().formatAddress(M().normalizeStoredAddress(address)).join(', ') : ''
}
function memberLabel(member) {
  if (member.type === 'household') return state.households.find((home) => home.id === member.id)?.name || 'Household'
  return nameOf(member.id)
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
    <p class="muted">Rules add matching people alongside anyone you add by hand. An empty rule list adds nobody.</p>
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
  const rows = visibleCampaigns().filter((row) => row.status !== 'archived').sort((a, b) => String(b.createdAt || b.updatedAt || '').localeCompare(String(a.createdAt || a.updatedAt || '')))
  return `<section class="card stack"><div class="fields"><label>Name<input data-scope="forms" data-bind="campaignName" value="${esc(state.forms.campaignName)}" placeholder="Christmas 2026"></label>
      <label>Type<select data-scope="forms" data-bind="campaignType">${M().CAMPAIGN_TYPES.map(([id, label]) => `<option value="${id}" ${state.forms.campaignType === id ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div>
      <button type="button" class="primary" data-action="new-campaign">Create campaign</button></section>
    <section class="card">
      <table>
        <thead><tr><th>Name</th><th>Date created</th><th>Type</th><th>Status</th></tr></thead>
        <tbody>
          ${rows.map((row) => `<tr class="link" data-action="open-campaign" data-id="${esc(row.id)}"><td>${esc(row.name)}</td><td>${esc(formatWhen(row.createdAt || row.updatedAt))}</td><td>${esc(campaignTypeLabel(row.campaignType))}</td><td>${esc(statusLabel(row.status))}</td></tr>`).join('') || '<tr><td colspan="4"><span class="muted">No campaigns yet.</span></td></tr>'}
        </tbody>
      </table>
    </section>`
}
function statusLabel(status) {
  const text = String(status || 'draft').replace(/-/g, ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function campaignView() {
  const campaign = state.edit
  if (!campaign) return '<p class="muted">Choose a campaign.</p>'
  if (state.tab === 'delivery') state.tab = 'recipients'
  const tabs = [['overview', 'Overview'], ['recipients', 'Recipients'], ['exports', 'Exports'], ['history', 'History']]
  return `<div class="tab">${tabs.map(([id, label]) => `<button type="button" data-action="tab" data-id="${id}" ${state.tab === id ? 'aria-current="page"' : ''}>${label}</button>`).join('')}</div>
    ${state.tab === 'recipients' ? recipientsTab(campaign) : state.tab === 'exports' ? exportTab(campaign) : state.tab === 'history' ? historyView(campaign.id) : campaignOverview(campaign)}`
}
function campaignOverview(campaign) {
  return `<section class="card stack">
      <div class="split"><button type="button" class="ghost back" data-action="nav" data-id="campaigns">${icon('back')} Back to All Campaigns</button><span class="pill">${esc(statusLabel(campaign.status))}</span></div>
      <div class="fields"><label>Name<input data-bind="name" value="${esc(campaign.name)}"></label><label>Type<select data-bind="campaignType">${M().CAMPAIGN_TYPES.map(([id, label]) => `<option value="${id}" ${campaign.campaignType === id ? 'selected' : ''}>${label}</option>`).join('')}<option value="custom" ${!M().CAMPAIGN_TYPES.some(([id]) => id === campaign.campaignType) ? 'selected' : ''}>Custom</option></select></label></div>
      ${campaign.campaignType === 'custom' || !M().CAMPAIGN_TYPES.some(([id]) => id === campaign.campaignType) ? `<label>Custom type<input data-bind="customType" value="${esc(campaign.customType || campaign.campaignType || '')}"></label>` : ''}
      ${campaign.salutationStyle === 'custom' ? `<label>Salutation format<input id="campaign-format" data-bind="salutationFormat" value="${esc(campaign.salutationFormat || '')}" placeholder="{mr-mrs}"></label>` : ''}
      <label>Description<textarea data-bind="description">${esc(campaign.description || '')}</textarea></label>
      <div class="fields">${modeSelect(campaign)}${deliverySelect(campaign)}
        <label>Salutation<select data-bind="salutationStyle">${M().SALUTATION_STYLES.map(([id, label]) => `<option value="${id}" ${campaign.salutationStyle === id ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <label>Schedule<input type="date" data-bind="scheduledAt" value="${esc((campaign.scheduledAt || '').slice(0, 10))}"></label>
      </div>
      ${campaignShareField(campaign)}
      <h2>Lists</h2>
      ${campaignListTable(campaign)}
      <div class="split"><button type="button" class="primary" data-action="save-campaign">Save</button><button type="button" class="ghost" data-action="duplicate-campaign">Duplicate for next year</button><button type="button" class="ghost" data-action="archive-campaign">Archive</button></div>
    </section>`
}
function campaignListTable(campaign) {
  const nameQuery = state.forms.campaignListName.trim().toLowerCase()
  const shareQuery = state.forms.campaignListShare.trim().toLowerCase()
  const selected = new Set(campaign.sourceListIds || [])
  const rows = visibleLists().map((list) => {
    const counts = M().listAudience(list, world())
    return { list, counts, share: list.sharing === 'workspace' ? 'Workspace' : 'Only me' }
  }).filter((row) => (!nameQuery || row.list.name.toLowerCase().includes(nameQuery)) && (!shareQuery || row.share.toLowerCase().includes(shareQuery)))
  const page = Math.min(state.sourcePage, Math.max(0, Math.ceil(rows.length / 8) - 1))
  state.sourcePage = page
  const visible = rows.slice(page * 8, page * 8 + 8)
  return `<table class="pick">
      <thead>
        <tr><th></th><th>Name</th><th>Households | People</th><th>Share with</th></tr>
        <tr class="filters">
          <th></th>
          <th><input id="campaign-list-name" data-scope="forms" data-bind="campaignListName" value="${esc(state.forms.campaignListName)}" placeholder="Name"></th>
          <th></th>
          <th><input id="campaign-list-share" data-scope="forms" data-bind="campaignListShare" value="${esc(state.forms.campaignListShare)}" placeholder="Only me"></th>
        </tr>
      </thead>
      <tbody>
        ${visible.map((row) => `<tr><td><input type="checkbox" data-action="toggle-source" data-id="${esc(row.list.id)}" ${selected.has(row.list.id) ? 'checked' : ''}></td><td>${esc(row.list.name)}</td><td>${row.counts.households} <span class="muted">|</span> ${row.counts.people}</td><td>${esc(row.share)}</td></tr>`).join('') || '<tr><td colspan="4"><span class="muted">No lists match.</span></td></tr>'}
      </tbody>
    </table>
    <div class="split">${page ? '<button type="button" class="ghost" data-action="source-page" data-id="prev">Previous</button>' : ''}<span class="muted">${rows.length ? `${page * 8 + 1}–${Math.min(rows.length, page * 8 + visible.length)} of ${rows.length}` : '0 lists'}</span>${page * 8 + 8 < rows.length ? '<button type="button" class="ghost" data-action="source-page" data-id="next">Next</button>' : ''}</div>`
}
function campaignShareField(campaign) {
  const roles = [['co-owner', 'Co-owner'], ['editor', 'Editor'], ['viewer', 'Viewer']]
  const options = (current) => roles.map(([id, label]) => `<option value="${id}" ${current === id ? 'selected' : ''}>${label}</option>`).join('')
  const people = M().listAccess(campaign)
  return `<div class="stack"><p>Share with</p>
      ${people.map((person) => `<div class="fields"><label>User<input value="${esc(person.name)}" readonly></label><label>Access<select data-action="set-access" data-id="${esc(person.id)}" ${person.id === campaign.ownerId ? 'disabled' : ''}>${options(person.role)}</select></label></div>`).join('')}
      <div class="fields"><label>User<input id="share-name" data-scope="forms" data-bind="shareName" value="${esc(state.forms.shareName)}" placeholder="Name"></label><label>Access<select data-scope="forms" data-bind="shareRole">${options(state.forms.shareRole || 'editor')}</select></label></div>
      <div class="split"><button type="button" class="ghost" data-action="add-share">Add</button></div>
    </div>`
}
function addressIsBad(row) {
  return row?.address?.validationStatus === 'bad'
}
function earlierMail(row, campaignId) {
  const ids = new Set([...(row.memberIds || []), row.recipientId].filter(Boolean))
  return state.recipients.filter((item) => {
    if (!item.campaignId || item.campaignId === campaignId || item.excluded) return false
    const campaign = state.campaigns.find((entry) => entry.id === item.campaignId)
    if (!campaign || campaign.status === 'draft' || !M().canSeeCampaign(campaign, state.lists, state.member?.id)) return false
    const people = new Set([...(item.memberIds || []), item.recipientId].filter(Boolean))
    for (const id of ids) if (people.has(id)) return true
    return false
  }).slice(0, 3).map((item) => {
    const campaign = state.campaigns.find((entry) => entry.id === item.campaignId)
    return `${campaign?.name || 'Campaign'} · ${item.deliveryStatus || 'recorded'}`
  })
}
function noteValue(row, campaign) {
  if (row.notes) return row.notes
  const key = row.recipientKey || row.key
  return campaign.recipientNotes?.[key] || ''
}
function campaignRecipientRows(campaign) {
  const prepared = M().prepareCampaign(campaign, world())
  const stored = state.recipients.filter((row) => row.campaignId === campaign.id)
  const showingStored = stored.length && campaign.status !== 'draft'
  const rows = (showingStored ? stored : prepared.recipients).filter((row) => !row.excluded)
  return { prepared, stored, showingStored, rows }
}
function recipientMatches(row) {
  const name = state.forms.recipientName.trim().toLowerCase()
  const members = state.forms.recipientMembers.trim().toLowerCase()
  const destination = state.forms.recipientDestination.trim().toLowerCase()
  const status = state.forms.recipientAddress
  const label = `${row.salutation || ''} ${row.displayName || ''}`.toLowerCase()
  const memberText = (row.memberNames || []).join(' ').toLowerCase()
  const dest = `${row.address ? M().formatAddress(row.address).join(' ') : ''} ${row.email || ''}`.toLowerCase()
  if (name && !label.includes(name)) return false
  if (members && !memberText.includes(members)) return false
  if (destination && !dest.includes(destination)) return false
  if (status === 'bad' && !addressIsBad(row)) return false
  if (status === 'missing' && !(row.missing || []).length && (row.address || row.email)) return false
  return true
}
function householdForRow(row) {
  if (!row) return null
  if (row.recipientType === 'household') return state.households.find((home) => home.id === row.recipientId) || null
  const ids = new Set([row.recipientId, ...(row.memberIds || [])].filter(Boolean))
  return activeHouseholds().find((home) => M().currentMembers(home).some((member) => ids.has(member.contactId))) || null
}
function recipientPickList() {
  const needle = state.forms.recipientQuery.trim().toLowerCase()
  if (!needle) return { homes: [], people: [] }
  const homes = activeHouseholds().filter((home) => `${home.name} ${saluteHome(home)}`.toLowerCase().includes(needle)).slice(0, 6)
  const people = state.contacts.filter((person) => M().personName(person).full.toLowerCase().includes(needle)).slice(0, 6)
  return { homes, people }
}
function recipientsTab(campaign) {
  const { prepared, showingStored, rows } = campaignRecipientRows(campaign)
  const locked = campaign.status === 'completed' || campaign.status === 'archived'
  const visible = rows.filter(recipientMatches)
  const unresolved = prepared.duplicates.filter((row) => M().duplicateGroupNeedsChoice(row) && row.resolution === 'pending')
  const bad = rows.filter(addressIsBad).length
  const picks = recipientPickList()
  const editing = state.households.find((home) => home.id === state.recipientEdit)
  return `<section class="card stack">
      <p>${locked ? 'This campaign is complete. Editing a household address updates that household and the people in it.' : showingStored ? 'This is the approved snapshot. Rebuild it if the lists changed.' : 'This is a preview. Approving saves a copy of each recipient.'} Export the file, send it with your own tools, then record what happened. Suppressed addresses are omitted.</p>
      <p class="muted">${rows.length} ready${bad ? ` · ${bad} bad addresses` : ''}${prepared.missing ? ` · ${prepared.missing} missing information` : ''}</p>
      ${prepared.duplicates.map((row) => `<div class="banner ${row.resolution === 'pending' ? 'warn' : ''}"><b>${esc(row.reason)}</b><div>${(row.labels || []).map(esc).join(' · ')}</div><div class="muted">${row.resolution === 'combine' ? 'One delivery' : row.resolution === 'separate' ? 'Separate deliveries' : 'Choose one'}</div>${row.resolution === 'pending' ? `<div class="split"><button type="button" class="primary" data-action="resolve-duplicate" data-id="${esc(row.id)}" data-choice="combine">Combine</button><button type="button" class="ghost" data-action="resolve-duplicate" data-id="${esc(row.id)}" data-choice="separate">Keep separate</button></div>` : ''}</div>`).join('')}
      ${prepared.missing ? `<p class="banner warn">${prepared.missing} recipients are missing an address or email. They are left out of the approved list until the information is added.</p>` : ''}
      <div class="split">${locked ? '' : `<button type="button" class="primary" data-action="approve">${showingStored ? 'Rebuild approved list' : 'Approve recipients'}</button>`}${campaign.status === 'ready' || campaign.status === 'active' ? '<button type="button" class="ghost" data-action="complete">Mark complete</button>' : ''}</div>
      ${unresolved.length && !locked ? `<p class="muted">${unresolved.length} duplicate groups still need a choice.</p>` : ''}
    </section>
    <section class="card stack">
      <div class="fields">
        <label>Name<input id="recipient-name" data-scope="forms" data-bind="recipientName" value="${esc(state.forms.recipientName)}" placeholder="Mr. and Mrs. Smith"></label>
        <label>Members<input id="recipient-members" data-scope="forms" data-bind="recipientMembers" value="${esc(state.forms.recipientMembers)}" placeholder="Jane Smith"></label>
        <label>Destination<input id="recipient-destination" data-scope="forms" data-bind="recipientDestination" value="${esc(state.forms.recipientDestination)}" placeholder="City, street, or email"></label>
        <label>Address<select id="recipient-address" data-scope="forms" data-bind="recipientAddress"><option value="" ${state.forms.recipientAddress ? '' : 'selected'}>Any</option><option value="bad" ${state.forms.recipientAddress === 'bad' ? 'selected' : ''}>Bad Address</option><option value="missing" ${state.forms.recipientAddress === 'missing' ? 'selected' : ''}>Missing</option></select></label>
      </div>
      <label>Add a household or person<input id="recipient-query" data-scope="forms" data-bind="recipientQuery" value="${esc(state.forms.recipientQuery)}" placeholder="Search by name"></label>
      <div class="people">${picks.homes.map((home) => `<button type="button" data-action="add-campaign-household" data-id="${esc(home.id)}">Add household · ${esc(home.name)}</button>`).join('')}${picks.people.map((person) => `<button type="button" data-action="add-campaign-contact" data-id="${esc(person.id)}">Add person · ${esc(M().personName(person).full)}</button>`).join('')}</div>
      <table><thead><tr><th>Recipient</th><th>Destination</th><th>Sent before</th><th>Note</th><th>Status</th><th></th></tr></thead><tbody>
      ${visible.slice(state.page * 20, state.page * 20 + 20).map((row) => {
        const key = row.id || row.key
        const past = earlierMail(row, campaign.id)
        const badRow = addressIsBad(row)
        const home = householdForRow(row)
        const status = showingStored && row.id ? statusSelect(row) : '<span class="muted">After approval</span>'
        return `<tr class="${badRow ? 'bad-address' : ''}"><td><b>${esc(row.salutation || row.displayName)}</b><div class="muted">${esc((row.memberNames || []).join(', '))}</div></td><td>${esc((row.address ? M().formatAddress(row.address) : []).join(', ') || row.email || 'Missing')}${badRow ? ' <span class="pill">Bad address</span>' : ''}${(row.missing || []).length ? `<div class="muted">Missing ${esc(row.missing.join(', '))}</div>` : ''}</td><td>${past.length ? past.map(esc).join('<br>') : '<span class="muted">Nothing earlier</span>'}</td><td><input id="note-${esc(key)}" data-note-key="${esc(key)}" value="${esc(noteValue(row, campaign))}" placeholder="Handwritten, returned, photo card"></td><td>${status}</td><td><div class="split">${home ? `<button type="button" class="ghost" data-action="edit-recipient" data-id="${esc(key)}">Edit</button>` : ''}<button type="button" class="ghost" data-action="remove-campaign-recipient" data-id="${esc(key)}">Remove</button>${row.address ? `<button type="button" class="bad-btn" data-action="mark-bad" data-id="${esc(key)}">${badRow ? 'Bad Address' : 'Bad address'}</button>` : ''}</div></td></tr>`
      }).join('') || '<tr><td colspan="6"><span class="muted">No recipients match these filters.</span></td></tr>'}
    </tbody></table>
    <div class="split">${state.page ? '<button type="button" class="ghost" data-action="page" data-id="prev">Previous</button>' : ''}${visible.length > (state.page + 1) * 20 ? '<button type="button" class="ghost" data-action="page" data-id="next">Next</button>' : ''}</div>
    ${editing ? `<h3>Edit ${esc(editing.name)}</h3><p class="muted">This address is saved on the household and used for each person in it.</p>${addressFields(false)}<div class="split"><button type="button" class="primary" data-action="save-recipient-address">Save address</button><button type="button" class="ghost" data-action="cancel-recipient-edit">Cancel</button></div>` : ''}
    </section>`
}
function statusSelect(row) {
  const channel = row.deliveryMethod === 'digital' ? 'email' : 'physical'
  const current = row.deliveryStatus || 'pending'
  const statuses = (M().DELIVERY_STATUSES[channel] || []).slice(0, 6)
  if (!statuses.includes(current)) statuses.push(current)
  return `<select data-action="set-status" data-id="${esc(row.id)}" aria-label="Status">${statuses.map((status) => `<option value="${status}" ${status === current ? 'selected' : ''}>${status}</option>`).join('')}</select>`
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
      <div class="split"><select data-scope="forms" data-bind="listPick">${visibleLists().map((list) => `<option value="${esc(list.id)}">${esc(list.name)}</option>`).join('')}</select><button type="button" class="primary" data-action="add-contact-to-list">Add to list</button></div>
      <h3>Correspondence</h3>
      <label>Preferred salutation<input id="contact-salutation" data-scope="forms" data-bind="contactSalutation" value="${esc(state.forms.contactSalutation ?? note.salutation ?? '')}"></label>
      <label>Notes<textarea id="contact-notes" data-scope="forms" data-bind="contactNotes">${esc(state.forms.contactNotes ?? note.notes ?? '')}</textarea></label>
      <button type="button" class="primary" data-action="save-contact-note">Save mailing notes</button>
      ${history.map((row) => `<div class="row"><span>${esc(row.salutation || row.displayName)}</span><span class="muted">${esc(row.deliveryStatus || '')}</span></div>`).join('') || '<p class="muted">No campaign history yet.</p>'}
    </section>`
}

const actions = {
  nav(id) { state.screen = id; state.edit = null; state.selectedId = ''; state.page = 0; state.notice = ''; state.createOpen = false; state.addMembersOpen = false; render() },
  async 'toggle-nav'() {
    state.navOpen = !state.navOpen
    render()
    try { await api().set('sidebar', state.navOpen ? 'open' : 'closed') } catch (error) { /* the choice still applies for this visit */ }
  },
  tab(id) { state.tab = id; state.page = 0; state.recipientEdit = ''; render() },
  page(id) { state.page = Math.max(0, state.page + (id === 'next' ? 1 : -1)); render() },
  async scan() {
    if (state.scanning) return
    state.scanning = true
    state.suggestionPage = 0
    state.notice = 'Looking for households…'
    render()
    try {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      await scanHouseholds()
    } finally {
      state.scanning = false
      if (state.notice === 'Looking for households…') state.notice = ''
      render()
    }
  },
  'open-create-household'() { state.createOpen = true; render() },
  'close-create-household'() { state.createOpen = false; render() },
  stay() {},
  'suggestion-page'(id) {
    const total = state.suggestions.filter((row) => row.status === 'pending').length
    const max = Math.max(0, Math.ceil(total / 3) - 1)
    state.suggestionPage = Math.min(max, Math.max(0, state.suggestionPage + (id === 'next' ? 1 : -1)))
    render()
  },
  async 'new-household'() { state.createOpen = false; await createHousehold(state.forms.householdName, []); state.forms.householdName = ''; },
  async 'new-household-for'(id) { await createHousehold(nameOf(id), [id]); },
  'open-household'(id) { openRecord('household', 'households', id) },
  'delete-household'(id) {
    const home = state.households.find((row) => row.id === id)
    if (!home) return
    ask(`Delete ${home.name}? Campaign history is kept.`, () => deleteHousehold(id))
  },
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
  async 'bad-address'(id) { await markHouseholdAddressBad(id) },
  'merge-household'(_id, node) {
    const select = node.parentElement?.querySelector('select')
    if (select?.value) state.forms.mergeId = select.value
    ask('Merge the selected household into this one? The other household is archived.', mergeCurrent)
  },
  async 'split-household'() { await splitCurrent() },
  async 'accept-suggestion'(id) { await acceptSuggestion(id) },
  async 'dismiss-suggestion'(id) { await dismissSuggestion(id) },
  'open-create-list'() { state.createOpen = true; render() },
  'close-create-list'() { state.createOpen = false; render() },
  async 'new-list'() { state.createOpen = false; await createList() },
  'open-list'(id) { openRecord('list', 'lists', id) },
  async 'save-list'() { await persistEdit('lists', state.lists) },
  async 'set-sharing'(id) { await setSharing(id) },
  async 'duplicate-list'() { await duplicateList() },
  'archive-list'() { ask('Archive this list? Campaign history is kept.', () => archiveRecord('lists', state.lists, 'list.archive')) },
  'open-add-members'() { state.addMembersOpen = true; state.pickedMembers = []; state.pickPage = 0; state.forms.pickSearch = ''; render() },
  'close-add-members'() { state.addMembersOpen = false; state.pickedMembers = []; render() },
  'toggle-member-pick'(id, node) {
    const picked = new Set(state.pickedMembers)
    if (node?.checked) picked.add(id)
    else picked.delete(id)
    state.pickedMembers = [...picked]
    render()
  },
  'pick-page'(id) { state.pickPage = Math.max(0, state.pickPage + (id === 'next' ? 1 : -1)); render() },
  async 'add-picked-members'() { await addPickedMembers() },
  async 'add-list-contact'(id) { revisionCheckpoint = true; await addListMember('contact', id) },
  async 'add-list-household'(_id, node) {
    const select = node.parentElement?.querySelector('select')
    const id = select?.value || state.forms.listPick
    if (id) { revisionCheckpoint = true; await addListMember('household', id) }
  },
  async 'restore-revision'(id) { await restoreRevision(id) },
  async 'remove-list-member'(id) { await excludeListMember(id) },
  async 'include-list-member'(id) {
    const [type, memberId] = id.split(':')
    revisionCheckpoint = true
    await addListMember(type, memberId)
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
  'source-page'(id) { state.sourcePage = Math.max(0, state.sourcePage + (id === 'next' ? 1 : -1)); render() },
  async 'set-access'(id, node) { await setAccess(id, node?.value || 'editor') },
  async 'add-share'() { await addCampaignShare() },
  'resolve-duplicate'(id, node) {
    const choice = node.dataset.choice
    state.edit.confirmedKeys = [...new Set([...(state.edit.confirmedKeys || []), id])]
    state.edit.separateKeys = (state.edit.separateKeys || []).filter((key) => key !== id)
    if (choice === 'separate') state.edit.separateKeys.push(id)
    render()
  },
  async 'mark-bad'(id) { await markBadAddress(id) },
  'edit-recipient'(id) { beginRecipientEdit(id) },
  'cancel-recipient-edit'() { state.recipientEdit = ''; state.addressDraft = blankAddress(); render() },
  async 'save-recipient-address'() { await saveRecipientHousehold() },
  async 'add-campaign-household'(id) { await addCampaignRecipient('household', id) },
  async 'add-campaign-contact'(id) { await addCampaignRecipient('contact', id) },
  async 'remove-campaign-recipient'(id) { await removeCampaignRecipient(id) },
  async approve() { await approveCampaign() },
  async complete() { await completeCampaign() },
  async 'set-status'(id, node) { await setStatusOn(id, node?.value || '') },
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
  state.addMembersOpen = false
  state.pickedMembers = []
  state.pickPage = 0
  state.forms.memberFilterName = ''
  state.forms.memberFilterAddress = ''
  state.forms.campaignListName = ''
  state.forms.campaignListShare = ''
  state.forms.shareName = ''
  state.sourcePage = 0
  render()
}
async function persistEdit(collection, list) {
  if (state.edit?.customType) state.edit.campaignType = slug(state.edit.customType)
  if (collection === 'lists' || collection === 'campaigns') {
    const sharing = collection === 'campaigns' ? M().campaignSharing(state.edit, state.lists) : (state.edit.sharing === 'private' ? 'private' : 'workspace')
    state.edit = M().withAccess(state.edit, state.member, sharing)
  }
  const saved = await saveRecord(collection, state.edit)
  upsert(list, saved)
  state.edit = M().clone(saved)
  const noted = state.revisionNote
  if (collection === 'lists') await writeRevision(saved)
  state.notice = noted || 'Saved.'
  render()
}
async function writeRevision(list, note) {
  const prior = state.revisions.filter((row) => row.listId === list.id).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0]
  const change = M().memberChange(prior?.members, list.members)
  const rulesChanged = JSON.stringify(prior?.rules || M().emptyRules()) !== JSON.stringify(list.rules || M().emptyRules())
  const requested = note || state.revisionNote || ''
  const checkpoint = revisionCheckpoint
  revisionCheckpoint = false
  state.revisionNote = ''
  const major = Boolean(requested) || rulesChanged || checkpoint
  if (!major) return
  if (prior && !requested && !rulesChanged && !change.added.length && !change.removed.length) return
  const summary = requested || describeMembership(change, rulesChanged)
  const revision = {
    id: M().createId(),
    listId: list.id,
    at: M().nowIso(),
    actor: state.me || 'Someone',
    summary,
    members: (list.members || []).map((member) => ({ type: member.type, id: member.id, status: member.status || 'included' })),
    rules: M().clone(list.rules || M().emptyRules()),
  }
  if (JSON.stringify(revision).length > 90000) {
    revision.members = null
    revision.rules = null
    revision.summary = `${summary} The membership was too large to restore later.`
  }
  const saved = await saveRecord('revisions', revision)
  state.revisions.unshift(saved)
}
function describeMembership(change, rulesChanged) {
  const label = (key) => memberLabel({ type: key.slice(0, key.indexOf(':')), id: key.slice(key.indexOf(':') + 1) })
  const parts = []
  if (change.added.length) parts.push(`Added ${change.added.map(label).join(', ')}`)
  if (change.removed.length) parts.push(`Removed ${change.removed.map(label).join(', ')}`)
  if (rulesChanged) parts.push('Updated the rules')
  return parts.join('. ') || 'Updated the list'
}
async function restoreRevision(id) {
  const revision = state.revisions.find((row) => row.id === id)
  if (!revision?.members || revision.listId !== state.edit?.id) throw new Error('That version cannot be restored.')
  state.edit.members = M().clone(revision.members)
  state.edit.rules = M().clone(revision.rules || M().emptyRules())
  state.revisionNote = `Restored the version from ${(revision.at || '').slice(0, 10)}`
  await persistEdit('lists', state.lists)
}
async function excludeListMember(id) {
  const [type, memberId] = id.split(':')
  state.edit.members = state.edit.members || []
  const member = state.edit.members.find((row) => row.type === type && row.id === memberId)
  if (member) member.status = 'excluded'
  else state.edit.members.push({ type, id: memberId, status: 'excluded', addedAt: M().nowIso(), addedBy: state.me, notes: '' })
  await persistEdit('lists', state.lists)
}
async function markHouseholdAddressBad(id) {
  state.edit = M().markAddressBad(state.edit, id)
  await persistEdit('households', state.households)
  await writeAudit('address.bad', 'household', state.edit.id, 'Marked an address as bad.')
  state.notice = 'Address marked bad. Update it when you have the right one.'
  render()
}
async function markBadAddress(id) {
  const campaign = state.edit
  const stored = state.recipients.find((row) => row.id === id && row.campaignId === campaign?.id)
  const prepared = M().prepareCampaign(campaign, world())
  const row = stored || prepared.recipients.find((item) => item.key === id)
  if (!row?.address?.id) throw new Error('This recipient has no address to mark.')
  const home = row.recipientType === 'household'
    ? state.households.find((item) => item.id === row.recipientId)
    : state.households.find((item) => (item.addresses || []).some((address) => address.id === row.address.id))
  if (!home) throw new Error('That address is not on a household yet.')
  const savedHome = await saveRecord('households', M().markAddressBad(home, row.address.id))
  upsert(state.households, savedHome)
  if (stored?.address) {
    stored.address = { ...stored.address, validationStatus: 'bad' }
    const saved = await saveRecord('recipients', stored)
    upsert(state.recipients, saved)
  }
  await writeAudit('address.bad', 'household', savedHome.id, `Marked an address bad for ${row.salutation || row.displayName}.`)
  state.notice = 'Address marked bad.'
  render()
}
async function saveRecipientNote(key, value) {
  const stored = state.recipients.find((row) => row.campaignId === state.edit?.id && (row.id === key || row.recipientKey === key))
  if (stored) {
    if ((stored.notes || '') === value) return
    stored.notes = value
    const saved = await saveRecord('recipients', stored)
    upsert(state.recipients, saved)
    setStatus('Note saved.')
    return
  }
  if ((state.edit.recipientNotes?.[key] || '') === value) return
  state.edit.recipientNotes = { ...(state.edit.recipientNotes || {}), [key]: value }
  await persistEdit('campaigns', state.campaigns)
}
async function deleteHousehold(id) {
  const home = state.households.find((row) => row.id === id)
  if (!home || home.archived) return
  if (home.match) {
    const members = M().currentMembers(home).map((member) => member.contactId)
    for (let left = 0; left < members.length; left += 1) {
      for (let right = left + 1; right < members.length; right += 1) rememberPair(members[left], members[right])
    }
    await savePrefs()
  }
  const next = { ...home, archived: true, status: home.status ? 'archived' : home.status }
  const saved = await saveRecord('households', next)
  upsert(state.households, saved)
  await writeAudit('household.archive', 'household', saved.id, `Deleted ${saved.name || saved.id}.`)
  if (state.edit?.id === saved.id) state.edit = null
  state.notice = `Deleted ${saved.name}.`
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
async function copyMemberAddresses() {
  for (const home of state.households) {
    if (home.archived) continue
    const next = M().takeContactAddresses(home, state.contacts)
    if (!next) continue
    const saved = await saveRecord('households', next)
    upsert(state.households, saved)
    if (state.edit?.id === saved.id) state.edit = M().clone(saved)
    const source = (saved.addresses || []).find((address) => address.sourceContactId)
    await writeAudit('address.update', 'household', saved.id, `Used the address from ${nameOf(source?.sourceContactId)}.`)
  }
}
async function createHousehold(name, contactIds) {
  const people = contactIds.map(contact).filter(Boolean)
  let household = {
    id: M().createId(),
    name: name || (people.length ? M().householdTitle(people) : 'New household'),
    salutation: '',
    salutationStyle: 'household',
    notes: '',
    primaryAddressId: '',
    addresses: [],
    members: people.map((person, index) => ({ contactId: person.id, relationshipType: 'member', displayOrder: index, primary: index === 0, validFrom: M().nowIso(), validUntil: '' })),
    archived: false,
    createdAt: M().nowIso(),
  }
  household = M().takeContactAddresses(household, people) || household
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
  state.edit = M().takeContactAddresses(state.edit, state.contacts) || state.edit
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
  const email = String(draft.email || '').trim()
  const hasAddress = Boolean(M().addressKey(draft))
  if (email && !email.includes('@')) throw new Error('Enter an email address.')
  if (state.replacingId && !hasAddress) throw new Error('Enter the replacement address.')
  if (hasAddress) state.edit = M().shareHouseholdAddress(state.edit, draft)
  else if (!email) throw new Error('Enter an address or an email.')
  if (email) state.edit.email = email
  state.addressDraft = blankAddress()
  state.replacingId = ''
  await persistEdit('households', state.households)
  await writeAudit('address.update', 'household', state.edit.id, email && !hasAddress ? `Saved ${email} for this household.` : `Updated the address for everyone in ${state.edit.name}.`)
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
function elevatedShare(campaign) {
  return M().listAccess(campaign).some((person) => person.id !== campaign.ownerId && person.role !== 'viewer')
}
async function saveCampaignAccess() {
  const wanted = elevatedShare(state.edit) ? 'workspace' : 'private'
  if (wanted === 'workspace' && M().campaignSharing({ ...state.edit, sharing: 'workspace' }, state.lists) === 'private') {
    state.edit.sharing = 'private'
    await persistEdit('campaigns', state.campaigns)
    state.notice = 'Share each private list on this campaign before giving someone editor access.'
    render()
    return
  }
  state.edit.sharing = wanted
  await persistEdit('campaigns', state.campaigns)
  const names = M().listAccess(state.edit).map((person) => `${person.name} (${roleLabel(person.role)})`).join(', ')
  await writeAudit('campaign.share', 'campaign', state.edit.id, `Share with ${names}.`)
  state.notice = 'Sharing updated.'
  render()
}
async function setAccess(id, role) {
  if (!state.edit || id === state.edit.ownerId) return
  const person = M().listAccess(state.edit).find((row) => row.id === id)
  if (!person) return
  state.edit.access = (state.edit.access || []).filter((grant) => grant.id !== id)
  state.edit.access.push({ id, name: person.name, role })
  await saveCampaignAccess()
}
async function addCampaignShare() {
  const name = state.forms.shareName.trim()
  const role = state.forms.shareRole || 'editor'
  if (!name || !state.edit) return
  const existing = M().listAccess(state.edit).find((person) => person.name.toLowerCase() === name.toLowerCase())
  if (existing?.id === state.edit.ownerId) return
  if (existing) {
    state.forms.shareName = ''
    await setAccess(existing.id, role)
    return
  }
  state.edit.access = [...(state.edit.access || []), { id: M().createId(), name, role }]
  state.forms.shareName = ''
  await saveCampaignAccess()
}
async function createList() {
  const list = M().withAccess({
    id: M().createId(),
    name: state.forms.listName || 'New list',
    description: '',
    listType: 'mixed',
    recipientMode: state.prefs.recipientMode,
    deliveryMethod: state.prefs.delivery,
    members: [],
    rules: M().emptyRules(),
    archived: false,
    createdAt: M().nowIso(),
  }, state.member, 'private')
  const saved = await saveRecord('lists', list)
  upsert(state.lists, saved)
  await writeRevision(saved, 'Created the list')
  state.forms.listName = ''
  openRecord('list', 'lists', saved.id)
}
function stageListMember(type, id) {
  state.edit.members = state.edit.members || []
  const existing = state.edit.members.find((member) => member.type === type && member.id === id)
  if (existing && existing.status !== 'excluded') return false
  if (existing) existing.status = 'included'
  else state.edit.members.push({ type, id, status: 'included', addedAt: M().nowIso(), addedBy: state.me, notes: '' })
  return true
}
async function addListMember(type, id) {
  if (!stageListMember(type, id)) {
    revisionCheckpoint = false
    render()
    return
  }
  await persistEdit('lists', state.lists)
}
async function addPickedMembers() {
  let staged = false
  for (const key of state.pickedMembers) {
    const split = key.indexOf(':')
    if (split < 1) continue
    staged = stageListMember(key.slice(0, split), key.slice(split + 1)) || staged
  }
  state.addMembersOpen = false
  state.pickedMembers = []
  if (!staged) { render(); return }
  revisionCheckpoint = true
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
  const saved = await saveRecord('lists', M().withAccess(copy, state.member, 'private'))
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
  const saved = await saveRecord('campaigns', M().withAccess(campaign, state.member, 'private'))
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
function findCampaignRow(id) {
  const campaign = state.edit
  return state.recipients.find((row) => row.campaignId === campaign?.id && (row.id === id || row.recipientKey === id))
    || M().prepareCampaign(campaign, world()).recipients.find((row) => row.key === id || row.id === id)
}
function beginRecipientEdit(id) {
  const row = findCampaignRow(id)
  const home = householdForRow(row)
  if (!home) throw new Error('This person is not in a household yet.')
  const address = row?.address || M().primaryAddress(home) || {}
  state.recipientEdit = home.id
  state.addressDraft = { ...blankAddress(), line1: address.line1 || '', line2: address.line2 || '', city: address.city || '', region: address.region || '', postalCode: address.postalCode || '', country: address.country || '', type: address.type || 'residential' }
  render()
}
async function saveRecipientHousehold() {
  const home = state.households.find((item) => item.id === state.recipientEdit)
  if (!home) throw new Error('Choose a household.')
  if (!M().addressKey(state.addressDraft)) throw new Error('Enter the household address.')
  const next = M().shareHouseholdAddress(home, state.addressDraft)
  const savedHome = await saveRecord('households', next)
  upsert(state.households, savedHome)
  const address = M().primaryAddress(savedHome)
  const memberIds = new Set(M().currentMembers(savedHome).map((member) => member.contactId))
  for (const row of state.recipients.filter((item) => item.campaignId === state.edit?.id)) {
    const involved = (row.recipientType === 'household' && row.recipientId === savedHome.id) || memberIds.has(row.recipientId) || (row.memberIds || []).some((id) => memberIds.has(id))
    if (!involved) continue
    row.address = M().clone(address)
    const saved = await saveRecord('recipients', row)
    upsert(state.recipients, saved)
  }
  state.recipientEdit = ''
  state.addressDraft = blankAddress()
  await writeAudit('address.update', 'household', savedHome.id, `Updated the address for everyone in ${savedHome.name}.`)
  state.notice = `Updated the address for everyone in ${savedHome.name}.`
  render()
}
async function addCampaignRecipient(type, id) {
  const campaign = state.edit
  const key = `${type}:${id}`
  const already = campaignRecipientRows(campaign).rows.some((row) => (row.recipientType === type && row.recipientId === id) || (type === 'contact' && (row.memberIds || []).includes(id)))
  if (already) {
    state.forms.recipientQuery = ''
    const label = type === 'household' ? (state.households.find((home) => home.id === id)?.name || 'That household') : nameOf(id)
    state.notice = `${label} is already on this campaign.`
    render()
    return
  }
  campaign.excludes = (campaign.excludes || []).filter((item) => `${item.type}:${item.id}` !== key)
  if (!(campaign.includes || []).some((item) => item.type === type && item.id === id)) campaign.includes = [...(campaign.includes || []), { type, id }]
  const draft = M().prepareCampaign(campaign, world()).recipients.find((row) => (row.recipientType === type && row.recipientId === id) || (type === 'contact' && (row.memberIds || []).includes(id)))
  const stored = draft && state.recipients.find((row) => row.campaignId === campaign.id && (row.recipientKey === draft.key || (row.recipientType === draft.recipientType && row.recipientId === draft.recipientId)))
  if (stored?.excluded === false) {
    state.forms.recipientQuery = ''
    state.notice = `${draft.salutation || draft.displayName} is already on this campaign.`
    render()
    return
  }
  if (stored) {
    stored.excluded = false
    const saved = await saveRecord('recipients', stored)
    upsert(state.recipients, saved)
  } else if (campaign.status !== 'draft' && draft && !draft.suppressed) {
    const [snapshot] = M().buildSnapshots(campaign.id, { recipients: [draft] })
    if (snapshot) {
      snapshot.excluded = false
      if (campaign.status === 'completed' || campaign.status === 'archived') snapshot.locked = true
      const saved = await saveRecord('recipients', snapshot)
      upsert(state.recipients, saved)
    }
  }
  state.forms.recipientQuery = ''
  await persistEdit('campaigns', state.campaigns)
  state.notice = `Added ${type === 'household' ? (state.households.find((home) => home.id === id)?.name || 'a household') : nameOf(id)}.`
  render()
}
async function removeCampaignRecipient(id) {
  const campaign = state.edit
  const row = findCampaignRow(id)
  if (!row) return
  const type = row.recipientType
  const target = row.recipientId
  const key = `${type}:${target}`
  campaign.excludes = [...(campaign.excludes || []).filter((item) => `${item.type}:${item.id}` !== key), { type, id: target }]
  campaign.includes = (campaign.includes || []).filter((item) => `${item.type}:${item.id}` !== key)
  const stored = state.recipients.find((item) => item.campaignId === campaign.id && item.recipientType === type && item.recipientId === target)
  if (stored) {
    stored.excluded = true
    const saved = await saveRecord('recipients', stored)
    upsert(state.recipients, saved)
  }
  await persistEdit('campaigns', state.campaigns)
  state.notice = `Removed ${row.salutation || row.displayName}.`
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
    let staged = false
    for (const person of people) staged = stageListMember('contact', person.id) || staged
    if (staged) {
      revisionCheckpoint = true
      await persistEdit('lists', state.lists)
    }
  }
  state.proposal = null
  state.notice = `Added ${people.length} people after your approval.`
  render()
}
async function addContactToList() {
  const list = visibleLists().find((row) => row.id === state.forms.listPick)
  if (!list) throw new Error('Choose a list.')
  list.members = list.members || []
  if (!list.members.some((member) => member.type === 'contact' && member.id === state.contactId)) {
    list.members.push({ type: 'contact', id: state.contactId, status: 'included', addedAt: M().nowIso(), addedBy: state.me, notes: '' })
    const saved = await saveRecord('lists', M().withAccess(list, state.member, list.sharing === 'private' ? 'private' : 'workspace'))
    upsert(state.lists, saved)
    await writeRevision(saved, `Added ${nameOf(state.contactId)}`)
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
  if (node.tagName === 'INPUT' || node.tagName === 'SELECT' || node.disabled) return
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
  if (node.dataset.action === 'set-sharing' && event.type === 'change') {
    run('set-sharing', node.value || '', node)
    return
  }
  if (node.dataset.action === 'set-access' && event.type === 'change') {
    run('set-access', node.dataset.id || '', node)
    return
  }
  if (node.dataset.action === 'set-status' && event.type === 'change') {
    run('set-status', node.dataset.id || '', node)
    return
  }
  if (node.dataset.action === 'toggle-member-pick' && event.type === 'change') {
    run('toggle-member-pick', node.dataset.id || '', node)
    return
  }
  if (node.dataset.bind) {
    const scope = node.dataset.scope || 'edit'
    if (state[scope]) setPath(state[scope], node.dataset.bind, node.type === 'checkbox' ? node.checked : node.value)
    if (node.dataset.bind === 'templateId' && event.type === 'change') render()
    if (node.dataset.bind === 'salutationStyle' && node.value === 'custom' && state.edit && !state.edit.salutationFormat && state.edit.salutation) state.edit.salutationFormat = state.edit.salutation
    if ((node.dataset.bind === 'salutationStyle' || node.dataset.bind === 'salutationFormat') && (event.type === 'change' || event.type === 'input')) render()
    if (String(node.dataset.bind).startsWith('recipient') && (event.type === 'input' || event.type === 'change')) { state.page = 0; render() }
    if ((node.dataset.bind === 'householdSearch' || node.dataset.bind === 'listSearch' || String(node.dataset.bind).startsWith('householdFilter') || String(node.dataset.bind).startsWith('memberFilter')) && event.type === 'input') { state.page = 0; render() }
    if (node.dataset.bind === 'pickSearch' && event.type === 'input') { state.pickPage = 0; render() }
    if ((node.dataset.bind === 'campaignListName' || node.dataset.bind === 'campaignListShare') && event.type === 'input') { state.sourcePage = 0; render() }
  }
  if (node.dataset.noteKey && event.type === 'change') {
    saveRecipientNote(node.dataset.noteKey, node.value).catch((error) => { state.error = error.message || 'The note was not saved.'; render() })
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
