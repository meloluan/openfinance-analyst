import type { DomainTransaction } from '../domain.js'
import { median, round2 } from './spending.js'

export type Cadence = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'YEARLY'

export type Recurring = {
  merchant: string
  cadence: Cadence
  /** valor típico (mediana), positivo */
  amount: number
  lastDate: string
  lastAmount: number
  occurrences: number
  /** última cobrança passou a mediana das anteriores em mais de 5% */
  priceIncrease: boolean
}

const MIN_OCCURRENCES = 3
const MAX_AMOUNT_VARIATION = 0.15
const PRICE_INCREASE_THRESHOLD = 1.05
const DAY_TOLERANCE = 4

const CADENCES: { name: Cadence; days: number }[] = [
  { name: 'WEEKLY', days: 7 },
  { name: 'BIWEEKLY', days: 14 },
  { name: 'MONTHLY', days: 30 },
  { name: 'YEARLY', days: 365 },
]

/**
 * Chave de agrupamento: "UBER *TRIP 1234" e "UBER *TRIP 5678" são a mesma
 * assinatura. Tira dígitos e pontuação, colapsa espaço.
 */
export function normalizeMerchant(tx: DomainTransaction): string {
  return (tx.merchantName ?? tx.description)
    .toUpperCase()
    .replace(/[0-9]+/g, ' ')
    .replace(/[^A-ZÀ-Ú ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const daysApart = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

function classifyCadence(intervals: number[]): Cadence | null {
  const m = median(intervals)
  const match = CADENCES.find((c) => Math.abs(m - c.days) <= DAY_TOLERANCE)
  return match?.name ?? null
}

/**
 * Detecta assinaturas e cobranças recorrentes.
 *
 * Regras (do spec): ≥3 ocorrências, só gastos, intervalo mediano casando com
 * uma cadência conhecida dentro de ±4 dias, e variação de valor ≤15%.
 */
export function findRecurring(txs: DomainTransaction[]): Recurring[] {
  const groups = new Map<string, DomainTransaction[]>()
  for (const tx of txs) {
    // Compra em 12x tem a cara exata de uma assinatura mensal: mesmo lojista,
    // mesmo valor, todo mês. Mas é uma compra só, e acaba. Parcelamento é
    // assunto do installments_outlook.
    if (tx.installmentTotal !== null) continue

    const key = normalizeMerchant(tx)
    if (!key) continue
    const group = groups.get(key)
    if (group) group.push(tx)
    else groups.set(key, [tx])
  }

  const found: Recurring[] = []

  for (const [merchant, group] of groups) {
    if (group.length < MIN_OCCURRENCES) continue
    // Entrada não é assinatura: salário recorrente não deve virar "cobrança".
    if (group.some((tx) => tx.amount >= 0)) continue

    const ordered = [...group].sort((a, b) => a.date.localeCompare(b.date))
    const amounts = ordered.map((tx) => Math.abs(tx.amount))

    const min = Math.min(...amounts)
    const max = Math.max(...amounts)
    const mean = amounts.reduce((s, v) => s + v, 0) / amounts.length
    if (mean === 0 || (max - min) / mean > MAX_AMOUNT_VARIATION) continue

    const intervals = ordered
      .slice(1)
      .map((tx, i) => daysApart(ordered[i]!.date, tx.date))
    const cadence = classifyCadence(intervals)
    if (!cadence) continue

    const last = ordered[ordered.length - 1]!
    const lastAmount = Math.abs(last.amount)
    const previousMedian = median(amounts.slice(0, -1))

    found.push({
      merchant,
      cadence,
      amount: round2(median(amounts)),
      lastDate: last.date,
      lastAmount: round2(lastAmount),
      occurrences: ordered.length,
      priceIncrease: previousMedian > 0 && lastAmount > previousMedian * PRICE_INCREASE_THRESHOLD,
    })
  }

  return found.sort((a, b) => b.amount - a.amount)
}
