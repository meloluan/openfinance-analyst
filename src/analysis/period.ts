import type { Period } from '../domain.js'

const TZ = 'America/Sao_Paulo'
const MONTH_RE = /^\d{4}-\d{2}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 'YYYY-MM-DD' de hoje no fuso de São Paulo. */
export function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export function monthOf(date: string): string {
  return date.slice(0, 7)
}

/**
 * Aritmética de mês sobre string 'YYYY-MM', sem passar por `Date` —
 * `Date` reintroduziria bug de fuso justamente no que estamos tentando evitar.
 */
export function addMonths(month: string, n: number): string {
  const year = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  const total = year * 12 + (m - 1) + n
  const newYear = Math.floor(total / 12)
  const newMonth = (total % 12) + 1
  return `${String(newYear).padStart(4, '0')}-${String(newMonth).padStart(2, '0')}`
}

/** Último dia do mês, respeitando ano bissexto. */
export function lastDayOfMonth(month: string): number {
  const year = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  return new Date(Date.UTC(year, m, 0)).getUTCDate()
}

/** Dias entre duas datas 'YYYY-MM-DD', inclusive nas duas pontas. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  return Math.floor((b - a) / 86_400_000) + 1
}

export type PeriodInput = { period?: string; from?: string; to?: string }

/**
 * Aceita 'YYYY-MM' (expande para o mês inteiro) ou o par from/to.
 * Default: mês corrente. `now` existe para o teste não depender do relógio.
 */
export function resolvePeriod(input: PeriodInput, now: string = today()): Period {
  if (input.from && input.to) {
    for (const d of [input.from, input.to]) {
      if (!DATE_RE.test(d)) throw new Error(`Data inválida: "${d}". Use YYYY-MM-DD.`)
    }
    return { from: input.from, to: input.to }
  }

  const month = input.period ?? monthOf(now)
  if (!MONTH_RE.test(month)) {
    throw new Error(`Período inválido: "${month}". Use YYYY-MM ou o par from/to.`)
  }
  return { from: `${month}-01`, to: `${month}-${String(lastDayOfMonth(month)).padStart(2, '0')}` }
}
