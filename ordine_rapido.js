/* ============================================================
   ORDINE RAPIDO - prima pagina dell'app, senza PIN
   - elenco di TUTTI i prodotti (anche senza AAMS), in ordine alfabetico
   - per ognuno si scrive solo il numero di stecche
   - in alto: stecche totali e importo dell'ordine (prezzo al pubblico), sempre visibili
   - tasto "ORDINI DI OGGI": solo i prodotti gia' scelti oggi, per abbassare le quantita'
   - le quantita' valgono per OGGI, si salvano (telefono + online) e si possono riaprire piu' volte
   - tasto FINITO: crea il file Excel nel formato Logista con tutto l'ordine di oggi
   Usa le funzioni globali dell'app: supa, S, $, esc, eur, localDay, askConfirm, showWarning,
   toast, exportOrdineLogista, aamsKey
   ============================================================ */
(function(){
'use strict';
const nomeP = p => ((p.marca||'')+' '+(p.nome||'')).trim();
const O = { q:{}, ts:0, exp:0, giorno:'', view:'tutti', filter:'', srv:'?', dirty:false, syncT:0, busy:false, poll:0 };
const key = () => 'bt_ordine_'+O.giorno;
const hhmm = ms => { const d=new Date(ms); return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); };
const noSql = m => /ordine_giorno|function|schema cache|does not exist|PGRST20/i.test(m);

/* ---------- salvataggio ---------- */
function loadLocal(){
  O.q={}; O.ts=0; O.exp=0;
  try{ const j=JSON.parse(localStorage.getItem(key())||'null'); if(j && j.q){ O.q=j.q; O.ts=j.ts||0; O.exp=j.exp||0; } }catch(e){}
  try{ for(let i=localStorage.length-1;i>=0;i--){ const k=localStorage.key(i); if(k && k.indexOf('bt_ordine_')===0 && k!==key()) localStorage.removeItem(k); } }catch(e){}
}
function saveLocal(){ try{ localStorage.setItem(key(), JSON.stringify({q:O.q,ts:O.ts,exp:O.exp})); }catch(e){} }
function srvLabel(){ return O.srv==='ok'?'☁ salvato':O.srv==='pending'?'☁ salvo…':O.srv==='off'?'⚠ salvato solo su questo telefono':O.srv==='err'?'⚠ non salvato online, riprovo':''; }
function queue(){
  O.ts=Date.now(); saveLocal(); O.dirty=true; clearTimeout(O.syncT);
  if(O.srv==='off'){ paintTot(); return; }
  O.srv='pending'; paintTot(); O.syncT=setTimeout(doSync,500);
}
async function doSync(){
  if(O.busy){ O.syncT=setTimeout(doSync,600); return; }
  if(O.srv==='off' || !O.dirty) return;
  O.busy=true; O.dirty=false;
  try{
    const r=await supa.rpc('ordine_giorno_salva',{p_giorno:O.giorno,p_righe:O.q}); if(r.error) throw r.error;
    O.srv='ok';
  }catch(e){
    const m=String((e&&e.message)||e);
    if(noSql(m)) O.srv='off'; else { O.srv='err'; O.dirty=true; O.syncT=setTimeout(doSync,10000); }
  }
  O.busy=false; paintTot();
}
async function fromServer(){
  try{
    const r=await supa.rpc('ordine_giorno_leggi',{p_giorno:O.giorno}); if(r.error) throw r.error;
    O.srv='ok'; const d=r.data;
    if(d && d.righe){
      const st=Date.parse(d.updated_at)||0;
      if(st>O.ts){ O.q=d.righe; O.ts=st; if(d.esportato_at) O.exp=Date.parse(d.esportato_at)||O.exp; saveLocal(); }
      else if(O.ts>st){ O.dirty=true; doSync(); }
    }else if(Object.keys(O.q).length){ O.dirty=true; doSync(); }
  }catch(e){ const m=String((e&&e.message)||e); O.srv = noSql(m) ? 'off' : 'err'; }
}

/* ---------- dati ---------- */
const qty = c => Math.max(0, parseInt(O.q[c])||0);
function items(){ return S.inv.filter(p=>qty(p.code)>0).map(p=>({ p, stecche:qty(p.code), pezzi:qty(p.code)*10 })); }
function totali(){ let st=0, eu=0, n=0; for(const o of items()){ st+=o.stecche; eu+=o.stecche*10*(Number(o.p.prezzo)||0); n++; } return {st,eu,n}; }
function setQ(code, v, fromInput){
  v=Math.max(0, Math.min(999, parseInt(v)||0));
  if(v>0) O.q[code]=v; else delete O.q[code];
  queue();
  const row=document.querySelector('#orList [data-row="'+CSS.escape(code)+'"]');
  if(row){
    const inp=row.querySelector('input'); if(inp && !fromInput) inp.value = v>0?String(v):'';
    row.classList.toggle('bg-emerald-50',v>0); row.classList.toggle('border-emerald-400',v>0);
    row.classList.toggle('bg-slate-50',v===0);
  }
}

/* ---------- schermata ---------- */
function ensure(){
  if($('orModal')) return;
  document.body.insertAdjacentHTML('beforeend', `
  <div id="orModal" class="modal hidden fixed inset-0 bg-white z-[250] flex flex-col" style="padding-top:env(safe-area-inset-top)">
    <div class="px-3 py-3 bg-slate-900 text-white flex items-center justify-between gap-2">
      <div class="min-w-0"><h3 class="font-black text-[17px]">ORDINE DI OGGI</h3><p id="orSub" class="text-[11px] text-slate-300"></p></div>
      <button data-or="cassa" class="shrink-0 px-4 h-11 min-h-0 bg-white/15 rounded-xl font-black text-[13px]">CASSA ›</button>
    </div>
    <div class="px-3 py-2 bg-yellow-300 flex items-center justify-between gap-3">
      <div><p class="text-[11px] font-black text-slate-700">ORDINE FINORA</p><p id="orTot" class="font-black text-[24px] leading-tight text-slate-900"></p></div>
      <p id="orStecche" class="font-black text-[15px] text-slate-900 text-right"></p>
    </div>
    <div class="px-3 pt-2 flex gap-2">
      <input id="orSearch" type="search" placeholder="Cerca per nome..." class="flex-1 min-w-0 bg-slate-50 border-2 rounded-xl px-3 py-3 font-bold text-[14px]">
      <button id="orToggle" data-or="toggle" class="shrink-0 px-3 rounded-xl font-black text-[12px] min-h-0 bg-slate-900 text-white"></button>
    </div>
    <div id="orList" class="flex-1 overflow-auto px-3 py-2 space-y-2"></div>
    <div class="p-3 border-t bg-white">
      <button data-or="finito" id="orFinito" class="w-full rounded-2xl py-4 font-black text-[16px] min-h-0 bg-emerald-500 text-white">FINITO · CREA IL FILE EXCEL</button>
      <p id="orNota" class="text-center text-[11px] font-bold text-slate-400 mt-1"></p>
    </div>
  </div>`);
  const m=$('orModal');
  m.addEventListener('click', e=>{
    const el=e.target.closest('[data-or]'); if(!el) return;
    const a=el.dataset.or, c=el.dataset.c;
    if(a==='minus') setQ(c, qty(c)-1);
    else if(a==='plus') setQ(c, qty(c)+1);
    else if(a==='toggle'){ O.view = O.view==='tutti'?'oggi':'tutti'; renderList(); paintTot(); }
    else if(a==='finito') finito();
    else if(a==='cassa') close();
  });
  m.addEventListener('input', e=>{
    const t=e.target;
    if(t.id==='orSearch'){ O.filter=t.value; renderList(); return; }
    if(t.dataset && t.dataset.orq){ t.value=t.value.replace(/\D/g,'').slice(0,3); setQ(t.dataset.orq, t.value, true); paintTot(); }
  });
  m.addEventListener('focusin', e=>{ if(e.target.dataset && e.target.dataset.orq) setTimeout(()=>{ try{ e.target.select(); }catch(x){} },30); });
}
function paintTot(){
  if(!$('orModal')) return;
  const t=totali();
  $('orTot').textContent = eur(t.eu);
  $('orStecche').innerHTML = t.st+' stecche<br><span class="text-[12px] font-bold">'+t.n+' prodotti</span>';
  $('orSub').textContent = new Date().toLocaleDateString('it-IT',{weekday:'long',day:'numeric',month:'long'})+' · '+srvLabel();
  $('orToggle').textContent = O.view==='tutti' ? 'ORDINI DI OGGI ('+t.n+')' : 'TUTTI I PRODOTTI';
  $('orNota').textContent = O.exp ? 'Ultimo file creato alle '+hhmm(O.exp)+'. Ogni volta contiene TUTTO l\'ordine di oggi.' : 'Prezzo al pubblico. Le quantità si salvano da sole.';
  $('orFinito').className='w-full rounded-2xl py-4 font-black text-[16px] min-h-0 '+(t.n?'bg-emerald-500 text-white':'bg-slate-200 text-slate-400');
}
function rowHtml(p){
  const c=esc(p.code), n=qty(p.code), aams=String(p.codice_aams||'').trim();
  const cls = n>0 ? 'bg-emerald-50 border-emerald-400' : (aams?'bg-slate-50':'bg-orange-50 border-orange-400 border-2');
  return `<div data-row="${c}" class="${cls} border rounded-xl p-2.5 flex items-center gap-2">
    <div class="min-w-0 flex-1"><p class="font-bold text-[13px] break-words">${esc(nomeP(p))}</p>${aams?'':'<p class="text-[10px] font-black text-orange-600">senza AAMS: non va nel file</p>'}</div>
    <button data-or="minus" data-c="${c}" aria-label="Una stecca in meno" class="w-12 h-12 min-h-0 bg-white border-2 rounded-full font-black text-[22px]">−</button>
    <input data-orq="${c}" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="3" autocomplete="off" placeholder="0" value="${n>0?n:''}" aria-label="Stecche" class="w-14 h-12 text-center border-2 border-slate-300 rounded-xl font-black text-[20px] bg-white">
    <button data-or="plus" data-c="${c}" aria-label="Una stecca in più" class="w-12 h-12 min-h-0 bg-slate-900 text-white rounded-full font-black text-[22px]">+</button>
  </div>`;
}
function renderList(){
  const box=$('orList'); if(!box) return;
  if(!S.inv || !S.inv.length){ box.innerHTML='<p class="text-center text-[13px] font-bold text-slate-500 py-10">Sto caricando i prodotti…<br>Se non compaiono, controlla la connessione.</p>'; return; }
  const q=(O.filter||'').toLowerCase().trim();
  let rows=S.inv.slice();
  if(O.view==='oggi') rows=rows.filter(p=>qty(p.code)>0);
  if(q) rows=rows.filter(p=>(nomeP(p)+' '+(p.codice_aams||'')).toLowerCase().includes(q));
  rows.sort((a,b)=>nomeP(a).localeCompare(nomeP(b)));
  box.innerHTML = rows.length ? rows.map(rowHtml).join('') :
    `<p class="text-center text-[13px] font-bold text-slate-400 py-10">${O.view==='oggi'?'Oggi non hai ancora scelto niente.':'Nessun prodotto trovato'}</p>`;
}

/* ---------- FINITO ---------- */
async function finito(){
  const l=items(), t=totali();
  if(!l.length){ showWarning('Non hai ancora scritto nessuna quantità.','ORDINE VUOTO'); return; }
  if(O.exp){
    const ok=await askConfirm('Hai già creato il file alle '+hhmm(O.exp)+'.\nQuesto nuovo file contiene TUTTO l\'ordine di oggi ('+t.st+' stecche), non solo le aggiunte.\nSe hai già inviato il primo a Logista, ordina solo la differenza.',{title:'CREARE DI NUOVO IL FILE?',ok:'CREA IL FILE',cancel:'ANNULLA'});
    if(!ok) return;
  }
  const fatto = await exportOrdineLogista(l);
  if(fatto){
    O.exp=Date.now(); saveLocal(); paintTot();
    try{ await supa.rpc('ordine_giorno_esportato',{p_giorno:O.giorno}); }catch(e){}
  }
}

/* ---------- apri / chiudi ---------- */
async function open(){
  ensure(); O.giorno=localDay(); loadLocal(); O.view='tutti'; O.filter=''; $('orSearch').value='';
  $('orModal').classList.remove('hidden'); renderList(); paintTot();
  clearInterval(O.poll); let n=0;
  if(!S.inv || !S.inv.length){ O.poll=setInterval(()=>{ n++; if(S.inv && S.inv.length){ clearInterval(O.poll); renderList(); paintTot(); } else if(n>100) clearInterval(O.poll); },500); }
  O.srv='pending'; paintTot();
  await fromServer(); renderList(); paintTot();
}
function close(){
  clearTimeout(O.syncT); if(O.dirty && O.srv!=='off') doSync();
  const m=$('orModal'); if(m) m.classList.add('hidden');
  if(typeof refocus==='function') refocus();
}

/* ---------- prima pagina: si apre da sola appena l'app e' pronta ---------- */
(function autoOpen(){
  let t=0;
  const iv=setInterval(()=>{
    t++;
    const gate=document.getElementById('gateModal');
    if(gate) { if(t>600) clearInterval(iv); return; }
    if((typeof S!=='undefined' && S.loaded) || t>20){
      clearInterval(iv);
      if(!document.querySelector('.modal:not(.hidden)')) open();
    }
  },300);
})();

window.ordRapidoOpen = open;
window.__orTest = { O, open, setQ, totali, items };
})();
