import type { Account, Item, Transaction } from 'pluggy-sdk'
import type { AccountKind, DomainAccount, DomainItem, DomainTransaction } from '../domain.js'

const TZ = 'America/Sao_Paulo'

/**
 * Date → 'YYYY-MM-DD' no fuso de São Paulo.
 * Agrupar em UTC jogaria uma compra de 1º à 0h30 para o mês anterior — silenciosamente.
 * `en-CA` já formata como YYYY-MM-DD.
 */
export function toLocalDate(d: Date | string | null | undefined): string | null {
  if (!d) return null
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

/**
 * Cartão de crédito na Pluggy usa sinal INVERTIDO: positivo = nova compra
 * (aumenta o que você deve). Conta corrente usa o natural: negativo = saída.
 *
 * Aqui tudo converge para a convenção única do projeto:
 * gasto negativo, entrada positiva.
 */
export function normalizeAmount(amount: number, kind: AccountKind): number {
  const normalized = kind === 'CREDIT' ? -amount : amount
  return normalized === 0 ? 0 : normalized // evita -0
}

export function normalizeTransaction(tx: Transaction, kind: AccountKind): DomainTransaction {
  const meta = tx.creditCardMetadata
  return {
    id: tx.id,
    accountId: tx.accountId,
    date: toLocalDate(tx.date) ?? '1970-01-01',
    description: tx.description,
    amount: normalizeAmount(tx.amount, kind),
    currencyCode: tx.currencyCode,
    category: tx.category ?? null,
    merchantName: tx.merchant?.name ?? null,
    installmentNumber: meta?.installmentNumber ?? null,
    installmentTotal: meta?.totalInstallments ?? null,
    billForecastDate: meta?.billForecastDate ?? null,
    status: tx.status === 'PENDING' ? 'PENDING' : 'POSTED',
    raw: JSON.stringify(tx),
  }
}

export function normalizeAccount(acc: Account): DomainAccount {
  return {
    id: acc.id,
    itemId: acc.itemId,
    kind: acc.type,
    name: acc.marketingName || acc.name,
    number: acc.number ?? null,
    balance: acc.balance,
    currencyCode: acc.currencyCode,
    creditLimit: acc.creditData?.creditLimit ?? null,
    availableCreditLimit: acc.creditData?.availableCreditLimit ?? null,
    closeDate: toLocalDate(acc.creditData?.balanceCloseDate),
    dueDate: toLocalDate(acc.creditData?.balanceDueDate),
  }
}

export function normalizeItem(item: Item): DomainItem {
  return {
    id: item.id,
    institutionName: item.connector?.name ?? 'desconhecida',
    status: item.status,
    lastUpdatedAt: item.lastUpdatedAt ? new Date(item.lastUpdatedAt).toISOString() : null,
    consentExpiresAt: item.consentExpiresAt ? new Date(item.consentExpiresAt).toISOString() : null,
  }
}
