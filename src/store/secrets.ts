import { execFileSync } from 'node:child_process'

const SERVICE = 'openfinance-analyst'
const SECURITY = '/usr/bin/security'

/**
 * Credenciais da Pluggy no Keychain, no mesmo lugar e com a mesma proteção da
 * chave do SQLCipher.
 *
 * O MCP recebe as credenciais por variável de ambiente, injetadas pelo Claude
 * Code. Um comando de shell comum (`npm run dash`) não herda nada disso — daí
 * a necessidade de uma fonte que os dois enxerguem. Arquivo `.env` resolveria,
 * mas guardaria segredo em texto claro; o Keychain não.
 *
 * `execFileSync` com array de argumentos, nunca string em shell: o segredo não
 * passa por `sh` e não aparece em `ps`.
 */
export function getSecret(account: string): string | null {
  try {
    return execFileSync(SECURITY, ['find-generic-password', '-s', SERVICE, '-a', account, '-w'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

export function setSecret(account: string, value: string): void {
  // -U atualiza se já existir, em vez de falhar com duplicata.
  execFileSync(SECURITY, ['add-generic-password', '-U', '-s', SERVICE, '-a', account, '-w', value], {
    stdio: 'ignore',
  })
}
