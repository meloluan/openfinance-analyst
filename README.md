# openfinance-analyst

MCP server que consolida suas contas e cartões de várias instituições via Open Finance e responde perguntas de gasto com números agregados — não com listas de transações.

```
"pra onde foi meu dinheiro em junho?"
"gastei mais com comida que no mês passado?"
"que assinaturas subiram de preço?"
"quanto do meu agosto já está comprometido com parcelas?"
```

## Por que passa pela Pluggy

Consumir as APIs do Open Finance Brasil diretamente exige ser instituição autorizada pelo BACEN, registrada no Diretório de Participantes, com certificados ICP/OFB, mTLS e FAPI. Pessoa física não se cadastra.

O **[Meu Pluggy](https://www.pluggy.ai/meu-pluggy)** resolve isso: a Pluggy é participante regulado e dá acesso gratuito, sem prazo de expiração, aos dados do **seu próprio CPF**.

> **Isto é de uso pessoal, um CPF.** Servir outras pessoas cai no plano comercial da Pluggy (a partir de R$ 2.500/mês). O projeto é somente leitura — nenhuma tool inicia pagamento.

### O trial de 14 dias não se aplica a você (se você conectar do jeito certo)

O trial cobre os **recursos comerciais** — conectar contas de outras pessoas. Acabado o trial, "as conexões com contas reais de clientes pausam até você ativar um plano". O acesso aos **seus próprios** dados é outra coisa: "o Meu Pluggy e o acesso à API através dele são gratuitos por tempo indeterminado, sem prazo de expiração", via **Conector 200**.

A armadilha é que o dashboard deixa criar a conexão dos dois jeitos, e o caminho errado é o mais intuitivo:

| como você conecta | conector | o que acontece em 14 dias |
|---|---|---|
| escolhendo **MeuPluggy** na lista | `200` | continua funcionando, de graça, sem prazo |
| escolhendo **Itaú / Nubank** direto | outro | **pausa** até você assinar um plano |

O MCP detecta isso: se alguma conexão não for o conector 200, toda resposta de análise passa a carregar um aviso explicando que ela vai pausar. Você descobre no primeiro `sync`, não no dia 15.

## Setup

> São **dois portais separados, com cadastros separados**. `meu.pluggy.ai` é só o consentimento — ele não expõe credencial de API e não é onde você a procura. As credenciais nascem no `dashboard.pluggy.ai`.

**1. Conecte seus bancos** em [meu.pluggy.ai](https://meu.pluggy.ai) — fluxo oficial de consentimento do Open Finance. O MCP nunca vê sua senha de banco.

**2. Crie a aplicação** em [dashboard.pluggy.ai](https://dashboard.pluggy.ai) (outro cadastro) → aba **Applications** → nova aplicação. `CLIENT_ID` e `CLIENT_SECRET` aparecem aqui.

**3. Adicione o conector `MeuPluggy`** à lista de conectores da aplicação.

**4. Vincule e pegue o item ID.** Na aplicação, clique em **"Ir para Demo"**, faça login com a conta do Meu Pluggy e autorize — isso cria o Item. Depois, no **menu de três pontos (canto superior direito) → "Copiar Item ID"**.

> Esse último passo não está na documentação da Pluggy. O `itemId` não aparece em nenhuma tela óbvia do dashboard, e o SDK não tem `fetchItems()` para descobri-lo — por isso ele precisa ser declarado uma vez em `PLUGGY_ITEM_IDS`. Depois do primeiro `sync` fica salvo no banco local e você não precisa mais dele.

**5. Instale:**

```bash
npm install && npm run build
```

**6. Registre no Claude Code:**

```bash
claude mcp add openfinance-analyst -- node /caminho/para/openfinance-analyst/dist/index.js
```

Com as variáveis de ambiente:

| variável | obrigatória | o que é |
|---|---|---|
| `PLUGGY_CLIENT_ID` | sim | credencial da aplicação |
| `PLUGGY_CLIENT_SECRET` | sim | credencial da aplicação |
| `PLUGGY_ITEM_IDS` | primeira vez | IDs das conexões, separados por vírgula |
| `OFA_DATA_DIR` | não | default `~/.openfinance-analyst` |

**7. Rode a tool `sync`** uma vez. O primeiro sync faz backfill de 24 meses.

## As tools

| tool | responde |
|---|---|
| `sync` | puxa o delta e reporta o status de cada conexão |
| `list_accounts` | contas e cartões com saldo, limite e datas de fatura |
| `spending_by_category` | gasto por categoria no período, com comparação opcional contra o anterior |
| `find_recurring` | assinaturas detectadas, marcando as que subiram de preço |
| `card_bill` | composição da fatura de um mês, por categoria |
| `installments_outlook` | quanto dos próximos meses já está comprometido |
| `set_budget` / `budget_status` | meta por categoria e realizado, com projeção de fim de mês |
| `recategorize` | corrige a categoria de um estabelecimento, retroativamente |
| `search_transactions` | busca livre, para o que não cabe nas agregações |

## Decisões que valem conhecer

**Os dados ficam no seu disco, cifrados.** SQLite com SQLCipher, chave no Keychain do macOS, arquivo `600` em `~/.openfinance-analyst/`. As tools de análise leem só do banco local — nunca da rede — o que torna a resposta rápida, barata e determinística.

**Cartão de crédito inverte o sinal.** Na Pluggy, valor positivo em cartão significa nova compra; em conta corrente significa entrada. Tudo é normalizado na entrada para uma regra única: **gasto negativo, entrada positiva**. Somar sem isso mistura despesa com receita silenciosamente.

**Nenhum número velho passa por fresco.** Consentimento do Open Finance expira em 12 meses e conexão cai sozinha. Toda resposta de análise carrega um campo `avisos` dizendo qual instituição está desatualizada, precisa de reautorização, ou está com consentimento perto de vencer.

**Sync é por upsert, nunca insert.** Transação não é imutável: nasce `PENDING`, vira `POSTED`, e a descrição às vezes é enriquecida depois. Cada sync revisita os últimos 35 dias; a chave é o `id` da Pluggy, então rodar duas vezes não duplica nada.

**Agrupamento mensal em `America/Sao_Paulo`.** Em UTC, compra de dia 1º à 0h30 cairia no mês anterior.

## Desenvolvimento

```bash
npm test          # 105 testes
npm run typecheck
npm run build
```

O módulo `analysis/` é puro — sem I/O, sem rede, sem banco. É onde mora a lógica que produz os números e é onde mora a maior parte dos testes.

Spec e plano de implementação em `docs/superpowers/`.

## Removendo

```bash
rm -rf ~/.openfinance-analyst
security delete-generic-password -s openfinance-analyst
```
