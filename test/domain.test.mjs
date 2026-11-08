import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addressKey,
  applySnapshotEdit,
  buildSnapshots,
  campaignSharing,
  canSeeCampaign,
  canSeeShared,
  contactsForTag,
  editorNames,
  evaluateDynamicList,
  formatSalutation,
  householdConfidence,
  interpret,
  listMembership,
  matchAddresses,
  memberIdentity,
  mergeHouseholds,
  missingAddressContacts,
  movedPeople,
  planHouseholds,
  prepareCampaign,
  quietHouseholds,
  splitHousehold,
  syncSnapshots,
  withAccess,
} from '../src/domain.mjs'
import { bytesToBase64, labelPdf, recipientCsv, recipientXlsx, templateById } from '../src/export.mjs'

const johnId = '11111111-1111-4111-8111-111111111111'
const janeId = '22222222-2222-4222-8222-222222222222'
const samId = '33333333-3333-4333-8333-333333333333'
const morganId = '44444444-4444-4444-8444-444444444444'
const priyaId = '55555555-5555-4555-8555-555555555555'
const home = { label: 'Home', street: '100 Oak Street', city: 'Austin', region: 'TX', postalCode: '78701', country: 'USA' }

function person(id, first, last, extra = {}) {
  return {
    id,
    displayName: `${first} ${last}`,
    firstName: first,
    lastName: last,
    preferredName: '',
    emails: extra.emails || [],
    tags: extra.tags || [],
    addresses: extra.addresses || [],
    relationships: extra.relationships || [],
    createdAt: extra.createdAt || '2024-01-01T00:00:00.000Z',
  }
}

const john = person(johnId, 'John', 'Smith', {
  emails: [{ value: 'john@example.com', primary: true }],
  tags: [{ name: 'Family' }],
  addresses: [home],
  relationships: [{ contactId: janeId, type: 'spouse' }, { contactId: samId, type: 'parent' }],
})
const jane = person(janeId, 'Jane', 'Smith', {
  emails: [{ value: 'jane@example.com', primary: true }],
  tags: [{ name: 'Family' }],
  addresses: [{ ...home }],
  relationships: [{ contactId: johnId, type: 'spouse' }],
})
const sam = person(samId, 'Sam', 'Smith', {
  tags: [{ name: 'Family' }],
  addresses: [{ ...home }],
})
const morgan = person(morganId, 'Morgan', 'Blake', {
  emails: [{ value: 'morgan@example.com', primary: true }],
  addresses: [{ label: 'Home', street: '100 Oak Street', street2: 'Apt 2', city: 'Austin', region: 'TX', postalCode: '78701', country: 'US' }],
})
const priya = person(priyaId, 'Priya', 'Shah', {
  emails: [{ value: 'priya@example.com', primary: true }],
  tags: [{ name: 'Friends' }],
  addresses: [{ label: 'Home', street: '50 Market Street', city: 'San Francisco', region: 'CA', postalCode: '94105', country: 'USA' }],
})
const family = [john, jane, sam, morgan, priya]

test('exact addresses match after abbreviation and country differences', () => {
  assert.equal(matchAddresses(john, jane), 'exact')
  assert.equal(matchAddresses(john, morgan), 'unit-conflict')
  assert.equal(addressKey({ street: '100 Oak St.', city: 'Austin', region: 'TX', postalCode: '78701', country: 'United States' }), addressKey(home))
})

test('same address is a suggestion and a family at that address is grouped', () => {
  const onlyAddress = householdConfidence(
    person('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Ada', 'Lovelace', { addresses: [home] }),
    person('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Grace', 'Hopper', { addresses: [home] }),
  )
  assert.equal(onlyAddress.level, 'suggestion')
  assert.ok(onlyAddress.score < 75)
  assert.ok(onlyAddress.reasons.includes('Same residential address'))

  const partners = householdConfidence(john, jane)
  assert.equal(partners.level, 'auto')
  assert.equal(householdConfidence(john, morgan).level, 'ignore')

  const plan = planHouseholds(family, [], [], true)
  assert.equal(plan.create.length, 1)
  assert.equal(plan.create[0].name, 'The Smith Household')
  assert.deepEqual(plan.create[0].members.map((member) => member.contactId).sort(), [janeId, johnId, samId].sort())
  assert.equal(plan.suggest.some((row) => row.contactIds.includes(morganId)), false)
})

test('automatic grouping can be turned off and reversed with a blocked pair', () => {
  const held = planHouseholds(family, [], [], false)
  assert.equal(held.create.length, 0)
  assert.ok(held.suggest.some((row) => row.level === 'review' || row.confidence >= 95))
  const blocked = planHouseholds([john, jane], [], [], true, [[johnId, janeId].sort().join('|')])
  assert.equal(blocked.create.length, 0)
  assert.equal(blocked.suggest.length, 0)
})

test('someone who already has a household is suggested, not grouped again', () => {
  const existing = {
    id: '99999999-9999-4999-8999-999999999999',
    name: 'Existing',
    archived: false,
    members: [{ contactId: johnId, validUntil: '' }],
    addresses: [],
  }
  const plan = planHouseholds([john, jane], [existing], [], true)
  assert.equal(plan.create.length, 0)
  assert.equal(plan.suggest[0].kind, 'add')
  assert.equal(plan.suggest[0].householdId, existing.id)
})

test('salutations keep every member name', () => {
  const couple = formatSalutation('names', [john, jane], { salutation: 'The Smiths' })
  assert.equal(couple.salutation, 'John & Jane Smith')
  assert.deepEqual(couple.members, ['John Smith', 'Jane Smith'])
  assert.equal(formatSalutation('family', [john, jane, sam], {}).salutation, 'The Smith Family')
  assert.equal(formatSalutation('formal', [john, jane], {}).salutation, 'John Smith and Jane Smith')
  assert.equal(formatSalutation('preferred', [john, jane], { salutation: 'The Smiths' }).salutation, 'The Smiths')
  const mixed = formatSalutation('names', [john, person(priyaId, 'Priya', 'Shah')], {})
  assert.equal(mixed.salutation, 'John Smith and Priya Shah')
})

test('a mixed list keeps households and people, and campaigns collapse duplicates', () => {
  const household = planHouseholds([john, jane, sam], [], [], true).create[0]
  const list = {
    id: 'list-family',
    name: 'Family & Friends',
    listType: 'static',
    archived: false,
    members: [
      { type: 'household', id: household.id, status: 'included' },
      { type: 'contact', id: priyaId, status: 'included' },
    ],
  }
  const world = { contacts: family, households: [household], lists: [list] }
  const members = listMembership(list, world)
  assert.equal(members.households.length, 1)
  assert.equal(members.contacts.length, 1)

  const other = {
    id: 'list-cards',
    name: 'Christmas Cards',
    listType: 'static',
    archived: false,
    members: [{ type: 'household', id: household.id, status: 'included' }],
  }
  const campaign = {
    id: 'camp-1',
    sourceListIds: [list.id, other.id],
    recipientMode: 'household',
    deliveryMethod: 'physical',
    salutationStyle: 'family',
    excludes: [],
    includes: [],
  }
  const prepared = prepareCampaign(campaign, { ...world, lists: [list, other], suppressions: [] })
  assert.equal(prepared.recipients.length, 2)
  const smiths = prepared.recipients.find((row) => row.recipientId === household.id)
  assert.equal(smiths.salutation, 'The Smith Family')
  assert.deepEqual(smiths.memberNames, ['John Smith', 'Jane Smith', 'Sam Smith'])
  assert.deepEqual(smiths.sourceListIds.sort(), [list.id, other.id].sort())
  assert.equal(prepared.duplicates.some((row) => row.reason === 'Same person'), false)
})

test('duplicate destinations are identified and same-person copies collapse', () => {
  const campaign = {
    sourceListIds: ['a', 'b'],
    recipientMode: 'individual',
    deliveryMethod: 'digital',
    salutationStyle: 'names',
    excludes: [],
    includes: [],
    separateKeys: [],
  }
  const lists = [
    { id: 'a', listType: 'static', archived: false, members: [{ type: 'contact', id: johnId, status: 'included' }] },
    { id: 'b', listType: 'static', archived: false, members: [{ type: 'contact', id: johnId, status: 'included' }, { type: 'contact', id: janeId, status: 'included' }] },
  ]
  jane.emails = [{ value: 'john@example.com', primary: true }]
  const prepared = prepareCampaign(campaign, { contacts: [john, jane], households: [], lists, suppressions: [] })
  assert.equal(prepared.recipients.length, 2)
  const johnRow = prepared.recipients.find((row) => row.recipientId === johnId)
  assert.deepEqual(johnRow.sourceListIds.sort(), ['a', 'b'])
  assert.equal(prepared.duplicates.some((row) => row.reason === 'Same email'), true)
  jane.emails = [{ value: 'jane@example.com', primary: true }]
})

test('completed campaign snapshots ignore a later address change', () => {
  const household = {
    id: 'hhhhhhhh-hhhh-4hhh-8hhh-hhhhhhhhhhhh',
    name: 'The Smith Household',
    salutation: 'The Smiths',
    archived: false,
    primaryAddressId: 'addr-1',
    addresses: [{ id: 'addr-1', line1: '100 Oak Street', city: 'Austin', region: 'TX', postalCode: '78701', country: 'USA', current: true }],
    members: [
      { contactId: johnId, displayOrder: 0, validUntil: '' },
      { contactId: janeId, displayOrder: 1, validUntil: '' },
    ],
  }
  const campaign = { id: 'camp', sourceListIds: ['cards'], recipientMode: 'household', deliveryMethod: 'physical', salutationStyle: 'preferred', excludes: [], includes: [] }
  const list = { id: 'cards', listType: 'static', archived: false, members: [{ type: 'household', id: household.id, status: 'included' }] }
  const prepared = prepareCampaign(campaign, { contacts: [john, jane], households: [household], lists: [list], suppressions: [] })
  const [snapshot] = buildSnapshots(campaign.id, prepared, '2026-12-01T00:00:00.000Z')
  snapshot.locked = true
  household.addresses[0].line1 = '9 New Road'
  john.addresses[0].street = '9 New Road'
  const again = prepareCampaign(campaign, { contacts: [john, jane], households: [household], lists: [list], suppressions: [] })
  assert.equal(snapshot.address.line1, '100 Oak Street')
  assert.equal(again.recipients[0].address.line1, '9 New Road')
  assert.throws(() => applySnapshotEdit(snapshot, { address: again.recipients[0].address }, {}), /correction reason/)
  const corrected = applySnapshotEdit(snapshot, { address: again.recipients[0].address }, { reason: 'Returned mail', actor: 'Ada', at: '2027-01-01T00:00:00.000Z' })
  assert.equal(corrected.address.line1, '9 New Road')
  assert.equal(corrected.corrections[0].reason, 'Returned mail')
  assert.equal(snapshot.address.line1, '100 Oak Street')
  john.addresses[0].street = '100 Oak Street'
})

test('dynamic lists change their preview and leave an existing campaign alone', () => {
  const list = {
    id: 'dynamic-family',
    listType: 'dynamic',
    recipientMode: 'individual',
    rules: { version: 1, match: 'all', conditions: [{ field: 'tag', op: 'is', value: 'Family' }], exclusions: [] },
  }
  const world = { contacts: [john, priya], households: [], lists: [list], campaigns: [], recipients: [] }
  assert.equal(evaluateDynamicList(list, world).contacts.map((contact) => contact.id).includes(johnId), true)
  const campaign = { id: 'camp', sourceListIds: [list.id], recipientMode: 'individual', deliveryMethod: 'digital', salutationStyle: 'names', excludes: [], includes: [] }
  const snapshots = buildSnapshots(campaign.id, prepareCampaign(campaign, world))
  world.contacts.push(person('66666666-6666-4666-8666-666666666666', 'Chris', 'Lee', { tags: [{ name: 'Family' }], emails: [{ value: 'chris@example.com', primary: true }] }))
  const preview = evaluateDynamicList(list, world)
  assert.equal(preview.contacts.length, 2)
  assert.equal(snapshots.some((row) => row.displayName === 'Chris Lee'), false)
})

test('suppressed emails and missing addresses are visible before approval', () => {
  const campaign = { sourceListIds: ['people'], recipientMode: 'individual', deliveryMethod: 'both', salutationStyle: 'names', excludes: [], includes: [] }
  const list = { id: 'people', listType: 'static', archived: false, members: [{ type: 'contact', id: johnId, status: 'included' }, { type: 'contact', id: samId, status: 'included' }] }
  const prepared = prepareCampaign(campaign, {
    contacts: [john, sam],
    households: [],
    lists: [list],
    suppressions: [{ email: 'john@example.com' }],
  })
  const johnRow = prepared.recipients.find((row) => row.recipientId === johnId)
  const samRow = prepared.recipients.find((row) => row.recipientId === samId)
  assert.equal(johnRow.suppressed, true)
  assert.ok(samRow.missing.includes('email'))
  const stored = buildSnapshots('camp', prepared)
  assert.equal(stored.some((row) => row.recipientId === johnId), false)
  assert.equal(stored.find((row) => row.recipientId === samId).excluded, true)
})

test('merge, split, and quiet households keep history', () => {
  const target = { id: 't', name: 'One', archived: false, members: [{ contactId: johnId, primary: true, validUntil: '' }], addresses: [], primaryAddressId: '' }
  const source = { id: 's', name: 'Two', archived: false, members: [{ contactId: janeId, primary: true, validUntil: '' }], addresses: [{ id: 'a', line1: '1 Road', city: 'Austin', current: true }], primaryAddressId: 'a' }
  const merged = mergeHouseholds(target, source)
  assert.equal(merged.source.archived, true)
  assert.ok(merged.target.members.some((member) => member.contactId === janeId))
  const split = splitHousehold(merged.target, [janeId], 'Jane')
  assert.equal(split.created.members.length, 1)
  assert.ok(split.stay.members.find((member) => member.contactId === janeId).validUntil)
  const quiet = quietHouseholds([target], [], [], 2)
  assert.equal(quiet.length, 1)
})

test('questions about the list are answered from records', () => {
  const missing = interpret('Find contacts without mailing addresses', { contacts: [person('77777777-7777-4777-8777-777777777777', 'No', 'Address')] })
  assert.equal(missing.rows.length, 1)
  const add = interpret('Add everyone tagged Family to Christmas 2026', {})
  assert.equal(add.action, 'add-tag')
  assert.equal(add.type, 'mutate')
  assert.equal(contactsForTag(family, 'Family').length, 3)
  assert.equal(missingAddressContacts([priya]).length, 0)
  const moved = movedPeople(
    [{ ...john, addresses: [{ label: 'Home', street: '9 New Road', city: 'Austin', region: 'TX', postalCode: '78702', country: 'USA' }] }],
    [{ id: 'h', name: 'The Smith Household', archived: false, addresses: [{ current: true, sourceContactId: johnId, line1: '100 Oak Street', city: 'Austin', region: 'TX', postalCode: '78701', country: 'USA' }] }],
  )
  assert.equal(moved[0].name, 'John Smith')
})

test('exports contain the snapshot and a real spreadsheet and pdf', () => {
  const rows = [{
    salutation: 'The Smith Family',
    displayName: 'The Smith Household',
    recipientType: 'household',
    memberNames: ['John Smith', 'Jane Smith'],
    email: 'john@example.com',
    address: { line1: '100 Oak Street', city: 'Austin', region: 'TX', postalCode: '78701', country: 'USA' },
    deliveryMethod: 'physical',
    deliveryStatus: 'approved',
    sourceListIds: ['cards'],
    excluded: false,
  }]
  const csv = recipientCsv(rows)
  assert.match(csv, /The Smith Family/)
  assert.match(csv, /100 Oak Street/)
  const quoted = recipientCsv([{ ...rows[0], salutation: 'Smith, Family' }])
  assert.match(quoted, /"Smith, Family"/)
  const xlsx = recipientXlsx(rows)
  assert.equal(String.fromCharCode(xlsx[0], xlsx[1]), 'PK')
  assert.match(Buffer.from(xlsx).toString('latin1'), /The Smith Family/)
  const pdf = labelPdf(rows, templateById('avery-5160'))
  const text = new TextDecoder().decode(pdf)
  assert.match(text, /^%PDF-1.4/)
  assert.match(text, /The Smith Family/)
  assert.match(text, /%%EOF/)
  const many = labelPdf(Array.from({ length: 31 }, (_, index) => ({ ...rows[0], salutation: `Person ${index}` })), templateById('avery-5160'))
  assert.match(new TextDecoder().decode(many), /\/Count 2/)
  assert.ok(bytesToBase64(pdf).length > 20)
})

test('approving twice keeps the same recipient record', () => {
  const built = [{ id: 'new', campaignId: 'c', recipientKey: 'contact:1', displayName: 'Ada', deliveryStatus: 'approved', notes: '', corrections: [] }]
  const existing = [{ id: 'kept', campaignId: 'c', recipientKey: 'contact:1', displayName: 'Ada', deliveryStatus: 'exported', notes: 'Handwritten', corrections: [], locked: false }]
  const synced = syncSnapshots(existing, built)
  assert.equal(synced.length, 1)
  assert.equal(synced[0].id, 'kept')
  assert.equal(synced[0].deliveryStatus, 'exported')
  assert.equal(synced[0].notes, 'Handwritten')
  const locked = syncSnapshots([{ ...existing[0], locked: true, displayName: 'Old' }], [{ ...built[0], displayName: 'New' }])
  assert.equal(locked[0].displayName, 'Old')
})

test('a shared list is editable by another member and a private list stays with its owner', () => {
  const ada = memberIdentity(null, 'Ada Lovelace')
  const again = memberIdentity(ada.token, 'Ada Lovelace')
  assert.equal(again.changed, false)
  assert.equal(again.id, ada.id)
  const grace = memberIdentity(null, 'Grace Hopper')
  const shared = withAccess({ id: 'cards', name: 'Christmas Cards', sharing: 'workspace' }, ada, 'workspace')
  const edited = withAccess(shared, grace, 'workspace')
  assert.equal(canSeeShared(edited, grace.id), true)
  assert.equal(canSeeShared(edited, ada.id), true)
  assert.deepEqual(editorNames(edited), ['Grace Hopper', 'Ada Lovelace'])
  const mine = withAccess(edited, ada, 'private')
  assert.equal(canSeeShared(mine, ada.id), true)
  assert.equal(canSeeShared(mine, grace.id), false)
  assert.equal(canSeeShared({ name: 'Older list' }, grace.id), true)
  const campaign = { id: 'c', sharing: 'workspace', sourceListIds: ['cards'] }
  assert.equal(canSeeCampaign(campaign, [mine], grace.id), false)
  assert.equal(canSeeCampaign(campaign, [shared], grace.id), true)
  assert.equal(campaignSharing({ ...campaign, sharing: 'workspace' }, [mine]), 'private')
  assert.equal(campaignSharing({ ...campaign, sharing: 'private' }, [shared]), 'private')
})
