import Database from 'better-sqlite3-multiple-ciphers'
import { chmodSync } from 'node:fs'
import { MIGRATIONS } from './schema.js'

export type Db = Database.Database

/**
 * Abre o banco cifrado com SQLCipher e aplica as migrations pendentes.
 * `key` vem do Keychain (ver `key.ts`) — nunca de arquivo em disco.
 */
export function openDb(path: string, key: string): Db {
  const db = new Database(path)

  // SQLCipher recusa cifrar banco em memória — e não precisa: ele nunca toca o
  // disco. Só banco de arquivo recebe a chave. Os testes usam ':memory:'.
  const isInMemory = path === ':memory:' || path === ''
  if (!isInMemory) {
    // A chave é interpolada porque PRAGMA não aceita bind parameter; o escape de
    // aspas simples evita quebrar a string. A chave gerada é hex, então não contém aspas.
    db.pragma(`key='${key.replace(/'/g, "''")}'`)
    db.pragma('journal_mode = WAL')

    // 0o600 mesmo com o diretório em 0o700: o banco guarda o extrato inteiro,
    // e o default do SQLite (0o644) deixaria legível para qualquer processo do usuário.
    chmodSync(path, 0o600)
  }
  db.pragma('foreign_keys = ON')

  const current = db.pragma('user_version', { simple: true }) as number
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec(MIGRATIONS[v]!)
    db.pragma(`user_version = ${v + 1}`)
  }

  return db
}
