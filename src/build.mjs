import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function squeeze(source) {
  return source.split('\n').map((line) => line.replace(/^[ \t]+/, '')).join('\n')
}

function strip(source) {
  const names = []
  const body = source
    .replace(/^\s*import\s+.*?$/gm, '')
    .replace(/export\s+function\s+([A-Za-z0-9_]+)/g, (_, name) => { names.push(name); return `function ${name}` })
    .replace(/export\s+const\s+([A-Za-z0-9_]+)/g, (_, name) => { names.push(name); return `const ${name}` })
  return { body, names }
}

export function buildPage() {
  const domain = strip(readFileSync(path.join(root, 'src', 'domain.mjs'), 'utf8'))
  const exporter = strip(readFileSync(path.join(root, 'src', 'export.mjs'), 'utf8'))
  const app = readFileSync(path.join(root, 'src', 'app.js'), 'utf8')
  const css = readFileSync(path.join(root, 'src', 'app.css'), 'utf8')
  const names = [...domain.names, ...exporter.names]
  const sources = [domain.body, exporter.body, app, css].map(squeeze)
  for (const source of sources) {
    if (/<\/(script|style)/i.test(source)) throw new Error('Plugin source cannot close the script or style tag')
  }
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mailing Lists</title>
<style>
${sources[3]}
</style>
</head>
<body>
<div id="app"><p>Loading mailing lists…</p></div>
<script>
window.Mailing = (function () {
${sources[0]}
${sources[1]}
return { ${names.join(', ')} }
})()
${sources[2]}
</script>
</body>
</html>
`
  if (html.length > 200000) throw new Error(`Plugin page is ${html.length} characters; keep it under 200000`)
  return html
}

if (process.argv[1] && process.argv[1].endsWith('build.mjs')) {
  const html = buildPage()
  writeFileSync(path.join(root, 'index.html'), html)
  console.log(`Wrote index.html (${html.length} characters)`)
}
