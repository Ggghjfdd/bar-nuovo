/* ============================================================
   INVENTARIO CON FOTOCAMERA DEL TELEFONO
   - legge i barcode con la telecamera (BarcodeDetector del telefono, oppure ZXing se manca)
   - dopo ogni lettura chiede la quantità
   - elenco di TUTTI i prodotti: "da contare" / "contati", con ricerca per quelli senza barcode
   - la conta si salva sul telefono (stessa chiave dell'inventario con pistola)
   - APPLICA corregge le giacenze con rettifica_giacenza, come l'inventario normale
   Usa le funzioni globali dell'app: supa, S, $, esc, resolve, askConfirm, showWarning,
   showError, showSuccess, toast, loadInventory, errMsg, caricaScript, refocus
   ============================================================ */
(function(){
'use strict';
const KEY = 'bt_inventario_v1';
const ZXING_URL = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
const nomeP = p => ((p.marca||'')+' '+(p.nome||'')).trim();
const C = { counts:new Map(), tab:'todo', q:'', stream:null, det:null, zx:null, cv:null, timer:0,
            paused:false, working:false, last:'', lastTs:0, notFound:'', notFoundTs:0, cur:null, applying:false };

function load(){ try{ const j=JSON.parse(localStorage.getItem(KEY)||'[]'); C.counts=new Map(Array.isArray(j)?j:[]); }catch(e){ C.counts=new Map(); } }
function save(){ try{ localStorage.setItem(KEY, JSON.stringify([...C.counts])); }catch(e){} }

/* ---------- schermata ---------- */
function ensure(){
  if($('icModal')) return;
  document.body.insertAdjacentHTML('beforeend', `
  <div id="icModal" class="modal hidden fixed inset-0 bg-white z-[260] flex flex-col">
    <div class="px-4 py-3 border-b flex items-center justify-between gap-3 bg-slate-900 text-white">
      <div><h3 class="font-black text-[16px]">INVENTARIO FOTOCAMERA</h3><p id="icSub" class="text-[12px] text-slate-300"></p></div>
      <button data-ic="close" class="w-10 h-10 min-h-0 bg-white/15 rounded-full font-black text-[18px]">×</button>
    </div>
    <div class="h-2 bg-slate-200"><div id="icBar" class="h-2 bg-emerald-500" style="width:0%"></div></div>
    <div class="relative bg-black" style="height:32vh;min-height:190px">
      <video id="icVideo" playsinline muted class="w-full h-full object-cover"></video>
      <div id="icGuide" class="absolute inset-0 pointer-events-none flex items-center justify-center">
        <div class="w-[78%] h-[46%] border-4 border-emerald-400/90 rounded-2xl relative"><div class="absolute left-2 right-2 top-1/2 h-[3px] bg-red-500/80"></div></div>
      </div>
      <div id="icStatus" class="absolute left-0 right-0 bottom-0 bg-black/70 text-white text-[12px] font-bold px-3 py-2 text-center"></div>
      <button id="icCamBtn" data-ic="cam" class="absolute inset-0 m-auto w-64 h-14 min-h-0 bg-emerald-500 text-white rounded-2xl font-black text-[15px]">📷 ACCENDI LA FOTOCAMERA</button>
    </div>
    <div class="px-3 pt-3 flex gap-2">
      <button data-ic="tabTodo" id="icTabTodo" class="flex-1 rounded-xl py-3 font-black text-[13px] min-h-0"></button>
      <button data-ic="tabDone" id="icTabDone" class="flex-1 rounded-xl py-3 font-black text-[13px] min-h-0"></button>
    </div>
    <div class="px-3 pt-2"><input id="icSearch" type="search" placeholder="Cerca per nome (anche senza barcode)..." class="w-full bg-slate-50 border-2 rounded-xl px-3 py-3 font-bold text-[14px]"></div>
    <div id="icList" class="flex-1 overflow-auto px-3 py-2 space-y-2"></div>
    <div class="p-3 border-t bg-white grid grid-cols-2 gap-2">
      <button data-ic="zero" class="border-2 border-slate-300 rounded-xl py-3 font-black text-[12px] min-h-0">NON CONTATI = 0</button>
      <button data-ic="apply" id="icApply" class="rounded-xl py-3 font-black text-[13px] min-h-0">APPLICA INVENTARIO</button>
    </div>
    <div id="icCard" class="hidden absolute inset-0 bg-black/60 flex items-end">
      <div class="bg-white w-full rounded-t-3xl p-5 shadow-2xl">
        <p class="text-[11px] font-black text-slate-400">PRODOTTO TROVATO</p>
        <h4 id="icName" class="font-black text-[19px] leading-tight"></h4>
        <p id="icInfo" class="text-[12px] text-slate-500 font-bold mt-1"></p>
        <label class="block mt-4 font-black text-[13px]">QUANTE NE HAI? (pezzi)</label>
        <div class="flex items-center gap-2 mt-1">
          <button data-ic="minus" class="w-14 h-14 min-h-0 bg-slate-100 rounded-2xl font-black text-[26px]">−</button>
          <input id="icQty" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="5" autocomplete="off" class="flex-1 min-w-0 h-14 text-center border-4 border-orange-400 rounded-2xl font-black text-[28px] bg-yellow-50 outline-none">
          <button data-ic="plus" class="w-14 h-14 min-h-0 bg-slate-100 rounded-2xl font-black text-[26px]">+</button>
        </div>
        <div class="grid grid-cols-2 gap-2 mt-4">
          <button data-ic="cancelCard" class="border-2 border-slate-300 rounded-2xl py-4 font-black text-[14px] min-h-0">ANNULLA</button>
          <button data-ic="saveCard" id="icSave" class="bg-emerald-500 text-white rounded-2xl py-4 font-black text-[14px] min-h-0">SALVA E CONTINUA</button>
        </div>
      </div>
    </div>
  </div>`);
  const m=$('icModal');
  m.addEventListener('click', e=>{ const el=e.target.closest('[data-ic]'); if(!el) return; const f=ACT[el.dataset.ic]; if(f) f(el.dataset.v); });
  $('icSearch').addEventListener('input', e=>{ C.q=e.target.value; renderList(); });
  $('icQty').addEventListener('input', e=>{ e.target.value=e.target.value.replace(/\D/g,''); });
  $('icQty').addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); saveCard(); } });
}

function status(t){ const s=$('icStatus'); if(s) s.textContent=t||''; }

function render(){
  const tot=S.inv.length, n=[...C.counts.keys()].filter(k=>S.byCode.has(k)).length;
  $('icSub').textContent = n+' contati su '+tot+' · ne mancano '+Math.max(0,tot-n);
  $('icBar').style.width = (tot? Math.round(n*100/tot):0)+'%';
  const on='bg-slate-900 text-white', off='bg-slate-100 text-slate-600';
  $('icTabTodo').className='flex-1 rounded-xl py-3 font-black text-[13px] min-h-0 '+(C.tab==='todo'?on:off);
  $('icTabDone').className='flex-1 rounded-xl py-3 font-black text-[13px] min-h-0 '+(C.tab==='done'?on:off);
  $('icTabTodo').textContent='DA CONTARE ('+Math.max(0,tot-n)+')';
  $('icTabDone').textContent='CONTATI ('+n+')';
  $('icApply').className='rounded-xl py-3 font-black text-[13px] min-h-0 '+(n?'bg-emerald-500 text-white':'bg-slate-200 text-slate-400');
  renderList();
}

function renderList(){
  const q=(C.q||'').toLowerCase().trim();
  let rows=S.inv.filter(p=>{
    const done=C.counts.has(p.code);
    if((C.tab==='done')!==done) return false;
    return !q || (nomeP(p)+' '+(p.codice_aams||'')).toLowerCase().includes(q);
  }).sort((a,b)=>nomeP(a).localeCompare(nomeP(b)));
  const tot=rows.length; rows=rows.slice(0,200);
  $('icList').innerHTML = rows.map(p=>{
    const c=C.counts.get(p.code), noBc=/^NOBARCODE_/.test(p.code);
    const sub = c ? `in sistema ${c.sys} → contati <b>${c.counted}</b>` : `in sistema ${p.qty}`+(noBc?' · <span class="text-orange-600">senza barcode: tocca per contare</span>':'');
    return `<button data-ic="pick" data-v="${esc(p.code)}" class="w-full text-left rounded-xl border-2 p-3 min-h-0 ${c?'bg-emerald-50 border-emerald-300':'bg-slate-50'}"><b class="text-[13px]">${esc(nomeP(p))}</b><br><span class="text-[11px] text-slate-500">${sub}</span></button>`;
  }).join('') || `<p class="text-center text-[13px] text-slate-400 py-8">${C.tab==='todo'?(q?'Nessun prodotto trovato':'🎉 Hai contato tutto!'):'Ancora nessun prodotto contato'}</p>`;
  if(tot>200) $('icList').insertAdjacentHTML('beforeend', `<p class="text-center text-[11px] text-slate-400 py-2">Mostrati i primi 200: usa la ricerca</p>`);
}

/* ---------- scheda quantità ---------- */
function showCard(p){
  C.cur=p; C.paused=true;
  const c=C.counts.get(p.code);
  $('icName').textContent=nomeP(p);
  $('icInfo').textContent='In sistema: '+p.qty+' pz'+(c?' · già contato: '+c.counted+' (verrà sostituito)':'');
  $('icQty').value = c? String(c.counted):'';
  $('icCard').classList.remove('hidden');
  setTimeout(()=>{ const i=$('icQty'); i.focus(); i.select(); }, 60);
}
function closeCard(){ C.cur=null; $('icCard').classList.add('hidden'); C.paused=false; C.lastTs=Date.now(); if(C.stream) status('Inquadra il prossimo barcode'); }
function saveCard(){
  const p=C.cur; if(!p) return;
  const v=$('icQty').value.trim();
  if(v===''){ toast('Scrivi la quantità','anche 0 se non ce ne sono',1400); return; }
  const n=parseInt(v,10); if(isNaN(n)||n<0) return;
  const old=C.counts.get(p.code);
  C.counts.set(p.code, { counted:n, sys: old?old.sys:p.qty, ts:Date.now() });
  save(); closeCard(); render();
  toast(nomeP(p), 'contati: '+n, 900);
}

/* ---------- fotocamera ---------- */
async function engineInit(){
  if(C.det || C.zx) return;
  if('BarcodeDetector' in window){
    try{ C.det=new window.BarcodeDetector({formats:['ean_13','ean_8','upc_a','upc_e']}); return; }catch(e){}
  }
  if(!window.ZXing) await caricaScript(ZXING_URL);
  const Z=window.ZXing, hints=new Map();
  hints.set(Z.DecodeHintType.POSSIBLE_FORMATS,[Z.BarcodeFormat.EAN_13,Z.BarcodeFormat.EAN_8,Z.BarcodeFormat.UPC_A,Z.BarcodeFormat.UPC_E]);
  hints.set(Z.DecodeHintType.TRY_HARDER,true);
  C.zx=new Z.MultiFormatReader(); C.zx.setHints(hints);
  C.cv=document.createElement('canvas');
}
async function camStart(){
  if(C.stream) return;
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ status('Fotocamera non disponibile su questo telefono/pagina: usa la ricerca per nome.'); return; }
  status('Accendo la fotocamera…');
  try{
    C.stream=await navigator.mediaDevices.getUserMedia({ video:{ facingMode:{ideal:'environment'}, width:{ideal:1280}, height:{ideal:720} }, audio:false });
  }catch(e){
    status(e && e.name==='NotAllowedError' ? 'Permesso negato: consenti la fotocamera a questo sito nelle impostazioni del telefono.' : 'Fotocamera non disponibile ('+((e&&e.name)||'errore')+'). Usa la ricerca per nome.');
    return;
  }
  const v=$('icVideo'); v.srcObject=C.stream; v.muted=true; v.setAttribute('playsinline','');
  try{ await v.play(); }catch(e){}
  $('icCamBtn').classList.add('hidden');
  try{ await engineInit(); }catch(e){ status('Non riesco a caricare il lettore di barcode (serve internet). Usa la ricerca per nome.'); return; }
  status('Inquadra il barcode del pacchetto');
  loop();
}
function camStop(){
  clearTimeout(C.timer); C.timer=0;
  if(C.stream){ C.stream.getTracks().forEach(t=>t.stop()); C.stream=null; }
  const v=$('icVideo'); if(v) v.srcObject=null;
  const b=$('icCamBtn'); if(b) b.classList.remove('hidden');
}
async function detect(){
  const v=$('icVideo'); if(!v || !v.videoWidth) return null;
  if(C.det){ const r=await C.det.detect(v); return r && r[0] ? r[0].rawValue : null; }
  const sc=Math.min(1, 1000/v.videoWidth), w=Math.round(v.videoWidth*sc), h=Math.round(v.videoHeight*sc);
  C.cv.width=w; C.cv.height=h;
  C.cv.getContext('2d',{willReadFrequently:true}).drawImage(v,0,0,w,h);
  const Z=window.ZXing;
  try{ return C.zx.decodeWithState(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(C.cv)))).getText(); }
  catch(e){ return null; }
}
async function loop(){
  if(!C.stream) return;
  if(!C.paused && !C.working){
    C.working=true;
    try{ const code=await detect(); if(code) onCode(code); }catch(e){}
    C.working=false;
  }
  C.timer=setTimeout(loop, C.det?120:200);
}
function onCode(raw){
  const code=String(raw||'').replace(/\D/g,''); if(code.length<6) return;
  const now=Date.now();
  if(code===C.last && now-C.lastTs<2500){ return; }
  C.last=code; C.lastTs=now;
  const r=resolve([code]);
  if(r.ambiguous){ status('Codice '+code+': più prodotti corrispondono, cercalo per nome'); return; }
  if(!r.prod){
    if(!(C.notFound===code && now-C.notFoundTs<4000)){ C.notFound=code; C.notFoundTs=now; status('Codice '+code+' non trovato: cercalo per nome'); try{ navigator.vibrate&&navigator.vibrate([80,60,80]); }catch(e){} }
    return;
  }
  try{ navigator.vibrate&&navigator.vibrate(60); }catch(e){}
  status('Trovato: '+nomeP(r.prod));
  showCard(r.prod);
}

/* ---------- applica ---------- */
async function apply(){
  if(C.applying || !C.counts.size) return;
  const todo=[...C.counts].map(([code,c])=>({code,c,p:S.byCode.get(code),d:c.counted-c.sys})).filter(x=>x.p && x.d!==0);
  const uguali=C.counts.size-todo.length;
  const mancano=Math.max(0, S.inv.length-[...C.counts.keys()].filter(k=>S.byCode.has(k)).length);
  if(!todo.length){
    if(await askConfirm('Nessuna differenza: le quantità contate coincidono con il sistema.\nChiudere e cancellare la conta?',{title:'TUTTO ALLINEATO',ok:'CHIUDI'})){ C.counts=new Map(); save(); close(); }
    return;
  }
  const tot=todo.reduce((s,x)=>s+x.d,0);
  const righe=todo.slice(0,8).map(x=>'• '+nomeP(x.p)+': '+x.c.sys+' → '+x.c.counted).join('\n')+(todo.length>8?'\n… e altri '+(todo.length-8):'');
  if(!(await askConfirm('Correggo '+todo.length+' prodotti (differenza totale '+(tot>0?'+':'')+tot+' pz).\n'+uguali+' già giusti.\n'+(mancano?'ATTENZIONE: '+mancano+' prodotti non sono stati contati e restano invariati.\n':'')+'\n'+righe,{title:'APPLICA INVENTARIO',ok:'APPLICA'}))) return;
  C.applying=true; let fatti=0; const errori=[];
  for(const x of todo){
    try{
      const { error } = await supa.rpc('rettifica_giacenza', { p_barcode:x.code, p_delta:x.d });
      if(error) throw error;
      C.counts.delete(x.code); fatti++; save();
    }catch(e){ errori.push(nomeP(x.p)+': '+errMsg(e)); }
  }
  for(const [code,c] of [...C.counts]){ if(c.counted===c.sys) C.counts.delete(code); }
  save(); C.applying=false;
  await loadInventory(true);
  if(errori.length){ render(); showError('Corretti '+fatti+' prodotti.\nNon riusciti:\n'+errori.slice(0,5).join('\n')+'\n\nI non riusciti restano nella conta: riprova.','INVENTARIO PARZIALE'); }
  else { close(); showSuccess('Inventario applicato: '+fatti+' prodotti corretti.','FATTO'); }
}
async function zero(){
  const resto=S.inv.filter(p=>!C.counts.has(p.code));
  if(!resto.length){ toast('Hai già contato tutto','',1200); return; }
  if(!(await askConfirm('Segno a 0 pezzi i '+resto.length+' prodotti NON ancora contati?\n(Fallo solo se hai passato tutto lo scaffale: poi puoi sempre correggere uno per uno.)',{title:'NON CONTATI = 0',ok:'METTI A 0',danger:true}))) return;
  resto.forEach(p=>C.counts.set(p.code,{counted:0,sys:p.qty,ts:Date.now()}));
  save(); render();
}

const ACT = {
  close: ()=>close(),
  cam: ()=>camStart(),
  tabTodo: ()=>{ C.tab='todo'; render(); },
  tabDone: ()=>{ C.tab='done'; render(); },
  pick: v=>{ const p=S.byCode.get(v); if(p) showCard(p); },
  minus: ()=>{ const i=$('icQty'); i.value=String(Math.max(0,(parseInt(i.value,10)||0)-1)); },
  plus: ()=>{ const i=$('icQty'); i.value=String((parseInt(i.value,10)||0)+1); },
  cancelCard: ()=>closeCard(),
  saveCard: ()=>saveCard(),
  apply: ()=>apply(),
  zero: ()=>zero()
};

function start(){
  if(!S.loaded){ showWarning('Catalogo non ancora caricato.','ATTENDI'); return; }
  ensure(); load(); C.tab='todo'; C.q=''; $('icSearch').value=''; C.paused=false; C.last=''; closeCardQuiet();
  $('icModal').classList.remove('hidden'); status('Premi il pulsante verde per accendere la fotocamera');
  render();
}
function closeCardQuiet(){ C.cur=null; const c=$('icCard'); if(c) c.classList.add('hidden'); }
function close(){ camStop(); closeCardQuiet(); const m=$('icModal'); if(m) m.classList.add('hidden'); if(typeof refocus==='function') refocus(); }

window.invCamStart = start;
window.__icTest = { C, onCode, render, saveCard, showCard };
})();
