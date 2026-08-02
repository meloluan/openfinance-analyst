import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const SERVICE = 'openfinance-analyst'
const SECURITY = '/usr/bin/security'

/**
 * Onde os segredos vivem quando não há Keychain: um arquivo por segredo,
 * `600`, num diretório `700`.
 */
function secretsDir(): string {
  const explicit = process.env.OFA_SECRETS_DIR?.trim()
  if (explicit) return explicit
  const dataDir = process.env.OFA_DATA_DIR?.trim() || join(homedir(), '.openfinance-analyst')
  return join(dataDir, 'secrets')
}

/**
 * Keychain só existe no macOS. Em Linux — servidor, container, Raspberry Pi —
 * o binário `security` não está lá e o processo morreria no boot.
 *
 * `OFA_SECRET_BACKEND` força um dos dois, útil para teste e para quem prefere
 * arquivo mesmo no Mac.
 */
export function backend(): 'keychain' | 'file' {
  const forced = process.env.OFA_SECRET_BACKEND?.trim()
  if (forced === 'keychain' || forced === 'file') return forced
  return process.platform === 'darwin' && existsSync(SECURITY) ? 'keychain' : 'file'
}

/** O nome vira caminho no backend de arquivo — nada fora de [a-z0-9-] passa. */
function safeName(account: string): string {
  return account.toLowerCase().replace(/[^a-z0-9-]/g, '_')
}

/**
 * Lê um segredo. Devolve null quando não existe.
 *
 * `execFileSync` com array de argumentos, nunca string em shell: o segredo não
 * passa por `sh` e não aparece em `ps`.
 */
export function getSecret(account: string): string | null {
  if (backend() === 'keychain') {
    try {
      return execFileSync(SECURITY, ['find-generic-password', '-s', SERVICE, '-a', account, '-w'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
    } catch {
      return null
    }
  }

  const path = join(secretsDir(), safeName(account))
  if (!existsSync(path)) return null
  // Se o arquivo afrouxou por algum motivo, aperta antes de usar.
  chmodSync(path, 0o600)
  return readFileSync(path, 'utf8').trim()
}

export function setSecret(account: string, value: string): void {
  if (backend() === 'keychain') {
    // -U atualiza se já existir, em vez de falhar com duplicata.
    execFileSync(
      SECURITY,
      ['add-generic-password', '-U', '-s', SERVICE, '-a', account, '-w', value],
      { stdio: 'ignore' },
    )
    return
  }

  const dir = secretsDir()
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const path = join(dir, safeName(account))
  writeFileSync(path, value, { mode: 0o600 })
  chmodSync(path, 0o600) // writeFileSync respeita umask; chmod não.
}
