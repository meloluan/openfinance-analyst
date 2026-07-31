import { describe, it, expect } from 'vitest'
import {
  normalizeAccount,
  normalizeAmount,
  normalizeItem,
  normalizeTransaction,
  toLocalDate,
} from '../../src/pluggy/normalize.js'

const base = {
  id: 't1',
  accountId: 'a1',
  date: new Date('2026-06-15T12:00:00Z'),
  description: 'IFOOD',
  descriptionRaw: null,
  balance: 0,
  currencyCode: 'BRL',
  category: 'Food',
  categoryId: 'f1',
  creditCardMetadata: null,
  operationType: null,
  operationTypeAdditionalInfo: null,
  providerId: null,
  amountInAccountCurrency: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as any

describe('convenção de sinal', () => {
  it('conta corrente: débito já vem negativo e permanece negativo', () => {
    const t = normalizeTransaction({ ...base, type: 'DEBIT', amount: -50 }, 'BANK')
    expect(t.amount).toBe(-50)
  })

  it('conta corrente: entrada permanece positiva', () => {
    const t = normalizeTransaction({ ...base, type: 'CREDIT', amount: 3000 }, 'BANK')
    expect(t.amount).toBe(3000)
  })

  it('cartão: compra vem POSITIVA na Pluggy e vira NEGATIVA', () => {
    const t = normalizeTransaction({ ...base, type: 'DEBIT', amount: 50 }, 'CREDIT')
    expect(t.amount).toBe(-50)
  })

  it('cartão: pagamento de fatura vem negativo na Pluggy e vira positivo', () => {
    const t = normalizeTransaction({ ...base, type: 'CREDIT', amount: -1200 }, 'CREDIT')
    expect(t.amount).toBe(1200)
  })

  it('não produz -0', () => {
    expect(Object.is(normalizeAmount(0, 'CREDIT'), -0)).toBe(false)
  })
})

describe('campos derivados', () => {
  it('extrai parcelas do creditCardMetadata', () => {
    const t = normalizeTransaction(
      {
        ...base,
        type: 'DEBIT',
        amount: 100,
        creditCardMetadata: {
          installmentNumber: 3,
          totalInstallments: 12,
          billForecastDate: '2026-07',
        },
      },
      'CREDIT',
    )
    expect(t.installmentNumber).toBe(3)
    expect(t.installmentTotal).toBe(12)
    expect(t.billForecastDate).toBe('2026-07')
  })

  it('data vira YYYY-MM-DD em America/Sao_Paulo, não em UTC', () => {
    // 2026-07-01T02:00Z ainda é 30/06 em São Paulo (UTC-3)
    const t = normalizeTransaction(
      { ...base, date: new Date('2026-07-01T02:00:00Z'), type: 'DEBIT', amount: -10 },
      'BANK',
    )
    expect(t.date).toBe('2026-06-30')
  })

  it('guarda o payload cru para reprocessamento', () => {
    const t = normalizeTransaction({ ...base, type: 'DEBIT', amount: -10 }, 'BANK')
    expect(JSON.parse(t.raw).id).toBe('t1')
  })

  it('status ausente vira POSTED', () => {
    const t = normalizeTransaction({ ...base, type: 'DEBIT', amount: -10 }, 'BANK')
    expect(t.status).toBe('POSTED')
  })

  it('toLocalDate devolve null para data inválida', () => {
    expect(toLocalDate(new Date('lixo'))).toBeNull()
    expect(toLocalDate(null)).toBeNull()
  })
})

describe('normalizeAccount', () => {
  it('mapeia cartão com limite e datas de fatura', () => {
    const acc = normalizeAccount({
      id: 'a1',
      itemId: 'i1',
      type: 'CREDIT',
      subtype: 'CREDIT_CARD',
      number: '****1234',
      balance: 1500,
      name: 'Cartão',
      marketingName: 'Platinum',
      owner: null,
      taxNumber: null,
      currencyCode: 'BRL',
      bankData: null,
      creditData: {
        level: null,
        brand: 'Visa',
        balanceCloseDate: new Date('2026-07-05T12:00:00Z'),
        balanceDueDate: new Date('2026-07-12T12:00:00Z'),
        availableCreditLimit: 3500,
        balanceForeignCurrency: null,
        minimumPayment: null,
        creditLimit: 5000,
        isLimitFlexible: null,
        status: 'ACTIVE',
        holderType: 'MAIN',
      },
    } as any)

    expect(acc.kind).toBe('CREDIT')
    expect(acc.name).toBe('Platinum')
    expect(acc.creditLimit).toBe(5000)
    expect(acc.closeDate).toBe('2026-07-05')
    expect(acc.dueDate).toBe('2026-07-12')
  })

  it('cai para name quando marketingName é null', () => {
    const acc = normalizeAccount({
      id: 'a2', itemId: 'i1', type: 'BANK', subtype: 'CHECKING_ACCOUNT',
      number: '1', balance: 10, name: 'Conta Corrente', marketingName: null,
      owner: null, taxNumber: null, currencyCode: 'BRL', bankData: null, creditData: null,
    } as any)
    expect(acc.name).toBe('Conta Corrente')
    expect(acc.creditLimit).toBeNull()
  })
})

describe('normalizeItem', () => {
  it('extrai nome da instituição e expiração do consentimento', () => {
    const item = normalizeItem({
      id: 'i1',
      connector: { name: 'Itaú' },
      status: 'UPDATED',
      lastUpdatedAt: new Date('2026-07-12T10:00:00Z'),
      consentExpiresAt: new Date('2027-01-01T00:00:00Z'),
    } as any)
    expect(item.institutionName).toBe('Itaú')
    expect(item.status).toBe('UPDATED')
    expect(item.consentExpiresAt).toBe('2027-01-01T00:00:00.000Z')
  })

  it('sobrevive a connector ausente', () => {
    const item = normalizeItem({ id: 'i1', status: 'UPDATED', lastUpdatedAt: null, consentExpiresAt: null } as any)
    expect(item.institutionName).toBe('desconhecida')
    expect(item.lastUpdatedAt).toBeNull()
  })
})
