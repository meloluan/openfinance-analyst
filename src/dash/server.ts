import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { Repo } from '../store/repo.js'
import type { Gateway } from '../pluggy/client.js'
import { syncAll } from '../sync.js'
import { today } from '../analysis/period.js'
import { buildDashboardData } from './data.js'
import { PAGE_HTML } from './page.js'

/**
 * Nunca 0.0.0.0. Numa rede compartilhada isso publicaria o extrato para
 * qualquer um no mesmo wi-fi.
 */
const HOST = '127.0.0.1'

export type DashDeps = {
  repo: Repo
  gateway: Gateway
  declaredItemIds: string[]
  token: string
  now?: () => string
}

/** Comparação em tempo constante: evita vazar o token por timing. */
function tokenOk(provided: string | null, expected: string): boolean {
  if (!provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

export function createDashServer(deps: DashDeps): Server {
  const now = deps.now ?? today

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://${HOST}`)

    if (!tokenOk(url.searchParams.get('t'), deps.token)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('403 — abra pela URL impressa no terminal, que carrega o token da sessão.')
      return
    }

    if (url.pathname === '/') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      })
      // A página não carrega o token: o JS lê de location.search.
      res.end(PAGE_HTML)
      return
    }

    if (url.pathname === '/api/data') {
      try {
        json(res, 200, buildDashboardData(deps.repo, now()))
      } catch (err) {
        json(res, 500, { erro: err instanceof Error ? err.message : 'falha ao montar os dados' })
      }
      return
    }

    if (url.pathname === '/api/sync') {
      if (req.method !== 'POST') {
        json(res, 405, { erro: 'Use POST para sincronizar.' })
        return
      }
      syncAll(deps.gateway, deps.repo, deps.declaredItemIds, now())
        .then((report) => json(res, 200, report))
        // Só a mensagem: exceção de SDK pode carregar credencial.
        .catch((err) =>
          json(res, 500, { erro: err instanceof Error ? err.message : 'falha no sync' }),
        )
      return
    }

    json(res, 404, { erro: 'rota inexistente' })
  })
}

export async function startDashboard(
  deps: Omit<DashDeps, 'token'>,
  port: number,
): Promise<{ url: string; token: string; close: () => Promise<void> }> {
  const token = randomBytes(24).toString('hex')
  const server = createDashServer({ ...deps, token })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, HOST, resolve)
  })

  const addr = server.address()
  const boundPort = typeof addr === 'object' && addr ? addr.port : port

  return {
    url: `http://${HOST}:${boundPort}/?t=${token}`,
    token,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
