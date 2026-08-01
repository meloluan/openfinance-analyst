import { describe, it, expect } from 'vitest'
import { PAGE_HTML } from '../../src/dash/page.js'

describe('PAGE_HTML', () => {
  it('não referencia nenhum host externo', () => {
    // Sem CDN a página funciona offline e não vaza navegação.
    expect(PAGE_HTML).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/)
  })

  it('não embute token nem credencial', () => {
    expect(PAGE_HTML).not.toMatch(/PLUGGY_CLIENT|client_secret/i)
    expect(PAGE_HTML).not.toMatch(/\?t=[0-9a-f]{8}/i)
  })

  it('lê o token de location.search em vez de tê-lo embutido', () => {
    expect(PAGE_HTML).toContain('location.search')
  })

  it('tem os quatro painéis e o botão', () => {
    for (const id of [
      'painel-fluxo',
      'painel-contas',
      'painel-gastos',
      'painel-compromissos',
      'btn-atualizar',
    ]) {
      expect(PAGE_HTML, `faltou ${id}`).toContain(id)
    }
  })

  it('trata claro e escuro', () => {
    expect(PAGE_HTML).toContain('prefers-color-scheme')
  })

  it('usa numeração tabular para as colunas alinharem', () => {
    expect(PAGE_HTML).toContain('tabular-nums')
  })

  it('mantém o último dado bom quando o sync falha', () => {
    expect(PAGE_HTML).toContain('ultimoBom')
  })
})
