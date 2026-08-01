# Dashboard local — design

**Data:** 2026-07-31
**Status:** aprovado, pronto para plano de implementação

## Problema

Consultar os números hoje exige passar pelo Claude. Para o acompanhamento rotineiro — saldo, fatura, quanto está comprometido, quanto sobrou no mês — isso é caro e lento demais. Falta uma superfície que atualize sob demanda sem LLM no caminho.

## Restrição que define a solução

O banco é SQLite cifrado com SQLCipher e a chave vive no Keychain do macOS. Qualquer leitura precisa acontecer **como o usuário, na máquina dele**. Isso elimina qualquer dashboard hospedado sem exportar os dados para fora — o que contrariaria a decisão de privacidade tomada no [design original](2026-07-30-openfinance-mcp-design.md).

Logo: servidor local, processo local, nada sai da máquina.

## Arquitetura

```
src/dash/
  server.ts   node:http puro, sem framework. Três rotas.
  data.ts     monta o payload dos painéis a partir do Repo + analysis/. Testável.
  page.ts     HTML + CSS + JS como string única, autocontida.
```

| rota | faz |
|---|---|
| `GET /` | devolve a página |
| `GET /api/data` | payload dos quatro painéis, lido do store |
| `POST /api/sync` | executa `syncAll` e devolve o `SyncReport` |

`npm run dash` sobe o servidor e abre o navegador.

**Nenhuma lógica de análise é reescrita.** `data.ts` chama as mesmas funções que as tools MCP chamam — `cashFlow`, `spendingByCategory`, `installmentsOutlook`, `findRecurring`, `billComposition`, `assessHealth`. Divergência de número entre o dashboard e o Claude é bug, não interpretação.

O fluxo: página carrega → `GET /api/data` → renderiza. Clique em Atualizar → `POST /api/sync` → `GET /api/data` → re-renderiza.

## Segurança

**Bind em `127.0.0.1`, nunca `0.0.0.0`.** Numa rede compartilhada, `0.0.0.0` publica o extrato para quem estiver no mesmo wi-fi.

**Token aleatório por sessão.** O servidor gera um token no boot e imprime `http://127.0.0.1:<porta>/?t=<token>`. Requisição sem token válido recebe 403. Sem isso, qualquer página aberta no navegador pode tentar bater em `localhost`. O CORS impede a leitura da resposta na maioria dos casos, mas extrato bancário não é lugar para depender de "na maioria dos casos".

**O token nunca entra no HTML servido** — ele viaja na query string e é lido pelo JS a partir de `location.search`.

## Painéis

**Cabeçalho.** Saldo consolidado, botão Atualizar e faixa de avisos quando houver. Os avisos vêm de `assessHealth` — mesmo texto que aparece no Claude, não uma segunda implementação.

O cabeçalho mostra **dois tempos, não um**: quando nós lemos a Pluggy (`items.last_synced_at`) e quando a Pluggy coletou da instituição (`items.last_updated_at`). São grandezas diferentes, e confundi-las já causou um bug real — o Banco do Brasil recém-conectado não aparecia enquanto tudo indicava estar atualizado. O segundo tempo é o que importa para saber se o dado é novo.

**Fluxo de caixa.** Doze meses de receita, gasto e sobra. Inclui a comparação **sobra média vs investimento líquido**, que é o que responde "por que não sobra dinheiro".

**Contas, cartões e fatura.** Saldos, limite usado por cartão em barra, composição da fatura aberta. Saldo negativo destacado.

**Gastos e compromissos.** Mês corrente por categoria contra o anterior, maiores variações no topo. Ao lado, os próximos 6 meses de parcelas comprometidas e as assinaturas ativas com custo mensal recorrente.

## Erros

- Sync que falha **não apaga a tela**: mensagem no cabeçalho, painéis mantêm o último dado bom com a hora dele.
- Banco vazio mostra estado inicial explicando o setup, em vez de zeros que parecem reais.
- Token e credencial nunca chegam ao HTML nem a log.
- Porta ocupada: erro claro dizendo qual porta e como trocar. A porta é **4000** por padrão, sobrescrita por `OFA_DASH_PORT`.

## Visual

Sem biblioteca de gráfico e sem CDN — barras em CSS puro dão conta de 12 meses e mantêm a página autocontida e funcional offline. Números em fonte tabular para as colunas alinharem. Claro e escuro conforme `prefers-color-scheme`. Vermelho reservado para saldo negativo e mês no vermelho; se toda despesa for vermelha, o sinal se perde.

## Testes

- **`data.ts`** — o foco: fixtures entram, payload dos quatro painéis sai, com assert nos números.
- **`server.ts`** — segurança acima de tudo: requisição sem token dá 403, com token dá 200, e o bind é `127.0.0.1`. Sobe em porta efêmera (`0`) para não colidir.
- **`page.ts`** — teste garante que o HTML não referencia host externo, que é o que mantém a página offline e sem vazar navegação.

## Fora de escopo

- Autenticação de usuário. A barreira é o Keychain e o `127.0.0.1`; não há multiusuário.
- Edição de dados pela página. O dashboard lê; a única escrita é o `sync`.
- Gráficos interativos, filtros dinâmicos, exportação. Se aparecer necessidade, entra depois.
- Empacotamento como app. É um comando de terminal.
