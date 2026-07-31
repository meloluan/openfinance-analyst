import { describe, it, expect, beforeEach } from 'vitest'
import { openDb } from '../../src/store/db.js'
import { Repo } from '../../src/store/repo.js'
import type { DomainAccount, DomainItem, DomainTransaction } from '../../src/domain.js'

const tx = (over: Partial<DomainTransaction> = {}): DomainTransaction => ({
  id: 't1',
  accountId: 'a1',
  date: '2026-06-15',
  description: 'IFOOD',
  amount: -50,
  currencyCode: 'BRL',
  category: 'Food',
  merchantName: 'iFood',
  installmentNumber: null,
  installmentTotal: null,
  billForecastDate: null,
  status: 'POSTED',
  raw: '{}',
  ...over,
})

const account = (over: Partial<DomainAccount> = {}): DomainAccount => ({
  id: 'a1',
  itemId: 'i1',
  kind: 'BANK',
  name: 'Conta Corrente',
  number: '123',
  balance: 1000,
  currencyCode: 'BRL',
  creditLimit: null,
  availableCreditLimit: null,
  closeDate: null,
  dueDate: null,
  ...over,
})

const item = (over: Partial<DomainItem> = {}): DomainItem => ({
  id: 'i1',
  institutionName: 'Itaú',
  status: 'UPDATED',
  lastUpdatedAt: '2026-07-12T10:00:00Z',
  consentExpiresAt: '2027-01-01T00:00:00Z',
  ...over,
})

function freshRepo(): Repo {
  const repo = new Repo(openDb(':memory:', 'test-key'))
  repo.upsertItem(item(), '2026-07-30')
  repo.upsertAccounts([account()])
  return repo
}

const JUNE = { from: '2026-06-01', to: '2026-06-30' }

describe('Repo.upsertTransactions', () => {
  let repo: Repo
  beforeEach(() => {
    repo = freshRepo()
  })

  it('sincronizar duas vezes não duplica', () => {
    repo.upsertTransactions([tx()])
    repo.upsertTransactions([tx()])
    expect(repo.queryTransactions(JUNE)).toHaveLength(1)
  })

  it('devolve a contagem de linhas realmente novas', () => {
    expect(repo.upsertTransactions([tx({ id: 't1' }), tx({ id: 't2' })])).toBe(2)
    expect(repo.upsertTransactions([tx({ id: 't1' }), tx({ id: 't3' })])).toBe(1)
  })

  it('atualiza PENDING para POSTED no lugar de inserir de novo', () => {
    repo.upsertTransactions([tx({ status: 'PENDING', description: 'COMPRA PENDENTE' })])
    repo.upsertTransactions([tx({ status: 'POSTED', description: 'IFOOD *PEDIDO' })])
    const rows = repo.queryTransactions(JUNE)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe('POSTED')
    expect(rows[0]!.description).toBe('IFOOD *PEDIDO')
  })

  it('preserva o sinal negativo ao passar pelo banco', () => {
    repo.upsertTransactions([tx({ amount: -50 })])
    expect(repo.queryTransactions(JUNE)[0]!.amount).toBe(-50)
  })

  it('filtra por período', () => {
    repo.upsertTransactions([tx({ id: 't1', date: '2026-05-20' }), tx({ id: 't2', date: '2026-06-15' })])
    expect(repo.queryTransactions(JUNE)).toHaveLength(1)
  })

  it('filtra por tipo de conta', () => {
    repo.upsertAccounts([account({ id: 'c1', kind: 'CREDIT', name: 'Cartão' })])
    repo.upsertTransactions([tx({ id: 't1', accountId: 'a1' }), tx({ id: 't2', accountId: 'c1' })])
    const credit = repo.queryTransactions({ ...JUNE, kind: 'CREDIT' })
    expect(credit).toHaveLength(1)
    expect(credit[0]!.id).toBe('t2')
  })
})

describe('Repo watermark', () => {
  it('devolve null quando nunca sincronizou e persiste depois', () => {
    const repo = freshRepo()
    expect(repo.getWatermark('item-1')).toBeNull()
    repo.setWatermark('item-1', '2026-06-01')
    expect(repo.getWatermark('item-1')).toBe('2026-06-01')
    repo.setWatermark('item-1', '2026-07-01')
    expect(repo.getWatermark('item-1')).toBe('2026-07-01')
  })
})

describe('Repo items e accounts', () => {
  it('upsert de item atualiza status em vez de duplicar', () => {
    const repo = freshRepo()
    repo.upsertItem(item({ status: 'LOGIN_ERROR' }), '2026-07-31')
    const items = repo.listItems()
    expect(items).toHaveLength(1)
    expect(items[0]!.status).toBe('LOGIN_ERROR')
    expect(items[0]!.lastSyncedAt).toBe('2026-07-31')
  })

  it('upsert de conta atualiza saldo', () => {
    const repo = freshRepo()
    repo.upsertAccounts([account({ balance: 2500 })])
    const accounts = repo.listAccounts()
    expect(accounts).toHaveLength(1)
    expect(accounts[0]!.balance).toBe(2500)
  })
})

describe('Repo overrides e budgets', () => {
  it('guarda overrides na ordem de criação', () => {
    const repo = freshRepo()
    repo.addOverride('UBER', 'Transporte')
    repo.addOverride('IFOOD', 'Alimentação')
    expect(repo.listOverrides().map((o) => o.category)).toEqual(['Transporte', 'Alimentação'])
  })

  it('budget por categoria é substituído, não duplicado', () => {
    const repo = freshRepo()
    repo.setBudget('Alimentação', 800)
    repo.setBudget('Alimentação', 1000)
    expect(repo.listBudgets()).toEqual([{ category: 'Alimentação', amount: 1000 }])
  })
})

describe('migrations', () => {
  it('banco novo aplica todas e fica na versão corrente', () => {
    const db = openDb(':memory:', 'k')
    const version = db.pragma('user_version', { simple: true })
    expect(version).toBeGreaterThan(0)
  })
})
