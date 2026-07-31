import { PluggyClient } from 'pluggy-sdk'
import type { AccountKind, DomainAccount, DomainItem, DomainTransaction } from '../domain.js'
import { normalizeAccount, normalizeItem, normalizeTransaction } from './normalize.js'

const RETRIABLE_STATUS = new Set([429, 500, 502, 503, 504])

function statusOf(err: unknown): number | undefined {
  const e = err as { status?: number; response?: { status?: number } } | null
  return e?.status ?? e?.response?.status
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const status = statusOf(err)
      if (status === undefined || !RETRIABLE_STATUS.has(status) || i === attempts - 1) throw err
      await new Promise((r) => setTimeout(r, 2 ** i * 500))
    }
  }
  throw lastErr
}

/**
 * Interface que o `sync` consome. Declarada aqui para que o teste possa
 * substituir a rede sem depender da classe concreta.
 */
export type Gateway = {
  fetchItem(id: string): Promise<DomainItem>
  fetchAccounts(itemId: string): Promise<DomainAccount[]>
  fetchTransactions(accountId: string, kind: AccountKind, since: string): Promise<DomainTransaction[]>
}

export class PluggyGateway implements Gateway {
  private client: PluggyClient

  constructor(clientId: string, clientSecret: string) {
    this.client = new PluggyClient({ clientId, clientSecret })
  }

  async fetchItem(id: string): Promise<DomainItem> {
    return normalizeItem(await withRetry(() => this.client.fetchItem(id)))
  }

  async fetchAccounts(itemId: string): Promise<DomainAccount[]> {
    const page = await withRetry(() => this.client.fetchAccounts(itemId))
    return page.results.map(normalizeAccount)
  }

  /** `since` em 'YYYY-MM-DD'. fetchAllTransactions já resolve a paginação por cursor. */
  async fetchTransactions(
    accountId: string,
    kind: AccountKind,
    since: string,
  ): Promise<DomainTransaction[]> {
    const txs = await withRetry(() =>
      this.client.fetchAllTransactions(accountId, { dateFrom: since }),
    )
    return txs.map((tx) => normalizeTransaction(tx, kind))
  }
}
