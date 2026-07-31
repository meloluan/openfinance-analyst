import type { Db } from './db.js'
import type { AccountKind, DomainAccount, DomainItem, DomainTransaction } from '../domain.js'

export type TxQuery = {
  from: string
  to: string
  accountIds?: string[]
  kind?: AccountKind
}

export type StoredItem = DomainItem & { lastSyncedAt: string | null }

const TX_COLUMNS = `
  t.id, t.account_id AS accountId, t.date, t.description, t.amount,
  t.currency_code AS currencyCode, t.category, t.merchant_name AS merchantName,
  t.installment_number AS installmentNumber, t.installment_total AS installmentTotal,
  t.bill_forecast_date AS billForecastDate, t.status, t.raw
`

/** Todo acesso a dado passa por aqui. Nenhum outro módulo escreve SQL. */
export class Repo {
  constructor(private db: Db) {}

  upsertItem(item: DomainItem, lastSyncedAt: string): void {
    this.db
      .prepare(
        `INSERT INTO items (id, institution_name, connector_id, status, last_updated_at, consent_expires_at, last_synced_at)
         VALUES (@id, @institutionName, @connectorId, @status, @lastUpdatedAt, @consentExpiresAt, @lastSyncedAt)
         ON CONFLICT(id) DO UPDATE SET
           institution_name = excluded.institution_name,
           connector_id = excluded.connector_id,
           status = excluded.status,
           last_updated_at = excluded.last_updated_at,
           consent_expires_at = excluded.consent_expires_at,
           last_synced_at = excluded.last_synced_at`,
      )
      .run({ ...item, lastSyncedAt })
  }

  upsertAccounts(accounts: DomainAccount[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO accounts (id, item_id, kind, name, number, balance, currency_code,
         credit_limit, available_credit_limit, close_date, due_date)
       VALUES (@id, @itemId, @kind, @name, @number, @balance, @currencyCode,
         @creditLimit, @availableCreditLimit, @closeDate, @dueDate)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         balance = excluded.balance,
         credit_limit = excluded.credit_limit,
         available_credit_limit = excluded.available_credit_limit,
         close_date = excluded.close_date,
         due_date = excluded.due_date`,
    )
    this.db.transaction((rows: DomainAccount[]) => {
      for (const row of rows) stmt.run(row)
    })(accounts)
  }

  /**
   * Upsert por id, nunca insert: transação muda depois de criada
   * (PENDING → POSTED, descrição enriquecida). Rodar o sync duas vezes
   * não pode duplicar nada.
   *
   * @returns quantas linhas eram realmente novas
   */
  upsertTransactions(txs: DomainTransaction[]): number {
    const now = new Date().toISOString()
    const stmt = this.db.prepare(
      `INSERT INTO transactions (id, account_id, date, description, amount, currency_code,
         category, merchant_name, installment_number, installment_total, bill_forecast_date,
         status, raw, synced_at)
       VALUES (@id, @accountId, @date, @description, @amount, @currencyCode,
         @category, @merchantName, @installmentNumber, @installmentTotal, @billForecastDate,
         @status, @raw, @syncedAt)
       ON CONFLICT(id) DO UPDATE SET
         date = excluded.date,
         description = excluded.description,
         amount = excluded.amount,
         category = excluded.category,
         merchant_name = excluded.merchant_name,
         installment_number = excluded.installment_number,
         installment_total = excluded.installment_total,
         bill_forecast_date = excluded.bill_forecast_date,
         status = excluded.status,
         raw = excluded.raw,
         synced_at = excluded.synced_at`,
    )

    const before = this.countTransactions()
    this.db.transaction((rows: DomainTransaction[]) => {
      for (const row of rows) stmt.run({ ...row, syncedAt: now })
    })(txs)
    return this.countTransactions() - before
  }

  private countTransactions(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM transactions').get() as { c: number }
    return row.c
  }

  queryTransactions(q: TxQuery): DomainTransaction[] {
    let sql = `SELECT ${TX_COLUMNS}
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      WHERE t.date >= ? AND t.date <= ?`
    const params: unknown[] = [q.from, q.to]

    if (q.kind) {
      sql += ' AND a.kind = ?'
      params.push(q.kind)
    }
    if (q.accountIds && q.accountIds.length > 0) {
      sql += ` AND t.account_id IN (${q.accountIds.map(() => '?').join(',')})`
      params.push(...q.accountIds)
    }

    return this.db.prepare(sql + ' ORDER BY t.date DESC, t.id').all(...params) as DomainTransaction[]
  }

  searchTransactions(term: string, limit: number): DomainTransaction[] {
    return this.db
      .prepare(
        `SELECT ${TX_COLUMNS}
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id
         WHERE t.description LIKE ? COLLATE NOCASE OR t.merchant_name LIKE ? COLLATE NOCASE
         ORDER BY t.date DESC LIMIT ?`,
      )
      .all(`%${term}%`, `%${term}%`, limit) as DomainTransaction[]
  }

  listAccounts(): DomainAccount[] {
    return this.db
      .prepare(
        `SELECT id, item_id AS itemId, kind, name, number, balance,
           currency_code AS currencyCode, credit_limit AS creditLimit,
           available_credit_limit AS availableCreditLimit,
           close_date AS closeDate, due_date AS dueDate
         FROM accounts ORDER BY kind, name`,
      )
      .all() as DomainAccount[]
  }

  listItems(): StoredItem[] {
    return this.db
      .prepare(
        `SELECT id, institution_name AS institutionName, connector_id AS connectorId, status,
           last_updated_at AS lastUpdatedAt, consent_expires_at AS consentExpiresAt,
           last_synced_at AS lastSyncedAt
         FROM items ORDER BY institution_name`,
      )
      .all() as StoredItem[]
  }

  getWatermark(itemId: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(`watermark:${itemId}`) as
      | { value: string }
      | undefined
    return row?.value ?? null
  }

  setWatermark(itemId: string, date: string): void {
    this.db
      .prepare(
        `INSERT INTO meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(`watermark:${itemId}`, date)
  }

  addOverride(pattern: string, category: string): void {
    this.db
      .prepare('INSERT INTO category_overrides (pattern, category, created_at) VALUES (?, ?, ?)')
      .run(pattern, category, new Date().toISOString())
  }

  listOverrides(): { pattern: string; category: string }[] {
    return this.db.prepare('SELECT pattern, category FROM category_overrides ORDER BY id').all() as {
      pattern: string
      category: string
    }[]
  }

  setBudget(category: string, amount: number): void {
    this.db
      .prepare(
        `INSERT INTO budgets (category, amount, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(category) DO UPDATE SET amount = excluded.amount, updated_at = excluded.updated_at`,
      )
      .run(category, amount, new Date().toISOString())
  }

  listBudgets(): { category: string; amount: number }[] {
    return this.db.prepare('SELECT category, amount FROM budgets ORDER BY category').all() as {
      category: string
      amount: number
    }[]
  }
}
