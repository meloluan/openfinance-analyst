import { describe, it, expect } from 'vitest'
import { findRecurring } from '../../src/analysis/recurring.js'
import { installmentsOutlook } from '../../src/analysis/installments.js'
import { budgetStatus } from '../../src/analysis/budget.js'
import { addMonths } from '../../src/analysis/period.js'
import { round2 } from '../../src/analysis/spending.js'
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

describe('findRecurring', () => {
  it('detecta assinatura mensal com variação de ±3 dias e ±5% no valor', () => {
    const found = findRecurring([
      tx({ date: '2026-04-10', amount: -55.9, merchantName: 'NETFLIX' }),
      tx({ date: '2026-05-13', amount: -55.9, merchantName: 'NETFLIX' }),
      tx({ date: '2026-06-11', amount: -57.9, merchantName: 'NETFLIX' }),
    ])
    expect(found).toHaveLength(1)
    expect(found[0]!.merchant).toBe('NETFLIX')
    expect(found[0]!.cadence).toBe('MONTHLY')
    expect(found[0]!.occurrences).toBe(3)
  })

  it('exige pelo menos 3 ocorrências', () => {
    expect(
      findRecurring([
        tx({ date: '2026-05-10', amount: -30, merchantName: 'SPOTIFY' }),
        tx({ date: '2026-06-10', amount: -30, merchantName: 'SPOTIFY' }),
      ]),
    ).toHaveLength(0)
  })

  it('marca priceIncrease quando a última supera a mediana anterior em mais de 5%', () => {
    const found = findRecurring([
      tx({ date: '2026-04-10', amount: -50, merchantName: 'HBO' }),
      tx({ date: '2026-05-10', amount: -50, merchantName: 'HBO' }),
      tx({ date: '2026-06-10', amount: -56, merchantName: 'HBO' }),
    ])
    expect(found[0]!.priceIncrease).toBe(true)
  })

  it('não marca aumento quando a variação está dentro de 5%', () => {
    const found = findRecurring([
      tx({ date: '2026-04-10', amount: -50, merchantName: 'HBO' }),
      tx({ date: '2026-05-10', amount: -50, merchantName: 'HBO' }),
      tx({ date: '2026-06-10', amount: -51, merchantName: 'HBO' }),
    ])
    expect(found[0]!.priceIncrease).toBe(false)
  })

  it('ignora entradas (salário não é assinatura)', () => {
    expect(
      findRecurring([
        tx({ date: '2026-04-05', amount: 5000, merchantName: 'ACME LTDA' }),
        tx({ date: '2026-05-05', amount: 5000, merchantName: 'ACME LTDA' }),
        tx({ date: '2026-06-05', amount: 5000, merchantName: 'ACME LTDA' }),
      ]),
    ).toHaveLength(0)
  })

  it('descarta grupo com valores muito variáveis (supermercado não é assinatura)', () => {
    expect(
      findRecurring([
        tx({ date: '2026-04-10', amount: -100, merchantName: 'MERCADO' }),
        tx({ date: '2026-05-10', amount: -450, merchantName: 'MERCADO' }),
        tx({ date: '2026-06-10', amount: -220, merchantName: 'MERCADO' }),
      ]),
    ).toHaveLength(0)
  })

  it('descarta cadência irregular', () => {
    expect(
      findRecurring([
        tx({ date: '2026-04-10', amount: -50, merchantName: 'ALEATORIO' }),
        tx({ date: '2026-04-28', amount: -50, merchantName: 'ALEATORIO' }),
        tx({ date: '2026-06-25', amount: -50, merchantName: 'ALEATORIO' }),
      ]),
    ).toHaveLength(0)
  })

  it('detecta cadência semanal', () => {
    const found = findRecurring([
      tx({ date: '2026-06-01', amount: -20, merchantName: 'ACADEMIA' }),
      tx({ date: '2026-06-08', amount: -20, merchantName: 'ACADEMIA' }),
      tx({ date: '2026-06-15', amount: -20, merchantName: 'ACADEMIA' }),
    ])
    expect(found[0]!.cadence).toBe('WEEKLY')
  })

  it('compra em 12x NÃO é assinatura, mesmo parecendo uma', () => {
    // Mesmo lojista, mesmo valor, todo mês — mas é uma compra só, e acaba.
    const parcelas = Array.from({ length: 12 }, (_, i) =>
      tx({
        date: `2026-${String(i + 1).padStart(2, '0')}-17`,
        amount: -159.99,
        merchantName: 'AMAZON',
        installmentNumber: i + 1,
        installmentTotal: 12,
      }),
    )
    expect(findRecurring(parcelas)).toHaveLength(0)
  })

  it('agrupa por merchant normalizado, ignorando sufixo numérico', () => {
    const found = findRecurring([
      tx({ date: '2026-04-10', amount: -30, description: 'UBER *TRIP 1234' }),
      tx({ date: '2026-05-10', amount: -30, description: 'UBER *TRIP 5678' }),
      tx({ date: '2026-06-10', amount: -30, description: 'UBER *TRIP 9012' }),
    ])
    expect(found).toHaveLength(1)
    expect(found[0]!.merchant).toBe('UBER TRIP')
  })
})

/**
 * Fixture no formato que o Open Finance realmente devolve: cada parcela é uma
 * transação própria, com billForecastDate. As futuras vêm PENDING e datadas à frente.
 */
const plano = (opts: {
  merchant: string
  amount: number
  total: number
  primeiroMesFatura: string
  de?: number
  ate?: number
}): DomainTransaction[] => {
  const de = opts.de ?? 1
  const ate = opts.ate ?? opts.total
  const out: DomainTransaction[] = []
  for (let n = de; n <= ate; n++) {
    const mes = addMonths(opts.primeiroMesFatura, n - 1)
    out.push(
      tx({
        date: `${mes}-17`,
        amount: -opts.amount,
        merchantName: opts.merchant,
        description: opts.merchant,
        installmentNumber: n,
        installmentTotal: opts.total,
        billForecastDate: mes,
      }),
    )
  }
  return out
}

describe('installmentsOutlook', () => {
  it('agrupa a compra mesmo com o número da parcela embutido na descrição', () => {
    // Formato real do Itaú: "AMAZONMKTPLC*WEBCO10/12". Sem merchantName.
    const rows = Array.from({ length: 12 }, (_, i) =>
      tx({
        date: `${addMonths('2026-06', i)}-17`,
        amount: -159.99,
        merchantName: null,
        description: `AMAZONMKTPLC*WEBCO${String(i + 1).padStart(2, '0')}/12`,
        installmentNumber: i + 1,
        installmentTotal: 12,
        billForecastDate: addMonths('2026-06', i),
      }),
    )
    const out = installmentsOutlook(rows, 12, '2026-06')
    // 11 meses restantes × 159,99 — e não 11 planos projetando cada um sua cauda.
    expect(round2(out.reduce((s, m) => s + m.committed, 0))).toBe(round2(159.99 * 11))
    expect(out.every((m) => m.items.every((i) => !i.projected))).toBe(true)
  })

  it('lê as parcelas que a instituição já lançou, sem contar em dobro', () => {
    // 12x de 100 começando na fatura de 2026-06; todas as 12 linhas existem.
    const out = installmentsOutlook(
      plano({ merchant: 'AMAZON', amount: 100, total: 12, primeiroMesFatura: '2026-06' }),
      12,
      '2026-06',
    )
    const comprometidos = out.filter((m) => m.committed > 0)
    expect(comprometidos).toHaveLength(11) // 2026-07 até 2027-05
    expect(comprometidos[0]!.month).toBe('2026-07')
    expect(comprometidos[0]!.committed).toBe(100) // e não 1100
    expect(comprometidos.at(-1)!.month).toBe('2027-05')
    expect(out.every((m) => m.items.every((i) => !i.projected))).toBe(true)
  })

  it('projeta apenas a cauda que a instituição não mandou', () => {
    // Só as parcelas 1 e 2 de 5 chegaram.
    const out = installmentsOutlook(
      plano({ merchant: 'LOJA', amount: 50, total: 5, primeiroMesFatura: '2026-06', ate: 2 }),
      6,
      '2026-06',
    )
    const comprometidos = out.filter((m) => m.committed > 0)
    expect(comprometidos.map((m) => m.month)).toEqual([
      '2026-07', '2026-08', '2026-09', '2026-10',
    ])
    expect(comprometidos[0]!.items[0]!.projected).toBe(false) // parcela 2, veio do banco
    expect(comprometidos[1]!.items[0]!.projected).toBe(true) // parcela 3, inferida
    expect(comprometidos.every((m) => m.committed === 50)).toBe(true)
  })

  it('ignora compra à vista', () => {
    const out = installmentsOutlook([tx({ amount: -100 })], 6, '2026-06')
    expect(out).toHaveLength(6)
    expect(out.every((m) => m.committed === 0)).toBe(true)
  })

  it('parcelamento já quitado não compromete o futuro', () => {
    const out = installmentsOutlook(
      plano({ merchant: 'ANTIGA', amount: 100, total: 3, primeiroMesFatura: '2026-04' }),
      6,
      '2026-06',
    )
    expect(out.every((m) => m.committed === 0)).toBe(true)
  })

  it('soma parcelamentos diferentes que caem no mesmo mês', () => {
    const out = installmentsOutlook(
      [
        ...plano({ merchant: 'A', amount: 100, total: 3, primeiroMesFatura: '2026-06' }),
        ...plano({ merchant: 'B', amount: 50, total: 2, primeiroMesFatura: '2026-06' }),
      ],
      6,
      '2026-06',
    )
    expect(out[0]!.month).toBe('2026-07')
    expect(out[0]!.committed).toBe(150)
    expect(out[1]!.committed).toBe(100)
    expect(out[2]!.committed).toBe(0)
  })

  it('atravessa a virada de ano', () => {
    const out = installmentsOutlook(
      plano({ merchant: 'C', amount: 100, total: 4, primeiroMesFatura: '2026-11' }),
      6,
      '2026-11',
    )
    expect(out.map((m) => m.month)).toEqual([
      '2026-12', '2027-01', '2027-02', '2027-03', '2027-04', '2027-05',
    ])
    expect(out[2]!.committed).toBe(100)
    expect(out[3]!.committed).toBe(0)
  })
})

describe('budgetStatus', () => {
  const period = { from: '2026-06-01', to: '2026-06-30' }

  it('projeta o fim do mês pelo ritmo: 300 em 15 de 30 dias projeta 600', () => {
    const [line] = budgetStatus(
      [tx({ date: '2026-06-10', amount: -300, category: 'Food' })],
      [{ category: 'Food', amount: 500 }],
      period,
      '2026-06-15',
      [],
    )
    expect(line!.spent).toBe(300)
    expect(line!.projected).toBe(600)
    expect(line!.willExceed).toBe(true)
  })

  it('não estoura quando a projeção fica abaixo da meta', () => {
    const [line] = budgetStatus(
      [tx({ date: '2026-06-10', amount: -100, category: 'Food' })],
      [{ category: 'Food', amount: 500 }],
      period,
      '2026-06-15',
      [],
    )
    expect(line!.projected).toBe(200)
    expect(line!.willExceed).toBe(false)
  })

  it('período já encerrado não projeta além do realizado', () => {
    const [line] = budgetStatus(
      [tx({ date: '2026-06-10', amount: -300, category: 'Food' })],
      [{ category: 'Food', amount: 500 }],
      period,
      '2026-07-20',
      [],
    )
    expect(line!.projected).toBe(300)
    expect(line!.willExceed).toBe(false)
  })

  it('categoria sem gasto reporta zero em vez de sumir', () => {
    const [line] = budgetStatus([], [{ category: 'Lazer', amount: 200 }], period, '2026-06-15', [])
    expect(line!.spent).toBe(0)
    expect(line!.projected).toBe(0)
  })

  it('respeita override de categoria ao somar', () => {
    const [line] = budgetStatus(
      [tx({ date: '2026-06-10', amount: -80, category: 'Outros', merchantName: 'IFOOD' })],
      [{ category: 'Alimentação', amount: 500 }],
      period,
      '2026-06-15',
      [{ pattern: 'IFOOD', category: 'Alimentação' }],
    )
    expect(line!.spent).toBe(80)
  })
})
