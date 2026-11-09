const FAMILY = new Set(['spouse', 'partner', 'boyfriend/girlfriend', 'husband', 'wife'])
const PARENT = new Set(['parent', 'child', 'guardian'])
const SIBLING = new Set(['sibling'])
const BUSINESS = /\b(work|business|office|company|corporate)\b/i

const STREET = {
  st: 'street',
  str: 'street',
  ave: 'avenue',
  av: 'avenue',
  rd: 'road',
  dr: 'drive',
  ln: 'lane',
  blvd: 'boulevard',
  ct: 'court',
  cir: 'circle',
  pl: 'place',
  ter: 'terrace',
  hwy: 'highway',
  pkwy: 'parkway',
  apt: 'apartment',
  ste: 'suite',
  fl: 'floor',
  n: 'north',
  s: 'south',
  e: 'east',
  w: 'west',
}

const COUNTRY = {
  us: 'us',
  usa: 'us',
  'united states': 'us',
  'united states of america': 'us',
  uk: 'gb',
  'united kingdom': 'gb',
  'great britain': 'gb',
}

export const CAMPAIGN_TYPES = [
  ['holiday', 'Holiday'],
  ['announcement', 'Announcement'],
  ['invitation', 'Invitation'],
  ['thank-you', 'Thank you'],
  ['newsletter', 'Newsletter'],
  ['general', 'General'],
]

export const SALUTATION_STYLES = [
  ['preferred', 'Household choice'],
  ['mr-mrs', 'Mr. and Mrs.'],
  ['names', 'Names'],
  ['household', 'The household'],
  ['family', 'The family'],
  ['formal', 'Full names'],
  ['custom', 'Custom format'],
]

export const DELIVERY_STATUSES = {
  physical: ['pending', 'approved', 'exported', 'sent', 'delivered', 'returned', 'failed', 'cancelled'],
  email: ['pending', 'approved', 'exported', 'queued', 'sent', 'delivered', 'bounced', 'failed', 'cancelled', 'received'],
}

export function createId() {
  const bytes = new Uint8Array(16)
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes)
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 15) | 64
  bytes[8] = (bytes[8] & 63) | 128
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function asId(value) {
  const text = String(value || '').trim().toLowerCase()
  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text) && text.length <= 40) return text
  return hashId('id', [text])
}

export function nowIso() {
  return new Date().toISOString()
}

export function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

export function auditEntry({ action, actor, targetType, targetId, detail, at }) {
  return {
    action,
    actor: actor || 'Someone',
    targetType,
    targetId: targetId || '',
    detail: detail || '',
    at: at || nowIso(),
  }
}

export function memberIdentity(stored, displayName) {
  const name = String(displayName || '').trim() || 'Someone'
  let parsed = null
  if (typeof stored === 'string' && stored.trim()) {
    try { parsed = JSON.parse(stored) } catch { parsed = null }
  }
  const rawId = parsed && typeof parsed.id === 'string' ? parsed.id : ''
  const id = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(rawId) && rawId.length <= 40 ? rawId : createId()
  const changed = !parsed || parsed.id !== id || parsed.name !== name
  return { id, name, token: JSON.stringify({ id, name }), changed }
}

export function withAccess(record, member, sharing) {
  const next = { ...record }
  const person = member?.id ? member : { id: 'member', name: 'Someone' }
  if (!next.ownerId) {
    next.ownerId = person.id
    next.ownerName = person.name
  }
  next.sharing = sharing === 'private' ? 'private' : 'workspace'
  const editors = Array.isArray(next.editors) ? next.editors.filter((row) => row && row.id && row.id !== person.id) : []
  editors.unshift({ id: person.id, name: person.name || 'Someone' })
  next.editors = editors.slice(0, 8)
  next.updatedBy = person.name
  return next
}

export function canSeeShared(record, memberId) {
  if (!record) return false
  if (record.sharing !== 'private') return true
  return Boolean(memberId) && record.ownerId === memberId
}

export function campaignSharing(campaign, lists) {
  const byId = new Map((lists || []).map((list) => [list.id, list]))
  const privateSource = (campaign?.sourceListIds || []).some((id) => byId.get(id)?.sharing === 'private')
  if (privateSource) return 'private'
  return campaign?.sharing === 'private' ? 'private' : 'workspace'
}

export function canSeeCampaign(campaign, lists, memberId) {
  if (!campaign || !canSeeShared(campaign, memberId)) return false
  const byId = new Map((lists || []).map((list) => [list.id, list]))
  return (campaign.sourceListIds || []).every((id) => {
    const list = byId.get(id)
    return !list || canSeeShared(list, memberId)
  })
}

export function editorNames(record) {
  const names = []
  for (const editor of record?.editors || []) {
    if (editor?.name && !names.includes(editor.name)) names.push(editor.name)
  }
  if (record?.ownerName && !names.includes(record.ownerName)) names.push(record.ownerName)
  return names
}

export function listAccess(record) {
  const people = []
  const seen = new Set()
  const push = (id, name, role) => {
    const key = id || name
    if (!key || seen.has(key)) return
    seen.add(key)
    people.push({ id: id || key, name: name || 'Someone', role })
  }
  if (record?.ownerId || record?.ownerName) push(record.ownerId, record.ownerName || 'Co-owner', 'co-owner')
  for (const grant of record?.access || []) {
    if (grant?.role === 'co-owner' || grant?.role === 'editor' || grant?.role === 'viewer') push(grant.id, grant.name, grant.role)
  }
  if (record?.sharing === 'workspace') {
    for (const editor of record?.editors || []) push(editor.id, editor.name, 'editor')
  }
  const rank = { 'co-owner': 0, editor: 1, viewer: 2 }
  return people.sort((a, b) => (rank[a.role] ?? 3) - (rank[b.role] ?? 3))
}

export function listAudience(list, world) {
  const members = listMembership(list, world)
  const people = new Set((members.contacts || []).map((contact) => contact.id))
  for (const home of members.households || []) {
    for (const member of currentMembers(home)) if (member.contactId) people.add(member.contactId)
  }
  return { households: (members.households || []).length, people: people.size }
}

function hashId(prefix, parts) {
  let h1 = 2166136261
  let h2 = 2166136261 ^ 0x9e3779b9
  const text = parts.join('|')
  for (let i = 0; i < text.length; i += 1) {
    h1 ^= text.charCodeAt(i)
    h1 = Math.imul(h1, 16777619)
    h2 ^= text.charCodeAt(text.length - 1 - i)
    h2 = Math.imul(h2, 16777619)
  }
  const hex = (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')
  return `${prefix}-${hex}`
}

function normToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[#.,]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => STREET[word] || word)
    .join(' ')
}

function normPostal(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function normCountry(value) {
  const text = normToken(value)
  return COUNTRY[text] || text
}

export function residentialAddresses(contact) {
  const rows = Array.isArray(contact?.addresses) ? contact.addresses : []
  const home = rows.filter((row) => !BUSINESS.test(row?.label || ''))
  return home.length ? home : []
}

export function addressKey(address) {
  if (!address) return ''
  const line1 = normToken(address.line1 || address.street)
  const line2 = normToken(address.line2 || address.street2)
  const city = normToken(address.city)
  const region = normToken(address.region)
  const postal = normPostal(address.postalCode)
  const country = normCountry(address.country)
  if (!line1 && !city && !postal) return ''
  return [line1, line2, city, region, postal, country].join('|')
}

export function matchAddresses(leftContact, rightContact) {
  const left = residentialAddresses(leftContact).map(addressKey).filter(Boolean)
  const right = residentialAddresses(rightContact).map(addressKey).filter(Boolean)
  if (!left.length || !right.length) return 'none'
  if (left.some((key) => right.includes(key))) return 'exact'
  const strip = (key) => key.split('|').map((part, index) => (index === 1 ? '' : part)).join('|')
  for (const a of left) {
    for (const b of right) {
      if (strip(a) === strip(b) && a !== b) return 'unit-conflict'
    }
  }
  return 'none'
}

function surname(contact) {
  return normToken(contact?.lastName || familyName(contact?.displayName))
}

function familyName(displayName) {
  const parts = String(displayName || '').trim().split(/\s+/)
  return parts.length > 1 ? parts[parts.length - 1] : ''
}

function relations(contact) {
  const rows = Array.isArray(contact?.relationships) ? contact.relationships : []
  return rows.map((row) => ({ id: String(row.contactId || ''), type: String(row.type || '').toLowerCase() }))
}

export function householdConfidence(left, right) {
  const reasons = []
  let score = 0
  const address = matchAddresses(left, right)
  if (address === 'exact') {
    score += 60
    reasons.push('Same residential address')
  }
  const leftSurname = surname(left)
  const rightSurname = surname(right)
  if (leftSurname && leftSurname === rightSurname) {
    score += 15
    reasons.push('Same surname')
  }
  const linked = new Set([
    ...relations(left).filter((row) => row.id === right.id).map((row) => row.type),
    ...relations(right).filter((row) => row.id === left.id).map((row) => row.type),
  ])
  if ([...linked].some((type) => FAMILY.has(type))) {
    score += 55
    reasons.push('Partner or spouse')
  } else if ([...linked].some((type) => PARENT.has(type))) {
    score += 25
    reasons.push('Parent or child')
  } else if ([...linked].some((type) => SIBLING.has(type))) {
    score += 15
    reasons.push('Sibling')
  }
  if (address === 'unit-conflict') reasons.push('Apartment or unit does not match')
  return {
    score: Math.min(100, score),
    reasons,
    conflict: address === 'unit-conflict',
    level: score >= 95 ? 'auto' : score >= 75 ? 'review' : score >= 50 ? 'suggestion' : 'ignore',
  }
}

export function currentMembers(household, at = nowIso()) {
  return (household?.members || []).filter((member) => !member.validUntil || member.validUntil > at)
}

export function pairKey(left, right) {
  return [left, right].sort().join('|')
}

export function planHouseholds(contacts, households, suggestions, autoEnabled, blockedPairs = []) {
  const people = contacts.filter((contact) => contact?.id)
  const byId = new Map(people.map((contact) => [contact.id, contact]))
  const blocked = new Set(blockedPairs || [])
  const closed = new Set((suggestions || []).filter((row) => row.status === 'dismissed' || row.status === 'accepted').map((row) => row.id))
  const homeOf = new Map()
  for (const household of households || []) {
    if (household.archived) continue
    for (const member of currentMembers(household)) homeOf.set(member.contactId, household.id)
  }
  const pairs = []
  for (let i = 0; i < people.length; i += 1) {
    for (let j = i + 1; j < people.length; j += 1) {
      if (blocked.has(pairKey(people[i].id, people[j].id))) continue
      const confidence = householdConfidence(people[i], people[j])
      if (confidence.level === 'ignore') continue
      const homeA = homeOf.get(people[i].id) || ''
      const homeB = homeOf.get(people[j].id) || ''
      if (homeA && homeA === homeB) continue
      pairs.push({ a: people[i].id, b: people[j].id, ...confidence, homeA, homeB })
    }
  }
  const parent = new Map()
  const find = (id) => {
    const current = parent.get(id) || id
    if (current === id) return id
    const root = find(current)
    parent.set(id, root)
    return root
  }
  const unite = (left, right) => {
    const a = find(left)
    const b = find(right)
    if (a !== b) parent.set(a, b)
  }
  for (const pair of pairs) {
    if (autoEnabled && pair.score >= 95 && !pair.homeA && !pair.homeB) unite(pair.a, pair.b)
  }
  const groups = new Map()
  for (const pair of pairs) {
    if (!(autoEnabled && pair.score >= 95 && !pair.homeA && !pair.homeB)) continue
    const root = find(pair.a)
    const group = groups.get(root) || { ids: new Set(), reasons: new Set(), score: 0 }
    group.ids.add(pair.a)
    group.ids.add(pair.b)
    pair.reasons.forEach((reason) => group.reasons.add(reason))
    group.score = Math.max(group.score, pair.score)
    groups.set(root, group)
  }
  const grouped = new Set()
  const create = []
  for (const group of groups.values()) {
    const ids = [...group.ids]
    if (ids.length < 2) continue
    ids.forEach((id) => grouped.add(id))
    const members = ids.map((id) => byId.get(id)).filter(Boolean)
    const shared = sharedAddress(members)
    const name = householdTitle(members)
    create.push({
      id: createId(),
      name,
      salutation: name,
      notes: '',
      primaryAddressId: shared?.id || '',
      addresses: shared ? [shared] : [],
      members: ids.map((id, index) => ({
        contactId: id,
        relationshipType: index === 0 ? 'primary' : 'member',
        displayOrder: index,
        primary: index === 0,
        validFrom: nowIso(),
        validUntil: '',
      })),
      match: { confidence: group.score, reasons: [...group.reasons], at: nowIso() },
      archived: false,
    })
  }
  const suggest = []
  const seen = new Set()
  for (const pair of pairs) {
    if (grouped.has(pair.a) && grouped.has(pair.b)) continue
    let kind = 'create'
    let householdId = ''
    let contactIds = [pair.a, pair.b]
    const newHomeA = grouped.has(pair.a)
    const newHomeB = grouped.has(pair.b)
    if ((pair.homeA || newHomeA) && !pair.homeB && !newHomeB) {
      kind = 'add'
      householdId = pair.homeA || create.find((row) => row.members.some((member) => member.contactId === pair.a))?.id || ''
      contactIds = [pair.b]
    } else if ((pair.homeB || newHomeB) && !pair.homeA && !newHomeA) {
      kind = 'add'
      householdId = pair.homeB || create.find((row) => row.members.some((member) => member.contactId === pair.b))?.id || ''
      contactIds = [pair.a]
    } else if (pair.homeA && pair.homeB && pair.homeA !== pair.homeB && pair.score >= 75) {
      kind = 'merge'
      contactIds = [pair.a, pair.b]
      householdId = pair.homeA
    } else if (pair.homeA || pair.homeB || newHomeA || newHomeB) {
      continue
    }
    const id = hashId('s', [kind, householdId, ...contactIds].sort())
    if (closed.has(id) || seen.has(id)) continue
    seen.add(id)
    suggest.push({
      id,
      kind,
      contactIds,
      householdId,
      otherHouseholdId: kind === 'merge' ? pair.homeB : '',
      confidence: pair.score,
      reasons: pair.reasons,
      level: pair.score >= 75 ? 'review' : 'suggestion',
      status: 'pending',
    })
  }
  return { create, suggest }
}

function sharedAddress(contacts) {
  const counts = new Map()
  for (const contact of contacts) {
    for (const address of residentialAddresses(contact)) {
      const key = addressKey(address)
      if (!key) continue
      const current = counts.get(key) || { count: 0, address }
      current.count += 1
      counts.set(key, current)
    }
  }
  let best = null
  for (const row of counts.values()) if (!best || row.count > best.count) best = row
  if (!best) return null
  return normalizeStoredAddress(best.address, { sourceContactId: '', type: 'residential' })
}

export function householdTitle(contacts) {
  const names = contacts.map((contact) => personName(contact))
  const tally = new Map()
  for (const name of names) {
    if (!name.last) continue
    tally.set(name.last, (tally.get(name.last) || 0) + 1)
  }
  let last = ''
  let count = 0
  for (const [value, seen] of tally) {
    if (seen > count) {
      last = value
      count = seen
    }
  }
  if (last && count >= 2) return `The ${last} Household`
  if (names.length === 2) return `${names[0].full} and ${names[1].full}`
  return names[0]?.full ? `${names[0].full}'s household` : 'New household'
}

export function personName(contact) {
  const preferred = String(contact?.preferredName || '').trim()
  const first = String(contact?.firstName || '').trim()
  const last = String(contact?.lastName || '').trim() || familyName(contact?.displayName)
  const given = preferred || first
  const full = String(contact?.displayName || '').trim() || [given, last].filter(Boolean).join(' ') || 'Unnamed'
  return { first: given || full, last, full }
}

export function formatSalutation(style, contacts, household) {
  const requested = style === 'preferred' && household?.salutationStyle ? household.salutationStyle : (style || 'names')
  return renderSalutation(requested, contacts, household)
}

function majorityLast(people) {
  const tally = new Map()
  for (const person of people) if (person.last) tally.set(person.last, (tally.get(person.last) || 0) + 1)
  let last = ''
  let count = 0
  for (const [value, seen] of tally) if (seen > count) { last = value; count = seen }
  return last
}

function renderSalutation(style, contacts, household) {
  const people = (contacts || []).map(personName)
  const members = people.map((person) => person.full)
  const preferred = String(household?.salutation || '').trim()
  const last = majorityLast(people)
  if (!people.length) return { salutation: preferred || household?.name || 'Unnamed', members }
  if ((style === 'preferred' || !style) && preferred) return { salutation: preferred, members }
  if (style === 'preferred' || !style) return renderSalutation('names', contacts, household)
  if (style === 'mr-mrs') return { salutation: last ? `Mr. and Mrs. ${last}` : (preferred || 'Mr. and Mrs.'), members }
  if (style === 'household') return { salutation: last ? `The ${last} Household` : (household?.name || preferred || 'The Household'), members }
  if (style === 'custom') {
    const template = String(household?.salutationFormat || preferred || '{names}').trim() || '{names}'
    const names = renderSalutation('names', contacts, household).salutation
    const titled = last ? `Mr. and Mrs. ${last}` : 'Mr. and Mrs.'
    const text = template
      .replaceAll('{household}', household?.name || '')
      .replaceAll('{last}', last)
      .replaceAll('{names}', names)
      .replaceAll('{mr-mrs}', titled)
    return { salutation: text || names, members }
  }
  if (style === 'family') {
    const tally = new Map()
    for (const person of people) if (person.last) tally.set(person.last, (tally.get(person.last) || 0) + 1)
    let last = ''
    let count = 0
    for (const [value, seen] of tally) if (seen > count) { last = value; count = seen }
    return { salutation: last ? `The ${last} Family` : (preferred || household?.name || 'The Family'), members }
  }
  if (style === 'formal' || people.length === 1) {
    if (people.length === 1) return { salutation: people[0].full, members }
    return { salutation: joinNames(people.map((person) => person.full)), members }
  }
  const sameLast = people.every((person) => person.last && person.last === people[0].last)
  if (sameLast && people.length === 2) return { salutation: `${people[0].first} & ${people[1].first} ${people[0].last}`, members }
  if (sameLast) {
    const given = people.map((person) => person.first)
    return { salutation: `${joinNames(given)} ${people[0].last}`, members }
  }
  return { salutation: joinNames(people.map((person) => person.full)), members }
}

function joinNames(names) {
  if (names.length <= 1) return names[0] || ''
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

export function normalizeStoredAddress(address, extra = {}) {
  const line1 = String(address?.line1 || address?.street || '').trim()
  const line2 = String(address?.line2 || address?.street2 || '').trim()
  const city = String(address?.city || '').trim()
  const region = String(address?.region || '').trim()
  const postalCode = String(address?.postalCode || '').trim()
  const country = String(address?.country || '').trim()
  const stored = {
    id: address?.id && asId(address.id) === String(address.id).toLowerCase() ? String(address.id).toLowerCase() : createId(),
    line1,
    line2,
    city,
    region,
    postalCode,
    country,
    type: extra.type || address?.type || 'residential',
    validationStatus: address?.validationStatus || 'unverified',
    lastVerifiedAt: address?.lastVerifiedAt || '',
    sourceContactId: extra.sourceContactId || address?.sourceContactId || '',
    sourceAddressId: address?.sourceAddressId || address?.id || '',
    current: true,
    replacedAt: '',
    createdAt: address?.createdAt || nowIso(),
  }
  stored.formatted = formatAddress(stored).join(', ')
  return stored
}

export function replaceAddress(household, addressId, next) {
  const copy = clone(household)
  const at = nowIso()
  copy.addresses = (copy.addresses || []).map((address) => {
    if (address.id !== addressId) return address
    return { ...address, current: false, replacedAt: at }
  })
  const stored = normalizeStoredAddress({ ...next, validationStatus: 'unverified', lastVerifiedAt: '' })
  copy.addresses.push(stored)
  if (!copy.primaryAddressId || copy.primaryAddressId === addressId) copy.primaryAddressId = stored.id
  copy.updatedAt = at
  return copy
}

export function currentAddresses(household) {
  return (household?.addresses || []).filter((address) => address.current !== false && !address.replacedAt)
}

export function primaryAddress(household) {
  const current = currentAddresses(household)
  return current.find((address) => address.id === household?.primaryAddressId) || current[0] || null
}

export function takeContactAddresses(household, contacts) {
  const current = currentAddresses(household).filter((address) => addressKey(address))
  if (current.length) return null
  const byId = new Map((contacts || []).map((person) => [person.id, person]))
  const seen = new Set()
  const rows = []
  for (const member of currentMembers(household)) {
    const person = byId.get(member.contactId)
    if (!person) continue
    for (const address of residentialAddresses(person)) {
      const key = addressKey(address)
      if (!key || seen.has(key)) continue
      seen.add(key)
      rows.push(normalizeStoredAddress(address, { sourceContactId: person.id, type: 'residential' }))
    }
  }
  if (!rows.length) return null
  const copy = clone(household)
  copy.addresses = [...(copy.addresses || []).filter((address) => address.replacedAt), ...rows]
  copy.primaryAddressId = rows[0].id
  return copy
}

export function shareHouseholdAddress(household, draft) {
  const copy = clone(household)
  const at = nowIso()
  copy.addresses = (copy.addresses || []).map((address) => (address.replacedAt ? address : { ...address, current: false, replacedAt: at }))
  const stored = normalizeStoredAddress({ ...draft, id: '', validationStatus: 'unverified', lastVerifiedAt: '' }, { type: draft?.type || 'residential' })
  copy.addresses.push(stored)
  copy.primaryAddressId = stored.id
  copy.updatedAt = at
  return copy
}

export function formatAddress(address) {
  return addressLines(address)
}

export function addressLines(address) {
  if (!address) return []
  const lines = []
  if (address.line1) lines.push(address.line1)
  if (address.line2) lines.push(address.line2)
  const region = [address.region, address.postalCode].filter(Boolean).join(' ')
  const city = [address.city, region].filter(Boolean).join(', ')
  if (city) lines.push(city)
  const country = String(address.country || '').trim()
  if (country && !/^(us|usa|united states|united states of america)$/i.test(country)) lines.push(country)
  return lines
}

export function emptyRules() {
  return { version: 1, match: 'all', conditions: [], exclusions: [] }
}

const RULE_FIELDS = new Set(['tag', 'country', 'region', 'city', 'has-address', 'has-email', 'created', 'in-household', 'last-correspondence', 'campaign'])

export function validateRules(rules) {
  if (!rules || typeof rules !== 'object') return 'Add a rule'
  if (rules.version !== 1) return 'These rules use an unsupported version'
  if (rules.match !== 'all' && rules.match !== 'any') return 'Choose whether all conditions or any condition must match'
  if (!Array.isArray(rules.conditions)) return 'Rules need a condition list'
  for (const condition of rules.conditions) {
    if (!condition || !RULE_FIELDS.has(condition.field)) return 'A condition uses an unknown field'
    if (!condition.op || !String(condition.value ?? '').trim()) return 'Finish each condition'
  }
  return ''
}

function primaryEmail(contact) {
  const emails = Array.isArray(contact?.emails) ? contact.emails : []
  const chosen = emails.find((row) => row.primary) || emails[0]
  return String(chosen?.value || '').trim()
}

function contactCountry(contact) {
  const address = residentialAddresses(contact)[0]
  return normCountry(address?.country)
}

export function contactMatches(contact, condition, world) {
  const value = String(condition.value || '').trim().toLowerCase()
  if (condition.field === 'tag') {
    const tags = (contact.tags || []).map((tag) => String(tag.name || tag).toLowerCase())
    const has = tags.includes(value)
    return condition.op === 'is-not' ? !has : has
  }
  if (condition.field === 'country') {
    const has = contactCountry(contact) === normCountry(value)
    return condition.op === 'is-not' ? !has : has
  }
  if (condition.field === 'region' || condition.field === 'city') {
    const addresses = residentialAddresses(contact)
    const has = addresses.some((address) => normToken(address[condition.field]) === normToken(value))
    return condition.op === 'is-not' ? !has : has
  }
  if (condition.field === 'has-address') {
    const has = residentialAddresses(contact).some((address) => addressKey(address))
    return value === 'no' ? !has : has
  }
  if (condition.field === 'has-email') {
    const has = Boolean(primaryEmail(contact))
    return value === 'no' ? !has : has
  }
  if (condition.field === 'created') {
    const created = Date.parse(contact.createdAt || '')
    const target = Date.parse(condition.value)
    if (Number.isNaN(created) || Number.isNaN(target)) return false
    return condition.op === 'before' ? created < target : created >= target
  }
  if (condition.field === 'in-household') {
    const homes = homesOf(contact.id, world.households)
    if (value === 'any') return condition.op === 'is-not' ? homes.length === 0 : homes.length > 0
    const has = homes.some((home) => home.id === condition.value)
    return condition.op === 'is-not' ? !has : has
  }
  if (condition.field === 'last-correspondence') {
    const last = lastCorrespondence(contact.id, world)
    if (condition.op === 'never') return !last
    if (!last) return condition.op === 'before'
    const when = Date.parse(last)
    const target = Date.parse(condition.value)
    if (Number.isNaN(when) || Number.isNaN(target)) return false
    return condition.op === 'before' ? when < target : when >= target
  }
  if (condition.field === 'campaign') {
    const hits = campaignHits(contact.id, world)
    const has = hits.some((hit) => hit.id === condition.value || hit.campaignType === value || hit.name.toLowerCase() === value)
    return condition.op === 'not-participated' ? !has : has
  }
  return false
}

function homesOf(contactId, households) {
  return (households || []).filter((household) => !household.archived && currentMembers(household).some((member) => member.contactId === contactId))
}

function lastCorrespondence(contactId, world) {
  let latest = ''
  for (const recipient of world.recipients || []) {
    if (recipient.excluded) continue
    const campaign = (world.campaigns || []).find((row) => row.id === recipient.campaignId)
    if (!campaign || (campaign.status !== 'completed' && campaign.status !== 'active' && campaign.status !== 'ready')) continue
    const involved = recipient.recipientId === contactId || (recipient.memberIds || []).includes(contactId)
    if (!involved) continue
    const when = recipient.sentAt || recipient.exportedAt || recipient.includedAt || ''
    if (when > latest) latest = when
  }
  return latest
}

function campaignHits(contactId, world) {
  const hits = []
  for (const recipient of world.recipients || []) {
    if (recipient.excluded) continue
    const involved = recipient.recipientId === contactId || (recipient.memberIds || []).includes(contactId)
    if (!involved) continue
    const campaign = (world.campaigns || []).find((row) => row.id === recipient.campaignId)
    if (campaign) hits.push(campaign)
  }
  return hits
}

export function evaluateDynamicList(list, world) {
  const rules = list.rules || emptyRules()
  const problem = validateRules(rules)
  if (problem) return { contacts: [], households: [], problem }
  if (!rules.conditions.length) return { contacts: [], households: [], problem: '' }
  const excluded = new Set((rules.exclusions || []).map((row) => `${row.type}:${row.id}`))
  const matched = []
  for (const contact of world.contacts || []) {
    if (excluded.has(`contact:${contact.id}`)) continue
    const results = rules.conditions.map((condition) => contactMatches(contact, condition, world))
    const ok = rules.match === 'any' ? results.some(Boolean) : results.every(Boolean)
    if (ok) matched.push(contact)
  }
  const mode = list.recipientMode || 'mixed'
  if (mode === 'individual') {
    return { contacts: matched, households: [], problem: '' }
  }
  const householdIds = new Set()
  const loose = []
  for (const contact of matched) {
    const homes = homesOf(contact.id, world.households).filter((home) => !excluded.has(`household:${home.id}`))
    if (!homes.length) loose.push(contact)
    homes.forEach((home) => householdIds.add(home.id))
  }
  const households = (world.households || []).filter((home) => householdIds.has(home.id))
  if (mode === 'household') return { contacts: loose, households, problem: '' }
  return { contacts: loose, households, problem: '' }
}

export function listMembership(list, world) {
  if (list.archived) return { contacts: [], households: [] }
  const byContact = new Map((world.contacts || []).map((contact) => [contact.id, contact]))
  const byHouse = new Map((world.households || []).map((home) => [home.id, home]))
  const contacts = []
  const households = []
  const excluded = new Set()
  for (const member of list.members || []) {
    const key = `${member.type}:${member.id}`
    if (member.status === 'excluded') {
      excluded.add(key)
      continue
    }
    if (member.type === 'household') {
      const home = byHouse.get(member.id)
      if (home && !home.archived) households.push(home)
    } else {
      const contact = byContact.get(member.id)
      if (contact) contacts.push(contact)
    }
  }
  const rules = list.rules || emptyRules()
  if (!rules.conditions?.length) return { contacts, households, problem: '' }
  const dynamic = evaluateDynamicList(list, world)
  if (dynamic.problem) return { contacts, households, problem: dynamic.problem }
  for (const contact of dynamic.contacts || []) {
    if (excluded.has(`contact:${contact.id}`) || contacts.some((row) => row.id === contact.id)) continue
    contacts.push(contact)
  }
  for (const home of dynamic.households || []) {
    if (excluded.has(`household:${home.id}`) || households.some((row) => row.id === home.id)) continue
    households.push(home)
  }
  return { contacts, households, problem: '' }
}

export function memberChange(before, after) {
  const active = (rows) => new Set((rows || []).filter((member) => member.status !== 'excluded').map((member) => `${member.type}:${member.id}`))
  const previous = active(before)
  const next = active(after)
  return {
    added: [...next].filter((key) => !previous.has(key)),
    removed: [...previous].filter((key) => !next.has(key)),
  }
}

export function markAddressBad(household, addressId, at = nowIso()) {
  const copy = clone(household)
  let found = false
  copy.addresses = (copy.addresses || []).map((address) => {
    if (address.id !== addressId) return address
    found = true
    return { ...address, validationStatus: 'bad', lastVerifiedAt: at }
  })
  if (found) copy.updatedAt = at
  return copy
}

function suppressionSet(rows) {
  return new Set((rows || []).map((row) => String(row.email || '').trim().toLowerCase()).filter(Boolean))
}

export function prepareCampaign(campaign, world) {
  const contacts = new Map((world.contacts || []).map((contact) => [contact.id, contact]))
  const households = new Map((world.households || []).filter((home) => !home.archived).map((home) => [home.id, home]))
  const lists = (world.lists || []).filter((list) => (campaign.sourceListIds || []).includes(list.id))
  const mode = campaign.recipientMode || 'mixed'
  const raw = []
  for (const list of lists) {
    const members = listMembership(list, world)
    for (const contact of members.contacts) raw.push({ type: 'contact', id: contact.id, listId: list.id })
    for (const home of members.households) raw.push({ type: 'household', id: home.id, listId: list.id })
  }
  for (const row of campaign.includes || []) raw.push({ type: row.type, id: row.id, listId: '' })
  const excluded = new Set((campaign.excludes || []).map((row) => `${row.type}:${row.id}`))
  const expanded = []
  for (const row of raw) {
    if (excluded.has(`${row.type}:${row.id}`)) continue
    if (mode === 'individual' && row.type === 'household') {
      const home = households.get(row.id)
      for (const member of currentMembers(home)) {
        if (excluded.has(`contact:${member.contactId}`)) continue
        expanded.push({ type: 'contact', id: member.contactId, listId: row.listId, viaHousehold: row.id })
      }
      continue
    }
    if (mode === 'household' && row.type === 'contact') {
      const homes = [...households.values()].filter((home) => currentMembers(home).some((member) => member.contactId === row.id))
      if (homes.length === 1) expanded.push({ type: 'household', id: homes[0].id, listId: row.listId, viaContact: row.id })
      else expanded.push({ type: 'contact', id: row.id, listId: row.listId })
      continue
    }
    expanded.push(row)
  }
  const groups = new Map()
  for (const row of expanded) {
    const key = `${row.type}:${row.id}`
    const group = groups.get(key) || { type: row.type, id: row.id, listIds: [], via: [] }
    if (row.listId && !group.listIds.includes(row.listId)) group.listIds.push(row.listId)
    if (row.viaHousehold) group.via.push(row.viaHousehold)
    if (row.viaContact) group.via.push(row.viaContact)
    groups.set(key, group)
  }
  const drafts = []
  for (const group of groups.values()) {
    drafts.push(draftRecipient(group, campaign, contacts, households, world))
  }
  const duplicates = findDuplicates(drafts, campaign)
  for (const duplicate of duplicates) {
    duplicate.labels = duplicate.keys.map((key) => drafts.find((draft) => draft.key === key)?.salutation || key)
  }
  const separate = new Set(campaign.separateKeys || [])
  const confirmed = new Set(campaign.confirmedKeys || [])
  const combined = []
  const consumed = new Set()
  for (const duplicate of duplicates) {
    const auto = duplicate.reason === 'Same person' || duplicate.reason === 'Same household'
    if (separate.has(duplicate.id)) duplicate.resolution = 'separate'
    else if (auto || confirmed.has(duplicate.id)) duplicate.resolution = 'combine'
    else duplicate.resolution = 'pending'
    if (duplicate.resolution !== 'combine') continue
    const rows = duplicate.keys.map((key) => drafts.find((draft) => draft.key === key)).filter(Boolean)
    if (rows.length < 2) continue
    rows.sort((left, right) => (left.recipientType === 'household' ? 0 : 1) - (right.recipientType === 'household' ? 0 : 1))
    const keep = rows[0]
    for (const row of rows.slice(1)) {
      consumed.add(row.key)
      keep.sourceListIds = [...new Set([...keep.sourceListIds, ...row.sourceListIds])]
      keep.memberNames = [...new Set([...(keep.memberNames || []), ...(row.memberNames || [])])]
      keep.memberIds = [...new Set([...(keep.memberIds || []), ...(row.memberIds || [])])]
      keep.combined = [...new Set([...(keep.combined || []), row.displayName])]
    }
  }
  for (const draft of drafts) if (!consumed.has(draft.key)) combined.push(draft)
  const suppressed = suppressionSet(world.suppressions)
  let missing = 0
  for (const draft of combined) {
    if (draft.email) draft.suppressed = suppressed.has(draft.email.toLowerCase())
    const needsAddress = campaign.deliveryMethod !== 'digital' && !draft.address
    const needsEmail = campaign.deliveryMethod !== 'physical' && !draft.email
    draft.missing = []
    if (needsAddress) draft.missing.push('address')
    if (needsEmail && !draft.suppressed) draft.missing.push('email')
    if (draft.missing.length) missing += 1
  }
  combined.sort((a, b) => a.salutation.localeCompare(b.salutation))
  return { recipients: combined, duplicates, missing }
}

function draftRecipient(group, campaign, contacts, households, world) {
  const style = campaign.salutationStyle || 'preferred'
  if (group.type === 'household') {
    const home = households.get(group.id)
    const members = currentMembers(home).slice().sort((a, b) => a.displayOrder - b.displayOrder)
    const people = members.map((member) => contacts.get(member.contactId)).filter(Boolean)
    const named = style === 'custom' ? { ...home, salutationFormat: campaign.salutationFormat || home?.salutationFormat || '' } : home
    const formatted = formatSalutation(style === 'formal' ? 'formal' : style, people, named)
    const address = chosenAddress(home, campaign)
    const email = campaign.emailChoices?.[group.id] || people.map(primaryEmail).find(Boolean) || String(home?.email || '').trim()
    return {
      key: `household:${group.id}`,
      recipientType: 'household',
      recipientId: group.id,
      displayName: home?.name || formatted.salutation,
      salutation: formatted.salutation,
      memberNames: formatted.members,
      memberIds: members.map((member) => member.contactId),
      email,
      address: address ? clone(address) : null,
      deliveryMethod: campaign.deliveryMethod || 'physical',
      sourceListIds: group.listIds,
      missing: [],
      suppressed: false,
      notes: campaign.recipientNotes?.[`household:${group.id}`] || '',
    }
  }
  const contact = contacts.get(group.id) || { id: group.id, displayName: 'Unknown contact' }
  const formatted = formatSalutation('names', [contact], null)
  const homes = [...households.values()].filter((home) => currentMembers(home).some((member) => member.contactId === group.id))
  const address = contactAddress(contact, homes, campaign)
  const email = campaign.emailChoices?.[group.id] || primaryEmail(contact)
  return {
    key: `contact:${group.id}`,
    recipientType: 'contact',
    recipientId: group.id,
    displayName: personName(contact).full,
    salutation: formatted.salutation,
    memberNames: formatted.members,
    memberIds: [group.id],
    email,
    address: address ? clone(address) : null,
    deliveryMethod: campaign.deliveryMethod || 'physical',
    sourceListIds: group.listIds,
    missing: [],
    suppressed: false,
    notes: campaign.recipientNotes?.[`contact:${group.id}`] || '',
  }
}

function chosenAddress(household, campaign) {
  const picked = campaign.addressChoices?.[household?.id]
  const current = currentAddresses(household)
  return current.find((address) => address.id === picked) || primaryAddress(household)
}

function contactAddress(contact, homes, campaign) {
  for (const home of homes) {
    const address = chosenAddress(home, campaign)
    if (address) return address
  }
  const own = residentialAddresses(contact).find((address) => addressKey(address))
  return own ? normalizeStoredAddress(own, { sourceContactId: contact.id }) : null
}

function findDuplicates(drafts, campaign) {
  const duplicates = []
  const byPerson = new Map()
  for (const draft of drafts) {
    for (const id of draft.memberIds || []) {
      const list = byPerson.get(id) || []
      list.push(draft.key)
      byPerson.set(id, list)
    }
  }
  for (const [id, keys] of byPerson) {
    const unique = [...new Set(keys)]
    if (unique.length < 2) continue
    duplicates.push(duplicateRow('Same person', unique, 'combine', id))
  }
  if ((campaign.deliveryMethod || 'physical') !== 'physical') {
    const byEmail = new Map()
    for (const draft of drafts) {
      const email = String(draft.email || '').trim().toLowerCase()
      if (!email) continue
      const list = byEmail.get(email) || []
      list.push(draft.key)
      byEmail.set(email, list)
    }
    for (const [email, keys] of byEmail) {
      const unique = [...new Set(keys)]
      if (unique.length < 2) continue
      duplicates.push(duplicateRow('Same email', unique, 'combine', email))
    }
  }
  if ((campaign.deliveryMethod || 'physical') !== 'digital') {
    const byAddress = new Map()
    for (const draft of drafts) {
      const key = addressKey(draft.address)
      if (!key) continue
      const list = byAddress.get(key) || []
      list.push(draft.key)
      byAddress.set(key, list)
    }
    for (const [key, keys] of byAddress) {
      const unique = [...new Set(keys)]
      if (unique.length < 2) continue
      duplicates.push(duplicateRow('Same address', unique, 'separate', key))
    }
  }
  return duplicates
}

function duplicateRow(reason, keys, defaultResolution, seed) {
  return {
    id: hashId('d', [reason, ...keys].sort()),
    reason,
    keys,
    defaultResolution,
    resolution: defaultResolution,
    seed,
  }
}

export function buildSnapshots(campaignId, prepared, at = nowIso()) {
  return prepared.recipients
    .filter((row) => !row.suppressed)
    .map((row) => ({
      id: createId(),
      campaignId,
      recipientType: row.recipientType,
      recipientId: row.recipientId,
      recipientKey: row.key,
      displayName: row.displayName,
      salutation: row.salutation,
      memberNames: clone(row.memberNames || []),
      memberIds: clone(row.memberIds || []),
      email: row.email || '',
      address: row.address ? clone(row.address) : null,
      deliveryMethod: row.deliveryMethod,
      deliveryStatus: 'approved',
      sourceListIds: clone(row.sourceListIds || []),
      includedAt: at,
      exportedAt: '',
      sentAt: '',
      deliveredAt: '',
      notes: row.notes || '',
      excluded: Boolean(row.missing?.length),
      missing: clone(row.missing || []),
      locked: false,
      corrections: [],
    }))
}

export function syncSnapshots(existing, built) {
  const kept = []
  const used = new Set()
  for (const previous of existing || []) {
    if (previous.locked) {
      kept.push(previous)
      used.add(previous.recipientKey)
      continue
    }
    const next = built.find((row) => row.recipientKey === previous.recipientKey)
    if (!next) continue
    used.add(next.recipientKey)
    kept.push({
      ...next,
      id: previous.id,
      deliveryStatus: previous.deliveryStatus === 'pending' ? 'approved' : previous.deliveryStatus,
      exportedAt: previous.exportedAt,
      sentAt: previous.sentAt,
      deliveredAt: previous.deliveredAt,
      notes: previous.notes,
      corrections: previous.corrections || [],
    })
  }
  for (const row of built) if (!used.has(row.recipientKey)) kept.push(row)
  return kept
}

export function applySnapshotEdit(record, patch, context) {
  if (record.locked && !String(context?.reason || '').trim()) {
    throw new Error('A completed campaign needs a correction reason')
  }
  const next = { ...record, ...clone(patch) }
  if (patch.address) next.address = clone(patch.address)
  if (record.locked) {
    next.locked = true
    next.corrections = [...(record.corrections || []), {
      at: context.at || nowIso(),
      actor: context.actor || 'Someone',
      reason: context.reason,
      fields: Object.keys(patch),
    }]
  }
  return next
}

export function mergeHouseholds(target, source) {
  const next = clone(target)
  const gone = clone(source)
  const at = nowIso()
  const present = new Set(currentMembers(next).map((member) => member.contactId))
  for (const member of currentMembers(gone)) {
    if (present.has(member.contactId)) continue
    next.members.push({ ...member, primary: false, displayOrder: next.members.length, validFrom: at })
  }
  const keys = new Set((next.addresses || []).map(addressKey))
  for (const address of currentAddresses(gone)) {
    if (keys.has(addressKey(address))) continue
    next.addresses.push(clone(address))
  }
  if (!next.primaryAddressId) next.primaryAddressId = primaryAddress(next)?.id || ''
  next.updatedAt = at
  gone.archived = true
  gone.mergedInto = next.id
  gone.updatedAt = at
  return { target: next, source: gone }
}

export function splitHousehold(household, contactIds, name) {
  const stay = clone(household)
  const moving = new Set(contactIds)
  const at = nowIso()
  const movedMembers = currentMembers(stay).filter((member) => moving.has(member.contactId))
  stay.members = (stay.members || []).map((member) => moving.has(member.contactId) && !member.validUntil ? { ...member, validUntil: at } : member)
  if (!currentMembers(stay).some((member) => member.primary)) {
    const first = currentMembers(stay)[0]
    if (first) stay.members = stay.members.map((member) => member.contactId === first.contactId && !member.validUntil ? { ...member, primary: true } : member)
  }
  const address = primaryAddress(stay)
  const created = {
    id: createId(),
    name: name || 'New household',
    salutation: name || '',
    notes: '',
    primaryAddressId: '',
    addresses: [],
    members: movedMembers.map((member, index) => ({
      ...member,
      primary: index === 0,
      displayOrder: index,
      validFrom: at,
      validUntil: '',
    })),
    archived: false,
    createdAt: at,
    updatedAt: at,
  }
  if (address) {
    const copy = normalizeStoredAddress(address)
    created.addresses = [copy]
    created.primaryAddressId = copy.id
  }
  stay.updatedAt = at
  return { stay, created }
}

export function movedPeople(contacts, households) {
  const rows = []
  for (const household of households || []) {
    if (household.archived) continue
    for (const address of currentAddresses(household)) {
      if (!address.sourceContactId) continue
      const contact = (contacts || []).find((row) => row.id === address.sourceContactId)
      if (!contact) continue
      const live = residentialAddresses(contact).map(addressKey).filter(Boolean)
      const saved = addressKey(address)
      if (saved && live.length && !live.includes(saved)) {
        rows.push({
          contactId: contact.id,
          name: personName(contact).full,
          householdId: household.id,
          household: household.name,
          previous: address.formatted || formatAddress(address).join(', '),
          current: formatAddress(residentialAddresses(contact)[0]).join(', '),
        })
      }
    }
  }
  return rows
}

export function missingAddressContacts(contacts) {
  return (contacts || []).filter((contact) => !residentialAddresses(contact).some((address) => addressKey(address))).map((contact) => ({
    id: contact.id,
    name: personName(contact).full,
  }))
}

export function quietHouseholds(households, recipients, campaigns, years = 2) {
  const cutoff = Date.now() - years * 365 * 24 * 60 * 60 * 1000
  const rows = []
  for (const household of households || []) {
    if (household.archived) continue
    let latest = 0
    for (const recipient of recipients || []) {
      if (recipient.excluded || recipient.recipientId !== household.id) continue
      const campaign = (campaigns || []).find((row) => row.id === recipient.campaignId)
      if (!campaign || campaign.status === 'draft') continue
      const when = Date.parse(recipient.sentAt || recipient.exportedAt || recipient.includedAt || '')
      if (!Number.isNaN(when)) latest = Math.max(latest, when)
    }
    if (!latest || latest < cutoff) {
      rows.push({ id: household.id, name: household.name, last: latest ? new Date(latest).toISOString() : '' })
    }
  }
  return rows
}

export function interpret(text, world) {
  const query = String(text || '').trim()
  if (!query) return null
  const lower = query.toLowerCase()
  const tagged = query.match(/tagged\s+(.+?)\s+to\s+(.+)/i)
  if (tagged) {
    return {
      type: 'mutate',
      action: 'add-tag',
      title: `Add people tagged ${tagged[1].trim()}`,
      detail: `Add matching people to ${tagged[2].trim()}. Nothing is added until you approve.`,
      payload: { tag: tagged[1].trim(), target: tagged[2].trim() },
    }
  }
  if (/without (a )?mailing address|no mailing address|missing address/.test(lower)) {
    const rows = missingAddressContacts(world.contacts)
    return { type: 'query', title: 'Contacts without a mailing address', rows: rows.map((row) => ({ label: row.name, meta: 'No residential address' })) }
  }
  if (/duplicate household/.test(lower)) {
    const suggestions = (world.suggestions || []).filter((row) => row.status === 'pending')
    return {
      type: 'query',
      title: 'Possible duplicate or matching households',
      rows: suggestions.map((row) => ({ label: row.reasons.join(' · ') || 'Possible match', meta: `${row.confidence}% · ${row.kind}` })),
    }
  }
  const compare = query.match(/compare\s+(.+?)\s+with\s+(.+)/i)
  if (compare) return compareNamed(compare[1], compare[2], world)
  if (/have moved|who moved|address change/.test(lower)) {
    const rows = movedPeople(world.contacts, world.households)
    return { type: 'query', title: 'People whose Rolodex address differs from the household', rows: rows.map((row) => ({ label: row.name, meta: `${row.household}: ${row.current}` })) }
  }
  if (/newly added|new contacts/.test(lower)) {
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000
    const listed = new Set()
    for (const list of world.lists || []) {
      const members = listMembership(list, world)
      members.contacts.forEach((contact) => listed.add(contact.id))
      members.households.forEach((home) => currentMembers(home).forEach((member) => listed.add(member.contactId)))
    }
    const rows = (world.contacts || []).filter((contact) => {
      const created = Date.parse(contact.createdAt || '')
      return !Number.isNaN(created) && created >= cutoff && !listed.has(contact.id)
    })
    return { type: 'query', title: 'New contacts who are not on a list', rows: rows.map((contact) => ({ label: personName(contact).full, meta: (contact.tags || []).map((tag) => tag.name).join(', ') || 'No tags' })) }
  }
  const received = query.match(/(?:received|got)\s+(?:a\s+)?(.+?)\s+last year/i)
  if (received) {
    const needle = received[1].trim().toLowerCase()
    const year = new Date().getFullYear() - 1
    const rows = []
    for (const campaign of world.campaigns || []) {
      const when = campaign.completedAt || campaign.approvedAt || campaign.createdAt
      if (!when || new Date(when).getFullYear() !== year) continue
      const named = campaign.name.toLowerCase().includes(needle) || campaign.campaignType === needle
      if (!named) continue
      for (const recipient of (world.recipients || []).filter((row) => row.campaignId === campaign.id && !row.excluded)) {
        rows.push({ label: recipient.salutation || recipient.displayName, meta: campaign.name })
      }
    }
    return { type: 'query', title: `People included in “${received[1].trim()}” last year`, rows }
  }
  if (/no correspondence in (the last )?(two|2) years/.test(lower)) {
    const rows = quietHouseholds(world.households, world.recipients, world.campaigns, 2)
    return { type: 'query', title: 'Households with no correspondence in two years', rows: rows.map((row) => ({ label: row.name, meta: row.last ? `Last ${row.last.slice(0, 10)}` : 'No campaign yet' })) }
  }
  return null
}

export function compareNamed(leftName, rightName, world) {
  const left = findNamed(leftName, world)
  const right = findNamed(rightName, world)
  if (!left || !right) {
    return { type: 'query', title: 'Could not find both lists or campaigns', rows: [{ label: left ? left.name : leftName.trim(), meta: left ? 'Found' : 'Not found' }, { label: right ? right.name : rightName.trim(), meta: right ? 'Found' : 'Not found' }] }
  }
  const a = nameSet(left, world)
  const b = nameSet(right, world)
  const rows = []
  for (const name of a) if (!b.has(name)) rows.push({ label: name, meta: `Only in ${left.name}` })
  for (const name of b) if (!a.has(name)) rows.push({ label: name, meta: `Only in ${right.name}` })
  if (!rows.length) rows.push({ label: 'The same people', meta: left.name })
  return { type: 'query', title: `${left.name} compared with ${right.name}`, rows }
}

function findNamed(name, world) {
  const needle = name.trim().toLowerCase()
  return [...(world.campaigns || []), ...(world.lists || [])].find((row) => row.name.toLowerCase() === needle)
    || [...(world.campaigns || []), ...(world.lists || [])].find((row) => row.name.toLowerCase().includes(needle))
}

function nameSet(record, world) {
  if (record.sourceListIds || record.campaignType) {
    const names = new Set()
    for (const recipient of (world.recipients || []).filter((row) => row.campaignId === record.id && !row.excluded)) {
      names.add(recipient.salutation || recipient.displayName)
    }
    return names
  }
  const members = listMembership(record, world)
  const names = new Set(members.contacts.map((contact) => personName(contact).full))
  members.households.forEach((home) => names.add(home.salutation || home.name))
  return names
}

export function contactsForTag(contacts, tag) {
  const needle = tag.trim().toLowerCase()
  return (contacts || []).filter((contact) => (contact.tags || []).some((row) => String(row.name || row).toLowerCase() === needle))
}

export function duplicateGroupNeedsChoice(duplicate) {
  return duplicate.reason === 'Same address' || duplicate.reason === 'Same email'
}
