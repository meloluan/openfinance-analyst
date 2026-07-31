import { describe, it, expect } from 'vitest'
import { parseConfig } from '../src/config.js'

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

  it('resolve dbPath dentro do dataDir', () => {
    const c = parseConfig({
      PLUGGY_CLIENT_ID: 'a',
      PLUGGY_CLIENT_SECRET: 'b',
      OFA_DATA_DIR: '/tmp/ofa-test',
    })
    expect(c.dbPath).toBe('/tmp/ofa-test/data.db')
  })
})
