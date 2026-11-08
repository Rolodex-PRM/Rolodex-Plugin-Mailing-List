import { addressLines } from './domain.mjs'

export const PAPER = {
  letter: { width: 612, height: 792 },
  a4: { width: 595.28, height: 841.89 },
  envelope10: { width: 684, height: 297 },
  dl: { width: 623.62, height: 311.81 },
}

const FONTS = new Set(['Helvetica', 'Helvetica-Bold', 'Times-Roman', 'Times-Bold', 'Courier', 'Courier-Bold'])

export const TEMPLATES = [
  { id: 'avery-5160', name: 'Avery 5160', kind: 'label', paper: 'letter', columns: 3, rows: 10, labelWidth: 2.625, labelHeight: 1, marginTop: 0.5, marginLeft: 0.1875, gapX: 0.125, gapY: 0, font: 'Helvetica', fontSize: 10 },
  { id: 'avery-5161', name: 'Avery 5161', kind: 'label', paper: 'letter', columns: 2, rows: 10, labelWidth: 4, labelHeight: 1, marginTop: 0.5, marginLeft: 0.156, gapX: 0.188, gapY: 0, font: 'Helvetica', fontSize: 11 },
  { id: 'avery-5162', name: 'Avery 5162', kind: 'label', paper: 'letter', columns: 2, rows: 7, labelWidth: 4, labelHeight: 1.333, marginTop: 0.833, marginLeft: 0.156, gapX: 0.188, gapY: 0, font: 'Helvetica', fontSize: 11 },
  { id: 'avery-5163', name: 'Avery 5163', kind: 'label', paper: 'letter', columns: 2, rows: 5, labelWidth: 4, labelHeight: 2, marginTop: 0.5, marginLeft: 0.156, gapX: 0.188, gapY: 0, font: 'Helvetica', fontSize: 12 },
  { id: 'a4-3x8', name: 'A4 3 by 8', kind: 'label', paper: 'a4', columns: 3, rows: 8, labelWidth: 70 / 25.4, labelHeight: 37 / 25.4, marginTop: 4.5 / 25.4, marginLeft: 0, gapX: 0, gapY: 0, font: 'Helvetica', fontSize: 10 },
  { id: 'envelope-10', name: 'Number 10 envelope', kind: 'envelope', paper: 'envelope10', columns: 1, rows: 1, labelWidth: 4, labelHeight: 1.4, marginTop: 1.75, marginLeft: 3.75, gapX: 0, gapY: 0, font: 'Helvetica', fontSize: 12 },
  { id: 'envelope-dl', name: 'DL envelope', kind: 'envelope', paper: 'dl', columns: 1, rows: 1, labelWidth: 90 / 25.4, labelHeight: 35 / 25.4, marginTop: 45 / 25.4, marginLeft: 110 / 25.4, gapX: 0, gapY: 0, font: 'Helvetica', fontSize: 12 },
]

export function templateById(id, custom = []) {
  return [...TEMPLATES, ...custom].find((template) => template.id === id) || TEMPLATES[0]
}

export function recipientCsv(recipients) {
  const header = ['Salutation', 'Name', 'Type', 'Members', 'Email', 'Address 1', 'Address 2', 'City', 'Region', 'Postal code', 'Country', 'Delivery', 'Status', 'Source lists']
  const lines = [header.map(csvCell).join(',')]
  for (const row of recipients) {
    if (row.excluded) continue
    const address = row.address || {}
    lines.push([
      row.salutation,
      row.displayName,
      row.recipientType,
      (row.memberNames || []).join('; '),
      row.email,
      address.line1,
      address.line2,
      address.city,
      address.region,
      address.postalCode,
      address.country,
      row.deliveryMethod,
      row.deliveryStatus,
      (row.sourceListIds || []).join(' '),
    ].map(csvCell).join(','))
  }
  return `${lines.join('\r\n')}\r\n`
}

function csvCell(value) {
  const text = String(value ?? '')
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function recipientXlsx(recipients) {
  const rows = [['Salutation', 'Name', 'Type', 'Members', 'Email', 'Address 1', 'Address 2', 'City', 'Region', 'Postal code', 'Country', 'Delivery', 'Status']]
  for (const row of recipients) {
    if (row.excluded) continue
    const address = row.address || {}
    rows.push([
      row.salutation || '',
      row.displayName || '',
      row.recipientType || '',
      (row.memberNames || []).join('; '),
      row.email || '',
      address.line1 || '',
      address.line2 || '',
      address.city || '',
      address.region || '',
      address.postalCode || '',
      address.country || '',
      row.deliveryMethod || '',
      row.deliveryStatus || '',
    ])
  }
  const sheet = sheetXml(rows)
  const files = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Recipients" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', sheet],
  ]
  return zipStore(files)
}

function sheetXml(rows) {
  const body = rows.map((row, rowIndex) => {
    const cells = row.map((value, column) => `<c r="${columnName(column)}${rowIndex + 1}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`).join('')
    return `<row r="${rowIndex + 1}">${cells}</row>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`
}

function columnName(index) {
  let n = index + 1
  let name = ''
  while (n) {
    const rem = (n - 1) % 26
    name = String.fromCharCode(65 + rem) + name
    n = Math.floor((n - 1) / 26)
  }
  return name
}

function xml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function labelPdf(recipients, template) {
  const page = PAPER[template.paper] || PAPER.letter
  const included = recipients.filter((row) => !row.excluded)
  const perPage = Math.max(1, template.columns * template.rows)
  const pages = []
  for (let index = 0; index < included.length; index += perPage) {
    pages.push(drawPage(included.slice(index, index + perPage), template, page))
  }
  if (!pages.length) pages.push(drawPage([], template, page))
  return buildPdf(pages, page, template.font)
}

function drawPage(rows, template, page) {
  const font = FONTS.has(template.font) ? template.font : 'Helvetica'
  const size = Number(template.fontSize) || 10
  const commands = ['BT', `/${fontKey(font)} ${size} Tf`]
  rows.forEach((row, index) => {
    const column = index % template.columns
    const line = Math.floor(index / template.columns)
    const x = (template.marginLeft + column * (template.labelWidth + template.gapX)) * 72 + 8
    const top = page.height - (template.marginTop + line * (template.labelHeight + template.gapY)) * 72 - size - 6
    const lines = [row.salutation || row.displayName || '', ...addressLines(row.address)]
    lines.forEach((text, lineIndex) => {
      const y = top - lineIndex * (size + 2)
      commands.push(`1 0 0 1 ${round(x)} ${round(y)} Tm (${pdfText(text)}) Tj`)
    })
  })
  commands.push('ET')
  return commands.join('\n')
}

export function templateSlots(template) {
  const page = PAPER[template.paper] || PAPER.letter
  const width = page.width / 72
  const height = page.height / 72
  const slots = []
  const count = template.columns * template.rows
  for (let index = 0; index < count; index += 1) {
    const column = index % template.columns
    const line = Math.floor(index / template.columns)
    slots.push({
      x: template.marginLeft + column * (template.labelWidth + template.gapX),
      y: template.marginTop + line * (template.labelHeight + template.gapY),
      w: template.labelWidth,
      h: template.labelHeight,
    })
  }
  return { width, height, slots }
}

function fontKey(font) {
  return `F${[...FONTS].indexOf(font) + 1}`
}

function pdfText(value) {
  let out = ''
  for (const char of String(value ?? '')) {
    const code = char.codePointAt(0)
    if (char === '\\' || char === '(' || char === ')') out += `\\${char}`
    else if (code >= 32 && code <= 126) out += char
    else if (code >= 160 && code <= 255) out += `\\${code.toString(8).padStart(3, '0')}`
    else out += '?'
  }
  return out
}

function buildPdf(contents, page) {
  const fonts = [...FONTS]
  const objects = []
  objects.push('<< /Type /Catalog /Pages 2 0 R >>')
  const pageIds = contents.map((_, index) => 3 + index * 2)
  objects.push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${contents.length} >>`)
  contents.forEach((stream, index) => {
    const pageId = 3 + index * 2
    const streamId = pageId + 1
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${round(page.width)} ${round(page.height)}] /Contents ${streamId} 0 R /Resources << /Font << ${fonts.map((name, fontIndex) => `/F${fontIndex + 1} ${3 + contents.length * 2 + fontIndex} 0 R`).join(' ')} >> >> >>`)
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
    if (pageId !== 3 + index * 2) throw new Error('page')
  })
  fonts.forEach((name) => {
    objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /${name} >>`)
  })
  let body = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(body.length)
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n`
  body += '0000000000 65535 f \n'
  for (let index = 1; index < offsets.length; index += 1) body += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`
  body += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return new TextEncoder().encode(body)
}

function round(value) {
  return Math.round(value * 100) / 100
}

function zipStore(files) {
  const chunks = []
  const central = []
  let offset = 0
  for (const [name, text] of files) {
    const data = new TextEncoder().encode(text)
    const nameBytes = new TextEncoder().encode(name)
    const crc = crc32(data)
    const local = new Uint8Array(30 + nameBytes.length + data.length)
    const view = new DataView(local.buffer)
    view.setUint32(0, 0x04034b50, true)
    view.setUint16(4, 20, true)
    view.setUint16(8, 0, true)
    view.setUint32(14, crc, true)
    view.setUint32(18, data.length, true)
    view.setUint32(22, data.length, true)
    view.setUint16(26, nameBytes.length, true)
    local.set(nameBytes, 30)
    local.set(data, 30 + nameBytes.length)
    chunks.push(local)
    const dir = new Uint8Array(46 + nameBytes.length)
    const dirView = new DataView(dir.buffer)
    dirView.setUint32(0, 0x02014b50, true)
    dirView.setUint16(4, 20, true)
    dirView.setUint16(6, 20, true)
    dirView.setUint32(16, crc, true)
    dirView.setUint32(20, data.length, true)
    dirView.setUint32(24, data.length, true)
    dirView.setUint16(28, nameBytes.length, true)
    dirView.setUint32(42, offset, true)
    dir.set(nameBytes, 46)
    central.push(dir)
    offset += local.length
  }
  const centralOffset = offset
  let centralSize = 0
  for (const dir of central) centralSize += dir.length
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, files.length, true)
  endView.setUint16(10, files.length, true)
  endView.setUint32(12, centralSize, true)
  endView.setUint32(16, centralOffset, true)
  const total = offset + centralSize + end.length
  const out = new Uint8Array(total)
  let cursor = 0
  for (const chunk of chunks) { out.set(chunk, cursor); cursor += chunk.length }
  for (const dir of central) { out.set(dir, cursor); cursor += dir.length }
  out.set(end, cursor)
  return out
}

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

export function bytesToBase64(bytes) {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

export function utf8Base64(text) {
  return bytesToBase64(new TextEncoder().encode(text))
}

export function safeFilename(name) {
  const cleaned = String(name || 'export').toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-|-$/g, '')
  return (cleaned || 'export').slice(0, 60)
}
