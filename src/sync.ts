import type { ConnectionHealth, DomainItem, SyncReport } from './domain.js'
import type { Gateway } from './pluggy/client.js'
import type { Repo } from './store/repo.js'
import { addDays, addMonths, monthOf, today } from './analysis/period.js'

/** Quanto histórico buscar quando a conexão nunca foi sincronizada. */
const BACKFILL_MONTHS = 24

/**
 * Quanto re-varrer a cada sync incremental. Transação não é imutável: nasce
 * PENDING, vira POSTED, e a descrição às vezes é enriquecida depois. Como o
 * upsert é por id, revisitar a janela recente é barato e é o que mantém o
 * dado correto.
 */
const RESYNC_WINDOW_DAYS = 35

/** Dias antes de `consentExpiresAt` em que já vale avisar. */
const CONSENT_WARNING_DAYS = 30

const HEALTHY_STATUSES = new Set(['UPDATED', 'UPDATING'])

export function assessHealth(item: DomainItem, now: string): ConnectionHealth {
  const healthy = HEALTHY_STATUSES.has(item.status)
  const warnings: string[] = []

  switch (item.status) {
    case 'LOGIN_ERROR':
      warnings.push(
        `${item.institutionName}: a conexão caiu e precisa ser reautorizada em meu.pluggy.ai.`,
      )
      break
    case 'WAITING_USER_INPUT':
    case 'WAITING_USER_ACTION':
      warnings.push(
        `${item.institutionName}: aguardando sua ação (MFA ou autorização) em meu.pluggy.ai.`,
      )
      break
    case 'OUTDATED':
      warnings.push(`${item.institutionName}: os dados estão desatualizados.`)
      break
    default:
      break
  }

  if (item.consentExpiresAt) {
    const limit = addDays(now, CONSENT_WARNING_DAYS)
    const expiresOn = item.consentExpiresAt.slice(0, 10)
    if (expiresOn <= limit) {
      warnings.push(
        `${item.institutionName}: o consentimento do Open Finance expira em ${expiresOn} — ` +
          `renove em meu.pluggy.ai para não perder o histórico novo.`,
      )
    }
  }

  return {
    itemId: item.id,
    institutionName: item.institutionName,
    status: item.status,
    healthy,
    staleSince: healthy ? null : item.lastUpdatedAt,
    warning: warnings.length > 0 ? warnings.join(' ') : null,
  }
}

/**
 * Puxa o delta de cada conexão para o store.
 *
 * Falha em uma conexão não aborta as outras — entra em `errors` e o sync
 * continua, porque perder o Itaú não é motivo para perder o Nubank também.
 */
export async function syncAll(
  gateway: Gateway,
  repo: Repo,
  itemIds: string[],
  now: string = today(),
): Promise<SyncReport> {
  // O env declara as conexões na primeira vez; depois elas vivem no banco.
  const known = repo.listItems().map((i) => i.id)
  const targets = [...new Set([...itemIds, ...known])]

  const report: SyncReport = { connections: [], newTransactions: {}, errors: [] }

  // Sem conexão declarada não há o que sincronizar — e um relatório vazio e
  // silencioso pareceria sucesso. O itemId não está documentado pela Pluggy,
  // então a mensagem carrega o caminho exato.
  if (targets.length === 0) {
    report.errors.push(
      'Nenhuma conexão configurada. Para obter o item ID: conecte seus bancos em ' +
        'meu.pluggy.ai, crie uma aplicação em dashboard.pluggy.ai (Applications), ' +
        'adicione o conector "MeuPluggy" a ela, clique em "Ir para Demo", autorize com ' +
        'sua conta do Meu Pluggy e use o menu de três pontos (canto superior direito) → ' +
        '"Copiar Item ID". Passe o valor em PLUGGY_ITEM_IDS ou no argumento itemIds desta tool.',
    )
    return report
  }

  for (const itemId of targets) {
    try {
      const item = await gateway.fetchItem(itemId)
      report.connections.push(assessHealth(item, now))
      repo.upsertItem(item, now)

      const accounts = await gateway.fetchAccounts(itemId)
      repo.upsertAccounts(accounts)

      const watermark = repo.getWatermark(itemId)
      const since = watermark
        ? addDays(watermark, -RESYNC_WINDOW_DAYS)
        : `${addMonths(monthOf(now), -BACKFILL_MONTHS)}-01`

      let added = 0
      for (const account of accounts) {
        const txs = await gateway.fetchTransactions(account.id, account.kind, since)
        added += repo.upsertTransactions(txs)
      }

      repo.setWatermark(itemId, now)
      report.newTransactions[item.institutionName] = added
    } catch (err) {
      // Mensagem sem payload da exceção: erro de SDK pode carregar credencial.
      const reason = err instanceof Error ? err.message : 'erro desconhecido'
      report.errors.push(`Conexão ${itemId} falhou: ${reason}`)
    }
  }

  return report
}
