/**
 * A página inteira numa string: HTML, CSS e JS inline.
 *
 * Sem CDN e sem build — a página funciona offline e não vaza navegação para
 * host nenhum. O token nunca é embutido aqui: o JS lê de `location.search`.
 *
 * Cuidado ao editar: esta é uma template string, então `${` e crases não podem
 * aparecer no conteúdo. O JS interno usa concatenação de string por isso.
 */
export const PAGE_HTML = `<!doctype html>
<html lang="pt-BR">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>openfinance-analyst</title>
<style>
:root{
  --bg:#faf9f7; --card:#fff; --fg:#1c1917; --muted:#78716c; --line:#e7e5e4;
  --accent:#0d7a6f; --accent-soft:#d9f0ed; --neg:#b3261e; --warn-bg:#fdf6e3; --warn-fg:#7c5e10;
}
@media (prefers-color-scheme:dark){
  :root{
    --bg:#16130f; --card:#221e1a; --fg:#f2efeb; --muted:#a09890; --line:#3a342e;
    --accent:#4ecdc0; --accent-soft:#1e3b38; --neg:#f2665c; --warn-bg:#2e2716; --warn-fg:#e8c86a;
  }
}
*{box-sizing:border-box}
body{
  margin:0; padding:24px; background:var(--bg); color:var(--fg);
  font:15px/1.5 ui-sans-serif,-apple-system,system-ui,sans-serif;
}
.num{font-variant-numeric:tabular-nums}
header{max-width:1200px;margin:0 auto 20px}
.top{display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap}
h1{font-size:15px;font-weight:600;margin:0;color:var(--muted);letter-spacing:.02em}
.saldo{font-size:38px;font-weight:650;margin:2px 0 4px;font-variant-numeric:tabular-nums}
.tempos{font-size:12.5px;color:var(--muted)}
.tempos b{font-weight:600;color:var(--fg)}
button{
  margin-left:auto; padding:10px 18px; border:1px solid var(--line); border-radius:8px;
  background:var(--card); color:var(--fg); font:inherit; font-weight:550; cursor:pointer;
}
button:hover:not(:disabled){border-color:var(--accent);color:var(--accent)}
button:disabled{opacity:.55;cursor:progress}
.avisos{margin-top:14px;display:grid;gap:6px}
.aviso{background:var(--warn-bg);color:var(--warn-fg);padding:9px 12px;border-radius:7px;font-size:13px}
.erro{background:var(--neg);color:#fff;padding:9px 12px;border-radius:7px;font-size:13px;margin-top:10px}
main{max-width:1200px;margin:0 auto;display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(340px,1fr))}
section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px}
section h2{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:0 0 14px;font-weight:600}
.row{display:flex;justify-content:space-between;gap:12px;padding:6px 0;font-variant-numeric:tabular-nums}
.row+.row{border-top:1px solid var(--line)}
.row .lbl{color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row .sub{color:var(--muted);font-size:12.5px}
.neg{color:var(--neg)}
.bar{height:6px;background:var(--accent-soft);border-radius:3px;overflow:hidden;margin-top:5px}
.bar>i{display:block;height:100%;background:var(--accent)}
.bar.danger>i{background:var(--neg)}
.destaque{display:flex;gap:20px;flex-wrap:wrap;padding:12px 0 16px;margin-bottom:8px;border-bottom:1px solid var(--line)}
.destaque div{flex:1;min-width:120px}
.destaque span{display:block;font-size:12px;color:var(--muted)}
.destaque strong{font-size:20px;font-weight:600;font-variant-numeric:tabular-nums}
.vazio{color:var(--muted);font-size:13.5px;padding:8px 0}
.mes{display:grid;grid-template-columns:58px 1fr 92px;gap:10px;align-items:center;padding:4px 0;font-size:13px}
.mes .barras{display:grid;gap:2px}
.mes b{font-weight:500;color:var(--muted);font-variant-numeric:tabular-nums}
.mes .v{text-align:right;font-variant-numeric:tabular-nums}
.inicial{max-width:1200px;margin:0 auto;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:24px}
</style>

<header>
  <div class="top">
    <div>
      <h1>openfinance-analyst</h1>
      <div class="saldo" id="saldo-total">—</div>
      <div class="tempos" id="tempos"></div>
    </div>
    <button id="btn-atualizar">&#8635; Atualizar</button>
  </div>
  <div class="avisos" id="avisos"></div>
  <div id="erro"></div>
</header>

<main id="paineis">
  <section id="painel-fluxo"><h2>Fluxo de caixa</h2><div class="vazio">carregando…</div></section>
  <section id="painel-contas"><h2>Contas e cartões</h2><div class="vazio">carregando…</div></section>
  <section id="painel-gastos"><h2>Gastos do mês</h2><div class="vazio">carregando…</div></section>
  <section id="painel-compromissos"><h2>Parcelas e recorrências</h2><div class="vazio">carregando…</div></section>
</main>

<div class="inicial" id="inicial" hidden></div>

<script>
var T = new URLSearchParams(location.search).get('t');
var api = function(p, o){ return fetch(p + '?t=' + encodeURIComponent(T || ''), o); };
var brl = function(n){ return (n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}); };
var el = function(id){ return document.getElementById(id); };
var esc = function(s){ var d=document.createElement('span'); d.textContent=String(s==null?'':s); return d.innerHTML; };

function quando(iso){
  if(!iso) return 'nunca';
  var d = new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso);
  var h = Math.floor((Date.now() - d.getTime())/3600000);
  if (h < 1) return 'agora há pouco';
  if (h < 24) return 'há ' + h + 'h';
  return 'há ' + Math.floor(h/24) + ' dias';
}

function linha(lbl, val, negativo, sub){
  return '<div class="row"><div><div class="lbl">' + esc(lbl) + '</div>' +
    (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') + '</div>' +
    '<div class="' + (negativo ? 'neg' : '') + '">' + brl(val) + '</div></div>';
}

function barra(pct, danger){
  var p = Math.max(0, Math.min(100, pct));
  return '<div class="bar' + (danger ? ' danger' : '') + '"><i style="width:' + p + '%"></i></div>';
}

function renderFluxo(d){
  var f = d.cashFlow, out = '';
  out += '<div class="destaque">' +
    '<div><span>sobra típica/mês</span><strong class="' + (f.sobraTipicaMes < 0 ? 'neg' : '') + '">' + brl(f.sobraTipicaMes) + '</strong></div>' +
    '<div><span>investido líquido/mês</span><strong>' + brl(f.investidoLiquidoMes) + '</strong></div>' +
    '</div>' +
    '<div class="sub" style="color:var(--muted);margin:-4px 0 10px">mediana, não média — um mês atípico distorceria a média o ano inteiro</div>';
  var max = 1;
  for (var i=0;i<f.months.length;i++) max = Math.max(max, f.months[i].income, f.months[i].expenses);
  for (var j=0;j<f.months.length;j++){
    var m = f.months[j];
    out += '<div class="mes"><b>' + esc(m.month) + '</b><div class="barras">' +
      barra(m.income/max*100, false) + barra(m.expenses/max*100, true) +
      '</div><div class="v ' + (m.net < 0 ? 'neg' : '') + '">' + brl(m.net) + '</div></div>';
  }
  return out || '<div class="vazio">sem dados</div>';
}

function renderContas(d){
  var out = '', i;
  for (i=0;i<d.accounts.contas.length;i++){
    var c = d.accounts.contas[i];
    out += linha(c.name, c.balance, c.balance < 0, c.number);
  }
  for (i=0;i<d.accounts.cartoes.length;i++){
    var k = d.accounts.cartoes[i];
    var usado = k.creditLimit ? (k.creditLimit - (k.availableCreditLimit||0)) / k.creditLimit * 100 : 0;
    out += '<div class="row"><div style="flex:1"><div class="lbl">' + esc(k.name) + '</div>' +
      '<div class="sub">limite ' + brl(k.creditLimit) + '</div>' + barra(usado, usado > 80) +
      '</div><div>' + brl(k.balance) + '</div></div>';
  }
  out += '<div class="destaque" style="border:0;margin:12px 0 0;padding:12px 0 0;border-top:1px solid var(--line)">' +
    '<div><span>fatura aberta</span><strong>' + brl(d.accounts.faturaAberta.total) + '</strong></div></div>';
  return out || '<div class="vazio">nenhuma conta</div>';
}

function renderGastos(d){
  var out = '', c = d.spending.comparacao.slice(0, 10);
  if (!c.length) return '<div class="vazio">nenhum gasto no mês</div>';
  for (var i=0;i<c.length;i++){
    var x = c[i];
    var delta = x.deltaPct == null ? 'novo' : (x.delta >= 0 ? '+' : '') + x.deltaPct.toFixed(0) + '%';
    out += linha(x.category, x.current, false, 'mês anterior ' + brl(x.previous) + ' · ' + delta);
  }
  return out;
}

function renderCompromissos(d){
  var out = '', i;
  out += '<div class="destaque">' +
    '<div><span>comprometido (6 meses)</span><strong>' + brl(d.commitments.totalComprometido) + '</strong></div>' +
    '<div><span>recorrentes/mês</span><strong>' + brl(d.commitments.custoMensalRecorrente) + '</strong></div>' +
    '</div>';
  for (i=0;i<d.commitments.proximosMeses.length;i++){
    var m = d.commitments.proximosMeses[i];
    var infer = 0;
    for (var j=0;j<m.items.length;j++) if (m.items[j].projected) infer++;
    out += linha(m.month, m.committed, false,
      m.items.length + ' parcelas' + (infer ? ' · ' + infer + ' inferidas' : ''));
  }
  var ass = d.commitments.recorrentes.slice(0, 8);
  if (ass.length){
    out += '<div class="sub" style="margin:14px 0 4px;color:var(--muted)">recorrências detectadas</div>';
    for (i=0;i<ass.length;i++){
      out += linha(ass[i].merchant, ass[i].amount, false,
        ass[i].cadence + (ass[i].priceIncrease ? ' · subiu de preço' : ''));
    }
  }
  return out;
}

var ultimoBom = null;

function render(d){
  el('saldo-total').textContent = brl(d.header.saldoTotal);
  el('saldo-total').className = 'saldo' + (d.header.saldoTotal < 0 ? ' neg' : '');
  el('tempos').innerHTML =
    'lido da Pluggy <b>' + quando(d.header.lastSyncedAt) + '</b> · ' +
    'coletado do banco <b>' + quando(d.header.lastCollectedAt) + '</b>';

  var av = '';
  for (var i=0;i<d.header.avisos.length;i++) av += '<div class="aviso">' + esc(d.header.avisos[i]) + '</div>';
  el('avisos').innerHTML = av;

  el('inicial').hidden = !d.header.semDados;
  el('paineis').hidden = !!d.header.semDados;
  if (d.header.semDados){
    el('inicial').innerHTML = '<h2>Nada sincronizado ainda</h2>' +
      '<p>Clique em <b>Atualizar</b> para o primeiro sync. Ele traz 24 meses de histórico.</p>';
    return;
  }

  el('painel-fluxo').innerHTML = '<h2>Fluxo de caixa</h2>' + renderFluxo(d);
  el('painel-contas').innerHTML = '<h2>Contas e cartões</h2>' + renderContas(d);
  el('painel-gastos').innerHTML = '<h2>Gastos do mês</h2>' + renderGastos(d);
  el('painel-compromissos').innerHTML = '<h2>Parcelas e recorrências</h2>' + renderCompromissos(d);
}

function erro(msg){
  el('erro').innerHTML = msg ? '<div class="erro">' + esc(msg) + '</div>' : '';
}

function carregar(){
  return api('/api/data').then(function(r){
    if (!r.ok) throw new Error('falha ao carregar os dados');
    return r.json();
  }).then(function(d){ ultimoBom = d; render(d); });
}

function atualizar(){
  var btn = el('btn-atualizar');
  btn.disabled = true; btn.textContent = 'Sincronizando…';
  erro(null);
  return api('/api/sync', { method: 'POST' })
    .then(function(r){ return r.json().then(function(b){ if(!r.ok) throw new Error(b.erro || 'falha no sync'); return b; }); })
    .then(function(){ return carregar(); })
    .catch(function(e){
      // Não apaga a tela: mantém o último dado bom e explica o que houve.
      erro(e.message);
      if (ultimoBom) render(ultimoBom);
    })
    .then(function(){ btn.disabled = false; btn.textContent = '\\u21BB Atualizar'; });
}

el('btn-atualizar').addEventListener('click', atualizar);
carregar().catch(function(e){ erro(e.message); });
</script>
`
