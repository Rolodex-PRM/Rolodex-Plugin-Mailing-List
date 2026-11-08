import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const port = 4173

createServer((request, response) => {
  const url = new URL(request.url || '/', `http://127.0.0.1:${port}`)
  if (url.pathname === '/' || url.pathname === '/index.html') {
    const html = readFileSync(path.join(root, 'index.html'), 'utf8').replace('</body>', '<script src="/dev/mock.js"></script></body>')
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end(html)
    return
  }
  const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`)
  if (!file.startsWith(root) || !existsSync(file)) {
    response.statusCode = 404
    response.end('Not found')
    return
  }
  response.setHeader('content-type', file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/plain; charset=utf-8')
  response.end(readFileSync(file))
}).listen(port, '127.0.0.1', () => {
  console.log(`Preview at http://127.0.0.1:${port}`)
})
