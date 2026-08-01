import { describe, it, expect, afterEach } from 'vitest'
import { openDb } from '../../src/store/db.js'
import { Repo } from '../../src/store/repo.js'
import { startDashboard } from '../../src/dash/server.js'
import type { Gateway } from '../../src/pluggy/client.js'

const gateway: Gateway = {
  async fetchItem(id) {
    return {
      id,
      institutionName: 'MeuPluggy',
      connectorId: 200,
      status: 'UPDATED',
      lastUpdatedAt: '2026-07-30T01:00:00Z',
      consentExpiresAt: null,
    }
  },
  async fetchAccounts() {
    return []
  },
  async fetchTransactions() {
    return []
  },
}

let stop: (() => Promise<void>) | null = null
afterEach(async () => {
  if (stop) await stop()
  stop = null
})

async function up() {
  const repo = new Repo(openDb(':memory:', 'k'))
  // porta 0 = efêmera, não colide com nada
  const d = await startDashboard(
    { repo, gateway, declaredItemIds: ['i1'], now: () => '2026-07-30' },
    0,
  )
  stop = d.close
  return { ...d, base: d.url.split('?')[0]! }
}

describe('dash server', () => {
  it('escuta apenas em 127.0.0.1', async () => {
    const d = await up()
    expect(d.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//)
  })

  it('sem token devolve 403', async () => {
    const d = await up()
    expect((await fetch(`${d.base}api/data`)).status).toBe(403)
    expect((await fetch(d.base)).status).toBe(403)
  })

  it('token errado devolve 403', async () => {
    const d = await up()
    expect((await fetch(`${d.base}api/data?t=chute`)).status).toBe(403)
  })

  it('token do tamanho certo mas errado também devolve 403', async () => {
    const d = await up()
    const falso = 'f'.repeat(d.token.length)
    expect((await fetch(`${d.base}api/data?t=${falso}`)).status).toBe(403)
  })

  it('com token devolve a página e o payload', async () => {
    const d = await up()
    const page = await fetch(`${d.base}?t=${d.token}`)
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toMatch(/text\/html/)

    const data = await fetch(`${d.base}api/data?t=${d.token}`)
    expect(data.status).toBe(200)
    const body = await data.json()
    expect(body.header).toBeDefined()
    expect(body.cashFlow).toBeDefined()
    expect(body.accounts).toBeDefined()
    expect(body.spending).toBeDefined()
    expect(body.commitments).toBeDefined()
  })

  it('o HTML servido não contém o token', async () => {
    const d = await up()
    const html = await (await fetch(d.url)).text()
    expect(html).not.toContain(d.token)
  })

  it('POST /api/sync executa o sync e devolve o relatório', async () => {
    const d = await up()
    const r = await fetch(`${d.base}api/sync?t=${d.token}`, { method: 'POST' })
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.connections).toHaveLength(1)
    expect(body.errors).toEqual([])
  })

  it('GET em /api/sync não sincroniza', async () => {
    const d = await up()
    expect((await fetch(`${d.base}api/sync?t=${d.token}`)).status).toBe(405)
  })

  it('rota desconhecida devolve 404', async () => {
    const d = await up()
    expect((await fetch(`${d.base}nada?t=${d.token}`)).status).toBe(404)
  })

  it('respostas de API não são cacheadas', async () => {
    const d = await up()
    const r = await fetch(`${d.base}api/data?t=${d.token}`)
    expect(r.headers.get('cache-control')).toMatch(/no-store/)
  })
})
