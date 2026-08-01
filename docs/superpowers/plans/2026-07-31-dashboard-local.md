# Dashboard local — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um dashboard local que mostra saldo, fluxo de caixa, gastos e compromissos, e atualiza sob demanda por um botão — sem LLM no caminho.

**Architecture:** Servidor HTTP local em `node:http` com três rotas. `data.ts` monta o payload chamando as mesmas funções de `src/analysis/` que as tools MCP usam; `page.ts` é uma string HTML autocontida; `server.ts` só roteia e protege.

**Tech Stack:** Node 26, TypeScript, `node:http` (sem framework), vitest. Nenhuma dependência nova.

## Global Constraints

- **Bind em `127.0.0.1`**, nunca `0.0.0.0`.
- **Token aleatório por sessão**; requisição sem token válido recebe **403**.
- Token e credencial **nunca** no HTML servido nem em log.
- Porta **4000** por padrão, sobrescrita por `OFA_DASH_PORT`.
- **Zero dependência externa na página**: sem CDN, sem link para host externo.
- Nenhuma lógica de análise reescrita — `data.ts` só orquestra `src/analysis/`.
- Somente leitura, exceto `POST /api/sync`.
- Valores em BRL; agrupamento mensal em `America/Sao_Paulo` (herdado de `analysis/period.ts`).

---

## File Structure

```
src/dash/
  data.ts     buildDashboardData(repo, now) → DashPayload.  PURO em relação à rede.
  page.ts     PAGE_HTML: string.  HTML + CSS + JS inline, autocontido.
  server.ts   createServer(deps) e startDashboard().  Rotas e token.
src/dash-cli.ts   entrypoint do `npm run dash`
tests/dash/
  data.test.ts
  server.test.ts
  page.test.ts
```

---

### Task 1: `data.ts` — payload dos painéis

**Files:**
- Create: `src/dash/data.ts`
- Test: `tests/dash/data.test.ts`

**Interfaces:**
- Consumes: `Repo` (`listAccounts`, `listItems`, `queryTransactions`, `listOverrides`), `assessHealth` de `src/sync.js`, e de `src/analysis/`: `cashFlow`, `spendingByCategory`, `comparePeriods`, `installmentsOutlook`, `findRecurring`, `billComposition`, `resolvePeriod`, `previousPeriod`, `addMonths`, `monthOf`, `round2`
- Produces: `type DashPayload` e `buildDashboardData(repo: Repo, now: string): DashPayload`

- [ ] **Step 1: Escrever o teste falhando**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { openDb } from '../../src/store/db.js'
import { Repo } from '../../src/store/repo.js'
import { buildDashboardData } from '../../src/dash/data.js'
import type { DomainTransaction } from '../../src/domain.js'

const NOW = '2026-07-30'

const tx = (o: Partial<DomainTransaction>): DomainTransaction => ({
  id: `t${Math.random()}`, accountId: 'acc1', date: '2026-07-10', description: 'X',
  amount: -10, currencyCode: 'BRL', category: null, merchantName: null,
  installmentNumber: null, installmentTotal: null, billForecastDate: null,
  status: 'POSTED', raw: '{}', ...o,
})

function seed(): Repo {
  const repo = new Repo(openDb(':memory:', 'k'))
  repo.upsertItem({
    id: 'i1', institutionName: 'MeuPluggy', connectorId: 200, status: 'UPDATED',
    lastUpdatedAt: '2026-07-30T01:00:00Z', consentExpiresAt: null,
  }, NOW)
  repo.upsertAccounts([
    { id: 'acc1', itemId: 'i1', kind: 'BANK', name: 'Itaú', number: '1', balance: 5000,
      currencyCode: 'BRL', creditLimit: null, availableCreditLimit: null, closeDate: null, dueDate: null },
    { id: 'acc2', itemId: 'i1', kind: 'BANK', name: 'BB', number: '2', balance: -1500,
      currencyCode: 'BRL', creditLimit: null, availableCreditLimit: null, closeDate: null, dueDate: null },
    { id: 'card1', itemId: 'i1', kind: 'CREDIT', name: 'Black', number: '9', balance: 2000,
      currencyCode: 'BRL', creditLimit: 10000, availableCreditLimit: 8000, closeDate: null, dueDate: '2026-08-10' },
  ])
  return repo
}

describe('buildDashboardData', () => {
  let repo: Repo
  beforeEach(() => { repo = seed() })

  it('cabeçalho soma o saldo das contas, inclusive negativo', () => {
    const d = buildDashboardData(repo, NOW)
    expect(d.header.saldoTotal).toBe(3500)
  })

  it('expõe os dois tempos separadamente', () => {
    const d = buildDashboardData(repo, NOW)
    expect(d.header.lastSyncedAt).toBe(NOW)
    expect(d.header.lastCollectedAt).toBe('2026-07-30T01:00:00Z')
  })

  it('propaga aviso de coleta atrasada vindo do assessHealth', () => {
    repo.upsertItem({
      id: 'i1', institutionName: 'MeuPluggy', connectorId: 200, status: 'UPDATED',
      lastUpdatedAt: '2026-07-20T01:00:00Z', consentExpiresAt: null,
    }, NOW)
    const d = buildDashboardData(repo, NOW)
    expect(d.header.avisos.join(' ')).toMatch(/não coleta/i)
  })

  it('separa conta de cartão e marca a negativa', () => {
    const d = buildDashboardData(repo, NOW)
    expect(d.accounts.contas.map((c) => c.name)).toEqual(['BB', 'Itaú'])
    expect(d.accounts.contas.find((c) => c.name === 'BB')!.balance).toBeLessThan(0)
    expect(d.accounts.cartoes).toHaveLength(1)
  })

  it('gasto do mês é positivo e agrupado por categoria', () => {
    repo.upsertTransactions([
      tx({ amount: -300, category: 'Alimentação' }),
      tx({ amount: -200, category: 'Alimentação' }),
      tx({ amount: 4000, category: 'Salary' }),
    ])
    const d = buildDashboardData(repo, NOW)
    expect(d.spending.atual).toEqual([{ category: 'Alimentação', total: 500, count: 2 }])
  })

  it('fluxo de caixa traz média mensal e investimento líquido', () => {
    repo.upsertTransactions([
      tx({ date: '2026-07-05', amount: 5000, category: 'Salary' }),
      tx({ date: '2026-07-06', amount: -2000, category: 'Shopping' }),
      tx({ date: '2026-07-07', amount: -1000, category: 'Investments' }),
    ])
    const d = buildDashboardData(repo, NOW)
    expect(d.cashFlow.totals.income).toBe(5000)
    expect(d.cashFlow.totals.expenses).toBe(2000)
    expect(d.cashFlow.netSaved).toBe(1000)
    expect(d.cashFlow.mediaMensal.sobra).toBe(3000)
  })

  it('compromissos trazem parcelas futuras e assinaturas', () => {
    repo.upsertTransactions([
      tx({ accountId: 'card1', date: '2026-07-17', amount: -100,
           installmentNumber: 1, installmentTotal: 3, billForecastDate: '2026-07' }),
      tx({ accountId: 'card1', date: '2026-08-17', amount: -100,
           installmentNumber: 2, installmentTotal: 3, billForecastDate: '2026-08' }),
    ])
    const d = buildDashboardData(repo, NOW)
    expect(d.commitments.proximosMeses[0]!.month).toBe('2026-08')
    expect(d.commitments.proximosMeses[0]!.committed).toBe(100)
  })

  it('banco vazio devolve estado inicial em vez de zeros', () => {
    const d = buildDashboardData(new Repo(openDb(':memory:', 'k')), NOW)
    expect(d.header.semDados).toBe(true)
    expect(d.header.avisos.join(' ')).toMatch(/sync/i)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/dash/data.test.ts`
Expected: FAIL — `Cannot find module '../../src/dash/data.js'`

- [ ] **Step 3: Implementar `src/dash/data.ts`**

```ts
import type { Repo } from '../store/repo.js'
import type { DomainAccount } from '../domain.js'
import { assessHealth } from '../sync.js'
import { cashFlow, type CashFlowSummary } from '../analysis/cashflow.js'
import { billComposition, type Bill } from '../analysis/bill.js'
import { findRecurring, type Recurring } from '../analysis/recurring.js'
import { installmentsOutlook, type OutlookMonth } from '../analysis/installments.js'
import {
  comparePeriods, round2, spendingByCategory,
  type CategoryComparison, type CategoryTotal,
} from '../analysis/spending.js'
import { addMonths, monthOf, previousPeriod, resolvePeriod } from '../analysis/period.js'

const CASHFLOW_MONTHS = 12
const OUTLOOK_MONTHS = 6
const RECURRING_LOOKBACK_MONTHS = 12

export type DashPayload = {
  header: {
    saldoTotal: number
    /** quando NÓS lemos a Pluggy */
    lastSyncedAt: string | null
    /** quando a PLUGGY coletou da instituição — é este que diz se o dado é novo */
    lastCollectedAt: string | null
    avisos: string[]
    semDados: boolean
  }
  cashFlow: CashFlowSummary & {
    mediaMensal: { receita: number; gasto: number; sobra: number }
    investidoLiquidoMes: number
  }
  accounts: { contas: DomainAccount[]; cartoes: DomainAccount[]; faturaAberta: Bill }
  spending: {
    periodo: { from: string; to: string }
    atual: CategoryTotal[]
    comparacao: CategoryComparison[]
  }
  commitments: {
    proximosMeses: OutlookMonth[]
    totalComprometido: number
    assinaturas: Recurring[]
    custoMensalAssinaturas: number
  }
}

export function buildDashboardData(repo: Repo, now: string): DashPayload {
  const mes = monthOf(now)
  const items = repo.listItems()
  const accounts = repo.listAccounts()
  const overrides = repo.listOverrides()
  const semDados = items.length === 0

  const avisos = semDados
    ? ['Nenhuma conexão sincronizada ainda. Clique em Atualizar para o primeiro sync.']
    : items.flatMap((i) => {
        const w = assessHealth(i, now).warning
        return w ? [w] : []
      })

  // Cabeçalho
  const contas = accounts.filter((a) => a.kind === 'BANK')
  const cartoes = accounts.filter((a) => a.kind === 'CREDIT')
  const header = {
    saldoTotal: round2(contas.reduce((s, a) => s + a.balance, 0)),
    lastSyncedAt: items[0]?.lastSyncedAt ?? null,
    lastCollectedAt: items[0]?.lastUpdatedAt ?? null,
    avisos,
    semDados,
  }

  // Fluxo de caixa
  const kinds = new Map(accounts.map((a) => [a.id, a.kind]))
  const flowTxs = repo.queryTransactions({
    from: `${addMonths(mes, -(CASHFLOW_MONTHS - 1))}-01`,
    to: now,
  })
  const flow = cashFlow(flowTxs, kinds)
  const n = Math.max(flow.months.length, 1)

  // Gastos do mês corrente vs anterior
  const periodo = resolvePeriod({ period: mes }, now)
  const anterior = previousPeriod(periodo)
  const txsMes = repo.queryTransactions(periodo)

  // Compromissos: janela para trás cobre parcelamento longo, para frente
  // é obrigatória — a instituição manda parcela futura como transação datada à frente.
  const txsCredito = repo.queryTransactions({
    from: `${addMonths(mes, -24)}-01`,
    to: `${addMonths(mes, OUTLOOK_MONTHS + 2)}-28`,
    kind: 'CREDIT',
  })
  const outlook = installmentsOutlook(txsCredito, OUTLOOK_MONTHS, mes)
  const assinaturas = findRecurring(
    repo.queryTransactions({ from: `${addMonths(mes, -RECURRING_LOOKBACK_MONTHS)}-01`, to: now }),
  )

  return {
    header,
    cashFlow: {
      ...flow,
      mediaMensal: {
        receita: round2(flow.totals.income / n),
        gasto: round2(flow.totals.expenses / n),
        sobra: round2(flow.totals.net / n),
      },
      investidoLiquidoMes: round2(flow.netSaved / n),
    },
    accounts: {
      contas: [...contas].sort((a, b) => a.name.localeCompare(b.name)),
      cartoes: [...cartoes].sort((a, b) => a.name.localeCompare(b.name)),
      faturaAberta: billComposition(txsCredito, mes, overrides),
    },
    spending: {
      periodo,
      atual: spendingByCategory(txsMes, overrides),
      comparacao: comparePeriods(txsMes, repo.queryTransactions(anterior), overrides),
    },
    commitments: {
      proximosMeses: outlook,
      totalComprometido: round2(outlook.reduce((s, m) => s + m.committed, 0)),
      assinaturas,
      custoMensalAssinaturas: round2(
        assinaturas.filter((a) => a.cadence === 'MONTHLY').reduce((s, a) => s + a.amount, 0),
      ),
    },
  }
}
```

- [ ] **Step 4: Rodar até passar**

Run: `npx vitest run tests/dash/data.test.ts`
Expected: PASS — 8 testes

- [ ] **Step 5: Commit**

```bash
git add src/dash/data.ts tests/dash/data.test.ts
git commit -m "feat(dash): payload dos painéis reaproveitando analysis/"
```

---

### Task 2: `server.ts` — rotas e proteção

**Files:**
- Create: `src/dash/server.ts`
- Test: `tests/dash/server.test.ts`

**Interfaces:**
- Consumes: `buildDashboardData(repo, now): DashPayload` da Task 1; `PAGE_HTML: string` da Task 3 (importar; a Task 3 cria o arquivo — se estiver implementando fora de ordem, crie `src/dash/page.ts` com `export const PAGE_HTML = '<!doctype html><title>dash</title>'` como stub e a Task 3 substitui)
- Produces:
  - `createDashServer(deps: DashDeps): http.Server`
  - `type DashDeps = { repo: Repo; gateway: Gateway; declaredItemIds: string[]; token: string; now?: () => string }`
  - `startDashboard(deps: Omit<DashDeps,'token'>, port: number): Promise<{ url: string; token: string; close: () => Promise<void> }>`

- [ ] **Step 1: Escrever o teste falhando**

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { openDb } from '../../src/store/db.js'
import { Repo } from '../../src/store/repo.js'
import { startDashboard } from '../../src/dash/server.js'
import type { Gateway } from '../../src/pluggy/client.js'

const gateway: Gateway = {
  async fetchItem(id) {
    return { id, institutionName: 'MeuPluggy', connectorId: 200, status: 'UPDATED',
             lastUpdatedAt: '2026-07-30T01:00:00Z', consentExpiresAt: null }
  },
  async fetchAccounts() { return [] },
  async fetchTransactions() { return [] },
}

let stop: (() => Promise<void>) | null = null
afterEach(async () => { if (stop) await stop(); stop = null })

async function up() {
  const repo = new Repo(openDb(':memory:', 'k'))
  // porta 0 = efêmera, não colide com nada
  const d = await startDashboard({ repo, gateway, declaredItemIds: ['i1'] }, 0)
  stop = d.close
  return d
}

describe('dash server', () => {
  it('escuta apenas em 127.0.0.1', async () => {
    const d = await up()
    expect(d.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//)
  })

  it('sem token devolve 403', async () => {
    const d = await up()
    const base = d.url.split('?')[0]
    expect((await fetch(`${base}api/data`)).status).toBe(403)
    expect((await fetch(base)).status).toBe(403)
  })

  it('token errado devolve 403', async () => {
    const d = await up()
    const base = d.url.split('?')[0]
    expect((await fetch(`${base}api/data?t=chute`)).status).toBe(403)
  })

  it('com token devolve a página e o payload', async () => {
    const d = await up()
    const base = d.url.split('?')[0]
    const page = await fetch(`${base}?t=${d.token}`)
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toMatch(/text\/html/)

    const data = await fetch(`${base}api/data?t=${d.token}`)
    expect(data.status).toBe(200)
    const body = await data.json()
    expect(body.header).toBeDefined()
    expect(body.cashFlow).toBeDefined()
    expect(body.accounts).toBeDefined()
    expect(body.commitments).toBeDefined()
  })

  it('o HTML servido não contém o token', async () => {
    const d = await up()
    const html = await (await fetch(`${d.url}`)).text()
    expect(html).not.toContain(d.token)
  })

  it('POST /api/sync executa o sync e devolve o relatório', async () => {
    const d = await up()
    const base = d.url.split('?')[0]
    const r = await fetch(`${base}api/sync?t=${d.token}`, { method: 'POST' })
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.connections).toHaveLength(1)
    expect(body.errors).toEqual([])
  })

  it('GET em /api/sync não sincroniza', async () => {
    const d = await up()
    const base = d.url.split('?')[0]
    expect((await fetch(`${base}api/sync?t=${d.token}`)).status).toBe(405)
  })

  it('rota desconhecida devolve 404', async () => {
    const d = await up()
    const base = d.url.split('?')[0]
    expect((await fetch(`${base}nada?t=${d.token}`)).status).toBe(404)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/dash/server.test.ts`
Expected: FAIL — `Cannot find module '../../src/dash/server.js'`

- [ ] **Step 3: Implementar `src/dash/server.ts`**

```ts
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { Repo } from '../store/repo.js'
import type { Gateway } from '../pluggy/client.js'
import { syncAll } from '../sync.js'
import { today } from '../analysis/period.js'
import { buildDashboardData } from './data.js'
import { PAGE_HTML } from './page.js'

const HOST = '127.0.0.1'

export type DashDeps = {
  repo: Repo
  gateway: Gateway
  declaredItemIds: string[]
  token: string
  now?: () => string
}

/** Comparação em tempo constante: evita vazar o token por timing. */
function tokenOk(provided: string | null, expected: string): boolean {
  if (!provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(payload)
}

export function createDashServer(deps: DashDeps): Server {
  const now = deps.now ?? today

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://${HOST}`)

    if (!tokenOk(url.searchParams.get('t'), deps.token)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('403 — abra pela URL impressa no terminal, que carrega o token da sessão.')
      return
    }

    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(PAGE_HTML) // não contém token: o JS lê de location.search
      return
    }

    if (url.pathname === '/api/data') {
      try {
        json(res, 200, buildDashboardData(deps.repo, now()))
      } catch (err) {
        json(res, 500, { erro: err instanceof Error ? err.message : 'falha ao montar os dados' })
      }
      return
    }

    if (url.pathname === '/api/sync') {
      if (req.method !== 'POST') {
        json(res, 405, { erro: 'Use POST para sincronizar.' })
        return
      }
      syncAll(deps.gateway, deps.repo, deps.declaredItemIds, now())
        .then((report) => json(res, 200, report))
        // Só a mensagem: exceção de SDK pode carregar credencial.
        .catch((err) =>
          json(res, 500, { erro: err instanceof Error ? err.message : 'falha no sync' }),
        )
      return
    }

    json(res, 404, { erro: 'rota inexistente' })
  })
}

export async function startDashboard(
  deps: Omit<DashDeps, 'token'>,
  port: number,
): Promise<{ url: string; token: string; close: () => Promise<void> }> {
  const token = randomBytes(24).toString('hex')
  const server = createDashServer({ ...deps, token })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, HOST, resolve) // HOST fixo: nunca 0.0.0.0
  })

  const addr = server.address()
  const boundPort = typeof addr === 'object' && addr ? addr.port : port

  return {
    url: `http://${HOST}:${boundPort}/?t=${token}`,
    token,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
```

- [ ] **Step 4: Rodar até passar**

Run: `npx vitest run tests/dash/server.test.ts`
Expected: PASS — 8 testes

- [ ] **Step 5: Commit**

```bash
git add src/dash/server.ts tests/dash/server.test.ts
git commit -m "feat(dash): servidor local com bind em 127.0.0.1 e token por sessão"
```

---

### Task 3: `page.ts` e o comando `npm run dash`

**Files:**
- Create: `src/dash/page.ts`, `src/dash-cli.ts`
- Modify: `package.json` (script `dash`), `README.md` (seção do dashboard)
- Test: `tests/dash/page.test.ts`

**Interfaces:**
- Consumes: `startDashboard` da Task 2, `loadConfig`, `getOrCreateKey`, `openDb`, `Repo`, `PluggyGateway`
- Produces: `PAGE_HTML: string`

- [ ] **Step 1: Escrever o teste falhando**

```ts
import { describe, it, expect } from 'vitest'
import { PAGE_HTML } from '../../src/dash/page.js'

describe('PAGE_HTML', () => {
  it('não referencia nenhum host externo', () => {
    // Sem CDN a página funciona offline e não vaza navegação.
    expect(PAGE_HTML).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/)
  })

  it('não embute token nem credencial', () => {
    expect(PAGE_HTML).not.toMatch(/PLUGGY_CLIENT|client_secret|\?t=[0-9a-f]{8}/i)
  })

  it('lê o token de location.search em vez de tê-lo embutido', () => {
    expect(PAGE_HTML).toContain('location.search')
  })

  it('tem os quatro painéis e o botão', () => {
    for (const id of ['painel-fluxo', 'painel-contas', 'painel-gastos', 'painel-compromissos', 'btn-atualizar']) {
      expect(PAGE_HTML).toContain(id)
    }
  })

  it('trata claro e escuro', () => {
    expect(PAGE_HTML).toContain('prefers-color-scheme')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/dash/page.test.ts`
Expected: FAIL — `Cannot find module '../../src/dash/page.js'`

- [ ] **Step 3: Implementar `src/dash/page.ts`**

`export const PAGE_HTML = String.raw\`...\`` contendo, numa string só:

- `<head>` com `<meta charset>`, `<title>openfinance-analyst</title>` e `<style>` inline.
- **CSS**: variáveis de cor em `:root` e override em `@media (prefers-color-scheme: dark)`; `font-variant-numeric: tabular-nums` nos valores; barras como `div` com `width: %`; grid de painéis com `grid-template-columns: repeat(auto-fit, minmax(320px, 1fr))`; classe `.neg` em vermelho, usada só em saldo negativo e mês no vermelho.
- **HTML**: cabeçalho com `#saldo-total`, `#tempos`, `#avisos`, `<button id="btn-atualizar">`; e quatro `<section>` com os ids `painel-fluxo`, `painel-contas`, `painel-gastos`, `painel-compromissos`.
- **JS inline**:

```js
const T = new URLSearchParams(location.search).get('t')   // token nunca vem embutido
const api = (p, o) => fetch(p + '?t=' + encodeURIComponent(T), o)
const brl = n => n.toLocaleString('pt-BR', { style:'currency', currency:'BRL' })

let ultimoBom = null
async function carregar() {
  const r = await api('/api/data')
  if (!r.ok) throw new Error('falha ao carregar')
  ultimoBom = await r.json()
  render(ultimoBom)
}
async function atualizar() {
  const btn = document.getElementById('btn-atualizar')
  btn.disabled = true; btn.textContent = 'Sincronizando…'
  try {
    const r = await api('/api/sync', { method: 'POST' })
    const rep = await r.json()
    if (!r.ok) throw new Error(rep.erro || 'falha no sync')
    await carregar()
    aviso(null)
  } catch (e) {
    // Não apaga a tela: mantém o último dado bom e explica o que houve.
    aviso(e.message)
    if (ultimoBom) render(ultimoBom)
  } finally {
    btn.disabled = false; btn.textContent = '↻ Atualizar'
  }
}
document.getElementById('btn-atualizar').addEventListener('click', atualizar)
carregar()
```

`render(d)` preenche os quatro painéis a partir do `DashPayload`: cabeçalho com `d.header.saldoTotal`, os dois tempos de `d.header.lastSyncedAt` e `d.header.lastCollectedAt` rotulados como "lido da Pluggy" e "coletado do banco", e `d.header.avisos` como faixa; fluxo com uma linha por `d.cashFlow.months` e o par `mediaMensal.sobra` vs `investidoLiquidoMes`; contas e cartões de `d.accounts` com `.neg` quando `balance < 0` e barra de limite usado; gastos de `d.spending.atual` e `d.spending.comparacao`; compromissos de `d.commitments`. Quando `d.header.semDados` for `true`, mostra o estado inicial e esconde os painéis.

- [ ] **Step 4: Rodar até passar**

Run: `npx vitest run tests/dash/page.test.ts`
Expected: PASS — 5 testes

- [ ] **Step 5: Criar `src/dash-cli.ts`**

```ts
#!/usr/bin/env node
import { mkdirSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { loadConfig } from './config.js'
import { openDb } from './store/db.js'
import { getOrCreateKey } from './store/key.js'
import { Repo } from './store/repo.js'
import { PluggyGateway } from './pluggy/client.js'
import { startDashboard } from './dash/server.js'

const PORT = Number(process.env.OFA_DASH_PORT ?? 4000)

const config = loadConfig()
mkdirSync(config.dataDir, { recursive: true, mode: 0o700 })

const repo = new Repo(openDb(config.dbPath, getOrCreateKey()))
const gateway = new PluggyGateway(config.clientId, config.clientSecret)

try {
  const { url } = await startDashboard(
    { repo, gateway, declaredItemIds: config.itemIds },
    PORT,
  )
  console.log(`dashboard em ${url}`)
  console.log('a URL carrega o token da sessão — Ctrl+C encerra')
  execFile('/usr/bin/open', [url])
} catch (err) {
  const e = err as { code?: string }
  if (e.code === 'EADDRINUSE') {
    console.error(`porta ${PORT} ocupada. Rode com OFA_DASH_PORT=4001 npm run dash`)
  } else {
    console.error(err instanceof Error ? err.message : 'falha ao subir o dashboard')
  }
  process.exit(1)
}
```

Adicionar ao `package.json`: `"dash": "node dist/dash-cli.js"`.

- [ ] **Step 6: Verificar tudo**

```bash
npx tsc --noEmit && npx vitest run && npx tsc
```
Expected: typecheck limpo, toda a suíte passando.

- [ ] **Step 7: Documentar no README**

Seção "Dashboard": o que `npm run dash` faz, que escuta só em `127.0.0.1`, que a URL carrega o token da sessão, e como trocar a porta com `OFA_DASH_PORT`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(dash): página autocontida e comando npm run dash"
```

---

## Self-Review

**Cobertura do spec:** restrição do Keychain (Task 3, roda local como o usuário) · três rotas (Task 2) · `data.ts` reaproveitando `analysis/` (Task 1) · bind `127.0.0.1` (Task 2, com teste) · token por sessão e 403 (Task 2, com teste) · token fora do HTML (Tasks 2 e 3, com teste nos dois) · quatro painéis (Tasks 1 e 3) · dois tempos no cabeçalho (Task 1, com teste) · avisos de `assessHealth` (Task 1, com teste) · sync falho não apaga a tela (Task 3, `ultimoBom`) · banco vazio com estado inicial (Task 1, com teste) · porta 4000 e `OFA_DASH_PORT` (Task 3) · sem CDN (Task 3, com teste) · claro/escuro e tabular-nums (Task 3) · testes dos três módulos (todas).

**Dependência circular entre tasks:** a Task 2 importa `PAGE_HTML`, criado na Task 3. Resolvido na própria Task 2, que instrui a criar o stub caso as tasks sejam executadas fora de ordem.

**Consistência de tipos:** `DashPayload` da Task 1 é o mesmo objeto que a Task 2 serializa em `/api/data` e que o `render(d)` da Task 3 consome. Campos usados no `render` — `header.saldoTotal`, `header.lastSyncedAt`, `header.lastCollectedAt`, `header.avisos`, `header.semDados`, `cashFlow.months`, `cashFlow.mediaMensal.sobra`, `cashFlow.investidoLiquidoMes`, `accounts.contas`, `accounts.cartoes`, `spending.atual`, `spending.comparacao`, `commitments.proximosMeses`, `commitments.assinaturas` — todos existem no tipo da Task 1.
