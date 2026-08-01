import type { AccountKind, DomainAccount, DomainTransaction } from '../domain.js'
import { addMonths, monthOf } from './period.js'

export type AccountCoverage = {
  accountId: string
  name: string
  kind: AccountKind
  /** primeira e última data com lançamento, ou null quando não há nenhum */
  from: string | null
  to: string | null
  count: number
}

export type Coverage = {
  accounts: AccountCoverage[]
  /**
   * Primeiro dia do primeiro mês em que TODAS as contas com dados já têm
   * cobertura. Antes disso a análise mistura conta com histórico e conta sem,
   * e o gasto que falta some sem deixar rastro.
   */
  reliableFrom: string | null
  /** Contas sem lançamento nenhum: não travam a janela, mas precisam ser ditas. */
  semLancamentos: string[]
  /** Explicação de quem determinou o início da janela. */
  limitadoPor: string | null
}

/**
 * Recua o início pedido até onde os dados sustentam.
 *
 * Toda análise passa por aqui: é o que impede que uma janela mais larga que a
 * cobertura produza número errado em vez de número incompleto.
 */
export function clampFrom(desiredFrom: string, coverage: Coverage): string {
  return coverage.reliableFrom && coverage.reliableFrom > desiredFrom
    ? coverage.reliableFrom
    : desiredFrom
}

/** Se um período inteiro cabe dentro da cobertura. */
export function isCovered(from: string, coverage: Coverage): boolean {
  return coverage.reliableFrom === null || from >= coverage.reliableFrom
}

/**
 * Até onde os dados vão, de verdade.
 *
 * O Open Finance entrega só o que a instituição guarda, e cada uma guarda um
 * tanto. Analisar um período mais largo que a cobertura não produz um número
 * incompleto — produz um número **errado**, porque a conta corrente registra o
 * pagamento da fatura de meses cujas compras não existem no banco de dados.
 *
 * Uma conta sem lançamento nenhum não limita a janela: ela pode simplesmente
 * nunca ter sido usada, e travar a análise por causa dela zeraria tudo.
 */
export function dataCoverage(
  accounts: DomainAccount[],
  txs: DomainTransaction[],
  now: string,
): Coverage {
  const porConta = new Map<string, string[]>()
  for (const tx of txs) {
    const datas = porConta.get(tx.accountId)
    if (datas) datas.push(tx.date)
    else porConta.set(tx.accountId, [tx.date])
  }

  const cobertura: AccountCoverage[] = accounts.map((a) => {
    const datas = (porConta.get(a.id) ?? []).sort()
    return {
      accountId: a.id,
      name: a.name,
      kind: a.kind,
      from: datas[0] ?? null,
      to: datas[datas.length - 1] ?? null,
      count: datas.length,
    }
  })

  const comDados = cobertura.filter((c) => c.from !== null)
  const semLancamentos = cobertura.filter((c) => c.from === null).map((c) => c.name)

  if (comDados.length === 0) {
    return { accounts: cobertura, reliableFrom: null, semLancamentos, limitadoPor: null }
  }

  // A conta que começa mais tarde é quem manda: antes dela a foto está incompleta.
  const maisTardia = comDados.reduce((a, b) => (a.from! >= b.from! ? a : b))

  // Mês seguinte ao primeiro lançamento: o mês de estreia é ele mesmo parcial.
  // Mas nunca além do mês corrente — numa conexão recém-criada isso jogaria a
  // janela para o futuro e a análise não mostraria nada.
  const mesSeguinte = `${addMonths(monthOf(maisTardia.from!), 1)}-01`
  const mesCorrente = `${monthOf(now)}-01`
  const reliableFrom = mesSeguinte > mesCorrente ? mesCorrente : mesSeguinte

  return {
    accounts: cobertura,
    reliableFrom,
    semLancamentos,
    limitadoPor: `${maisTardia.name} (primeiro lançamento em ${maisTardia.from})`,
  }
}
