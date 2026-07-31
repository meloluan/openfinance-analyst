import { describe, it, expect, beforeEach } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { openDb } from '../../src/store/db.js'
import { Repo } from '../../src/store/repo.js'
import { registerTools } from '../../src/mcp/tools.js'
import { today } from '../../src/analysis/period.js'
import type { Gateway } from '../../src/pluggy/client.js'
import type { DomainTransaction } from '../../src/domain.js'

const NOW = today()
const THIS_MONTH = NOW.slice(0, 7)

const tx = (o: Partial<DomainTransaction>): DomainTransaction => ({
  id: `t-${Math.random()}`,
  accountId: 'card1',
  date: `${THIS_MONTH}-05`,
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
  ...o,
})

const gateway: Gateway = {
  async fetchItem(id) {
    return {
      id,
      institutionName: 'Itaú',
      status: 'UPDATED',
      lastUpdatedAt: `${NOW}T10:00:00Z`,
      consentExpiresAt: null,
    }
  },
  async fetchAccounts() {
    return []
  },
  async fetchTransactions() {
    return []
  },
}

async function connect(repo: Repo): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' })
  registerTools(server, { repo, gateway, declaredItemIds: [] })

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
  return client
}

function seed(): Repo {
  const repo = new Repo(openDb(':memory:', 'k'))
  repo.upsertItem(
    {
      id: 'i1',
      institutionName: 'Itaú',
      status: 'UPDATED',
      lastUpdatedAt: `${NOW}T10:00:00Z`,
      consentExpiresAt: null,
    },
    NOW,
  )
  repo.upsertAccounts([
    {
      id: 'acc1', itemId: 'i1', kind: 'BANK', name: 'Conta Corrente', number: '1',
      balance: 4200, currencyCode: 'BRL', creditLimit: null, availableCreditLimit: null,
      closeDate: null, dueDate: null,
    },
    {
      id: 'card1', itemId: 'i1', kind: 'CREDIT', name: 'Cartão Platinum', number: '****1234',
      balance: -1800, currencyCode: 'BRL', creditLimit: 8000, availableCreditLimit: 6200,
      closeDate: `${THIS_MONTH}-05`, dueDate: `${THIS_MONTH}-12`,
    },
  ])
  return repo
}

const parse = (result: unknown): any =>
  JSON.parse((result as { content: { text: string }[] }).content[0]!.text)

describe('superfície MCP', () => {
  let repo: Repo
  let client: Client

  beforeEach(async () => {
    repo = seed()
    client = await connect(repo)
  })

  it('expõe exatamente as dez tools do spec', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([
      'budget_status',
      'card_bill',
      'find_recurring',
      'installments_outlook',
      'list_accounts',
      'recategorize',
      'search_transactions',
      'set_budget',
      'spending_by_category',
      'sync',
    ])
  })

  it('toda tool tem descrição e schema de entrada', async () => {
    const { tools } = await client.listTools()
    for (const tool of tools) {
      expect(tool.description, `${tool.name} sem descrição`).toBeTruthy()
      expect(tool.inputSchema, `${tool.name} sem schema`).toBeTruthy()
    }
  })

  it('list_accounts separa conta de cartão e soma o saldo', async () => {
    const out = parse(await client.callTool({ name: 'list_accounts', arguments: {} }))
    expect(out.contas).toHaveLength(1)
    expect(out.cartoes).toHaveLength(1)
    expect(out.saldoTotalEmConta).toBe(4200)
    expect(out.cartoes[0].creditLimit).toBe(8000)
  })

  it('spending_by_category devolve gasto positivo agregado', async () => {
    repo.upsertTransactions([
      tx({ amount: -300, category: 'Alimentação', accountId: 'acc1' }),
      tx({ amount: -120, category: 'Alimentação', accountId: 'acc1' }),
      tx({ amount: 5000, category: 'Salário', accountId: 'acc1' }),
    ])
    const out = parse(
      await client.callTool({ name: 'spending_by_category', arguments: { period: THIS_MONTH } }),
    )
    expect(out.porCategoria).toEqual([{ category: 'Alimentação', total: 420, count: 2 }])
    expect(out.totalGasto).toBe(420)
  })

  it('rejeita período mal formado com mensagem útil, sem estourar', async () => {
    const result = (await client.callTool({
      name: 'spending_by_category',
      arguments: { period: 'junho' },
    })) as { isError?: boolean; content: { text: string }[] }
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toMatch(/YYYY-MM/)
  })

  it('recategorize cria regra e já reflete na agregação seguinte', async () => {
    repo.upsertTransactions([
      tx({ amount: -80, category: 'Outros', merchantName: 'IFOOD', accountId: 'acc1' }),
    ])

    const applied = parse(
      await client.callTool({
        name: 'recategorize',
        arguments: { pattern: 'IFOOD', category: 'Alimentação' },
      }),
    )
    expect(applied.transacoesAfetadas).toBe(1)

    const out = parse(
      await client.callTool({ name: 'spending_by_category', arguments: { period: THIS_MONTH } }),
    )
    expect(out.porCategoria).toEqual([{ category: 'Alimentação', total: 80, count: 1 }])
  })

  it('set_budget seguido de budget_status projeta o estouro', async () => {
    repo.upsertTransactions([
      tx({ date: `${THIS_MONTH}-01`, amount: -900, category: 'Alimentação', accountId: 'acc1' }),
    ])
    await client.callTool({ name: 'set_budget', arguments: { category: 'Alimentação', amount: 500 } })

    const out = parse(
      await client.callTool({ name: 'budget_status', arguments: { period: THIS_MONTH } }),
    )
    expect(out.linhas[0].spent).toBe(900)
    expect(out.vaoEstourar).toContain('Alimentação')
  })

  it('budget_status sem meta definida orienta em vez de falhar', async () => {
    const out = parse(await client.callTool({ name: 'budget_status', arguments: {} }))
    expect(out.metas).toEqual([])
    expect(out.observacao).toMatch(/set_budget/)
  })

  it('card_bill usa billForecastDate para alocar a compra', async () => {
    repo.upsertTransactions([
      tx({ date: `${THIS_MONTH}-06`, amount: -250, billForecastDate: THIS_MONTH, category: 'Lazer' }),
    ])
    const out = parse(await client.callTool({ name: 'card_bill', arguments: { month: THIS_MONTH } }))
    expect(out.fatura.total).toBe(250)
    expect(out.fatura.month).toBe(THIS_MONTH)
  })

  it('installments_outlook projeta o que já está comprometido', async () => {
    repo.upsertTransactions([
      tx({
        date: `${THIS_MONTH}-10`,
        amount: -200,
        installmentNumber: 1,
        installmentTotal: 4,
        description: 'NOTEBOOK',
      }),
    ])
    const out = parse(await client.callTool({ name: 'installments_outlook', arguments: { months: 6 } }))
    expect(out.totalComprometido).toBe(600)
    expect(out.proximosMeses[0].committed).toBe(200)
    expect(out.proximosMeses[3].committed).toBe(0)
  })

  it('search_transactions respeita o limite', async () => {
    repo.upsertTransactions([
      tx({ description: 'UBER TRIP 1', accountId: 'acc1' }),
      tx({ description: 'UBER TRIP 2', accountId: 'acc1' }),
      tx({ description: 'PADARIA', accountId: 'acc1' }),
    ])
    const out = parse(
      await client.callTool({ name: 'search_transactions', arguments: { term: 'uber', limit: 1 } }),
    )
    expect(out.transacoes).toHaveLength(1)
  })

  it('toda análise carrega o campo de avisos', async () => {
    const out = parse(await client.callTool({ name: 'list_accounts', arguments: {} }))
    expect(Array.isArray(out.avisos)).toBe(true)
  })

  it('conexão degradada aparece como aviso na resposta da análise', async () => {
    repo.upsertItem(
      {
        id: 'i1',
        institutionName: 'Itaú',
        status: 'LOGIN_ERROR',
        lastUpdatedAt: `${NOW}T10:00:00Z`,
        consentExpiresAt: null,
      },
      NOW,
    )
    const out = parse(await client.callTool({ name: 'list_accounts', arguments: {} }))
    expect(out.avisos.join(' ')).toMatch(/reautoriz/i)
  })

  it('banco vazio orienta a rodar sync em vez de mentir zero', async () => {
    const emptyClient = await connect(new Repo(openDb(':memory:', 'k')))
    const out = parse(await emptyClient.callTool({ name: 'list_accounts', arguments: {} }))
    expect(out.avisos.join(' ')).toMatch(/sync/i)
  })
})
