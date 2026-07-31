import { describe, it, expect } from 'vitest'
import { openDb } from '../src/store/db.js'
import { Repo } from '../src/store/repo.js'
import { syncAll } from '../src/sync.js'
import type { Gateway } from '../src/pluggy/client.js'
import type { DomainAccount, DomainTransaction } from '../src/domain.js'

const ACCOUNT: DomainAccount = {
  id: 'a1', itemId: 'i1', kind: 'BANK', name: 'CC', number: '1',
  balance: 100, currencyCode: 'BRL', creditLimit: null, availableCreditLimit: null,
  closeDate: null, dueDate: null,
}

const TX: DomainTransaction = {
  id: 't1', accountId: 'a1', date: '2026-06-15', description: 'IFOOD', amount: -50,
  currencyCode: 'BRL', category: 'Food', merchantName: 'iFood',
  installmentNumber: null, installmentTotal: null, billForecastDate: null,
  status: 'POSTED', raw: '{}',
}

type FakeOpts = { status?: string; consentExpiresAt?: string | null; throwOn?: string }

function fakeGateway(opts: FakeOpts = {}): Gateway & { sinceSeen: string[] } {
  const sinceSeen: string[] = []
  return {
    sinceSeen,
    async fetchItem(id) {
      if (opts.throwOn === id) throw new Error('boom')
      return {
        id,
        institutionName: id === 'i2' ? 'Nubank' : 'Itaú',
        status: opts.status ?? 'UPDATED',
        lastUpdatedAt: '2026-07-12T10:00:00Z',
        consentExpiresAt: opts.consentExpiresAt === undefined ? '2027-01-01T00:00:00Z' : opts.consentExpiresAt,
      }
    },
    async fetchAccounts(itemId) {
      return [{ ...ACCOUNT, id: `${itemId}-a1`, itemId }]
    },
    async fetchTransactions(accountId, _kind, since) {
      sinceSeen.push(since)
      return [{ ...TX, id: `${accountId}-t1`, accountId }]
    },
  }
}

const newRepo = () => new Repo(openDb(':memory:', 'k'))

describe('syncAll', () => {
  it('reporta conexão saudável e conta as transações novas', async () => {
    const r = await syncAll(fakeGateway(), newRepo(), ['i1'], '2026-07-30')
    expect(r.connections[0]!.healthy).toBe(true)
    expect(r.connections[0]!.warning).toBeNull()
    expect(r.newTransactions['Itaú']).toBe(1)
    expect(r.errors).toEqual([])
  })

  it('marca conexão degradada com aviso acionável em vez de estourar', async () => {
    const r = await syncAll(fakeGateway({ status: 'LOGIN_ERROR' }), newRepo(), ['i1'], '2026-07-30')
    expect(r.connections[0]!.healthy).toBe(false)
    expect(r.connections[0]!.warning).toMatch(/reautoriz/i)
    expect(r.connections[0]!.staleSince).toBe('2026-07-12T10:00:00Z')
  })

  it('avisa quando o consentimento está perto de expirar', async () => {
    const r = await syncAll(
      fakeGateway({ consentExpiresAt: '2026-08-10T00:00:00Z' }),
      newRepo(),
      ['i1'],
      '2026-07-30',
    )
    expect(r.connections[0]!.warning).toMatch(/consentimento/i)
  })

  it('segundo sync não duplica nada', async () => {
    const repo = newRepo()
    await syncAll(fakeGateway(), repo, ['i1'], '2026-07-30')
    const r2 = await syncAll(fakeGateway(), repo, ['i1'], '2026-07-31')
    expect(r2.newTransactions['Itaú']).toBe(0)
    expect(repo.queryTransactions({ from: '2026-01-01', to: '2026-12-31' })).toHaveLength(1)
  })

  it('primeiro sync faz backfill de 24 meses; o seguinte revisita só a janela recente', async () => {
    const repo = newRepo()
    const g1 = fakeGateway()
    await syncAll(g1, repo, ['i1'], '2026-07-30')
    expect(g1.sinceSeen[0]).toBe('2024-07-01')

    const g2 = fakeGateway()
    await syncAll(g2, repo, ['i1'], '2026-07-31')
    // 35 dias antes do watermark (2026-07-30): pega PENDING que virou POSTED
    expect(g2.sinceSeen[0]).toBe('2026-06-25')
  })

  it('falha em uma conexão não derruba as outras', async () => {
    const r = await syncAll(fakeGateway({ throwOn: 'i1' }), newRepo(), ['i1', 'i2'], '2026-07-30')
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]).toMatch(/i1/)
    expect(r.newTransactions['Nubank']).toBe(1)
  })

  it('persiste as conexões para não depender do env no próximo boot', async () => {
    const repo = newRepo()
    await syncAll(fakeGateway(), repo, ['i1'], '2026-07-30')
    expect(repo.listItems().map((i) => i.id)).toEqual(['i1'])
  })

  it('sem nenhuma conexão, orienta como obter o item ID em vez de fingir sucesso', async () => {
    const r = await syncAll(fakeGateway(), newRepo(), [], '2026-07-30')
    expect(r.connections).toEqual([])
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]).toMatch(/Copiar Item ID/)
    expect(r.errors[0]).toMatch(/dashboard\.pluggy\.ai/)
  })

  it('sem itemIds declarados, usa os que já estão no banco', async () => {
    const repo = newRepo()
    await syncAll(fakeGateway(), repo, ['i1'], '2026-07-30')
    const r = await syncAll(fakeGateway(), repo, [], '2026-07-31')
    expect(r.connections.map((c) => c.itemId)).toEqual(['i1'])
  })
})
