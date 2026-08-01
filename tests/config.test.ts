import { describe, it, expect } from 'vitest'
import { parseConfig, parsePaths, resolveEnv } from '../src/config.js'

describe('parseConfig', () => {
  it('exige clientId e clientSecret', () => {
    expect(() => parseConfig({})).toThrow(/PLUGGY_CLIENT_ID/)
  })

  it('parseia itemIds separados por vírgula, ignorando espaço', () => {
    const c = parseConfig({
      PLUGGY_CLIENT_ID: 'a',
      PLUGGY_CLIENT_SECRET: 'b',
      PLUGGY_ITEM_IDS: 'i1, i2 ,i3',
    })
    expect(c.itemIds).toEqual(['i1', 'i2', 'i3'])
  })

  it('aceita ausência de itemIds', () => {
    const c = parseConfig({ PLUGGY_CLIENT_ID: 'a', PLUGGY_CLIENT_SECRET: 'b' })
    expect(c.itemIds).toEqual([])
  })

  it('nunca inclui o secret na mensagem de erro', () => {
    expect.assertions(1)
    try {
      parseConfig({ PLUGGY_CLIENT_SECRET: 'super-secreto' })
    } catch (e) {
      expect(String(e)).not.toContain('super-secreto')
    }
  })

  it('parsePaths funciona sem credencial nenhuma', () => {
    // O dashboard precisa abrir em modo leitura mesmo sem credencial.
    const p = parsePaths({ OFA_DATA_DIR: '/tmp/ofa' })
    expect(p.dbPath).toBe('/tmp/ofa/data.db')
    expect(p.itemIds).toEqual([])
  })

  it('resolve dbPath dentro do dataDir', () => {
    const c = parseConfig({
      PLUGGY_CLIENT_ID: 'a',
      PLUGGY_CLIENT_SECRET: 'b',
      OFA_DATA_DIR: '/tmp/ofa-test',
    })
    expect(c.dbPath).toBe('/tmp/ofa-test/data.db')
  })
})

describe('resolveEnv', () => {
  const keychain = (m: Record<string, string>) => (a: string) => m[a] ?? null

  it('usa o Keychain quando o ambiente não tem as credenciais', () => {
    // É o caso do `npm run dash`: shell comum não herda o env do MCP.
    const e = resolveEnv(
      {},
      keychain({
        'pluggy-client-id': 'id-do-keychain',
        'pluggy-client-secret': 'segredo-do-keychain',
        'pluggy-item-ids': 'i1,i2',
      }),
    )
    expect(parseConfig(e).clientId).toBe('id-do-keychain')
    expect(parseConfig(e).itemIds).toEqual(['i1', 'i2'])
  })

  it('o ambiente vence o Keychain', () => {
    const e = resolveEnv(
      { PLUGGY_CLIENT_ID: 'do-env', PLUGGY_CLIENT_SECRET: 's' },
      keychain({ 'pluggy-client-id': 'do-keychain' }),
    )
    expect(parseConfig(e).clientId).toBe('do-env')
  })

  it('sem env e sem Keychain continua faltando, com mensagem acionável', () => {
    expect(() => parseConfig(resolveEnv({}, () => null))).toThrow(/PLUGGY_CLIENT_ID/)
  })
})
