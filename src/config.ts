import { homedir } from 'node:os'
import { join } from 'node:path'

export type Config = {
  clientId: string
  clientSecret: string
  /**
   * O SDK da Pluggy não expõe listagem de items, então as conexões precisam ser
   * declaradas. Depois do primeiro sync elas ficam persistidas na tabela `items`.
   */
  itemIds: string[]
  dataDir: string
  dbPath: string
}

const SETUP_HINT =
  'Conecte seus bancos em meu.pluggy.ai, crie uma aplicação em dashboard.pluggy.ai ' +
  'e exporte as credenciais como variáveis de ambiente do MCP.'

export function parseConfig(env: Record<string, string | undefined>): Config {
  const clientId = env.PLUGGY_CLIENT_ID?.trim()
  const clientSecret = env.PLUGGY_CLIENT_SECRET?.trim()

  const missing: string[] = []
  if (!clientId) missing.push('PLUGGY_CLIENT_ID')
  if (!clientSecret) missing.push('PLUGGY_CLIENT_SECRET')
  if (missing.length > 0) {
    // Só nomes de variáveis entram na mensagem — nunca valores.
    throw new Error(`Faltando ${missing.join(' e ')}. ${SETUP_HINT}`)
  }

  const dataDir = env.OFA_DATA_DIR?.trim() || join(homedir(), '.openfinance-analyst')

  return {
    clientId: clientId!,
    clientSecret: clientSecret!,
    itemIds: (env.PLUGGY_ITEM_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    dataDir,
    dbPath: join(dataDir, 'data.db'),
  }
}

export const loadConfig = (): Config => parseConfig(process.env)
