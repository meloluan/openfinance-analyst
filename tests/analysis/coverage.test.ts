import { describe, it, expect } from 'vitest'
import { dataCoverage } from '../../src/analysis/coverage.js'
import type { DomainAccount, DomainTransaction } from '../../src/domain.js'

let seq = 0
const tx = (accountId: string, date: string): DomainTransaction => ({
  id: `t${seq++}`,
  accountId,
  date,
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
})

const acc = (id: string, name: string, kind: 'BANK' | 'CREDIT' = 'CREDIT'): DomainAccount => ({
  id,
  itemId: 'i1',
  kind,
  name,
  number: null,
  balance: 0,
  currencyCode: 'BRL',
  creditLimit: null,
  availableCreditLimit: null,
  closeDate: null,
  dueDate: null,
})

describe('dataCoverage', () => {
  it('a janela começa no mês seguinte ao da conta que estreia mais tarde', () => {
    const c = dataCoverage(
      [acc('conta', 'Itaú', 'BANK'), acc('card1', 'Black'), acc('card2', 'Magalu')],
      [
        tx('conta', '2025-08-01'),
        tx('card1', '2025-10-11'),
        tx('card2', '2025-12-17'),
      ],
      '2026-08-01',
    )
    expect(c.reliableFrom).toBe('2026-01-01')
    expect(c.limitadoPor).toMatch(/Magalu/)
  })

  it('o mês de estreia é descartado por ser parcial', () => {
    const c = dataCoverage([acc('a', 'Única', 'BANK')], [tx('a', '2026-03-20')], '2026-08-01')
    // Março teve dado só a partir do dia 20 — a janela confiável começa em abril.
    expect(c.reliableFrom).toBe('2026-04-01')
  })

  it('conta sem lançamento nenhum não trava a janela, mas é reportada', () => {
    const c = dataCoverage(
      [acc('conta', 'Itaú', 'BANK'), acc('vazio', 'Ourocard Fácil')],
      [tx('conta', '2025-08-01')],
      '2026-08-01',
    )
    expect(c.reliableFrom).toBe('2025-09-01')
    expect(c.semLancamentos).toEqual(['Ourocard Fácil'])
    expect(c.limitadoPor).toMatch(/Itaú/)
  })

  it('sem dado nenhum devolve janela nula em vez de inventar uma', () => {
    const c = dataCoverage([acc('a', 'Itaú', 'BANK')], [], '2026-08-01')
    expect(c.reliableFrom).toBeNull()
    expect(c.limitadoPor).toBeNull()
    expect(c.semLancamentos).toEqual(['Itaú'])
  })

  it('conexão recém-criada não joga a janela para o futuro', () => {
    // Todo o histórico é deste mês: clampar para o mês seguinte esconderia tudo.
    const c = dataCoverage([acc('a', 'Nova', 'BANK')], [tx('a', '2026-08-03')], '2026-08-10')
    expect(c.reliableFrom).toBe('2026-08-01')
  })

  it('reporta o intervalo de cada conta', () => {
    const c = dataCoverage(
      [acc('card1', 'Black')],
      [tx('card1', '2025-10-11'), tx('card1', '2026-07-29'), tx('card1', '2026-01-05')],
      '2026-08-01',
    )
    const black = c.accounts.find((a) => a.name === 'Black')!
    expect(black.from).toBe('2025-10-11')
    expect(black.to).toBe('2026-07-29')
    expect(black.count).toBe(3)
  })
})
