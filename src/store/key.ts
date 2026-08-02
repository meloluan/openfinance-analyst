import { randomBytes } from 'node:crypto'
import { getSecret, setSecret } from './secrets.js'

const ACCOUNT = 'sqlcipher-key'

/**
 * Chave do SQLCipher. Na primeira execução gera 32 bytes aleatórios e persiste;
 * depois só lê.
 *
 * Onde ela fica depende da plataforma — Keychain no macOS, arquivo `600` em
 * Linux. Ver `secrets.ts`.
 */
export function getOrCreateKey(): string {
  const existing = getSecret(ACCOUNT)
  if (existing) return existing

  const key = randomBytes(32).toString('hex')
  setSecret(ACCOUNT, key)
  return key
}
