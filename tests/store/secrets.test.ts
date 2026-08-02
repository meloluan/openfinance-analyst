import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, statSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backend, getSecret, setSecret } from '../../src/store/secrets.js'
import { getOrCreateKey } from '../../src/store/key.js'

const dirs: string[] = []
let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = {
    OFA_SECRET_BACKEND: process.env.OFA_SECRET_BACKEND,
    OFA_SECRETS_DIR: process.env.OFA_SECRETS_DIR,
  }
  const dir = mkdtempSync(join(tmpdir(), 'ofa-sec-'))
  dirs.push(dir)
  // Força o backend de arquivo: o teste precisa rodar igual em macOS e Linux,
  // e mexer no Keychain real da máquina de quem roda a suíte é inaceitável.
  process.env.OFA_SECRET_BACKEND = 'file'
  process.env.OFA_SECRETS_DIR = join(dir, 'secrets')
})

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('backend', () => {
  it('respeita a escolha explícita', () => {
    expect(backend()).toBe('file')
    process.env.OFA_SECRET_BACKEND = 'keychain'
    expect(backend()).toBe('keychain')
  })

  it('sem escolha explícita, usa arquivo fora do macOS', () => {
    delete process.env.OFA_SECRET_BACKEND
    const esperado = process.platform === 'darwin' ? 'keychain' : 'file'
    expect(backend()).toBe(esperado)
  })
})

describe('backend de arquivo', () => {
  it('grava e lê de volta', () => {
    setSecret('pluggy-client-id', 'abc123')
    expect(getSecret('pluggy-client-id')).toBe('abc123')
  })

  it('segredo inexistente devolve null em vez de estourar', () => {
    expect(getSecret('nunca-gravado')).toBeNull()
  })

  it('sobrescreve sem duplicar', () => {
    setSecret('x', 'antigo')
    setSecret('x', 'novo')
    expect(getSecret('x')).toBe('novo')
  })

  it('o arquivo do segredo fica 600', () => {
    setSecret('x', 'v')
    const path = join(process.env.OFA_SECRETS_DIR!, 'x')
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('o diretório fica 700', () => {
    setSecret('x', 'v')
    expect(statSync(process.env.OFA_SECRETS_DIR!).mode & 0o777).toBe(0o700)
  })

  it('nome de conta não escapa do diretório', () => {
    // Os nomes vêm do nosso código, mas um path traversal aqui gravaria
    // segredo em lugar arbitrário — não vale depender de disciplina.
    setSecret('../../fora', 'v')
    expect(existsSync(join(process.env.OFA_SECRETS_DIR!, '______fora'))).toBe(true)
  })

  it('valor com espaços e quebras sobrevive', () => {
    setSecret('x', '  com espaço  \n')
    expect(getSecret('x')).toBe('com espaço')
  })
})

describe('getOrCreateKey', () => {
  it('gera uma chave hex de 32 bytes na primeira vez', () => {
    const k = getOrCreateKey()
    expect(k).toMatch(/^[0-9a-f]{64}$/)
  })

  it('devolve a mesma chave nas chamadas seguintes', () => {
    expect(getOrCreateKey()).toBe(getOrCreateKey())
  })
})
