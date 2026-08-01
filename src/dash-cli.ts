#!/usr/bin/env node
import { mkdirSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { loadConfig } from './config.js'
import { openDb } from './store/db.js'
import { getOrCreateKey } from './store/key.js'
import { Repo } from './store/repo.js'
import { PluggyGateway } from './pluggy/client.js'
import { startDashboard } from './dash/server.js'

const PORT = Number(process.env.OFA_DASH_PORT ?? 4000)

async function main(): Promise<void> {
  const config = loadConfig()
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 })

  const repo = new Repo(openDb(config.dbPath, getOrCreateKey()))
  const gateway = new PluggyGateway(config.clientId, config.clientSecret)

  const { url } = await startDashboard(
    { repo, gateway, declaredItemIds: config.itemIds },
    PORT,
  )

  console.log(`dashboard em ${url}`)
  console.log('a URL carrega o token da sessão — Ctrl+C encerra')
  execFile('/usr/bin/open', [url], () => {})
}

main().catch((err: unknown) => {
  const code = (err as { code?: string })?.code
  if (code === 'EADDRINUSE') {
    console.error(`porta ${PORT} ocupada. Rode com OFA_DASH_PORT=4001 npm run dash`)
  } else {
    console.error(err instanceof Error ? err.message : 'falha ao subir o dashboard')
  }
  process.exit(1)
})
