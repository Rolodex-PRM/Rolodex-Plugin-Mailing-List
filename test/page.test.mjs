import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPage } from '../src/build.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('the plugin page stays inside the Rolodex sandbox limits', () => {
  const html = buildPage()
  assert.ok(html.length < 200000, html.length)
  assert.match(html, /window\.Mailing/)
  assert.match(html, /addEventListener\('rolodex'/)
  assert.doesNotMatch(html, /\bfetch\s*\(/)
  assert.doesNotMatch(html, /XMLHttpRequest/)
  assert.doesNotMatch(html, /WebSocket/)
  const manifest = JSON.parse(readFileSync(path.join(root, 'rolodex-plugin.json'), 'utf8'))
  assert.equal(manifest.id, 'mailing-lists')
  assert.ok(manifest.name.length <= 40)
  assert.ok(manifest.description.length <= 200)
  assert.deepEqual(manifest.permissions, ['contacts:read', 'data:own', 'files:own', 'ai:suggest', 'profile:section'])
  assert.ok(manifest.settings.length <= 12)
  const registry = JSON.parse(readFileSync(path.join(root, 'registry-entry.json'), 'utf8'))
  assert.equal(registry.repo, 'Rolodex-PRM/Rolodex-Plugin-Mailing-List')
  assert.equal(registry.id, manifest.id)
  assert.equal(registry.description, manifest.description)
})
