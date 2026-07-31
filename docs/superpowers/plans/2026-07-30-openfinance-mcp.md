# openfinance-analyst Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um MCP server que consolida conta corrente e cartão de crédito de várias instituições via Open Finance (Pluggy/Meu Pluggy) e responde perguntas de gasto com números agregados.

**Architecture:** Quatro módulos isolados. `pluggy/` fala HTTP e normaliza para tipos do domínio; `store/` persiste em SQLite cifrado; `analysis/` é puro e faz as agregações; `mcp/` expõe as tools. O `sync` grava; as tools de análise só leem do store.

**Tech Stack:** Node 26, TypeScript, `pluggy-sdk` 0.90, `@modelcontextprotocol/sdk` 1.30, `better-sqlite3-multiple-ciphers` 12.11 (SQLCipher), `zod` 4.4, `vitest` 4.1.

## Global Constraints

- **Somente leitura.** Nenhuma tool inicia pagamento. O `paymentsClient` do SDK nunca é usado.
- **Uso pessoal, um CPF.** É o limite do Meu Pluggy gratuito.
- **Convenção de sinal:** gasto sempre negativo, entrada sempre positiva, aplicada na normalização. Cartão de crédito na Pluggy usa a convenção **inversa** (positivo = nova compra), logo `type: 'CREDIT'` tem o sinal invertido na entrada.
- **Fuso:** todo agrupamento por mês usa `America/Sao_Paulo`.
- **Período:** tools aceitam `YYYY-MM` ou par `from`/`to` ISO date. Default: mês corrente.
- **Segredo nunca vaza:** token e `client_secret` jamais em log ou mensagem de erro.
- **Banco cifrado** com chave no Keychain do macOS, arquivo `600` em `~/.openfinance-analyst/`.

---

## File Structure

```
src/
  config.ts              lê env, valida, resolve paths.  Sem I/O de rede.
  domain.ts              tipos do domínio: DomainAccount, DomainTransaction, DomainItem, SyncReport
  pluggy/
    normalize.ts         Pluggy → domínio. Onde mora a convenção de sinal. PURO.
    client.ts            wrapper do PluggyClient: retry, backoff, fetch de item/contas/transações
  store/
    key.ts               chave SQLCipher via Keychain do macOS (`security` CLI)
    schema.ts            DDL + migrations versionadas
    db.ts                abre o banco cifrado, aplica migrations
    repo.ts              upsert idempotente + queries de leitura
  analysis/
    period.ts            parsing de período e bucketing mensal em America/Sao_Paulo. PURO.
    categories.ts        aplica category_overrides sobre a categoria da Pluggy. PURO.
    spending.ts          agregação por categoria/mês + comparação de períodos. PURO.
    recurring.ts         detecção de assinaturas. PURO.
    installments.ts      projeção de parcelas futuras. PURO.
    budget.ts            realizado vs meta + projeção de fim de mês. PURO.
    bill.ts              composição de fatura de cartão. PURO.
  sync.ts                orquestra pluggy → store, monta SyncReport
  mcp/
    server.ts            registra as tools, stdio transport
    tools.ts             schemas zod + handlers finos
  index.ts               entrypoint
tests/                   espelha src/
```

`analysis/` nunca importa de `pluggy/` nem de `store/` — recebe arrays de `DomainTransaction`. É o que torna o teste barato.

---

### Task 1: Scaffold, config e tipos do domínio

**Files:**
- Create: `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`
- Create: `src/domain.ts`, `src/config.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Produces: `DomainTransaction`, `DomainAccount`, `DomainItem`, `SyncReport`, `loadConfig(): Config`

- [ ] **Step 1: `.gitignore` primeiro** — antes de qualquer código, para não versionar segredo nem dado real.

```
node_modules/
dist/
.env
*.db
tests/**/fixtures/real-*
```

- [ ] **Step 2: `tsconfig.json`** — ESM, strict.

```json
{
  "compilerOptions": {
    "target": "ES2023", "module": "Node16", "moduleResolution": "Node16",
    "strict": true, "esModuleInterop": true, "skipLibCheck": true,
    "outDir": "dist", "rootDir": "src", "declaration": false
  },
  "include": ["src/**/*"]
}
```

Adicionar `"type": "module"` ao `package.json` e os scripts `build` (`tsc`), `test` (`vitest run`), `dev` (`tsx src/index.ts`).

- [ ] **Step 3: `src/domain.ts`** — os tipos que atravessam os módulos.

```ts
export type AccountKind = 'BANK' | 'CREDIT'

export type DomainAccount = {
  id: string; itemId: string; kind: AccountKind
  name: string; number: string | null
  balance: number; currencyCode: string
  creditLimit: number | null; availableCreditLimit: number | null
  closeDate: string | null   // YYYY-MM-DD
  dueDate: string | null     // YYYY-MM-DD
}

export type DomainTransaction = {
  id: string; accountId: string
  date: string               // YYYY-MM-DD em America/Sao_Paulo
  description: string
  amount: number             // gasto negativo, entrada positiva — SEMPRE
  currencyCode: string
  category: string | null    // categoria da Pluggy, antes de overrides
  merchantName: string | null
  installmentNumber: number | null
  installmentTotal: number | null
  billForecastDate: string | null  // YYYY-MM
  status: 'PENDING' | 'POSTED'
  raw: string                // JSON cru, para reprocessar sem re-sync
}

export type DomainItem = {
  id: string; institutionName: string; status: string
  lastUpdatedAt: string | null; consentExpiresAt: string | null
}

export type ConnectionHealth = {
  itemId: string; institutionName: string; status: string
  healthy: boolean; staleSince: string | null; warning: string | null
}

export type SyncReport = {
  connections: ConnectionHealth[]
  newTransactions: Record<string, number>  // institutionName → contagem
  errors: string[]
}
```

- [ ] **Step 4: Teste de config falhando**

```ts
import { describe, it, expect } from 'vitest'
import { parseConfig } from '../src/config.js'

describe('parseConfig', () => {
  it('exige clientId e clientSecret', () => {
    expect(() => parseConfig({})).toThrow(/PLUGGY_CLIENT_ID/)
  })

  it('parseia itemIds separados por vírgula, ignorando espaço', () => {
    const c = parseConfig({
      PLUGGY_CLIENT_ID: 'a', PLUGGY_CLIENT_SECRET: 'b',
      PLUGGY_ITEM_IDS: 'i1, i2 ,i3',
    })
    expect(c.itemIds).toEqual(['i1', 'i2', 'i3'])
  })

  it('nunca inclui o secret na mensagem de erro', () => {
    try { parseConfig({ PLUGGY_CLIENT_SECRET: 'super-secreto' }) }
    catch (e) { expect(String(e)).not.toContain('super-secreto') }
  })
})
```

- [ ] **Step 5: Rodar e ver falhar** — `npx vitest run tests/config.test.ts`. Esperado: falha por módulo inexistente.

- [ ] **Step 6: Implementar `src/config.ts`**

```ts
import { homedir } from 'node:os'
import { join } from 'node:path'

export type Config = {
  clientId: string; clientSecret: string; itemIds: string[]
  dataDir: string; dbPath: string
}

export function parseConfig(env: Record<string, string | undefined>): Config {
  const clientId = env.PLUGGY_CLIENT_ID?.trim()
  const clientSecret = env.PLUGGY_CLIENT_SECRET?.trim()
  const missing: string[] = []
  if (!clientId) missing.push('PLUGGY_CLIENT_ID')
  if (!clientSecret) missing.push('PLUGGY_CLIENT_SECRET')
  if (missing.length) {
    throw new Error(
      `Faltando ${missing.join(' e ')}. Pegue as credenciais em dashboard.pluggy.ai ` +
      `(crie uma aplicação) depois de conectar seus bancos em meu.pluggy.ai.`,
    )
  }
  const dataDir = env.OFA_DATA_DIR?.trim() || join(homedir(), '.openfinance-analyst')
  return {
    clientId: clientId!, clientSecret: clientSecret!,
    itemIds: (env.PLUGGY_ITEM_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean),
    dataDir, dbPath: join(dataDir, 'data.db'),
  }
}

export const loadConfig = () => parseConfig(process.env)
```

A mensagem lista o que falta e o caminho para resolver, sem nunca ecoar valor de variável.

- [ ] **Step 7: Rodar até passar** — `npx vitest run tests/config.test.ts`. Esperado: 3 passando.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: scaffold, domain types and config"
```

---

### Task 2: `pluggy/` — normalização e cliente

**Files:**
- Create: `src/pluggy/normalize.ts`, `src/pluggy/client.ts`
- Test: `tests/pluggy/normalize.test.ts`

**Interfaces:**
- Consumes: `DomainTransaction`, `DomainAccount`, `DomainItem` de `src/domain.ts`
- Produces:
  - `normalizeTransaction(tx: Transaction, accountKind: AccountKind): DomainTransaction`
  - `normalizeAccount(acc: Account): DomainAccount`
  - `normalizeItem(item: Item): DomainItem`
  - `class PluggyGateway { fetchItem(id); fetchAccounts(itemId); fetchTransactions(accountId, kind, since) }`

Esta é a task mais importante do plano: **é onde o sinal é decidido**. Errar aqui contamina todo número que o MCP produzir.

- [ ] **Step 1: Teste da convenção de sinal (o coração)**

```ts
import { describe, it, expect } from 'vitest'
import { normalizeTransaction } from '../../src/pluggy/normalize.js'

const base = {
  id: 't1', accountId: 'a1', date: new Date('2026-06-15T12:00:00Z'),
  description: 'IFOOD', descriptionRaw: null, balance: 0, currencyCode: 'BRL',
  category: 'Food', categoryId: 'f1', creditCardMetadata: null,
  operationType: null, operationTypeAdditionalInfo: null, providerId: null,
  amountInAccountCurrency: null, createdAt: new Date(), updatedAt: new Date(),
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
})

describe('campos derivados', () => {
  it('extrai parcelas do creditCardMetadata', () => {
    const t = normalizeTransaction({
      ...base, type: 'DEBIT', amount: 100,
      creditCardMetadata: { installmentNumber: 3, totalInstallments: 12, billForecastDate: '2026-07' },
    }, 'CREDIT')
    expect(t.installmentNumber).toBe(3)
    expect(t.installmentTotal).toBe(12)
    expect(t.billForecastDate).toBe('2026-07')
  })

  it('data vira YYYY-MM-DD em America/Sao_Paulo, não em UTC', () => {
    // 2026-07-01T02:00Z é ainda 30/06 em São Paulo (UTC-3)
    const t = normalizeTransaction({ ...base, date: new Date('2026-07-01T02:00:00Z'), type: 'DEBIT', amount: -10 }, 'BANK')
    expect(t.date).toBe('2026-06-30')
  })

  it('guarda o payload cru para reprocessamento', () => {
    const t = normalizeTransaction({ ...base, type: 'DEBIT', amount: -10 }, 'BANK')
    expect(JSON.parse(t.raw).id).toBe('t1')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run tests/pluggy/normalize.test.ts`. Esperado: módulo não encontrado.

- [ ] **Step 3: Implementar `src/pluggy/normalize.ts`**

```ts
import type { Account, Item, Transaction } from 'pluggy-sdk'
import type { AccountKind, DomainAccount, DomainItem, DomainTransaction } from '../domain.js'

const TZ = 'America/Sao_Paulo'

/** Date → 'YYYY-MM-DD' no fuso de São Paulo. en-CA já formata como YYYY-MM-DD. */
export function toLocalDate(d: Date | string | null): string | null {
  if (!d) return null
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
}

/**
 * Cartão de crédito na Pluggy usa sinal INVERTIDO: positivo = nova compra.
 * Conta corrente usa o natural: negativo = saída.
 * Aqui tudo converge para: gasto negativo, entrada positiva.
 */
export function normalizeAmount(amount: number, kind: AccountKind): number {
  const normalized = kind === 'CREDIT' ? -amount : amount
  return normalized === 0 ? 0 : normalized  // evita -0
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
    id: acc.id, itemId: acc.itemId, kind: acc.type,
    name: acc.marketingName || acc.name, number: acc.number ?? null,
    balance: acc.balance, currencyCode: acc.currencyCode,
    creditLimit: acc.creditData?.creditLimit ?? null,
    availableCreditLimit: acc.creditData?.availableCreditLimit ?? null,
    closeDate: toLocalDate(acc.creditData?.balanceCloseDate ?? null),
    dueDate: toLocalDate(acc.creditData?.balanceDueDate ?? null),
  }
}

export function normalizeItem(item: Item): DomainItem {
  return {
    id: item.id,
    institutionName: item.connector?.name ?? 'desconhecida',
    status: item.status,
    lastUpdatedAt: item.lastUpdatedAt ? item.lastUpdatedAt.toISOString() : null,
    consentExpiresAt: item.consentExpiresAt ? item.consentExpiresAt.toISOString() : null,
  }
}
```

- [ ] **Step 4: Rodar até passar** — `npx vitest run tests/pluggy/normalize.test.ts`. Esperado: 7 passando.

- [ ] **Step 5: Implementar `src/pluggy/client.ts`** — sem teste de rede; a lógica testável está em `normalize`.

```ts
import { PluggyClient } from 'pluggy-sdk'
import type { AccountKind, DomainAccount, DomainItem, DomainTransaction } from '../domain.js'
import { normalizeAccount, normalizeItem, normalizeTransaction } from './normalize.js'

const RETRIABLE = new Set([429, 500, 502, 503, 504])

async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try { return await fn() } catch (err: any) {
      lastErr = err
      const status = err?.status ?? err?.response?.status
      if (!RETRIABLE.has(status) || i === attempts - 1) throw err
      await new Promise(r => setTimeout(r, 2 ** i * 500))
    }
  }
  throw lastErr
}

export class PluggyGateway {
  private client: PluggyClient
  constructor(clientId: string, clientSecret: string) {
    this.client = new PluggyClient({ clientId, clientSecret })
  }

  fetchItem = (id: string): Promise<DomainItem> =>
    withRetry(() => this.client.fetchItem(id)).then(normalizeItem)

  fetchAccounts = (itemId: string): Promise<DomainAccount[]> =>
    withRetry(() => this.client.fetchAccounts(itemId)).then(r => r.results.map(normalizeAccount))

  /** `since` em 'YYYY-MM-DD'. fetchAllTransactions já resolve a paginação por cursor. */
  fetchTransactions = (accountId: string, kind: AccountKind, since: string): Promise<DomainTransaction[]> =>
    withRetry(() => this.client.fetchAllTransactions(accountId, { dateFrom: since }))
      .then(txs => txs.map(tx => normalizeTransaction(tx, kind)))
}
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(pluggy): normalization with sign convention and gateway"
```

---

### Task 3: `store/` — SQLite cifrado e upsert idempotente

**Files:**
- Create: `src/store/key.ts`, `src/store/schema.ts`, `src/store/db.ts`, `src/store/repo.ts`
- Test: `tests/store/repo.test.ts`

**Interfaces:**
- Consumes: tipos de `src/domain.ts`
- Produces:
  - `openDb(path: string, key: string): Database`
  - `getOrCreateKey(): string`
  - `class Repo` com `upsertItem`, `upsertAccounts`, `upsertTransactions`, `listAccounts`, `listItems`, `queryTransactions`, `getWatermark`, `setWatermark`, `addOverride`, `listOverrides`, `setBudget`, `listBudgets`

- [ ] **Step 1: Teste de idempotência (o que mais importa)**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { openDb } from '../../src/store/db.js'
import { Repo } from '../../src/store/repo.js'
import type { DomainTransaction } from '../../src/domain.js'

const tx = (over: Partial<DomainTransaction> = {}): DomainTransaction => ({
  id: 't1', accountId: 'a1', date: '2026-06-15', description: 'IFOOD',
  amount: -50, currencyCode: 'BRL', category: 'Food', merchantName: 'iFood',
  installmentNumber: null, installmentTotal: null, billForecastDate: null,
  status: 'POSTED', raw: '{}', ...over,
})

describe('Repo.upsertTransactions', () => {
  let repo: Repo
  beforeEach(() => { repo = new Repo(openDb(':memory:', 'test-key')) })

  it('sincronizar duas vezes não duplica', () => {
    repo.upsertTransactions([tx()])
    repo.upsertTransactions([tx()])
    expect(repo.queryTransactions({ from: '2026-06-01', to: '2026-06-30' })).toHaveLength(1)
  })

  it('atualiza PENDING para POSTED no lugar de inserir de novo', () => {
    repo.upsertTransactions([tx({ status: 'PENDING', description: 'COMPRA PENDENTE' })])
    repo.upsertTransactions([tx({ status: 'POSTED', description: 'IFOOD *PEDIDO' })])
    const rows = repo.queryTransactions({ from: '2026-06-01', to: '2026-06-30' })
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('POSTED')
    expect(rows[0].description).toBe('IFOOD *PEDIDO')
  })

  it('preserva o sinal negativo ao passar pelo banco', () => {
    repo.upsertTransactions([tx({ amount: -50 })])
    expect(repo.queryTransactions({ from: '2026-06-01', to: '2026-06-30' })[0].amount).toBe(-50)
  })
})

describe('Repo watermark', () => {
  it('devolve null quando nunca sincronizou e persiste depois', () => {
    const repo = new Repo(openDb(':memory:', 'k'))
    expect(repo.getWatermark('item-1')).toBeNull()
    repo.setWatermark('item-1', '2026-06-01')
    expect(repo.getWatermark('item-1')).toBe('2026-06-01')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run tests/store/`.

- [ ] **Step 3: `src/store/schema.ts`** — DDL com migrations versionadas.

```ts
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE items (
    id TEXT PRIMARY KEY, institution_name TEXT NOT NULL, status TEXT NOT NULL,
    last_updated_at TEXT, consent_expires_at TEXT, last_synced_at TEXT
  );
  CREATE TABLE accounts (
    id TEXT PRIMARY KEY, item_id TEXT NOT NULL, kind TEXT NOT NULL,
    name TEXT NOT NULL, number TEXT, balance REAL NOT NULL, currency_code TEXT NOT NULL,
    credit_limit REAL, available_credit_limit REAL, close_date TEXT, due_date TEXT
  );
  CREATE TABLE transactions (
    id TEXT PRIMARY KEY, account_id TEXT NOT NULL, date TEXT NOT NULL,
    description TEXT NOT NULL, amount REAL NOT NULL, currency_code TEXT NOT NULL,
    category TEXT, merchant_name TEXT,
    installment_number INTEGER, installment_total INTEGER, bill_forecast_date TEXT,
    status TEXT NOT NULL, raw TEXT NOT NULL, synced_at TEXT NOT NULL
  );
  CREATE INDEX idx_tx_date ON transactions(date);
  CREATE INDEX idx_tx_account ON transactions(account_id);
  CREATE TABLE category_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT, pattern TEXT NOT NULL,
    category TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE budgets (category TEXT PRIMARY KEY, amount REAL NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
]
```

- [ ] **Step 4: `src/store/db.ts`** — abre cifrado e aplica migrations.

```ts
import Database from 'better-sqlite3-multiple-ciphers'
import { MIGRATIONS } from './schema.js'

export type Db = Database.Database

export function openDb(path: string, key: string): Db {
  const db = new Database(path)
  db.pragma(`key='${key.replace(/'/g, "''")}'`)   // SQLCipher
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  const current = db.pragma('user_version', { simple: true }) as number
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec(MIGRATIONS[v])
    db.pragma(`user_version = ${v + 1}`)
  }
  return db
}
```

Migration é idempotente por `user_version`: banco novo aplica tudo, banco existente aplica só o que falta.

- [ ] **Step 5: `src/store/key.ts`** — chave no Keychain, nunca em arquivo.

```ts
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const SERVICE = 'openfinance-analyst'
const ACCOUNT = 'sqlcipher-key'

export function getOrCreateKey(): string {
  try {
    return execFileSync('/usr/bin/security',
      ['find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    const key = randomBytes(32).toString('hex')
    execFileSync('/usr/bin/security',
      ['add-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w', key],
      { stdio: 'ignore' })
    return key
  }
}
```

`execFileSync` com array de argumentos, nunca string interpolada em shell — a chave não passa por `sh` e não vaza em `ps`.

- [ ] **Step 6: `src/store/repo.ts`** — todo acesso a dado passa por aqui.

```ts
import type { Db } from './db.js'
import type { DomainAccount, DomainItem, DomainTransaction } from '../domain.js'

export type TxQuery = { from: string; to: string; accountIds?: string[]; kind?: 'BANK' | 'CREDIT' }

export class Repo {
  constructor(private db: Db) {}

  upsertItem(item: DomainItem, lastSyncedAt: string): void {
    this.db.prepare(`
      INSERT INTO items (id, institution_name, status, last_updated_at, consent_expires_at, last_synced_at)
      VALUES (@id, @institutionName, @status, @lastUpdatedAt, @consentExpiresAt, @lastSyncedAt)
      ON CONFLICT(id) DO UPDATE SET
        institution_name=excluded.institution_name, status=excluded.status,
        last_updated_at=excluded.last_updated_at, consent_expires_at=excluded.consent_expires_at,
        last_synced_at=excluded.last_synced_at
    `).run({ ...item, lastSyncedAt })
  }

  upsertAccounts(accounts: DomainAccount[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO accounts (id, item_id, kind, name, number, balance, currency_code,
        credit_limit, available_credit_limit, close_date, due_date)
      VALUES (@id, @itemId, @kind, @name, @number, @balance, @currencyCode,
        @creditLimit, @availableCreditLimit, @closeDate, @dueDate)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, balance=excluded.balance, credit_limit=excluded.credit_limit,
        available_credit_limit=excluded.available_credit_limit,
        close_date=excluded.close_date, due_date=excluded.due_date
    `)
    this.db.transaction((rows: DomainAccount[]) => rows.forEach(r => stmt.run(r)))(accounts)
  }

  /** Upsert por id: transação muda (PENDING→POSTED, descrição enriquecida). Nunca duplica. */
  upsertTransactions(txs: DomainTransaction[]): number {
    const now = new Date().toISOString()
    const stmt = this.db.prepare(`
      INSERT INTO transactions (id, account_id, date, description, amount, currency_code,
        category, merchant_name, installment_number, installment_total, bill_forecast_date,
        status, raw, synced_at)
      VALUES (@id, @accountId, @date, @description, @amount, @currencyCode,
        @category, @merchantName, @installmentNumber, @installmentTotal, @billForecastDate,
        @status, @raw, @syncedAt)
      ON CONFLICT(id) DO UPDATE SET
        date=excluded.date, description=excluded.description, amount=excluded.amount,
        category=excluded.category, merchant_name=excluded.merchant_name,
        installment_number=excluded.installment_number, installment_total=excluded.installment_total,
        bill_forecast_date=excluded.bill_forecast_date, status=excluded.status,
        raw=excluded.raw, synced_at=excluded.synced_at
    `)
    const before = this.count()
    this.db.transaction((rows: DomainTransaction[]) =>
      rows.forEach(r => stmt.run({ ...r, syncedAt: now })))(txs)
    return this.count() - before
  }

  private count(): number {
    return this.db.prepare('SELECT COUNT(*) AS c FROM transactions').get() as any as number
      ?? 0
  }

  queryTransactions(q: TxQuery): DomainTransaction[] {
    let sql = `SELECT t.id, t.account_id AS accountId, t.date, t.description, t.amount,
      t.currency_code AS currencyCode, t.category, t.merchant_name AS merchantName,
      t.installment_number AS installmentNumber, t.installment_total AS installmentTotal,
      t.bill_forecast_date AS billForecastDate, t.status, t.raw
      FROM transactions t JOIN accounts a ON a.id = t.account_id
      WHERE t.date >= ? AND t.date <= ?`
    const params: unknown[] = [q.from, q.to]
    if (q.kind) { sql += ' AND a.kind = ?'; params.push(q.kind) }
    if (q.accountIds?.length) {
      sql += ` AND t.account_id IN (${q.accountIds.map(() => '?').join(',')})`
      params.push(...q.accountIds)
    }
    return this.db.prepare(sql + ' ORDER BY t.date DESC').all(...params) as DomainTransaction[]
  }

  listAccounts(): DomainAccount[] {
    return this.db.prepare(`SELECT id, item_id AS itemId, kind, name, number, balance,
      currency_code AS currencyCode, credit_limit AS creditLimit,
      available_credit_limit AS availableCreditLimit, close_date AS closeDate, due_date AS dueDate
      FROM accounts`).all() as DomainAccount[]
  }

  listItems(): (DomainItem & { lastSyncedAt: string | null })[] {
    return this.db.prepare(`SELECT id, institution_name AS institutionName, status,
      last_updated_at AS lastUpdatedAt, consent_expires_at AS consentExpiresAt,
      last_synced_at AS lastSyncedAt FROM items`).all() as any
  }

  getWatermark(itemId: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(`watermark:${itemId}`) as
      { value: string } | undefined
    return row?.value ?? null
  }

  setWatermark(itemId: string, date: string): void {
    this.db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(`watermark:${itemId}`, date)
  }

  addOverride(pattern: string, category: string): void {
    this.db.prepare('INSERT INTO category_overrides (pattern, category, created_at) VALUES (?, ?, ?)')
      .run(pattern, category, new Date().toISOString())
  }

  listOverrides(): { pattern: string; category: string }[] {
    return this.db.prepare('SELECT pattern, category FROM category_overrides ORDER BY id').all() as any
  }

  setBudget(category: string, amount: number): void {
    this.db.prepare(`INSERT INTO budgets (category, amount, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(category) DO UPDATE SET amount=excluded.amount, updated_at=excluded.updated_at`)
      .run(category, amount, new Date().toISOString())
  }

  listBudgets(): { category: string; amount: number }[] {
    return this.db.prepare('SELECT category, amount FROM budgets').all() as any
  }
}
```

Atenção no `count()`: `better-sqlite3` devolve objeto, então o acesso correto é `(row as {c: number}).c`. Corrigir na implementação — o teste de idempotência pega isso.

- [ ] **Step 7: Rodar até passar** — `npx vitest run tests/store/`. Esperado: 4 passando.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(store): encrypted sqlite with idempotent upsert"
```

---

### Task 4: `analysis/` — agregações e heurísticas

**Files:**
- Create: `src/analysis/period.ts`, `categories.ts`, `spending.ts`, `recurring.ts`, `installments.ts`, `budget.ts`, `bill.ts`
- Test: `tests/analysis/*.test.ts`

**Interfaces:**
- Consumes: `DomainTransaction[]`
- Produces:
  - `resolvePeriod(input?: {period?: string; from?: string; to?: string}): {from: string; to: string}`
  - `applyOverrides(tx, overrides): string` → categoria efetiva
  - `spendingByCategory(txs, overrides): {category: string; total: number; count: number}[]`
  - `spendingByMonth(txs, overrides): {month: string; total: number}[]`
  - `comparePeriods(current, previous, overrides): {category, current, previous, delta, deltaPct}[]`
  - `findRecurring(txs): Recurring[]`
  - `installmentsOutlook(txs, months): {month: string; committed: number; items: {...}[]}[]`
  - `budgetStatus(txs, budgets, period, today): BudgetLine[]`
  - `billComposition(txs, billMonth, overrides): {...}`

- [ ] **Step 1: Testes das heurísticas** — as regras exatas do spec viram assert.

```ts
import { describe, it, expect } from 'vitest'
import { findRecurring } from '../../src/analysis/recurring.js'
import { installmentsOutlook } from '../../src/analysis/installments.js'
import { budgetStatus } from '../../src/analysis/budget.js'
import type { DomainTransaction } from '../../src/domain.js'

const tx = (o: Partial<DomainTransaction>): DomainTransaction => ({
  id: Math.random().toString(36), accountId: 'a1', date: '2026-06-15',
  description: 'X', amount: -10, currencyCode: 'BRL', category: null, merchantName: null,
  installmentNumber: null, installmentTotal: null, billForecastDate: null,
  status: 'POSTED', raw: '{}', ...o,
})

describe('findRecurring', () => {
  it('detecta assinatura mensal com variação de ±3 dias e ±5% no valor', () => {
    const txs = [
      tx({ date: '2026-04-10', amount: -55.90, merchantName: 'NETFLIX' }),
      tx({ date: '2026-05-13', amount: -55.90, merchantName: 'NETFLIX' }),
      tx({ date: '2026-06-11', amount: -57.90, merchantName: 'NETFLIX' }),
    ]
    const found = findRecurring(txs)
    expect(found).toHaveLength(1)
    expect(found[0].merchant).toBe('NETFLIX')
    expect(found[0].cadence).toBe('MONTHLY')
  })

  it('exige pelo menos 3 ocorrências', () => {
    expect(findRecurring([
      tx({ date: '2026-05-10', amount: -30, merchantName: 'SPOTIFY' }),
      tx({ date: '2026-06-10', amount: -30, merchantName: 'SPOTIFY' }),
    ])).toHaveLength(0)
  })

  it('marca priceIncrease quando a última supera a mediana anterior em mais de 5%', () => {
    const found = findRecurring([
      tx({ date: '2026-04-10', amount: -50, merchantName: 'HBO' }),
      tx({ date: '2026-05-10', amount: -50, merchantName: 'HBO' }),
      tx({ date: '2026-06-10', amount: -56, merchantName: 'HBO' }),
    ])
    expect(found[0].priceIncrease).toBe(true)
  })

  it('não marca aumento quando a variação está dentro de 5%', () => {
    const found = findRecurring([
      tx({ date: '2026-04-10', amount: -50, merchantName: 'HBO' }),
      tx({ date: '2026-05-10', amount: -50, merchantName: 'HBO' }),
      tx({ date: '2026-06-10', amount: -51, merchantName: 'HBO' }),
    ])
    expect(found[0].priceIncrease).toBe(false)
  })

  it('ignora entradas (salário não é assinatura)', () => {
    expect(findRecurring([
      tx({ date: '2026-04-05', amount: 5000, merchantName: 'ACME LTDA' }),
      tx({ date: '2026-05-05', amount: 5000, merchantName: 'ACME LTDA' }),
      tx({ date: '2026-06-05', amount: 5000, merchantName: 'ACME LTDA' }),
    ])).toHaveLength(0)
  })
})

describe('installmentsOutlook', () => {
  it('compra 3/12 projeta as 9 parcelas restantes', () => {
    const out = installmentsOutlook(
      [tx({ date: '2026-06-15', amount: -100, installmentNumber: 3, installmentTotal: 12,
            description: 'GELADEIRA' })],
      12, '2026-06',
    )
    const committed = out.filter(m => m.committed > 0)
    expect(committed).toHaveLength(9)
    expect(committed[0].month).toBe('2026-07')
    expect(committed[0].committed).toBe(100)
    expect(committed[8].month).toBe('2027-03')
  })

  it('ignora compra à vista', () => {
    const out = installmentsOutlook([tx({ amount: -100 })], 6, '2026-06')
    expect(out.every(m => m.committed === 0)).toBe(true)
  })

  it('parcela final não gera projeção', () => {
    const out = installmentsOutlook(
      [tx({ amount: -100, installmentNumber: 12, installmentTotal: 12 })], 6, '2026-06')
    expect(out.every(m => m.committed === 0)).toBe(true)
  })
})

describe('budgetStatus', () => {
  it('projeta o fim do mês pelo ritmo: 300 em 15 de 30 dias projeta 600', () => {
    const txs = [tx({ date: '2026-06-10', amount: -300, category: 'Food' })]
    const [line] = budgetStatus(txs, [{ category: 'Food', amount: 500 }],
      { from: '2026-06-01', to: '2026-06-30' }, '2026-06-15')
    expect(line.spent).toBe(300)
    expect(line.projected).toBe(600)
    expect(line.willExceed).toBe(true)
  })

  it('não estoura quando a projeção fica abaixo da meta', () => {
    const txs = [tx({ date: '2026-06-10', amount: -100, category: 'Food' })]
    const [line] = budgetStatus(txs, [{ category: 'Food', amount: 500 }],
      { from: '2026-06-01', to: '2026-06-30' }, '2026-06-15')
    expect(line.projected).toBe(200)
    expect(line.willExceed).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run tests/analysis/`.

- [ ] **Step 3: Implementar os módulos de análise.** Regras exatas, todas puras:

`period.ts` — `resolvePeriod` aceita `YYYY-MM` (expande para primeiro e último dia) ou `from`/`to`; default mês corrente em `America/Sao_Paulo`. Helpers `addMonths(month, n)` e `monthOf(date)` operando sobre string `YYYY-MM`, sem `Date`, para não reintroduzir bug de fuso.

`categories.ts` — `applyOverrides(tx, overrides)`: primeira regra cujo `pattern` (case-insensitive, substring) casa com `merchantName` ou `description` vence; senão `tx.category`; senão `'Sem categoria'`.

`spending.ts` — soma apenas `amount < 0`, reporta como valor **positivo** de gasto (o consumidor quer "gastei 500", não "-500"). `comparePeriods` alinha por categoria, com `delta` e `deltaPct` (`null` quando o anterior é zero, para não dividir por zero).

`recurring.ts` — agrupa por merchant normalizado (`merchantName ?? description`, upper, sem dígitos/pontuação); descarta grupos com <3 ocorrências ou com qualquer `amount > 0`; calcula os intervalos em dias entre datas ordenadas e tira a mediana; classifica em `WEEKLY` (7±4), `BIWEEKLY` (14±4), `MONTHLY` (30±4), `YEARLY` (365±4), senão descarta; exige variação de valor ≤15% (`(max-min)/média`); `priceIncrease = último > mediana(anteriores) * 1.05`.

`installments.ts` — para cada transação com `installmentNumber` e `installmentTotal` e `installmentNumber < installmentTotal`, gera `installmentTotal - installmentNumber` entradas a partir do mês seguinte ao da compra, cada uma com o mesmo valor absoluto.

`budget.ts` — `spent` = soma dos gastos da categoria efetiva no período; `projected = spent / diasDecorridos * diasDoPeríodo`, arredondado a 2 casas; `willExceed = projected > amount`. Quando `today` está fora do período, `projected = spent`.

`bill.ts` — agrupa por `billForecastDate` (ou o mês da data, se ausente), devolve total e composição por categoria efetiva.

- [ ] **Step 4: Rodar até passar** — `npx vitest run tests/analysis/`. Esperado: 10 passando.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(analysis): spending, recurring, installments and budget"
```

---

### Task 5: `sync.ts` e `mcp/` — orquestração e tools

**Files:**
- Create: `src/sync.ts`, `src/mcp/tools.ts`, `src/mcp/server.ts`, `src/index.ts`
- Test: `tests/sync.test.ts`

**Interfaces:**
- Consumes: `PluggyGateway`, `Repo`, tudo de `analysis/`
- Produces: `syncAll(gateway, repo, itemIds): Promise<SyncReport>`, `registerTools(server, ctx)`

- [ ] **Step 1: Teste do sync com gateway falso** — o que importa é a janela de re-sync e o relatório de saúde.

```ts
import { describe, it, expect } from 'vitest'
import { openDb } from '../src/store/db.js'
import { Repo } from '../src/store/repo.js'
import { syncAll } from '../src/sync.js'

const gateway = (status = 'UPDATED') => ({
  fetchItem: async (id: string) => ({
    id, institutionName: 'Itaú', status,
    lastUpdatedAt: '2026-07-12T10:00:00Z', consentExpiresAt: '2027-01-01T00:00:00Z',
  }),
  fetchAccounts: async () => ([{
    id: 'a1', itemId: 'i1', kind: 'BANK' as const, name: 'CC', number: '1',
    balance: 100, currencyCode: 'BRL', creditLimit: null, availableCreditLimit: null,
    closeDate: null, dueDate: null,
  }]),
  fetchTransactions: async () => ([{
    id: 't1', accountId: 'a1', date: '2026-06-15', description: 'IFOOD', amount: -50,
    currencyCode: 'BRL', category: 'Food', merchantName: 'iFood',
    installmentNumber: null, installmentTotal: null, billForecastDate: null,
    status: 'POSTED' as const, raw: '{}',
  }]),
})

describe('syncAll', () => {
  it('reporta conexão saudável e conta as transações novas', async () => {
    const repo = new Repo(openDb(':memory:', 'k'))
    const r = await syncAll(gateway() as any, repo, ['i1'])
    expect(r.connections[0].healthy).toBe(true)
    expect(r.newTransactions['Itaú']).toBe(1)
  })

  it('marca conexão degradada com aviso acionável em vez de estourar', async () => {
    const repo = new Repo(openDb(':memory:', 'k'))
    const r = await syncAll(gateway('LOGIN_ERROR') as any, repo, ['i1'])
    expect(r.connections[0].healthy).toBe(false)
    expect(r.connections[0].warning).toMatch(/reautoriz/i)
  })

  it('segundo sync não duplica nada', async () => {
    const repo = new Repo(openDb(':memory:', 'k'))
    await syncAll(gateway() as any, repo, ['i1'])
    const r2 = await syncAll(gateway() as any, repo, ['i1'])
    expect(r2.newTransactions['Itaú']).toBe(0)
    expect(repo.queryTransactions({ from: '2026-01-01', to: '2026-12-31' })).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run tests/sync.test.ts`.

- [ ] **Step 3: Implementar `src/sync.ts`**

Regras:
- Janela de busca: se não há watermark, busca **24 meses** para trás (backfill). Se há, busca a partir de **35 dias antes do watermark** — porque transação `PENDING` vira `POSTED` e descrição é enriquecida depois, então re-varrer a janela recente é o que mantém o dado correto. O upsert torna isso barato e seguro.
- Status saudável: `UPDATED` e `UPDATING`. `LOGIN_ERROR` e `WAITING_USER_INPUT`/`WAITING_USER_ACTION` geram `warning` pedindo reautorização em `meu.pluggy.ai`. `OUTDATED` avisa que os dados estão velhos.
- Consentimento a menos de 30 dias de `consentExpiresAt` gera aviso próprio.
- Falha em um item **não** aborta os outros: entra em `errors[]` e o sync continua.
- Ao final grava o watermark com a data de hoje.

- [ ] **Step 4: Rodar até passar** — `npx vitest run tests/sync.test.ts`. Esperado: 3 passando.

- [ ] **Step 5: Implementar `src/mcp/tools.ts`** com as 10 tools, cada uma com schema zod e handler fino que só chama `analysis/`.

Toda tool de análise anexa, no fim da resposta, o aviso de conexões degradadas vindo de `repo.listItems()` — o requisito de nunca servir número velho com cara de fresco. Valores monetários formatados em BRL. `search_transactions` limita a 100 resultados por padrão.

- [ ] **Step 6: Implementar `src/mcp/server.ts` e `src/index.ts`** — `McpServer` + `StdioServerTransport`, instanciando config, gateway e repo uma vez.

- [ ] **Step 7: Verificar build e boot**

```bash
npx tsc --noEmit && npx vitest run
```

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(mcp): sync orchestration and tool surface"
```

---

## Self-Review

**Spec coverage:** setup fora do código (README, Task 5) · 4 módulos (Tasks 2–5) · sync incremental por upsert (Tasks 3 e 5) · conexão degradada nunca em silêncio (Task 5) · 6 tabelas (Task 3) · payload cru (Task 3) · convenção de sinal (Task 2) · 10 tools (Task 5) · recorrência/parcelas/orçamento/categorização (Task 4) · erros e testes (distribuído) · fora de escopo respeitado (nenhuma task toca pagamento ou multi-CPF).

**Lacuna encontrada e coberta:** o SDK não expõe `fetchItems()`, então não há como descobrir as conexões automaticamente. Resolvido com `PLUGGY_ITEM_IDS` no env, persistido em `items` no primeiro sync — documentar no README (Task 5).

**Consistência de tipos:** `DomainTransaction.amount` é sempre "gasto negativo" da Task 2 em diante; `analysis/` reporta gasto como positivo apenas na saída das tools. `kind` é `'BANK' | 'CREDIT'` em todo o código, nunca `type`.
