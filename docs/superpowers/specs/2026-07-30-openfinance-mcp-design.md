# openfinance-analyst — MCP de análise de gastos via Open Finance

**Data:** 2026-07-30
**Status:** aprovado, pronto para plano de implementação

## Problema

Analisar gastos espalhados entre bancos tradicionais, bancos digitais e corretoras exige hoje abrir um app por instituição e somar na mão. O objetivo é um MCP server que consolide conta corrente e cartão de crédito de todas as instituições e responda perguntas de gasto diretamente no Claude Code.

## Restrição regulatória e a solução

Consumir as APIs do Open Finance Brasil diretamente exige ser instituição autorizada pelo BACEN, registrada no Diretório de Participantes, com certificados ICP/OFB, mTLS e FAPI. Pessoa física não se cadastra.

A saída é o **Meu Pluggy**: a Pluggy é participante regulado e oferece acesso gratuito e sem prazo de expiração aos dados do **próprio CPF**, cobrindo conta corrente, poupança, cartão de crédito, transações, empréstimos e investimentos.

O limite dessa gratuidade é explícito e define o escopo do projeto: **uso pessoal, um CPF**. Servir outras pessoas cai no plano comercial (Dados a partir de R$ 2.500/mês; a Belvo começa em ~US$ 1.000/mês). Este projeto é e permanece de uso pessoal.

Já existem MCPs de Pluggy (`pluggyai/pluggy-mcp`, embrionário; `thunderjr/openfinance-mcp-server` em Go). Conectividade é problema resolvido — **o valor deste projeto está na camada de análise**, e o esforço vai para lá.

## Setup (fora do código, uma vez)

1. `meu.pluggy.ai` — conectar as instituições pelo fluxo oficial de consentimento do Open Finance.
2. `dashboard.pluggy.ai` — criar aplicação, obter `client_id` e `client_secret`.
3. Connector 200 (MeuPluggy) — expõe os dados já conectados para a aplicação.

Consequência de arquitetura: **o MCP não implementa widget de consentimento e nunca tem contato com credenciais bancárias.** Consome uma API já autorizada.

## Arquitetura

Stack: TypeScript/Node. SDK oficial da Pluggy é Node, o MCP SDK TS é o mais maduro, e `better-sqlite3-multiple-ciphers` dá SQLCipher sem dor de compilação no macOS.

Quatro módulos, cada um com uma responsabilidade e testável isoladamente:

```
pluggy/    cliente HTTP: auth (API key, TTL ~2h), paginação, retry, backoff em rate limit.
           Traduz JSON da Pluggy → tipos do domínio. Não conhece SQLite.
store/     SQLite cifrado: schema, migrations, upsert, queries. Não conhece Pluggy.
analysis/  puro: recebe linhas do domínio, devolve agregados. Zero I/O.
mcp/       tools: valida input (zod), chama analysis, formata resposta. Fino de propósito.
```

Fluxo de dados: `sync` → busca na Pluggy → normaliza → grava no store. **As tools de análise leem apenas do store, nunca da rede.** É o que torna as respostas rápidas, baratas em tokens e determinísticas.

O contrato entre módulos são os tipos do domínio (`Account`, `Transaction`, `Item`). `analysis/` não conhece a forma do JSON da Pluggy; trocar de agregador um dia toca só o `pluggy/`.

### Sync é incremental e por upsert

Watermark por conexão; a cada sync pede apenas o delta. Transação **não é imutável**: nasce `pending`, vira `posted`, e a descrição às vezes é enriquecida depois. Por isso a chave é o `id` da Pluggy e a operação é upsert — **rodar o sync duas vezes não pode duplicar nada.**

### Conexão degradada nunca falha em silêncio

Consentimento do Open Finance expira em 12 meses, e um item pode cair em `LOGIN_ERROR` ou `WAITING_USER_INPUT` a qualquer momento. O modo de falha que estraga análise financeira é o sync "funcionar" servindo dados velhos.

Regra: `sync` reporta status **por instituição**, e toda tool de análise carrega um aviso quando alguma conexão está desatualizada (ex.: "Itaú parado desde 12/07"). Um número com ressalva é melhor que um número errado com cara de certo.

## Modelo de dados

SQLite cifrado com SQLCipher. Chave no Keychain do macOS, arquivo `600` em `~/.openfinance-analyst/`, fora de qualquer diretório sincronizado para nuvem.

| tabela | papel |
|---|---|
| `items` | conexão com instituição: `status`, `last_synced_at`, `consent_expires_at` |
| `accounts` | conta ou cartão: tipo, subtipo, saldo, limite, dia de fechamento e vencimento |
| `transactions` | PK = `id` da Pluggy; data, descrição, valor, categoria, merchant, `installment_number`/`installment_total`, status, payload cru |
| `category_overrides` | regras do usuário: padrão de merchant/descrição → categoria |
| `budgets` | teto por categoria e período |
| `meta` | versão de schema e watermarks de sync |

O **payload cru** fica guardado junto: quando a Pluggy mudar um campo ou uma normalização se mostrar errada, dá para reprocessar sem re-sincronizar tudo.

### Convenção de sinal

Conta corrente e cartão de crédito usam convenções opostas de positivo/negativo. Somar despesa com receita sem perceber é o erro clássico desse domínio.

Regra única, aplicada na entrada: **gasto é sempre negativo, entrada é sempre positiva.** A conversão fica isolada em uma única função no `pluggy/`, com teste dedicado por tipo de conta.

## Tools

Todas devolvem **números agregados**, não listas de transações — exceto `search_transactions`, que é o escape hatch explícito.

**Estado**
- `sync` — puxa o delta; retorna transações novas por instituição e o status de cada conexão
- `list_accounts` — contas e cartões consolidados, com saldo e limite
- `search_transactions` — busca livre com limite, para o que não cabe nas agregações

**Análise**
- `spending_by_category` — período, agrupamento por mês/categoria, filtro por conta, comparação opcional contra o período anterior (responde tanto "pra onde foi meu dinheiro" quanto "gastei mais que em maio")
- `find_recurring` — assinaturas e cobranças recorrentes detectadas
- `card_bill` — composição da fatura atual ou fechada, por categoria
- `installments_outlook` — quanto dos próximos N meses já está comprometido com parcelas em aberto

**Orçamento**
- `set_budget` — define teto por categoria
- `budget_status` — realizado vs meta, com projeção de fim de mês pelo ritmo atual
- `recategorize` — cria regra de override e reprocessa o histórico de uma vez

### Convenções de parâmetros

Fixadas aqui para que toda tool se comporte igual:

- **Período** aceita `YYYY-MM` ou o par `from`/`to` em ISO date. Default: mês corrente.
- **Fuso.** Todo agrupamento por mês usa `America/Sao_Paulo`. Compra de dia 1º à 0h30 pertence ao mês certo — agrupar em UTC jogaria transações para o mês anterior.
- **`sync`** sincroniza todas as conexões por padrão; aceita filtro opcional por instituição.
- **`card_bill`** usa a fatura aberta atual por padrão; a fechada é escolha explícita.
- **`installments_outlook`** projeta 6 meses por padrão.

### Heurísticas

**Recorrência.** Agrupa por merchant normalizado; exige ≥3 ocorrências; intervalo mediano de 30 dias com tolerância de ±4 dias (também reconhece 7, 14 e 365, com a mesma tolerância); variação de valor ≤15%. Marca `price_increase` quando a última cobrança supera a mediana das anteriores em mais de 5% — o caso "a assinatura subiu e eu não vi".

**Parcelas.** Para cada compra com `n de N`, projeta as `N-n` parcelas restantes nos meses seguintes. É o que responde "quanto do meu agosto já está vendido".

**Projeção de orçamento.** Gasto acumulado ÷ dias decorridos × dias do mês.

**Categorização.** Base é a categoria enriquecida pela Pluggy; por cima, `category_overrides` do usuário. Agregador erra feio em caso pessoal ("PIX pro João" não é categoria) — corrigir uma vez tem que valer para sempre, inclusive retroativamente.

## Erros

- Nenhuma tool estoura por conexão degradada: responde com o dado disponível **mais o aviso de qual instituição está desatualizada**.
- Credencial ausente ou inválida → mensagem acionável apontando o passo do setup, nunca stack trace.
- Token nunca aparece em log nem em mensagem de erro.
- Rate limit → backoff exponencial no `pluggy/`.

## Testes

- **`analysis/`** — o foco, porque é puro: fixtures de transações entram, agregados saem. Recorrência com variação de ±3 dias e ±5% no valor; parcelamento 3/12 projetando 9 meses; orçamento avaliado no dia 15; convenção de sinal por tipo de conta.
- **`store/`** — idempotência acima de tudo: rodar o sync duas vezes não duplica nenhuma linha. Migrations aplicam em banco novo e em banco existente.
- **`pluggy/`** — fixtures gravadas e sanitizadas. Teste nunca toca a rede, e fixture com dado real nunca entra no repositório.
- Teste de fumaça manual com dados reais antes de considerar pronto.

## Fora de escopo

- Iniciação de pagamento (Pix). Este MCP é somente leitura.
- Multi-CPF ou qualquer uso comercial — violaria os termos do Meu Pluggy.
- Interface gráfica, dashboard web, app.
- Análise de investimentos. Contas de corretora **são conectadas e aparecem em `list_accounts` com saldo consolidado**, mas posição, rentabilidade e alocação ficam para depois — gasto é o foco.
- Importação de OFX/CSV. Só entra se a Pluggy deixar de atender.

## Referências

- [Meu Pluggy](https://www.pluggy.ai/meu-pluggy) · [pluggyai/meu-pluggy](https://github.com/pluggyai/meu-pluggy)
- [Preços Pluggy](https://www.pluggy.ai/precos) · [Belvo plans](https://belvo.com/plans-and-pricing/)
- [Docs: Accounts](https://docs.pluggy.ai/docs/accounts) · [Docs: Transactions](https://docs.pluggy.ai/docs/transactions)
- [pluggyai/pluggy-mcp](https://github.com/pluggyai/pluggy-mcp) · [thunderjr/openfinance-mcp-server](https://github.com/thunderjr/openfinance-mcp-server)
