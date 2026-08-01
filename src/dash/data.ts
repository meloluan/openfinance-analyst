import type { Repo } from '../store/repo.js'
import type { DomainAccount } from '../domain.js'
import { assessHealth } from '../sync.js'
import { cashFlow, type CashFlowSummary } from '../analysis/cashflow.js'
import { billComposition, type Bill } from '../analysis/bill.js'
import { findRecurring, type Recurring } from '../analysis/recurring.js'
import { installmentsOutlook, type OutlookMonth } from '../analysis/installments.js'
import {
  comparePeriods,
  round2,
  spendingByCategory,
  type CategoryComparison,
  type CategoryTotal,
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
  const flow = cashFlow(
    repo.queryTransactions({ from: `${addMonths(mes, -(CASHFLOW_MONTHS - 1))}-01`, to: now }),
    kinds,
  )
  const n = Math.max(flow.months.length, 1)

  const periodo = resolvePeriod({ period: mes }, now)
  const anterior = previousPeriod(periodo)
  const txsMes = repo.queryTransactions(periodo)

  // Janela para trás cobre o parcelamento mais longo com saldo; para frente é
  // obrigatória, porque a instituição manda parcela futura como transação
  // datada à frente e `to: now` as deixaria justamente de fora.
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
    header: {
      saldoTotal: round2(contas.reduce((s, a) => s + a.balance, 0)),
      lastSyncedAt: items[0]?.lastSyncedAt ?? null,
      lastCollectedAt: items[0]?.lastUpdatedAt ?? null,
      avisos,
      semDados,
    },
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
