import { createServer } from 'node:http'
import handler from '../api/agent/chat'

const port = Number(process.env.AGENT_PORT || process.env.PORT || 3000)

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || `localhost:${port}`}`)

  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (url.pathname === '/api/agent/chat') {
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }

    void handler(req, res)
    return
  }

  res.statusCode = 404
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify({ error: 'Not found' }))
})

server.listen(port, () => {
  console.log(`MyNote Agent gateway listening on http://localhost:${port}/api/agent/chat`)
})
