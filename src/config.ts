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

  return { ...parsePaths(env), clientId: clientId!, clientSecret: clientSecret! }
}

/** A parte da config que não depende de credencial — sempre resolvível. */
export function parsePaths(env: Record<string, string | undefined>): Omit<
  Config,
  'clientId' | 'clientSecret'
> {
  const dataDir = env.OFA_DATA_DIR?.trim() || join(homedir(), '.openfinance-analyst')
  return {
    itemIds: (env.PLUGGY_ITEM_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    dataDir,
    dbPath: join(dataDir, 'data.db'),
  }
}

/**
 * Env primeiro, Keychain depois.
 *
 * O MCP recebe as credenciais por variável de ambiente, injetadas pelo Claude
 * Code. `npm run dash` é um shell comum e não herda nada disso — o Keychain é
 * o que os dois enxergam.
 */
export function resolveEnv(
  env: Record<string, string | undefined>,
  fromKeychain: (account: string) => string | null,
): Record<string, string | undefined> {
  return {
    ...env,
    PLUGGY_CLIENT_ID: env.PLUGGY_CLIENT_ID?.trim() || fromKeychain('pluggy-client-id') || undefined,
    PLUGGY_CLIENT_SECRET:
      env.PLUGGY_CLIENT_SECRET?.trim() || fromKeychain('pluggy-client-secret') || undefined,
    PLUGGY_ITEM_IDS: env.PLUGGY_ITEM_IDS?.trim() || fromKeychain('pluggy-item-ids') || undefined,
  }
}

export const loadConfig = (): Config => parseConfig(process.env)
