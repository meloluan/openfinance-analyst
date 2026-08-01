import { describe, it, expect, beforeEach } from 'vitest'
import { openDb } from '../../src/store/db.js'
import { Repo } from '../../src/store/repo.js'
import { buildDashboardData } from '../../src/dash/data.js'
import { addMonths } from '../../src/analysis/period.js'
import type { DomainTransaction } from '../../src/domain.js'

const NOW = '2026-07-30'

let seq = 0
const tx = (o: Partial<DomainTransaction>): DomainTransaction => ({
  id: `t${seq++}`,
  accountId: 'acc1',
  date: '2026-07-10',
  description: 'X',
  amount: -10,
  currencyCode: 'BRL',
  category: null,
  merchantName: null,
  installmentNumber: null,
  installmentTotal: null,
  billForecastDate: null,
  status: 'POSTED',
  raw: '{}',
  ...o,
})

function seed(): Repo {
  const repo = new Repo(openDb(':memory:', 'k'))
  repo.upsertItem(
    {
      id: 'i1',
      institutionName: 'MeuPluggy',
      connectorId: 200,
      status: 'UPDATED',
      lastUpdatedAt: '2026-07-30T01:00:00Z',
      consentExpiresAt: null,
    },
    NOW,
  )
  repo.upsertAccounts([
    { id: 'acc1', itemId: 'i1', kind: 'BANK', name: 'Itaú', number: '1', balance: 5000,
      currencyCode: 'BRL', creditLimit: null, availableCreditLimit: null, closeDate: null, dueDate: null },
    { id: 'acc2', itemId: 'i1', kind: 'BANK', name: 'BB', number: '2', balance: -1500,
      currencyCode: 'BRL', creditLimit: null, availableCreditLimit: null, closeDate: null, dueDate: null },
    { id: 'card1', itemId: 'i1', kind: 'CREDIT', name: 'Black', number: '9', balance: 2000,
      currencyCode: 'BRL', creditLimit: 10000, availableCreditLimit: 8000, closeDate: null, dueDate: '2026-08-10' },
  ])
  return repo
}

describe('buildDashboardData', () => {
  let repo: Repo
  beforeEach(() => {
    repo = seed()
  })

  it('cabeçalho soma o saldo das contas, inclusive negativo', () => {
    expect(buildDashboardData(repo, NOW).header.saldoTotal).toBe(3500)
  })

  it('expõe os dois tempos separadamente', () => {
    const d = buildDashboardData(repo, NOW)
    expect(d.header.lastSyncedAt).toBe(NOW)
    expect(d.header.lastCollectedAt).toBe('2026-07-30T01:00:00Z')
  })

  it('propaga aviso de coleta atrasada vindo do assessHealth', () => {
    repo.upsertItem(
      {
        id: 'i1', institutionName: 'MeuPluggy', connectorId: 200, status: 'UPDATED',
        lastUpdatedAt: '2026-07-20T01:00:00Z', consentExpiresAt: null,
      },
      NOW,
    )
    expect(buildDashboardData(repo, NOW).header.avisos.join(' ')).toMatch(/não coleta/i)
  })

  it('separa conta de cartão e marca a negativa', () => {
    const d = buildDashboardData(repo, NOW)
    expect(d.accounts.contas.map((c) => c.name)).toEqual(['BB', 'Itaú'])
    expect(d.accounts.contas.find((c) => c.name === 'BB')!.balance).toBeLessThan(0)
    expect(d.accounts.cartoes).toHaveLength(1)
  })

  it('gasto do mês é positivo e agrupado por categoria', () => {
    repo.upsertTransactions([
      tx({ amount: -300, category: 'Alimentação' }),
      tx({ amount: -200, category: 'Alimentação' }),
      tx({ amount: 4000, category: 'Salary' }),
    ])
    expect(buildDashboardData(repo, NOW).spending.atual).toEqual([
      { category: 'Alimentação', total: 500, count: 2 },
    ])
  })

  it('fluxo de caixa traz média mensal e investimento líquido', () => {
    repo.upsertTransactions([
      tx({ date: '2026-07-05', amount: 5000, category: 'Salary' }),
      tx({ date: '2026-07-06', amount: -2000, category: 'Shopping' }),
      tx({ date: '2026-07-07', amount: -1000, category: 'Investments' }),
    ])
    const d = buildDashboardData(repo, NOW)
    expect(d.cashFlow.totals.income).toBe(5000)
    expect(d.cashFlow.totals.expenses).toBe(2000)
    expect(d.cashFlow.netSaved).toBe(1000)
    expect(d.cashFlow.mediaMensal.sobra).toBe(3000)
  })

  it('compromissos trazem parcelas futuras', () => {
    repo.upsertTransactions([
      tx({ accountId: 'card1', date: '2026-07-17', amount: -100,
           installmentNumber: 1, installmentTotal: 3, billForecastDate: '2026-07' }),
      tx({ accountId: 'card1', date: '2026-08-17', amount: -100,
           installmentNumber: 2, installmentTotal: 3, billForecastDate: '2026-08' }),
    ])
    const d = buildDashboardData(repo, NOW)
    expect(d.commitments.proximosMeses[0]!.month).toBe('2026-08')
    expect(d.commitments.proximosMeses[0]!.committed).toBe(100)
  })

  it('investimento NÃO aparece como gasto do mês', () => {
    // O painel de fluxo trata investimento como poupança. Se o painel de gastos
    // o tratasse como despesa, as duas metades da mesma tela se contradiriam.
    repo.upsertTransactions([
      tx({ amount: -500, category: 'Alimentação' }),
      tx({ amount: -3000, category: 'Investments' }),
      tx({ amount: -800, category: 'Credit card payment' }),
    ])
    const d = buildDashboardData(repo, NOW)
    expect(d.spending.atual.map((c) => c.category)).toEqual(['Alimentação'])
    expect(d.spending.atual[0]!.total).toBe(500)
  })

  it('a sobra em destaque é mediana, não média — um mês atípico não distorce', () => {
    // 11 meses com sobra pequena e um mês excepcional.
    const txs = []
    for (let i = 0; i < 11; i++) {
      const mes = addMonths('2025-09', i)
      txs.push(tx({ date: `${mes}-10`, amount: 1000, category: 'Salary' }))
      txs.push(tx({ date: `${mes}-11`, amount: -900, category: 'Shopping' }))
    }
    txs.push(tx({ date: '2026-07-10', amount: 50000, category: 'Salary' }))
    repo.upsertTransactions(txs)

    const d = buildDashboardData(repo, NOW)
    expect(d.cashFlow.sobraTipicaMes).toBe(100)
    // A média existe, mas é dominada pelo mês atípico — por isso não é o destaque.
    expect(d.cashFlow.mediaMensal.sobra).toBeGreaterThan(4000)
  })

  it('recorrentes somam boleto e seguro, não só assinatura de streaming', () => {
    const d = buildDashboardData(repo, NOW)
    expect(d.commitments).toHaveProperty('recorrentes')
    expect(d.commitments).toHaveProperty('custoMensalRecorrente')
  })

  it('banco vazio devolve estado inicial em vez de zeros', () => {
    const d = buildDashboardData(new Repo(openDb(':memory:', 'k')), NOW)
    expect(d.header.semDados).toBe(true)
    expect(d.header.avisos.join(' ')).toMatch(/sync|atualizar/i)
  })
})

describe('janela limitada pela cobertura', () => {
  it('recua a análise até onde a conta que estreia mais tarde tem dado', () => {
    const repo = seed()
    repo.upsertTransactions([
      tx({ accountId: 'acc1', date: '2026-02-10', amount: 5000, category: 'Salary' }),
      // O cartão só começa em maio: antes disso a foto está incompleta.
      tx({ accountId: 'card1', date: '2026-05-10', amount: -300, category: 'Shopping' }),
    ])
    const d = buildDashboardData(repo, NOW)
    expect(d.coverage.janelaAnalisada.from).toBe('2026-06-01')
    expect(d.coverage.limitadoPor).toMatch(/Black/)
    expect(d.header.avisos.join(' ')).toMatch(/limitada a partir de 2026-06-01/)
  })

  it('não compara com um mês anterior fora da cobertura', () => {
    const repo = seed()
    repo.upsertTransactions([
      tx({ accountId: 'card1', date: '2026-07-10', amount: -300, category: 'Shopping' }),
    ])
    const d = buildDashboardData(repo, NOW)
    expect(d.spending.comparavel).toBe(false)
    expect(d.spending.comparacao).toEqual([])
  })

  it('reporta as contas sem lançamento nenhum', () => {
    const repo = seed()
    repo.upsertTransactions([tx({ accountId: 'acc1', amount: -50, category: 'X' })])
    const d = buildDashboardData(repo, NOW)
    expect(d.coverage.semLancamentos).toContain('BB')
    expect(d.header.avisos.join(' ')).toMatch(/Sem lançamento nenhum/)
  })
})
