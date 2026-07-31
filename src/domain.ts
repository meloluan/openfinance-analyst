/**
 * Tipos que atravessam os módulos. Nenhum deles carrega forma da API da Pluggy:
 * trocar de agregador um dia toca só a camada `pluggy/`.
 */

export type AccountKind = 'BANK' | 'CREDIT'

export type DomainAccount = {
  id: string
  itemId: string
  kind: AccountKind
  name: string
  number: string | null
  balance: number
  currencyCode: string
  creditLimit: number | null
  availableCreditLimit: number | null
  /** YYYY-MM-DD — fechamento da fatura, só para cartão */
  closeDate: string | null
  /** YYYY-MM-DD — vencimento da fatura, só para cartão */
  dueDate: string | null
}

export type TransactionStatus = 'PENDING' | 'POSTED'

export type DomainTransaction = {
  id: string
  accountId: string
  /** YYYY-MM-DD já convertido para America/Sao_Paulo */
  date: string
  description: string
  /**
   * Convenção única do projeto: gasto sempre NEGATIVO, entrada sempre POSITIVA.
   * A Pluggy usa sinal invertido em cartão de crédito; a inversão acontece
   * em `pluggy/normalize.ts` e nunca depois.
   */
  amount: number
  currencyCode: string
  /** Categoria vinda da Pluggy, antes de aplicar os overrides do usuário */
  category: string | null
  merchantName: string | null
  installmentNumber: number | null
  installmentTotal: number | null
  /** YYYY-MM — mês da fatura em que a compra deve ser cobrada */
  billForecastDate: string | null
  status: TransactionStatus
  /** JSON cru da Pluggy, para reprocessar sem re-sincronizar */
  raw: string
}

export type DomainItem = {
  id: string
  institutionName: string
  status: string
  /** ISO timestamp da última sincronização da Pluggy com a instituição */
  lastUpdatedAt: string | null
  /** ISO timestamp — consentimento do Open Finance expira em 12 meses */
  consentExpiresAt: string | null
}

export type ConnectionHealth = {
  itemId: string
  institutionName: string
  status: string
  healthy: boolean
  /** ISO timestamp desde quando os dados estão parados, quando não saudável */
  staleSince: string | null
  /** Texto acionável para o usuário, ou null quando está tudo bem */
  warning: string | null
}

export type SyncReport = {
  connections: ConnectionHealth[]
  /** institutionName → quantidade de transações novas */
  newTransactions: Record<string, number>
  errors: string[]
}

export type Period = { from: string; to: string }
