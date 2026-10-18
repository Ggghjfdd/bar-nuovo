/* ============================================================
   MODALITÀ GUIDATE: COLLEGA EAN + INVENTARIO
   Caricato dopo lo script principale: usa le sue funzioni globali
   (supa, S, $, esc, normCode, aamsKey, resolve, openNumpad, askConfirm,
    showWarning/showError/showSuccess, toast, loadInventory, errMsg, refocus)
   ============================================================ */
(function(){
'use strict';

/* ---------- utilità ---------- */
/* EAN valido = solo cifre, 8/12/13/14 cifre e cifra di controllo GS1 corretta */
function gs1ok(s){
  s = String(s||'');
  if(!/^\d+$/.test(s) || ![8,12,13,14].includes(s.length)) return false;
  const d = s.split('').map(Number), chk = d.pop();
  let sum = 0;
  for(let i=d.length-1, w=3; i>=0; i--, w = (w===3?1:3)) sum += d[i]*w;
  return ((10 - sum % 10) % 10) === chk;
}
const nomeP = p => (p.marca+' '+p.nome).trim();
const MD = { mode:null, queue:[], pos:0, linked:0, skipped:0, cur:null, busy:false,
             counts:new Map(), plus1:false, picking:null };

/* il prodotto ha già un EAN utilizzabile con la pistola? */
function haEan(p){
  if(gs1ok(p.code) || gs1ok(p.codice_aams)) return true;
  for(const [k,b] of S.alias){ if(b===p.code && (gs1ok(k) || gs1ok(k.padStart(8,'0')) || gs1ok(k.padStart(13,'0')))) return true; }
  return false;
}

/* ---------- guscio del modale ---------- */
function ensureModal(){
  if($('mdModal')) return;
  document.body.insertAdjacentHTML('beforeend',
   `<div id="mdModal" class="modal hidden fixed inset-0 bg-black/70 z-[255] flex items-center justify-center p-4">
      <div class="bg-white rounded-3xl max-w-[680px] w-full max-h-[92vh] flex flex-col">
        <div class="p-5 border-b flex justify-between items-center gap-3">
          <div><h3 id="mdTitle" class="font-black text-[18px]"></h3><p id="mdSub" class="text-[12px] text-slate-500"></p></div>
          <button data-md="close" class="w-10 h-10 min-h-0 bg-slate-100 rounded-full font-black">×</button>
        </div>
        <div id="mdBody" class="p-5 overflow-auto flex-1"></div>
      </div>
    </div>`);
  $('mdModal').addEventListener('click', e=>{
    const el=e.target.closest('[data-md]'); if(!el) return;
    const a=el.dataset.md, v=el.dataset.v;
    const fn=ACTIONS[a]; if(fn) fn(v);
  });
  $('mdModal').addEventListener('keydown', e=>{
    if(e.key==='Enter' && e.target.id==='mdScan'){ e.preventDefault(); const v=e.target.value; e.target.value=''; onScan(v); }
  });
  $('mdModal').addEventListener('input', e=>{ if(e.target.id==='mdSearch') renderPickList(); });
}
function open(title){ ensureModal(); $('mdTitle').textContent=title; $('mdModal').classList.remove('hidden'); }
function hide(){ if($('mdModal')) $('mdModal').classList.add('hidden'); MD.mode=null; refocus(); }
function sub(t){ $('mdSub').textContent=t||''; }
function focusScan(){ setTimeout(()=>{ const i=$('mdScan'); if(i) i.focus(); }, 80); }
const scanBox = (ph) => `<input id="mdScan" inputmode="none" autocomplete="off" placeholder="${ph}" class="mt-2 w-full border-4 border-orange-400 rounded-2xl px-4 py-4 font-mono font-black text-[22px] text-center bg-yellow-50 outline-none">`;
const btn = (act, label, cls, v) => `<button data-md="${act}"${v!==undefined?` data-v="${esc(v)}"`:''} class="${cls} rounded-2xl py-4 font-black text-[14px]">${label}</button>`;
const BTN_DARK='bg-slate-900 text-white', BTN_OK='bg-emerald-500 text-white', BTN_LIGHT='bg-white border-2 border-slate-300';

/* ============================================================
   COLLEGA EAN
   ============================================================ */
function eanStart(){
  if(!S.loaded){ showWarning('Catalogo non ancora caricato.','ATTENDI'); return; }
  const q = S.inv.filter(p=>!haEan(p)).sort((a,b)=>nomeP(a).localeCompare(nomeP(b)));
  if(!q.length){ showSuccess('Tutti i prodotti hanno già un EAN collegato.','NIENTE DA FARE'); return; }
  Object.assign(MD,{ mode:'ean', queue:q, pos:0, linked:0, skipped:0, cur:null, busy:false, picking:null });
  open('COLLEGA EAN');
  eanShow();
}
function eanShow(){
  if(MD.pos >= MD.queue.length){ eanFine(); return; }
  const p = MD.queue[MD.pos]; MD.cur = p;
  sub('Prodotto '+(MD.pos+1)+' di '+MD.queue.length+' · collegati '+MD.linked);
  $('mdBody').innerHTML =
    `<div class="bg-slate-100 rounded-2xl p-4">
       <p class="text-[11px] font-bold text-slate-500">PRODOTTO SENZA EAN</p>
       <p class="font-black text-[24px] break-words leading-tight">${esc(nomeP(p))}</p>
       <p class="text-[13px] font-bold mt-1">${p.codice_aams?'AAMS '+esc(p.codice_aams)+' · ':''}giac. ${p.qty}</p>
     </div>
     <label class="block mt-4 font-black text-[15px]">Spara il codice a barre del pacchetto</label>
     ${scanBox('SPARA L\'EAN')}
     <div class="grid grid-cols-2 gap-3 mt-4">${btn('skip','SALTA',BTN_LIGHT)}${btn('close','FINE',BTN_DARK)}</div>`;
  focusScan();
}
async function eanLink(code, p){
  /* collega 'code' al prodotto p (alias). Ritorna true se fatto */
  const r = resolve([code]);
  if(r.prod && r.prod.code===p.code){ toast('GIÀ COLLEGATO', nomeP(p), 1200); return true; }
  if(r.prod){ showWarning('Questo codice appartiene già a:\n'+nomeP(r.prod)+'\n\nNon posso collegarlo anche a '+nomeP(p)+'.','CODICE GIÀ USATO'); return false; }
  if(r.ambiguous){ showWarning('Il codice corrisponde a più prodotti: non lo collego.','CODICE AMBIGUO'); return false; }
  if(!gs1ok(code) && !(await askConfirm('Il codice "'+code+'" non è un EAN valido (cifra di controllo errata o lunghezza insolita).\nPotrebbe essere stato letto male.\n\nCollegarlo comunque a '+nomeP(p)+'?',{title:'CODICE DUBBIO',ok:'COLLEGA COMUNQUE'}))) return false;
  if(/^NOBARCODE_/.test(p.code)){
    /* prodotto senza barcode: il codice sparato diventa il suo barcode (collegamenti e storico restano) */
    const { error } = await supa.from('prodotti_master').update({ barcode:code }).eq('barcode', p.code);
    if(error) throw error;
    return true;
  }
  const { error } = await supa.rpc('associa_codice', { p_codice:code, p_barcode:p.code });
  if(error) throw error;
  return true;
}
async function eanScan(raw){
  const code = normCode(raw), p = MD.cur;
  if(code.length<4 || !p || MD.busy) return;
  MD.busy = true;
  try{
    if(await eanLink(code, p)){
      MD.linked++; MD.pos++;
      await loadInventory(true);
      toast('COLLEGATO', nomeP(p)+' ← '+code, 1200);
      MD.busy=false; eanShow(); return;
    }
  }catch(e){ showError(errMsg(e),'COLLEGAMENTO'); }
  MD.busy=false; focusScan();
}
async function eanFine(){
  const msg='EAN collegati: '+MD.linked+'\nProdotti saltati: '+MD.skipped+'\nDa fare: '+Math.max(0,S.inv.filter(p=>!haEan(p)).length);
  hide(); await loadInventory(true); showSuccess(msg,'COLLEGAMENTO EAN');
}

/* collegare un codice sconosciuto (letto in cassa/carico) a un prodotto scelto da elenco */
function eanPick(code){
  code = normCode(code); if(!code) return;
  if(!S.loaded){ showWarning('Catalogo non ancora caricato.','ATTENDI'); return; }
  Object.assign(MD,{ mode:'pick', picking:code, busy:false });
  open('COLLEGA CODICE A UN PRODOTTO'); sub('Codice letto: '+code);
  $('mdBody').innerHTML =
    `<input id="mdSearch" placeholder="Cerca marca o nome..." class="w-full bg-slate-50 border-2 rounded-2xl px-4 py-3 font-bold text-[14px]">
     <div id="mdList" class="mt-3 space-y-2 max-h-[55vh] overflow-auto"></div>`;
  renderPickList();
}
function renderPickList(){
  const box=$('mdList'); if(!box) return;
  const q=($('mdSearch').value||'').toLowerCase().trim();
  const list=S.inv.filter(p=>!q || (nomeP(p)+' '+(p.codice_aams||'')).toLowerCase().includes(q)).sort((a,b)=>nomeP(a).localeCompare(nomeP(b))).slice(0,50);
  box.innerHTML = list.map(p=>`<button data-md="${MD.mode==='inv'?'invPick':'pick'}" data-v="${esc(p.code)}" class="w-full text-left bg-slate-50 border-2 rounded-xl p-3 min-h-0"><b class="text-[13px]">${esc(nomeP(p))}</b><br><span class="text-[11px] text-slate-500">giac. ${p.qty}${p.codice_aams?' · AAMS '+esc(p.codice_aams):''}${haEan(p)?' · ha già un EAN':''}</span></button>`).join('')
    || '<p class="text-center text-[12px] text-slate-400 py-4">Nessun prodotto trovato</p>';
}
async function pickChosen(code){
  const p=S.byCode.get(code); if(!p||MD.busy) return;
  if(!(await askConfirm('Collegare il codice '+MD.picking+' a:\n'+nomeP(p)+'?',{title:'COLLEGA CODICE',ok:'COLLEGA'}))) return;
  MD.busy=true;
  try{
    if(await eanLink(MD.picking, p)){
      S.lastUnknown=null; if(typeof renderUnknownHint==='function') renderUnknownHint();
      await loadInventory(true); hide(); showSuccess('Da ora il codice '+MD.picking+' vende:\n'+nomeP(p),'COLLEGATO'); MD.busy=false; return;
    }
  }catch(e){ showError(errMsg(e),'COLLEGAMENTO'); }
  MD.busy=false;
}

/* ============================================================
   INVENTARIO (conta e riallinea)
   I conteggi restano salvati su questo dispositivo finché non li applichi.
   Si applica la DIFFERENZA (contato - giacenza al momento della conta):
   le vendite fatte nel frattempo non vengono cancellate.
   ============================================================ */
const KEY = 'bt_inventario_v1';
function invSave(){ try{ localStorage.setItem(KEY, JSON.stringify([...MD.counts])); }catch(e){} }
function invLoad(){ try{ const j=JSON.parse(localStorage.getItem(KEY)||'[]'); MD.counts=new Map(Array.isArray(j)?j:[]); }catch(e){ MD.counts=new Map(); } }
function invClear(){ MD.counts=new Map(); try{ localStorage.removeItem(KEY); }catch(e){} }

function invStart(){
  if(!S.loaded){ showWarning('Catalogo non ancora caricato.','ATTENDI'); return; }
  invLoad();
  MD.mode='inv'; MD.busy=false;
  open('INVENTARIO'); invRender();
}
function invRender(){
  const n=MD.counts.size;
  let diffTot=0, cambi=0;
  const rows=[...MD.counts].map(([code,c])=>{
    const p=S.byCode.get(code); const d=c.counted-c.sys; diffTot+=d; if(d!==0) cambi++;
    return {code,c,p,d};
  }).sort((a,b)=>b.c.ts-a.c.ts);
  sub(n+' prodotti contati · '+cambi+' da correggere · non contati: '+Math.max(0,S.inv.length-n));
  const col = d => d===0?'text-slate-500':(d>0?'text-emerald-600':'text-red-600');
  $('mdBody').innerHTML =
    `<label class="block font-black text-[15px]">Spara un prodotto per contarlo</label>
     ${scanBox('SPARA IL CODICE')}
     <label class="mt-3 flex items-center gap-2 text-[13px] font-bold"><input type="checkbox" id="mdPlus1" ${MD.plus1?'checked':''} onchange="window.__mdPlus1(this.checked)"> Ogni scansione = +1 pezzo (senza chiedere la quantità)</label>
     <div class="grid grid-cols-2 gap-3 mt-3">${btn('invSearch','CERCA PER NOME (senza EAN)',BTN_LIGHT)}${btn('invApply','APPLICA RIALLINEAMENTO',n?BTN_OK:'bg-slate-200 text-slate-400')}</div>
     <div class="mt-4 space-y-2">${rows.map(({code,c,p,d})=>`
        <div class="flex items-center justify-between gap-2 bg-slate-50 border rounded-xl p-3">
          <button data-md="invEdit" data-v="${esc(code)}" class="text-left min-h-0 flex-1"><b class="text-[13px]">${esc(p?nomeP(p):code)}</b><br><span class="text-[11px] text-slate-500">sistema ${c.sys} → contati <b>${c.counted}</b> · <b class="${col(d)}">${d>0?'+':''}${d}</b></span></button>
          <button data-md="invDel" data-v="${esc(code)}" class="w-9 h-9 min-h-0 bg-white border rounded-full font-black text-red-600">×</button>
        </div>`).join('') || '<p class="text-center text-[12px] text-slate-400 py-6">Nessun prodotto contato</p>'}
     </div>
     ${n?`<p class="mt-3 text-[12px] font-bold text-slate-500">Differenza totale: ${diffTot>0?'+':''}${diffTot} pezzi. ${btnLink('invReset','Azzera tutta la conta')}</p>`:''}`;
  focusScan();
}
const btnLink = (act,label) => `<button data-md="${act}" class="underline text-red-600 min-h-0">${label}</button>`;
window.__mdPlus1 = v => { MD.plus1 = !!v; focusScan(); };

function invCount(p, counted){
  const old = MD.counts.get(p.code);
  /* la giacenza "di sistema" resta quella del PRIMO conteggio (se ricontato, non la riscriviamo) */
  MD.counts.set(p.code, { counted, sys: old ? old.sys : p.qty, ts: Date.now() });
  invSave(); invRender();
}
function invAsk(p){
  const old = MD.counts.get(p.code);
  openNumpad({ label:'QUANTITÀ CONTATA - '+nomeP(p), initial: old?String(old.counted):'', maxLen:5,
    validate:v=>{ const n=parseInt(v,10); return (isNaN(n)||n<0)?'Quantità non valida':null; },
    onOk:v=>invCount(p, parseInt(v,10)) });
}
function invScan(raw){
  const code=normCode(raw); if(code.length<3) return;
  const r=resolve([code]);
  if(r.ambiguous){ showWarning('Il codice corrisponde a più prodotti. Usa CERCA PER NOME.','CODICE AMBIGUO'); return; }
  if(!r.prod){
    showWarning('Codice '+code+' non trovato.\nUsa CERCA PER NOME e poi, a fine conta, COLLEGA EAN per non rifarlo.','NON TROVATO'); return;
  }
  const p=r.prod;
  if(MD.plus1){ const old=MD.counts.get(p.code); invCount(p, (old?old.counted:0)+1); toast(nomeP(p), 'contati: '+MD.counts.get(p.code).counted, 700); }
  else invAsk(p);
}
function invSearch(){
  MD.mode='inv'; sub('Scegli il prodotto da contare');
  $('mdBody').innerHTML =
    `<input id="mdSearch" placeholder="Cerca marca o nome..." class="w-full bg-slate-50 border-2 rounded-2xl px-4 py-3 font-bold text-[14px]">
     <div id="mdList" class="mt-3 space-y-2 max-h-[50vh] overflow-auto"></div>
     <div class="mt-3">${btn('invBack','← TORNA ALLA CONTA',BTN_LIGHT)}</div>`;
  renderPickList();
}
async function invApply(){
  if(!MD.counts.size){ return; }
  const todo=[...MD.counts].map(([code,c])=>({code,c,p:S.byCode.get(code),d:c.counted-c.sys})).filter(x=>x.p && x.d!==0);
  const ok0=[...MD.counts].length-todo.length;
  if(!todo.length){
    if(await askConfirm('Nessuna differenza: tutte le quantità contate coincidono con il sistema.\nChiudere e cancellare la conta?',{title:'TUTTO ALLINEATO',ok:'CHIUDI'})){ invClear(); hide(); }
    return;
  }
  const tot=todo.reduce((s,x)=>s+x.d,0);
  const righe=todo.slice(0,8).map(x=>'• '+nomeP(x.p)+': '+x.c.sys+' → '+x.c.counted).join('\n')+(todo.length>8?'\n… e altri '+(todo.length-8):'');
  if(!(await askConfirm('Correggo '+todo.length+' prodotti (differenza totale '+(tot>0?'+':'')+tot+' pz).\n'+ok0+' già corretti.\n\n'+righe+'\n\nI prodotti non contati restano invariati.',{title:'APPLICA INVENTARIO',ok:'APPLICA'}))) return;
  MD.busy=true; let fatti=0; const errori=[];
  for(const x of todo){
    try{
      const { error } = await supa.rpc('rettifica_giacenza', { p_barcode:x.code, p_delta:x.d });
      if(error) throw error;
      MD.counts.delete(x.code); fatti++; invSave();
    }catch(e){ errori.push(nomeP(x.p)+': '+errMsg(e)); }
  }
  /* quelli già allineati si tolgono dalla conta */
  for(const [code,c] of [...MD.counts]){ if(c.counted===c.sys) MD.counts.delete(code); }
  invSave(); MD.busy=false;
  await loadInventory(true);
  if(errori.length){ invRender(); showError('Corretti '+fatti+' prodotti.\nNon riusciti:\n'+errori.slice(0,5).join('\n')+'\n\nI non riusciti restano nella conta: riprova.','INVENTARIO PARZIALE'); }
  else { hide(); showSuccess('Inventario applicato: '+fatti+' prodotti corretti.','FATTO'); }
}

/* ---------- azioni e scansioni ---------- */
function onScan(raw){
  if(MD.mode==='ean') eanScan(raw);
  else if(MD.mode==='inv') invScan(raw);
}
const ACTIONS = {
  close: async ()=>{
    if(MD.mode==='ean' && MD.linked>0){ eanFine(); return; }
    if(MD.mode==='inv' && MD.counts.size){ hide(); toast('CONTA SALVATA','Riprendi da INVENTARIO quando vuoi',2000); return; }
    hide();
  },
  skip: ()=>{ MD.skipped++; MD.pos++; eanShow(); },
  peSave: ()=>peSave(),
  pick: v=>pickChosen(v),
  invPick: v=>{ const p=S.byCode.get(v); if(!p) return; invRender(); invAsk(p); },
  invSearch: ()=>invSearch(),
  invBack: ()=>invRender(),
  invEdit: v=>{ const p=S.byCode.get(v); if(p) invAsk(p); },
  invDel: v=>{ MD.counts.delete(v); invSave(); invRender(); },
  invApply: ()=>invApply(),
  invReset: async ()=>{ if(await askConfirm('Cancellare tutta la conta fatta finora?',{title:'AZZERA CONTA',ok:'AZZERA',danger:true})){ invClear(); invRender(); } }
};


/* ============================================================
   MODIFICA PRODOTTO (dal Magazzino): tutti i campi, barcode compreso
   ============================================================ */
function peField(id,label,val,extra=''){
  return `<label class="block"><span class="text-[11px] font-black text-slate-500">${label}</span><input id="${id}" value="${esc(val)}" ${extra} class="w-full border-2 rounded-2xl px-4 py-3 font-bold text-[16px] ${extra.includes('readonly')?'bg-yellow-50':''}"></label>`;
}
function prodEdit(code){
  const p=S.byCode.get(code); if(!p) return;
  if(!S.loaded){ showWarning('Catalogo non ancora caricato.','ATTENDI'); return; }
  MD.mode='edit'; MD.editing=p.code; MD.busy=false;
  open('MODIFICA PRODOTTO'); sub(p.code);
  const senza=/^NOBARCODE_/.test(p.code);
  $('mdBody').innerHTML =
    `<div class="grid grid-cols-2 gap-3">
       <div class="col-span-2">${peField('peMarca','PRODOTTO *',p.marca)}</div>
       <div class="col-span-2">${peField('peBarcode','BARCODE (tocca e spara con la pistola)',p.code,'onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.blur();}" autocomplete="off"')}
         <p class="text-[11px] font-bold mt-1 ${senza?'text-red-600':'text-slate-500'}">${senza?'Questo prodotto non ha ancora un barcode: sparalo qui quando vuoi.':'Se cambi il barcode il prodotto prende il nuovo codice; giacenza, storico e collegamenti restano.'}</p></div>
       ${peField('peAams','CODICE AAMS',p.codice_aams||'')}
       ${peField('peLog','CODICE LOGISTA',p.codice_logista||'')}
       ${peField('pePrezzo','PREZZO € *',String(p.prezzo||''),'readonly data-numpad="PREZZO €" data-decimal="1" placeholder="tocca"')}
       ${peField('peCat','CATEGORIA',p.categoria||'KS')}
       ${peField('peQty','GIACENZA (pezzi)',String(p.qty),'readonly data-numpad="GIACENZA" placeholder="tocca"')}
       ${peField('peScorta','SCORTA MINIMA',String(p.scorta),'readonly data-numpad="SCORTA" placeholder="tocca"')}
     </div>
     <div class="grid grid-cols-2 gap-3 mt-5">${btn('close','ANNULLA',BTN_LIGHT)}${btn('peSave','SALVA',BTN_OK)}</div>`;
}
async function peSave(){
  const old=S.byCode.get(MD.editing); if(!old||MD.busy) return;
  const marca=$('peMarca').value.replace(/\s+/g,' ').trim().toUpperCase();
  const nuovo=$('peBarcode').value.replace(/\s+/g,'').toUpperCase();
  const aams=$('peAams').value.trim().toUpperCase(), log=$('peLog').value.trim();
  const cat=($('peCat').value.trim().toUpperCase())||'KS';
  const prezzo=num($('pePrezzo').value), qty=parseInt($('peQty').value,10), scorta=parseInt($('peScorta').value,10);
  if(!marca){ showWarning('Il nome del prodotto è obbligatorio.','DATI MANCANTI'); return; }
  if(isNaN(prezzo)||prezzo<=0||prezzo>=1000){ showWarning('Inserisci un prezzo valido (maggiore di 0).','DATI MANCANTI'); return; }
  if(isNaN(qty)||qty<0||isNaN(scorta)||scorta<0){ showWarning('Giacenza e scorta devono essere numeri (0 o più).','DATI MANCANTI'); return; }
  if(!/^[0-9A-Z_]{3,30}$/.test(nuovo)){ showWarning('Il barcode può contenere solo cifre e lettere (da 3 a 30 caratteri).','BARCODE NON VALIDO'); return; }
  const cambiaBc = nuovo!==old.code;
  if(cambiaBc){
    const altro=S.byCode.get(nuovo);
    if(altro){ showWarning('Questo barcode è già di un altro prodotto:\n'+nomeP(altro)+'\n\nSe sono lo stesso prodotto, tieni un solo record.','BARCODE GIÀ USATO'); return; }
    if(!gs1ok(nuovo) && !/^NOBARCODE_/.test(nuovo) && !(await askConfirm('Il codice "'+nuovo+'" non è un EAN valido (cifra di controllo errata o lunghezza insolita).\nPotrebbe essere stato letto male.\n\nSalvarlo comunque?',{title:'CODICE DUBBIO',ok:'SALVA COMUNQUE'}))) return;
  }
  const upd={ marca, nome:'', prezzo, categoria:cat, codice_aams:aams||null, codice_logista:log||null, scorta };
  if(cambiaBc) upd.barcode=nuovo;
  MD.busy=true;
  try{
    const { error } = await supa.from('prodotti_master').update(upd).eq('barcode', old.code);
    if(error){ if(error.code==='23505') throw new Error('Esiste già un prodotto con questo barcode.'); throw error; }
    if(qty!==old.qty){
      const r = await supa.rpc('imposta_giacenza', { p_barcode:nuovo, p_qty:qty });
      if(r.error) throw r.error;
    }
    await loadInventory(true); hide(); toast('SALVATO', marca, 1500);
  }catch(e){ showError(errMsg(e),'SALVATAGGIO'); }
  MD.busy=false;
}
document.addEventListener('click', e=>{ const b=e.target.closest('[data-edit]'); if(b) prodEdit(b.dataset.edit); });

window.eanStart = eanStart; window.eanPick = eanPick; window.invStart = invStart; window.prodEdit = prodEdit;
window.__mdTest = { gs1ok, haEan, MD };
})();
