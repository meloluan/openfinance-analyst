import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Gateway } from '../pluggy/client.js'
import type { Repo } from '../store/repo.js'
import { assessHealth, syncAll } from '../sync.js'
import {
  addMonths,
  monthOf,
  previousPeriod,
  resolvePeriod,
  today,
  type PeriodInput,
} from '../analysis/period.js'
import { comparePeriods, round2, spendingByCategory, spendingByMonth } from '../analysis/spending.js'
import { cashFlow } from '../analysis/cashflow.js'
import { findRecurring } from '../analysis/recurring.js'
import { installmentsOutlook } from '../analysis/installments.js'
import { budgetStatus } from '../analysis/budget.js'
import { billComposition } from '../analysis/bill.js'

export type ToolContext = { repo: Repo; gateway: Gateway; declaredItemIds: string[] }

/** Depois de 2 dias sem sync, o número já merece ressalva. */
const STALE_AFTER_DAYS = 2

/**
 * Nenhuma tool de análise serve número velho com cara de fresco. Todo resultado
 * carrega os avisos de conexão degradada, consentimento vencendo e sync atrasado.
 */
function connectionWarnings(repo: Repo): string[] {
  const now = today()
  const warnings: string[] = []
  const items = repo.listItems()

  if (items.length === 0) {
    return ['Nenhuma conexão sincronizada ainda. Rode a tool `sync` primeiro.']
  }

  for (const item of items) {
    const health = assessHealth(item, now)
    if (health.warning) warnings.push(health.warning)

    if (item.lastSyncedAt) {
      const daysSince = Math.floor(
        (Date.parse(`${now}T00:00:00Z`) - Date.parse(`${item.lastSyncedAt.slice(0, 10)}T00:00:00Z`)) /
          86_400_000,
      )
      if (daysSince > STALE_AFTER_DAYS) {
        warnings.push(
          `${item.institutionName}: última sincronização em ${item.lastSyncedAt.slice(0, 10)} ` +
            `(${daysSince} dias atrás). Rode \`sync\` para atualizar.`,
        )
      }
    }
  }
  return warnings
}

function respond(repo: Repo, payload: Record<string, unknown>) {
  const avisos = connectionWarnings(repo)
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ ...payload, moeda: 'BRL', avisos }, null, 2),
      },
    ],
  }
}

function fail(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true }
}

const periodShape = {
  period: z.string().optional().describe("Mês no formato YYYY-MM. Default: mês corrente."),
  from: z.string().optional().describe('Início do intervalo, YYYY-MM-DD. Use junto com `to`.'),
  to: z.string().optional().describe('Fim do intervalo, YYYY-MM-DD. Use junto com `from`.'),
}

export function registerTools(server: McpServer, ctx: ToolContext): void {
  const { repo, gateway } = ctx

  // ---------------------------------------------------------------- estado

  server.registerTool(
    'sync',
    {
      title: 'Sincronizar conexões',
      description:
        'Puxa transações novas de todas as instituições conectadas e devolve o status de cada conexão. ' +
        'Rode antes de qualquer análise se os dados estiverem velhos.',
      inputSchema: {
        itemIds: z
          .array(z.string())
          .optional()
          .describe('IDs de conexão adicionais para registrar (obtidos em meu.pluggy.ai).'),
      },
    },
    async ({ itemIds }) => {
      const report = await syncAll(gateway, repo, [...ctx.declaredItemIds, ...(itemIds ?? [])])
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(report, null, 2) }],
      }
    },
  )

  server.registerTool(
    'list_accounts',
    {
      title: 'Listar contas e cartões',
      description: 'Contas e cartões conectados, com saldo, limite e datas de fatura.',
      inputSchema: {},
    },
    async () => {
      const accounts = repo.listAccounts()
      return respond(repo, {
        contas: accounts.filter((a) => a.kind === 'BANK'),
        cartoes: accounts.filter((a) => a.kind === 'CREDIT'),
        saldoTotalEmConta: accounts
          .filter((a) => a.kind === 'BANK')
          .reduce((s, a) => s + a.balance, 0),
      })
    },
  )

  server.registerTool(
    'search_transactions',
    {
      title: 'Buscar transações',
      description:
        'Busca livre por descrição ou estabelecimento. Use apenas quando as tools de agregação ' +
        'não responderem — elas são mais precisas e mais baratas.',
      inputSchema: {
        term: z.string().min(1).describe('Texto a buscar na descrição ou no estabelecimento.'),
        limit: z.number().int().min(1).max(500).default(100).describe('Máximo de resultados.'),
      },
    },
    async ({ term, limit }) => respond(repo, { transacoes: repo.searchTransactions(term, limit) }),
  )

  // --------------------------------------------------------------- análise

  server.registerTool(
    'spending_by_category',
    {
      title: 'Gastos por categoria',
      description:
        'Total gasto por categoria no período, opcionalmente comparado com o período anterior. ' +
        'Responde "pra onde foi meu dinheiro" e "gastei mais que no mês passado".',
      inputSchema: {
        ...periodShape,
        kind: z
          .enum(['BANK', 'CREDIT'])
          .optional()
          .describe('Filtra só conta (BANK) ou só cartão (CREDIT). Default: os dois.'),
        compareWithPrevious: z
          .boolean()
          .default(false)
          .describe('Compara com o período imediatamente anterior.'),
        byMonth: z.boolean().default(false).describe('Também quebra o total por mês.'),
      },
    },
    async ({ period, from, to, kind, compareWithPrevious, byMonth }) => {
      let range
      try {
        range = resolvePeriod({ period, from, to } as PeriodInput)
      } catch (err) {
        return fail(err instanceof Error ? err.message : 'Período inválido.')
      }

      const overrides = repo.listOverrides()
      const txs = repo.queryTransactions({ ...range, kind })
      const payload: Record<string, unknown> = {
        periodo: range,
        porCategoria: spendingByCategory(txs, overrides),
        totalGasto: spendingByCategory(txs, overrides).reduce((s, c) => s + c.total, 0),
      }

      if (byMonth) payload.porMes = spendingByMonth(txs)

      // Parcela futura chega como transação datada à frente. Somá-la sem dizer
      // transformaria "quanto gastei" em "quanto gastei mais quanto ainda vou".
      const now = today()
      const futuras = txs.filter((tx) => tx.date > now && tx.amount < 0)
      if (futuras.length > 0) {
        payload.observacao =
          `${futuras.length} transações do período ainda não aconteceram ` +
          `(parcelas futuras já lançadas pela instituição) e estão somadas no total.`
      }

      if (compareWithPrevious) {
        const prev = previousPeriod(range)
        payload.periodoAnterior = prev
        payload.comparacao = comparePeriods(
          txs,
          repo.queryTransactions({ ...prev, kind }),
          overrides,
        )
      }

      return respond(repo, payload)
    },
  )

  server.registerTool(
    'cash_flow',
    {
      title: 'Fluxo de caixa',
      description:
        'Receita vs gasto mês a mês, separando o que é dinheiro de verdade entrando e saindo do ' +
        'que é só movimento entre contas suas. Responde "por que não sobra dinheiro". ' +
        'Não conta pagamento de fatura em dobro e trata investimento como poupança, não gasto.',
      inputSchema: {
        months: z
          .number()
          .int()
          .min(1)
          .max(36)
          .default(12)
          .describe('Quantos meses para trás analisar.'),
      },
    },
    async ({ months }) => {
      const now = today()
      const kinds = new Map(repo.listAccounts().map((a) => [a.id, a.kind]))
      const txs = repo.queryTransactions({
        from: `${addMonths(monthOf(now), -(months - 1))}-01`,
        to: now,
      })
      const flow = cashFlow(txs, kinds)
      return respond(repo, {
        ...flow,
        mediaMensal: {
          receita: round2(flow.totals.income / Math.max(flow.months.length, 1)),
          gasto: round2(flow.totals.expenses / Math.max(flow.months.length, 1)),
          sobra: round2(flow.totals.net / Math.max(flow.months.length, 1)),
        },
        mesesNoVermelho: flow.months.filter((m) => m.net < 0).map((m) => m.month),
      })
    },
  )

  server.registerTool(
    'find_recurring',
    {
      title: 'Assinaturas e recorrências',
      description:
        'Detecta cobranças que se repetem (assinaturas, mensalidades) e marca as que subiram de preço.',
      inputSchema: {
        lookbackMonths: z
          .number()
          .int()
          .min(3)
          .max(36)
          .default(12)
          .describe('Quantos meses de histórico varrer.'),
      },
    },
    async ({ lookbackMonths }) => {
      const now = today()
      const from = `${addMonths(monthOf(now), -lookbackMonths)}-01`
      const recorrentes = findRecurring(repo.queryTransactions({ from, to: now }))
      return respond(repo, {
        janela: { from, to: now },
        recorrentes,
        totalMensalEstimado: recorrentes
          .filter((r) => r.cadence === 'MONTHLY')
          .reduce((s, r) => s + r.amount, 0),
        aumentaramDePreco: recorrentes.filter((r) => r.priceIncrease),
      })
    },
  )

  server.registerTool(
    'card_bill',
    {
      title: 'Fatura do cartão',
      description:
        'Composição da fatura de um mês, por categoria. Usa o mês de cobrança informado pela ' +
        'instituição, então compra feita depois do fechamento cai na fatura certa.',
      inputSchema: {
        month: z.string().optional().describe('Mês da fatura, YYYY-MM. Default: fatura aberta atual.'),
        accountId: z.string().optional().describe('Restringe a um cartão específico.'),
      },
    },
    async ({ month, accountId }) => {
      const billMonth = month ?? monthOf(today())
      if (!/^\d{4}-\d{2}$/.test(billMonth)) return fail(`Mês inválido: "${billMonth}". Use YYYY-MM.`)

      // Janela ampla: compra de meses anteriores pode ter sido alocada nesta fatura.
      const txs = repo.queryTransactions({
        from: `${addMonths(billMonth, -2)}-01`,
        to: `${addMonths(billMonth, 1)}-28`,
        kind: 'CREDIT',
        accountIds: accountId ? [accountId] : undefined,
      })

      return respond(repo, { fatura: billComposition(txs, billMonth, repo.listOverrides()) })
    },
  )

  server.registerTool(
    'installments_outlook',
    {
      title: 'Parcelas comprometidas',
      description:
        'Quanto dos próximos meses já está comprometido com parcelas em aberto. ' +
        'Responde "quanto do meu agosto já está vendido".',
      inputSchema: {
        months: z.number().int().min(1).max(24).default(6).describe('Horizonte em meses.'),
      },
    },
    async ({ months }) => {
      const now = today()
      // Para trás, 24 meses cobrem o parcelamento mais longo que ainda tem saldo.
      // Para frente é obrigatório: a instituição manda as parcelas futuras como
      // transações datadas à frente, e `to: now` as deixaria de fora justamente
      // na tool que existe para enxergá-las.
      const txs = repo.queryTransactions({
        from: `${addMonths(monthOf(now), -24)}-01`,
        to: `${addMonths(monthOf(now), months + 2)}-28`,
        kind: 'CREDIT',
      })
      const outlook = installmentsOutlook(txs, months, monthOf(now))
      return respond(repo, {
        proximosMeses: outlook,
        totalComprometido: outlook.reduce((s, m) => s + m.committed, 0),
      })
    },
  )

  // -------------------------------------------------------------- orçamento

  server.registerTool(
    'set_budget',
    {
      title: 'Definir meta de gasto',
      description: 'Define ou atualiza o teto mensal de uma categoria.',
      inputSchema: {
        category: z.string().min(1).describe('Nome da categoria, exatamente como aparece nas análises.'),
        amount: z.number().positive().describe('Teto mensal em reais.'),
      },
    },
    async ({ category, amount }) => {
      repo.setBudget(category, amount)
      return respond(repo, { definido: { category, amount }, metas: repo.listBudgets() })
    },
  )

  server.registerTool(
    'budget_status',
    {
      title: 'Situação do orçamento',
      description:
        'Realizado vs meta por categoria, com projeção de fim de mês pelo ritmo atual de gasto.',
      inputSchema: periodShape,
    },
    async ({ period, from, to }) => {
      const budgets = repo.listBudgets()
      if (budgets.length === 0) {
        return respond(repo, {
          metas: [],
          observacao: 'Nenhuma meta definida ainda. Use `set_budget` para criar a primeira.',
        })
      }

      let range
      try {
        range = resolvePeriod({ period, from, to } as PeriodInput)
      } catch (err) {
        return fail(err instanceof Error ? err.message : 'Período inválido.')
      }

      const linhas = budgetStatus(
        repo.queryTransactions(range),
        budgets,
        range,
        today(),
        repo.listOverrides(),
      )
      return respond(repo, {
        periodo: range,
        linhas,
        vaoEstourar: linhas.filter((l) => l.willExceed).map((l) => l.category),
      })
    },
  )

  server.registerTool(
    'recategorize',
    {
      title: 'Corrigir categoria',
      description:
        'Cria uma regra que reclassifica toda transação cujo estabelecimento ou descrição contenha ' +
        'o padrão. Vale retroativamente — corrigir uma vez vale para sempre.',
      inputSchema: {
        pattern: z
          .string()
          .min(2)
          .describe('Trecho do estabelecimento ou descrição, ex.: "IFOOD". Não diferencia maiúscula.'),
        category: z.string().min(1).describe('Categoria a aplicar.'),
      },
    },
    async ({ pattern, category }) => {
      repo.addOverride(pattern, category)
      const now = today()
      // Para frente também: parcela futura é transação datada à frente, e uma
      // regra de categoria precisa valer para ela tanto quanto para o passado.
      const afetadas = repo
        .queryTransactions({
          from: `${addMonths(monthOf(now), -24)}-01`,
          to: `${addMonths(monthOf(now), 12)}-28`,
        })
        .filter((tx) => `${tx.merchantName ?? ''} ${tx.description}`.toUpperCase().includes(pattern.toUpperCase()))

      return respond(repo, {
        regra: { pattern, category },
        transacoesAfetadas: afetadas.length,
        regrasAtuais: repo.listOverrides(),
      })
    },
  )
}
