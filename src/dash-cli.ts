#!/usr/bin/env node
import { mkdirSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { parseConfig, parsePaths, resolveEnv } from './config.js'
import { openDb } from './store/db.js'
import { getOrCreateKey } from './store/key.js'
import { getSecret } from './store/secrets.js'
import { Repo } from './store/repo.js'
import { PluggyGateway, type Gateway } from './pluggy/client.js'
import { startDashboard } from './dash/server.js'

const PORT = Number(process.env.OFA_DASH_PORT ?? 4000)

/**
 * Sem credencial o dashboard ainda vale: os dados já sincronizados estão no
 * banco local. O que não funciona é o botão Atualizar — e ele diz por quê,
 * em vez de o processo morrer no boot e não mostrar nada.
 */
function gatewayIndisponivel(motivo: string): Gateway {
  const falhar = async (): Promise<never> => {
    throw new Error(motivo)
  }
  return { fetchItem: falhar, fetchAccounts: falhar, fetchTransactions: falhar }
}

async function main(): Promise<void> {
  const env = resolveEnv(process.env, getSecret)
  const paths = parsePaths(env)
  mkdirSync(paths.dataDir, { recursive: true, mode: 0o700 })

  const repo = new Repo(openDb(paths.dbPath, getOrCreateKey()))

  let gateway: Gateway
  let itemIds = paths.itemIds
  try {
    const config = parseConfig(env)
    gateway = new PluggyGateway(config.clientId, config.clientSecret)
    itemIds = config.itemIds
  } catch (err) {
    const motivo = err instanceof Error ? err.message : 'credenciais indisponíveis'
    gateway = gatewayIndisponivel(motivo)
    console.warn(`aviso: ${motivo}`)
    console.warn('o dashboard abre em modo leitura; o botão Atualizar vai falhar até configurar')
  }

  const { url } = await startDashboard({ repo, gateway, declaredItemIds: itemIds }, PORT)

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
