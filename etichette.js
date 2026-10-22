/* ============================================================
   ETICHETTE: crea un barcode (EAN-13 interno) per prodotti che non ne hanno
   (caffè, cornetti...), assegnalo a un prodotto e stampa le etichette.
   Caricato dopo lo script principale: usa le sue funzioni globali.
   ============================================================ */
(function(){
'use strict';

/* ---------- EAN-13: cifra di controllo e disegno ---------- */
const L=['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
const G=['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
const R=['1110010','1100110','1101100','1000010','1011100','1001110','1010000','1000100','1001000','1110100'];
const PAR=['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'];
function checkDigit(d12){
  let s=0; for(let i=0;i<12;i++) s+=Number(d12[i])*(i%2===0?1:3);
  return (10-s%10)%10;
}
function ean13ok(c){ return /^\d{13}$/.test(c) && checkDigit(c.slice(0,12))===Number(c[12]); }
function ean13Modules(code){
  const d=code.split('').map(Number), par=PAR[d[0]];
  let m='101';
  for(let i=0;i<6;i++) m+=(par[i]==='L'?L:G)[d[1+i]];
  m+='01010';
  for(let i=0;i<6;i++) m+=R[d[7+i]];
  return m+'101';                       /* 95 moduli */
}
/* SVG del codice a barre (zone di rispetto incluse) */
function ean13Svg(code, h){
  h=h||60; const m=ean13Modules(code), Q=9, W=95+Q*2;
  const guard=i=>(i<3||(i>=45&&i<50)||i>=92);
  let bars='';
  for(let i=0;i<95;){
    if(m[i]==='1'){ let j=i; while(j<95&&m[j]==='1') j++;
      const bh = guard(i)?h:h-8; bars+=`<rect x="${Q+i}" y="0" width="${j-i}" height="${bh}"/>`; i=j; } else i++;
  }
  const ty=h+6;
  const txt=`<text x="${Q-2}" y="${ty}" text-anchor="end">${code[0]}</text>`
    +`<text x="${Q+3+21}" y="${ty}" text-anchor="middle" textLength="39">${code.slice(1,7)}</text>`
    +`<text x="${Q+50+21}" y="${ty}" text-anchor="middle" textLength="39">${code.slice(7)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h+8}" preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges"><g fill="#000">${bars}</g><g font-family="monospace" font-size="8" fill="#000">${txt}</g></svg>`;
}

/* ---------- nuovo codice interno ---------- */
const PREFISSO='290';   /* codici interni: 290 + 9 cifre + controllo */
function nuovoCodice(){
  let max=0;
  const vedi=c=>{ c=String(c||''); if(/^290\d{10}$/.test(c)){ const n=parseInt(c.slice(3,12),10); if(n>max) max=n; } };
  S.byCode.forEach((p,k)=>vedi(k));
  S.alias.forEach((b,k)=>{ vedi(k); });
  const base=PREFISSO+String(max+1).padStart(9,'0');
  return base+checkDigit(base);
}

/* ---------- stato e schermata ---------- */
const E={ mode:'esistente', prod:null, code:null, saved:false, sez:'caffetteria', senzaGiac:true, busy:false };
const SEZ={ caffetteria:{t:'☕ CAFFETTERIA',cat:'CAFFETTERIA'}, cibi:{t:'🥐 CIBI E BEVANDE',cat:'CIBI E BEVANDE'}, tabacchi:{t:'🚬 TABACCHI',cat:'KS'} };
const nomeP=p=>((p.marca||'')+' '+(p.nome||'')).trim();
const eur2=n=>'€ '+Number(n||0).toFixed(2).replace('.',',');
const bt=(on)=>on?'bg-slate-900 text-white border-slate-900':'bg-white text-slate-700 border-slate-300';

function root(){ return document.getElementById('tab-etichette'); }

function etRender(){
  const r=root(); if(!r) return;
  const keepName=document.getElementById('etNome')?.value||'', keepPrezzo=document.getElementById('etPrezzo')?.value||'', keepQ=document.getElementById('etQty')?.value||'', keepSearch=document.getElementById('etSearch')?.value||'', keepCop=document.getElementById('etCopie')?.value||'1';
  const focusId=document.activeElement&&document.activeElement.id;
  let h=`<div class="max-w-[820px] mx-auto space-y-4">
  <div class="bg-white rounded-3xl border p-5">
    <h2 class="font-black text-[20px]">🏷 CREA E STAMPA BARCODE</h2>
    <p class="text-[13px] text-slate-500 font-bold mt-1">Per i prodotti senza codice a barre (caffè, cornetti…): crea un codice, assegnalo al prodotto, stampa l'etichetta da attaccare vicino alla cassa.</p>
  </div>
  <div class="bg-white rounded-3xl border p-5">
    <p class="font-black text-[15px]">1 · PRODOTTO</p>
    <div class="grid grid-cols-2 gap-2 mt-3">
      <button data-et="mode" data-v="esistente" class="chip rounded-2xl h-12 min-h-0 font-black text-[13px] border-2 ${bt(E.mode==='esistente')}">GIÀ NEL SISTEMA</button>
      <button data-et="mode" data-v="nuovo" class="chip rounded-2xl h-12 min-h-0 font-black text-[13px] border-2 ${bt(E.mode==='nuovo')}">NUOVO PRODOTTO</button>
    </div>`;
  if(E.mode==='esistente'){
    h+=`<input id="etSearch" value="${esc(keepSearch)}" placeholder="Cerca il prodotto…" class="mt-3 w-full border-2 rounded-2xl px-4 py-3 text-[16px] font-bold" autocomplete="off">
    <div id="etLista" class="mt-3 space-y-2 max-h-[300px] overflow-auto"></div>`;
    if(E.prod) h+=`<div class="mt-3 bg-emerald-50 border-2 border-emerald-400 rounded-2xl p-3"><p class="text-[11px] font-black text-emerald-700">SELEZIONATO</p><p class="font-black text-[16px]">${esc(nomeP(E.prod))}</p><p class="text-[12px] font-bold text-slate-600">${eur2(E.prod.prezzo)} · ${/^NOBARCODE_/.test(E.prod.code)?'<span class="text-red-600">senza barcode</span>':'barcode '+esc(E.prod.code)}</p></div>`;
  } else {
    h+=`<div class="grid grid-cols-3 gap-2 mt-3">${Object.keys(SEZ).map(k=>`<button data-et="sez" data-v="${k}" class="chip rounded-2xl px-1 h-12 min-h-0 font-black text-[11px] leading-tight border-2 ${bt(E.sez===k)}">${SEZ[k].t}</button>`).join('')}</div>
    <input id="etNome" value="${esc(keepName)}" placeholder="Nome (es. CAFFÈ ESPRESSO)" class="mt-3 w-full border-2 rounded-2xl px-4 py-3 text-[16px] font-bold" autocomplete="off">
    <input id="etPrezzo" value="${esc(keepPrezzo)}" readonly data-numpad="PREZZO €" data-decimal="1" placeholder="Prezzo €" class="mt-2 w-full border-2 rounded-2xl px-4 py-3 text-[16px] font-bold bg-yellow-50">
    <label class="mt-3 flex items-center gap-3 font-bold text-[14px]"><input id="etSenza" type="checkbox" ${E.senzaGiac?'checked':''} class="w-6 h-6"> Non tengo il conto dei pezzi (caffè, ecc.)</label>
    ${E.senzaGiac?'':`<input id="etQty" value="${esc(keepQ)}" readonly data-numpad="QUANTITÀ" placeholder="Quantità in magazzino" class="mt-2 w-full border-2 rounded-2xl px-4 py-3 text-[16px] font-bold bg-yellow-50">`}`;
  }
  h+=`</div>
  <div class="bg-white rounded-3xl border p-5">
    <p class="font-black text-[15px]">2 · CODICE A BARRE</p>`;
  if(E.mode==='esistente' && E.prod && ean13ok(E.prod.code) && !E.code){
    h+=`<p class="text-[13px] font-bold text-slate-600 mt-2">Questo prodotto ha già un codice EAN-13. Puoi stamparlo così com'è, oppure creare un codice interno in più.</p>
    <div class="mt-3 bg-white border rounded-2xl p-3 text-center"><div style="max-width:300px;margin:0 auto">${ean13Svg(E.prod.code)}</div></div>`;
  }
  if(E.code){
    h+=`<div class="mt-3 bg-white border-2 rounded-2xl p-3 text-center"><div style="max-width:300px;margin:0 auto">${ean13Svg(E.code)}</div><p class="font-mono font-black text-[15px] mt-1">${E.code}</p><p class="text-[11px] font-bold ${E.saved?'text-emerald-600':'text-amber-600'}">${E.saved?'✓ ASSEGNATO AL PRODOTTO':'Non ancora assegnato: tocca ASSEGNA'}</p></div>`;
  }
  h+=`<div class="grid grid-cols-2 gap-2 mt-3">
      <button data-et="crea" class="rounded-2xl py-4 font-black text-[14px] bg-yellow-400 border-2 border-yellow-500">${E.code?'NUOVO CODICE':'CREA BARCODE'}</button>
      <button data-et="assegna" class="rounded-2xl py-4 font-black text-[14px] bg-emerald-500 text-white ${(!E.code||E.saved)?'opacity-40':''}">ASSEGNA AL PRODOTTO</button>
    </div>
  </div>`;
  const stampabile = (E.code&&E.saved) ? E.code : (E.mode==='esistente'&&E.prod&&ean13ok(E.prod.code)) ? E.prod.code : null;
  const nomeStampa = E.mode==='esistente'&&E.prod ? nomeP(E.prod) : (document.getElementById('etNome')?.value||keepName||'');
  h+=`<div class="bg-white rounded-3xl border p-5">
    <p class="font-black text-[15px]">3 · STAMPA</p>
    <div class="grid grid-cols-2 gap-2 mt-3">
      <label class="block"><span class="text-[11px] font-black text-slate-500">NUMERO DI ETICHETTE</span><input id="etCopie" value="${esc(keepCop)}" readonly data-numpad="NUMERO ETICHETTE" class="w-full border-2 rounded-2xl px-4 py-3 text-[16px] font-bold bg-yellow-50"></label>
      <label class="block"><span class="text-[11px] font-black text-slate-500">FORMATO</span><select id="etFormato" class="w-full border-2 rounded-2xl px-3 py-3 text-[14px] font-bold bg-white"><option value="foglio">Foglio A4 (più etichette)</option><option value="rotolo">Rotolo 50×30 mm (1 per etichetta)</option></select></label>
    </div>
    <label class="mt-3 flex items-center gap-3 font-bold text-[14px]"><input id="etMostraPrezzo" type="checkbox" checked class="w-6 h-6"> Scrivi il prezzo sull'etichetta</label>
    <button data-et="stampa" class="w-full mt-3 rounded-2xl py-4 font-black text-[15px] bg-slate-900 text-white ${stampabile?'':'opacity-40'}">🖨 STAMPA ETICHETTE</button>
    ${stampabile?'':'<p class="text-[12px] font-bold text-slate-500 mt-2">Prima crea e assegna un barcode (oppure scegli un prodotto con codice EAN-13).</p>'}
  </div></div>`;
  r.innerHTML=h;
  const sel=document.getElementById('etFormato'); if(sel&&E.formato) sel.value=E.formato;
  if(E.mode==='esistente') etLista();
  if(focusId){ const f=document.getElementById(focusId); if(f&&f.tagName==='INPUT'&&f.type!=='checkbox'){ f.focus(); try{ f.setSelectionRange(f.value.length,f.value.length); }catch(e){} } }
}

function etLista(){
  const box=document.getElementById('etLista'); if(!box) return;
  const q=(document.getElementById('etSearch')?.value||'').toLowerCase().trim();
  let list=S.inv.slice();
  if(q) list=list.filter(p=>(typeof hay==='function'?hay(p):nomeP(p).toLowerCase()).includes(q));
  list.sort((a,b)=>(/^NOBARCODE_/.test(b.code)?1:0)-(/^NOBARCODE_/.test(a.code)?1:0) || nomeP(a).localeCompare(nomeP(b)));
  box.innerHTML=list.slice(0,40).map(p=>`<button data-et="pick" data-code="${esc(p.code)}" class="w-full text-left border-2 rounded-xl p-3 ${E.prod&&E.prod.code===p.code?'border-emerald-500 bg-emerald-50':'bg-slate-50'}"><span class="font-black text-[13px]">${esc(nomeP(p))}</span><br><span class="text-[11px] font-bold ${/^NOBARCODE_/.test(p.code)?'text-red-600':'text-slate-500'}">${/^NOBARCODE_/.test(p.code)?'SENZA BARCODE':esc(p.code)} · ${eur2(p.prezzo)}</span></button>`).join('')
    + (list.length>40?'<p class="text-center text-[11px] text-slate-500">Mostrati 40 su '+list.length+': usa la ricerca</p>':'')
    + (!list.length?'<p class="text-center text-[12px] text-slate-400 py-4">Nessun prodotto trovato.</p>':'');
}

/* ---------- azioni ---------- */
async function assegna(){
  if(E.busy||!E.code||E.saved) return;
  E.busy=true;
  try{
    if(S.byCode.get(E.code)||resolve([E.code]).prod){ showWarning('Questo codice esiste già. Creane uno nuovo.','CODICE GIÀ USATO'); E.code=null; etRender(); return; }
    if(E.mode==='esistente'){
      const p=E.prod; if(!p){ showWarning('Scegli prima il prodotto.','PRODOTTO'); return; }
      if(/^NOBARCODE_/.test(p.code)){
        const { error } = await supa.from('prodotti_master').update({ barcode:E.code }).eq('barcode', p.code);
        if(error) throw error;
      } else {
        const { error } = await supa.rpc('associa_codice', { p_codice:E.code, p_barcode:p.code });
        if(error) throw error;
      }
      await loadInventory(true);
      E.prod = S.byCode.get(E.code) || S.byCode.get(p.code) || p;
    } else {
      const nome=(document.getElementById('etNome')?.value||'').replace(/\s+/g,' ').trim().toUpperCase();
      const prezzo=num(document.getElementById('etPrezzo')?.value||'');
      const senza=!!document.getElementById('etSenza')?.checked; const qty=senza?9999:parseInt(document.getElementById('etQty')?.value||'');
      if(!nome||isNaN(prezzo)||prezzo<=0||prezzo>=1000||isNaN(qty)||qty<0){ showWarning('Scrivi il nome e il prezzo (e la quantità, se la tieni).','DATI MANCANTI'); return; }
      const { error } = await supa.from('prodotti_master').insert([{ barcode:E.code, marca:nome, nome:'', prezzo, quantita:qty, codice_aams:null, codice_logista:null, categoria:SEZ[E.sez].cat, data_ultimo_carico:new Date().toISOString(), media_giornaliera:0, scorta:0 }]);
      if(error) throw error;
      await loadInventory(true);
    }
    E.saved=true; toast('BARCODE ASSEGNATO', E.code, 1500);
  }catch(e){ showError(e.code==='23505'?'Esiste già un prodotto con questo codice.':errMsg(e),'SALVATAGGIO'); }
  finally{ E.busy=false; etRender(); }
}

function stampa(){
  const code = (E.code&&E.saved) ? E.code : (E.mode==='esistente'&&E.prod&&ean13ok(E.prod.code)) ? E.prod.code : null;
  if(!code){ showWarning('Prima crea e assegna un barcode.','NIENTE DA STAMPARE'); return; }
  const p=S.byCode.get(code)||E.prod;
  const nome = p ? nomeP(p) : (document.getElementById('etNome')?.value||'').toUpperCase();
  const prezzo = p ? p.prezzo : num(document.getElementById('etPrezzo')?.value||'');
  const n=Math.max(1,Math.min(200,parseInt(document.getElementById('etCopie')?.value||'1')||1));
  const formato=document.getElementById('etFormato')?.value||'foglio'; E.formato=formato;
  const conPrezzo=!!document.getElementById('etMostraPrezzo')?.checked;
  let area=document.getElementById('printArea'); if(!area){ area=document.createElement('div'); area.id='printArea'; document.body.appendChild(area); }
  const lab=`<div class="et-lab"><div class="et-nome">${esc(nome)}</div>${conPrezzo&&!isNaN(prezzo)?`<div class="et-prezzo">${eur2(prezzo)}</div>`:''}<div class="et-bc">${ean13Svg(code)}</div></div>`;
  area.className='et-'+formato;
  area.innerHTML=lab.repeat(n);
  let st=document.getElementById('etPrintStyle'); if(!st){ st=document.createElement('style'); st.id='etPrintStyle'; document.head.appendChild(st); }
  st.textContent = `@page{size:${formato==='rotolo'?'50mm 30mm':'A4'};margin:${formato==='rotolo'?'0':'8mm'}}`;
  document.body.classList.add('stampa-etichette');
  const fine=()=>{ document.body.classList.remove('stampa-etichette'); window.removeEventListener('afterprint',fine); };
  window.addEventListener('afterprint',fine);
  setTimeout(()=>{ window.print(); setTimeout(()=>{ if(document.body.classList.contains('stampa-etichette') && !/iPad|iPhone/.test(navigator.userAgent)) fine(); },1500); },80);
}

/* ---------- eventi ---------- */
document.addEventListener('click', e=>{
  const b=e.target.closest('[data-et]'); if(!b||!root()||!root().contains(b)) return;
  const a=b.dataset.et;
  if(a==='mode'){ E.mode=b.dataset.v; E.code=null; E.saved=false; E.prod=null; etRender(); }
  else if(a==='sez'){ E.sez=b.dataset.v; E.senzaGiac = b.dataset.v!=='tabacchi'; etRender(); }
  else if(a==='pick'){ E.prod=S.byCode.get(b.dataset.code)||null; E.code=null; E.saved=false; etRender(); }
  else if(a==='crea'){ E.code=nuovoCodice(); E.saved=false; etRender(); }
  else if(a==='assegna'){ assegna(); }
  else if(a==='stampa'){ stampa(); }
});
document.addEventListener('input', e=>{ if(e.target.id==='etSearch') etLista(); });
document.addEventListener('change', e=>{ if(e.target.id==='etSenza'){ E.senzaGiac=e.target.checked; etRender(); } if(e.target.id==='etFormato') E.formato=e.target.value; });

/* stile stampa */
const css=document.createElement('style');
css.textContent=`
#printArea{display:none}
@media print{
  body.stampa-etichette>*:not(#printArea){display:none!important}
  body.stampa-etichette{padding:0!important;background:#fff!important}
  body.stampa-etichette #printArea{display:flex!important;flex-wrap:wrap;align-content:flex-start}
  #printArea .et-lab{box-sizing:border-box;break-inside:avoid;font-family:Arial,sans-serif;color:#000;text-align:center;overflow:hidden}
  #printArea .et-nome{font-weight:700;line-height:1.1}
  #printArea .et-prezzo{font-weight:900}
  #printArea .et-bc svg{width:100%;display:block}
  #printArea.et-foglio .et-lab{width:63.5mm;height:33.9mm;padding:2mm 3mm;border:.2mm dotted #bbb}
  #printArea.et-foglio .et-nome{font-size:11pt;max-height:2.4em}
  #printArea.et-foglio .et-prezzo{font-size:13pt}
  #printArea.et-foglio .et-bc svg{height:17mm}
  #printArea.et-rotolo{display:block!important}
  #printArea.et-rotolo .et-lab{width:50mm;height:30mm;padding:1.5mm 2mm;page-break-after:always}
  #printArea.et-rotolo .et-nome{font-size:9pt;max-height:2.3em}
  #printArea.et-rotolo .et-prezzo{font-size:11pt}
  #printArea.et-rotolo .et-bc svg{height:14mm}
}`;
document.head.appendChild(css);

window.etRender = etRender;
window.__etTest = { checkDigit, ean13ok, ean13Modules, ean13Svg, nuovoCodice, E, stampa };
})();
