import { describe, it, expect } from 'vitest'
import { addMonths, daysBetween, monthOf, resolvePeriod } from '../../src/analysis/period.js'
import { applyOverrides } from '../../src/analysis/categories.js'
import { comparePeriods, spendingByCategory, spendingByMonth } from '../../src/analysis/spending.js'
import { billComposition } from '../../src/analysis/bill.js'
import type { DomainTransaction } from '../../src/domain.js'

let seq = 0
const tx = (o: Partial<DomainTransaction>): DomainTransaction => ({
  id: `t${seq++}`,
  accountId: 'a1',
  date: '2026-06-15',
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

describe('resolvePeriod', () => {
  it('expande YYYY-MM para o mês inteiro', () => {
    expect(resolvePeriod({ period: '2026-06' })).toEqual({ from: '2026-06-01', to: '2026-06-30' })
  })

  it('acerta fevereiro em ano bissexto', () => {
    expect(resolvePeriod({ period: '2028-02' })).toEqual({ from: '2028-02-01', to: '2028-02-29' })
  })

  it('acerta fevereiro em ano comum', () => {
    expect(resolvePeriod({ period: '2026-02' })).toEqual({ from: '2026-02-01', to: '2026-02-28' })
  })

  it('passa from/to adiante', () => {
    expect(resolvePeriod({ from: '2026-01-05', to: '2026-03-10' })).toEqual({
      from: '2026-01-05',
      to: '2026-03-10',
    })
  })

  it('default é o mês corrente', () => {
    expect(resolvePeriod({}, '2026-07-30')).toEqual({ from: '2026-07-01', to: '2026-07-31' })
  })

  it('rejeita período mal formado', () => {
    expect(() => resolvePeriod({ period: 'junho' })).toThrow(/YYYY-MM/)
  })
})

describe('helpers de mês', () => {
  it('addMonths atravessa a virada de ano', () => {
    expect(addMonths('2026-11', 3)).toBe('2027-02')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
  })

  it('monthOf extrai o mês da data', () => {
    expect(monthOf('2026-06-15')).toBe('2026-06')
  })

  it('daysBetween conta os dias inclusive', () => {
    expect(daysBetween('2026-06-01', '2026-06-30')).toBe(30)
    expect(daysBetween('2026-06-01', '2026-06-01')).toBe(1)
  })
})

describe('applyOverrides', () => {
  const overrides = [
    { pattern: 'IFOOD', category: 'Alimentação' },
    { pattern: 'UBER', category: 'Transporte' },
  ]

  it('casa merchant sem diferenciar maiúscula', () => {
    expect(applyOverrides(tx({ merchantName: 'iFood Delivery' }), overrides)).toBe('Alimentação')
  })

  it('casa também pela descrição', () => {
    expect(applyOverrides(tx({ description: 'UBER *TRIP' }), overrides)).toBe('Transporte')
  })

  it('primeira regra cadastrada vence', () => {
    expect(
      applyOverrides(tx({ description: 'IFOOD UBER' }), overrides),
    ).toBe('Alimentação')
  })

  it('sem override, usa a categoria da Pluggy', () => {
    expect(applyOverrides(tx({ category: 'Shopping' }), overrides)).toBe('Shopping')
  })

  it('sem categoria nenhuma, cai no rótulo padrão', () => {
    expect(applyOverrides(tx({}), overrides)).toBe('Sem categoria')
  })
})

describe('spendingByCategory', () => {
  it('soma só gastos e reporta como valor positivo', () => {
    const result = spendingByCategory(
      [
        tx({ amount: -100, category: 'Food' }),
        tx({ amount: -50, category: 'Food' }),
        tx({ amount: 3000, category: 'Salário' }),
      ],
      [],
    )
    expect(result).toEqual([{ category: 'Food', total: 150, count: 2 }])
  })

  it('ordena da maior para a menor', () => {
    const result = spendingByCategory(
      [
        tx({ amount: -10, category: 'Lazer' }),
        tx({ amount: -900, category: 'Moradia' }),
        tx({ amount: -100, category: 'Food' }),
      ],
      [],
    )
    expect(result.map((r) => r.category)).toEqual(['Moradia', 'Food', 'Lazer'])
  })

  it('aplica override antes de agrupar', () => {
    const result = spendingByCategory(
      [
        tx({ amount: -50, category: 'Outros', merchantName: 'IFOOD' }),
        tx({ amount: -30, category: 'Alimentação' }),
      ],
      [{ pattern: 'IFOOD', category: 'Alimentação' }],
    )
    expect(result).toEqual([{ category: 'Alimentação', total: 80, count: 2 }])
  })
})

describe('spendingByMonth', () => {
  it('agrupa por mês em ordem cronológica', () => {
    const result = spendingByMonth([
      tx({ date: '2026-06-15', amount: -100 }),
      tx({ date: '2026-05-20', amount: -200 }),
      tx({ date: '2026-06-01', amount: -50 }),
    ])
    expect(result).toEqual([
      { month: '2026-05', total: 200 },
      { month: '2026-06', total: 150 },
    ])
  })
})

describe('comparePeriods', () => {
  it('calcula delta e percentual', () => {
    const result = comparePeriods(
      [tx({ amount: -150, category: 'Food' })],
      [tx({ amount: -100, category: 'Food' })],
      [],
    )
    expect(result).toEqual([
      { category: 'Food', current: 150, previous: 100, delta: 50, deltaPct: 50 },
    ])
  })

  it('deltaPct é null quando o período anterior é zero, sem dividir por zero', () => {
    const result = comparePeriods([tx({ amount: -80, category: 'Novo' })], [], [])
    expect(result[0]!.deltaPct).toBeNull()
    expect(result[0]!.delta).toBe(80)
  })

  it('inclui categoria que existia antes e sumiu agora', () => {
    const result = comparePeriods([], [tx({ amount: -60, category: 'Antigo' })], [])
    expect(result).toEqual([
      { category: 'Antigo', current: 0, previous: 60, delta: -60, deltaPct: -100 },
    ])
  })
})

describe('billComposition', () => {
  it('usa billForecastDate para alocar a compra na fatura certa', () => {
    const bill = billComposition(
      [
        tx({ date: '2026-06-28', amount: -100, billForecastDate: '2026-07', category: 'Food' }),
        tx({ date: '2026-06-02', amount: -40, billForecastDate: '2026-06', category: 'Food' }),
      ],
      '2026-07',
      [],
    )
    expect(bill.total).toBe(100)
    expect(bill.byCategory).toEqual([{ category: 'Food', total: 100, count: 1 }])
  })

  it('sem billForecastDate, cai para o mês da transação', () => {
    const bill = billComposition(
      [tx({ date: '2026-06-10', amount: -70, category: 'Lazer' })],
      '2026-06',
      [],
    )
    expect(bill.total).toBe(70)
  })

  it('pagamento de fatura não conta como gasto', () => {
    const bill = billComposition(
      [
        tx({ date: '2026-06-10', amount: -70, billForecastDate: '2026-06' }),
        tx({ date: '2026-06-11', amount: 500, billForecastDate: '2026-06' }),
      ],
      '2026-06',
      [],
    )
    expect(bill.total).toBe(70)
  })
})
