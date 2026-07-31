import type { DomainTransaction } from '../domain.js'

export type Override = { pattern: string; category: string }

export const UNCATEGORIZED = 'Sem categoria'

/**
 * Categoria efetiva de uma transação.
 *
 * A categoria do agregador erra feio em caso pessoal ("PIX pro João" não é
 * categoria), então o override do usuário sempre vence. A primeira regra
 * cadastrada que casar ganha — ordem de criação é a precedência.
 */
export function applyOverrides(tx: DomainTransaction, overrides: Override[]): string {
  const haystack = `${tx.merchantName ?? ''} ${tx.description}`.toUpperCase()
  for (const o of overrides) {
    if (haystack.includes(o.pattern.toUpperCase())) return o.category
  }
  return tx.category ?? UNCATEGORIZED
}
