import type { Repo } from '../store/repo.js'
import type { DomainAccount } from '../domain.js'
import { assessHealth } from '../sync.js'
import { cashFlow, NON_EXPENSE_CATEGORIES, type CashFlowSummary } from '../analysis/cashflow.js'
import { billComposition, type Bill } from '../analysis/bill.js'
import { findRecurring, type Recurring } from '../analysis/recurring.js'
import { installmentsOutlook, type OutlookMonth } from '../analysis/installments.js'
import {
  comparePeriods,
  median,
  round2,
  spendingByCategory,
  type CategoryComparison,
  type CategoryTotal,
} from '../analysis/spending.js'
import { addMonths, monthOf, previousPeriod, resolvePeriod } from '../analysis/period.js'
import { clampFrom, dataCoverage, isCovered, type Coverage } from '../analysis/coverage.js'

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
  /** Até onde os dados vão de verdade, e o que limitou a janela. */
  coverage: Coverage & { janelaAnalisada: { from: string; to: string } }
  cashFlow: CashFlowSummary & {
    mediaMensal: { receita: number; gasto: number; sobra: number }
    /**
     * Mediana da sobra mensal. É o número que vai no destaque: a média é
     * dominada por um mês atípico e faria parecer que sobra muito mais do que
     * de fato sobra num mês comum.
     */
    sobraTipicaMes: number
    investidoLiquidoMes: number
  }
  accounts: { contas: DomainAccount[]; cartoes: DomainAccount[]; faturaAberta: Bill }
  spending: {
    periodo: { from: string; to: string }
    atual: CategoryTotal[]
    comparacao: CategoryComparison[]
    /** false quando o mês anterior está fora da cobertura e comparar mentiria */
    comparavel: boolean
  }
  commitments: {
    proximosMeses: OutlookMonth[]
    totalComprometido: number
    recorrentes: Recurring[]
    /** Soma das cobranças mensais recorrentes — inclui boleto e seguro, não só assinatura. */
    custoMensalRecorrente: number
  }
}

/**
 * Monta tudo que a página precisa, numa chamada.
 *
 * Não implementa análise nenhuma: chama exatamente as mesmas funções que as
 * tools MCP chamam. Se um número divergir entre o dashboard e o Claude, é bug.
 */
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

  const contas = accounts.filter((a) => a.kind === 'BANK')
  const cartoes = accounts.filter((a) => a.kind === 'CREDIT')

  const kinds = new Map(accounts.map((a) => [a.id, a.kind]))

  // A janela vem da cobertura real, não de um "12 meses" arbitrário. Analisar
  // além do que os dados cobrem não dá um número incompleto — dá um número
  // errado, porque a conta registra fatura de meses cujas compras não existem.
  const todas = repo.queryTransactions({ from: '1970-01-01', to: `${addMonths(mes, 24)}-28` })
  const cobertura = dataCoverage(accounts, todas, now)
  const janelaPedida = `${addMonths(mes, -(CASHFLOW_MONTHS - 1))}-01`
  const from = clampFrom(janelaPedida, cobertura)

  if (from !== janelaPedida) {
    avisos.push(
      `Análise limitada a partir de ${from}: ${cobertura.limitadoPor}. ` +
        `Antes disso o histórico não cobre todas as contas e os números sairiam errados.`,
    )
  }
  if (cobertura.semLancamentos.length > 0) {
    avisos.push(
      `Sem lançamento nenhum: ${cobertura.semLancamentos.join(', ')}. ` +
        `A instituição não publica o histórico dessas contas.`,
    )
  }

  const flow = cashFlow(repo.queryTransactions({ from, to: now }), kinds)
  const n = Math.max(flow.months.length, 1)

  const periodo = resolvePeriod({ period: mes }, now)
  const anterior = previousPeriod(periodo)

  // Mesmo critério do fluxo de caixa: investimento e movimento entre contas
  // próprias não são gasto. Sem isso os dois painéis da mesma tela se
  // contradizem — um chamando investimento de gasto, o outro de poupança.
  const soConsumo = (t: { category: string | null }): boolean =>
    !NON_EXPENSE_CATEGORIES.has(t.category ?? '')
  const txsMes = repo.queryTransactions(periodo).filter(soConsumo)

  // Comparar contra um mês fora da cobertura produziria uma queda inventada:
  // o mês anterior pareceria barato só porque metade dele não foi coletada.
  const anteriorCoberto = isCovered(anterior.from, cobertura)
  const txsMesAnterior = anteriorCoberto
    ? repo.queryTransactions(anterior).filter(soConsumo)
    : []

  // Janela para trás cobre o parcelamento mais longo com saldo; para frente é
  // obrigatória, porque a instituição manda parcela futura como transação
  // datada à frente e `to: now` as deixaria justamente de fora.
  const txsCredito = repo.queryTransactions({
    from: clampFrom(`${addMonths(mes, -24)}-01`, cobertura),
    to: `${addMonths(mes, OUTLOOK_MONTHS + 2)}-28`,
    kind: 'CREDIT',
  })
  const outlook = installmentsOutlook(txsCredito, OUTLOOK_MONTHS, mes)
  const recorrentes = findRecurring(
    repo.queryTransactions({
      from: clampFrom(`${addMonths(mes, -RECURRING_LOOKBACK_MONTHS)}-01`, cobertura),
      to: now,
    }),
  )

  return {
    header: {
      saldoTotal: round2(contas.reduce((s, a) => s + a.balance, 0)),
      lastSyncedAt: items[0]?.lastSyncedAt ?? null,
      lastCollectedAt: items[0]?.lastUpdatedAt ?? null,
      avisos,
      semDados,
    },
    coverage: { ...cobertura, janelaAnalisada: { from, to: now } },
    cashFlow: {
      ...flow,
      mediaMensal: {
        receita: round2(flow.totals.income / n),
        gasto: round2(flow.totals.expenses / n),
        sobra: round2(flow.totals.net / n),
      },
      sobraTipicaMes: round2(median(flow.months.map((m) => m.net))),
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
      comparacao: anteriorCoberto ? comparePeriods(txsMes, txsMesAnterior, overrides) : [],
      comparavel: anteriorCoberto,
    },
    commitments: {
      proximosMeses: outlook,
      totalComprometido: round2(outlook.reduce((s, m) => s + m.committed, 0)),
      recorrentes,
      custoMensalRecorrente: round2(
        recorrentes.filter((a) => a.cadence === 'MONTHLY').reduce((s, a) => s + a.amount, 0),
      ),
    },
  }
}
