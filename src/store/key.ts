import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const SERVICE = 'openfinance-analyst'
const ACCOUNT = 'sqlcipher-key'
const SECURITY = '/usr/bin/security'

/**
 * Chave do SQLCipher guardada no Keychain do macOS. Na primeira execução gera
 * 32 bytes aleatórios e persiste; depois só lê.
 *
 * `execFileSync` com array de argumentos, nunca string interpolada em shell —
 * a chave não passa por `sh` e não aparece em `ps`.
 */
export function getOrCreateKey(): string {
  try {
    return execFileSync(SECURITY, ['find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    const key = randomBytes(32).toString('hex')
    execFileSync(SECURITY, ['add-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w', key], {
      stdio: 'ignore',
    })
    return key
  }
}
