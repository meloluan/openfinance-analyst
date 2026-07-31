import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync, rmSync, mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { openDb } from '../../src/store/db.js'
import { Repo } from '../../src/store/repo.js'

const dirs: string[] = []
function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ofa-enc-'))
  dirs.push(dir)
  return join(dir, 'data.db')
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('cifra em disco', () => {
  it('o arquivo NÃO começa com o header de SQLite em texto claro', () => {
    const path = tempDbPath()
    const db = openDb(path, 'a'.repeat(64))
    new Repo(db).setBudget('Alimentação', 800)
    db.close()

    const header = readFileSync(path).subarray(0, 16).toString('utf8')
    expect(header).not.toContain('SQLite format 3')
  })

  it('não vaza conteúdo gravado em texto claro no arquivo', () => {
    const path = tempDbPath()
    const db = openDb(path, 'b'.repeat(64))
    new Repo(db).addOverride('MERCADO-SECRETO-XYZ', 'Alimentação')
    db.close()

    expect(readFileSync(path).toString('latin1')).not.toContain('MERCADO-SECRETO-XYZ')
  })

  it('abre com a chave certa e recupera o dado', () => {
    const path = tempDbPath()
    const key = 'c'.repeat(64)
    const db = openDb(path, key)
    new Repo(db).setBudget('Transporte', 300)
    db.close()

    const reopened = openDb(path, key)
    expect(new Repo(reopened).listBudgets()).toEqual([{ category: 'Transporte', amount: 300 }])
    reopened.close()
  })

  it('o arquivo do banco fica 600, não legível por outros processos', () => {
    const path = tempDbPath()
    const db = openDb(path, 'e'.repeat(64))
    db.close()
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('falha ao abrir com a chave errada', () => {
    const path = tempDbPath()
    const db = openDb(path, 'd'.repeat(64))
    new Repo(db).setBudget('Lazer', 200)
    db.close()

    expect(() => {
      const wrong = new Database(path)
      wrong.pragma("key='chave-errada'")
      wrong.prepare('SELECT * FROM budgets').all()
    }).toThrow()
  })
})
