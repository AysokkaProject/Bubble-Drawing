import * as pdfjs from './vendor/pdf.mjs';
import { parseDimension, makeCSV, annotatePDF, makeSample } from './core.js';
import { extractRequirement, groupTextItems, ocrLines, moveBubble, correctionKey } from './detection.js';
pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.mjs', import.meta.url).href;
const $ = id => document.getElementById(id);
let pdf = null, original = null, filename = '', pageNumber = 1, viewport = null;
let scale = 1, bubbles = [], selected = null, adding = false, addingMsa = false, history = [], busy = false;
let renderTask = null, renderVersion = 0, drag = null;
let rotations = {}, corrections = {}, scanCancelled = false, ocrWorker = null;
const status = (message, error = false) => { $('status').textContent = message; $('status').classList.toggle('error', error); };
const current = () => bubbles.find(b => b.id === selected);
function checkpoint() { history.push(JSON.stringify({bubbles,rotations})); if(history.length > 60) history.shift(); $('undo').disabled = false; }
function controls() {
  document.querySelectorAll('[data-needs-doc]').forEach(b => b.disabled = !pdf || busy);
  $('prev').disabled = !pdf || busy || pageNumber === 1;
  $('next').disabled = !pdf || busy || pageNumber === pdf.numPages;
  $('undo').disabled = busy || !history.length;
  $('exportcsv').disabled = busy || !bubbles.length;
  $('open').disabled = busy; $('sample').disabled = busy; $('choose').disabled = busy;
  $('editor').inert = busy;
  $('register').inert = busy;
  $('overlay').inert = busy;
  $('sort').disabled = !pdf || busy || bubbles.length < 2;
  $('save').disabled = !pdf || busy || !bubbles.length;
}
async function run(action) {
  if(busy) return;
  busy = true; controls();
  try { await action(); } catch(e) { console.error(e); status(e.message || 'Something went wrong. Please try again.', true); }
  finally { busy = false; controls(); }
}
function setMode(value, msa = false) { adding = value; addingMsa = value && msa; $('add').setAttribute('aria-pressed', String(adding && !addingMsa)); $('add-msa').setAttribute('aria-pressed', String(addingMsa)); $('paper').classList.toggle('adding', adding); $('mode').textContent = addingMsa ? 'PLACE MSA ATTRIBUTES' : adding ? 'PLACE BUBBLES' : 'REVIEW MODE'; }
function clampPoint(x, y) { const margin = 12 * scale; return [Math.max(Math.min(margin,viewport.width/2),Math.min(viewport.width-margin,x)),Math.max(Math.min(margin,viewport.height/2),Math.min(viewport.height-margin,y))]; }
async function render(fit = false) {
  if(!pdf) return;
  const version = ++renderVersion;
  if(renderTask) { renderTask.cancel(); try {await renderTask.promise;} catch {} }
  const page = await pdf.getPage(pageNumber);
  if(version !== renderVersion) return;
  const rotation = (page.rotate + (rotations[pageNumber]||0)) % 360;
  const natural = page.getViewport({ scale: 1, rotation });
  if(fit) scale = Math.max(.15, Math.min(2, ($('viewer').clientWidth - 52)/natural.width));
  viewport = page.getViewport({ scale, rotation });
  const ratio = Math.min(window.devicePixelRatio || 1, 2, 4500 / Math.max(viewport.width, viewport.height));
  $('canvas').width = Math.round(viewport.width * ratio); $('canvas').height = Math.round(viewport.height * ratio);
  $('paper').style.width = `${viewport.width}px`; $('paper').style.height = `${viewport.height}px`;
  $('zoom').textContent = `${Math.round(scale*100)}%`; $('page').value = pageNumber; $('page').max = pdf.numPages;
  $('pages').textContent = `/ ${pdf.numPages}`;
  renderTask = page.render({ canvasContext: $('canvas').getContext('2d'), viewport, transform: [ratio,0,0,ratio,0,0] });
  try { await renderTask.promise; } catch(e) { if(e.name !== 'RenderingCancelledException') throw e; }
  if(version === renderVersion) { renderTask = null; drawBubbles(); controls(); }
}
async function loadPDF(bytes, name) {
  if(original && bubbles.length && !confirm('Open a different drawing? Download your current PDF and CSV first if you want to keep this work.')) return;
  status('Opening drawing…');
  const candidate = await pdfjs.getDocument({ data: bytes.slice(), cMapUrl: new URL('./vendor/cmaps/', import.meta.url).href, cMapPacked: true, standardFontDataUrl: new URL('./vendor/standard_fonts/', import.meta.url).href, wasmUrl: new URL('./vendor/wasm/', import.meta.url).href, isEvalSupported: false }).promise.catch(e => {throw new Error(e.name === 'PasswordException' ? 'This PDF is password protected. Open an unlocked copy.' : 'This PDF could not be opened. Try another PDF file.');});
  if(candidate.numPages > 300) {await candidate.destroy();throw new Error('Please use a PDF with 300 pages or fewer.');}
  if(pdf) await pdf.destroy();
  pdf = candidate; original = bytes; filename = name; pageNumber = 1; bubbles = []; history = []; selected = null;
  rotations = {};
  $('filename').textContent = name; $('filemeta').textContent = `${pdf.numPages} page${pdf.numPages===1?'':'s'} · ${(bytes.length/1024/1024).toFixed(1)} MB`;
  $('empty').hidden = true; $('paper').hidden = false; setMode(false); refresh();
  await render(true); status('Drawing ready. Add bubbles manually or scan dimensions across the drawing.');
}
async function openFile(file) {
  if(!file) return;
  if(!/\.pdf$/i.test(file.name)) throw new Error('Choose a PDF file.');
  if(file.size > 50*1024*1024) throw new Error('This file is larger than 50 MB. Please use a smaller PDF.');
  await loadPDF(new Uint8Array(await file.arrayBuffer()), file.name);
}
function createBubble(x, y, fields = {}) {
  return { id: crypto.randomUUID(), page: pageNumber, x, y, dimension: '', nominal: '', tolerance: '', feature: '', datums: '', notes: '', reviewed: false, ...fields };
}
function drawBubbles() {
  $('overlay').replaceChildren();
  if(!viewport) return;
  bubbles.forEach((b,i) => {
    if(b.page !== pageNumber) return;
    const [x,y] = viewport.convertToViewportPoint(b.x,b.y);
    const button = document.createElement('button'); button.className = `bubble${b.msa ? ' msa' : ''}` + (b.id === selected ? ' selected' : '');
    const label = b.msa ? msaLabel(b) : normalLabel(b);
    button.textContent = label; button.dataset.id = b.id; button.title = `${b.msa ? 'MSA attribute' : 'Bubble'} ${label}: ${b.dimension || 'No dimension entered'}`;
    button.setAttribute('aria-label', button.title); button.style.left = `${x}px`; button.style.top = `${y}px`;
    const radius = Math.max(10, String(i+1).length * 3 + 4);
    button.style.width = button.style.height = `${radius*2*scale}px`; button.style.fontSize = `${10*scale}px`;
    button.style.borderWidth = `${1.5*scale}px`;
    button.addEventListener('pointerdown',e => {
      if(busy || e.button !== 0) return;
      e.preventDefault(); e.stopPropagation(); selected = b.id; if(!adding) setMode(false);
      // Keep the pointer-capturing button mounted during a drag.
      document.querySelectorAll('.bubble').forEach(el=>el.classList.toggle('selected',el===button));
      refresh(false); button.setPointerCapture(e.pointerId);
      drag = {id:b.id,startX:e.clientX,startY:e.clientY,x:b.x,y:b.y,moved:false};
    });
    button.addEventListener('pointermove',e => {
      if(!drag || drag.id!==b.id) return;
      if(!drag.moved && Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)<3) return;
      if(!drag.moved) checkpoint(); drag.moved=true;
      const rect = $('paper').getBoundingClientRect();
      const [vx,vy] = clampPoint(e.clientX-rect.left,e.clientY-rect.top);
      [b.x,b.y] = viewport.convertToPdfPoint(vx,vy);
      button.style.left = `${vx}px`;button.style.top = `${vy}px`;
    });
    button.addEventListener('pointerup',()=>{if(drag){drag=null;drawBubbles();}});
    button.addEventListener('pointercancel',()=>{if(drag){b.x=drag.x;b.y=drag.y;drag=null;drawBubbles();}});
    button.addEventListener('click',e=>{e.stopPropagation();selected=b.id;refresh();});
    button.addEventListener('keydown',e=>{
      if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key) || busy) return;
      e.preventDefault();checkpoint();const step=e.shiftKey?10:2;
      const [vx,vy]=viewport.convertToViewportPoint(b.x,b.y);
      const [nx,ny]=clampPoint(vx+(e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0),vy+(e.key==='ArrowDown'?step:e.key==='ArrowUp'?-step:0));
      [b.x,b.y]=viewport.convertToPdfPoint(nx,ny);drawBubbles();$('overlay').querySelector(`[data-id="${b.id}"]`).focus();
    });
    $('overlay').append(button);
  });
}
function refresh(paint = true, editor = true) {
  $('count').textContent = bubbles.length;
  const reviewed = bubbles.filter(b=>b.reviewed).length;
  $('review-summary').textContent = bubbles.length ? `${bubbles.length} bubble${bubbles.length===1?'':'s'} · ${reviewed} reviewed · ${bubbles.length-reviewed} to check` : 'Add a bubble to begin.';
  $('register').replaceChildren();
  if(!bubbles.length) {const empty=document.createElement('div');empty.className='register-empty';empty.textContent='Your inspection points will appear here.';$('register').append(empty);}
  bubbles.forEach((b,i)=>{
    const row=document.createElement('button');row.className='register-item';row.setAttribute('aria-current',String(b.id===selected));
    const num=document.createElement('span');num.className=`register-number${b.msa?' msa':''}`;num.textContent=b.msa?msaLabel(b):normalLabel(b);
    const text=document.createElement('span');text.className='register-text';
    const title=document.createElement('strong');title.textContent=b.dimension||'Untitled requirement';
    const meta=document.createElement('small');meta.textContent=`Page ${b.page} · ${b.reviewed?'Reviewed':'Needs review'}`;
    text.append(title,meta);row.append(num,text);
    if(b.reviewed){const check=document.createElement('span');check.className='review-check';check.textContent='✓';row.append(check);}
    row.onclick=()=>run(async()=>{selected=b.id;if(!adding)setMode(false);if(pageNumber!==b.page){pageNumber=b.page;await render();}refresh();});
    $('register').append(row);
  });
  const b=current();$('editor').hidden=!b;
  if(b&&editor){$('selected-label').textContent=`${b.msa?'MSA attribute':'Bubble'} ${b.msa?msaLabel(b):normalLabel(b)}`;for(const key of ['dimension','nominal','tolerance','feature','datums','notes']) $(key).value=b[key]||'';$('reviewed').checked=b.reviewed;$('moveup').disabled=bubbles.indexOf(b)===0;$('movedown').disabled=bubbles.indexOf(b)===bubbles.length-1;
    $('bubble-number').value=bubbles.indexOf(b)+1;$('bubble-number').max=bubbles.length;
    $('source-info').textContent=b.source?`${b.source}${b.confidence!==undefined?' · OCR confidence '+Math.round(b.confidence)+'%':''}${b.learned?' · Remembered correction':''} · Original: ${b.rawText||''}`:'Manually placed bubble';
    $('learn').disabled=!b.rawText||!b.reviewed;
  }
  if(paint) drawBubbles();controls();
}
function normalLabel(b){return String(bubbles.filter(item=>!item.msa).indexOf(b)+1);}
function msaLabel(b){let n=bubbles.filter(item=>item.msa).indexOf(b)+1,label='';while(n){n--;label=String.fromCharCode(65+n%26)+label;n=Math.floor(n/26);}return label;}
function sortByPosition(){
  checkpoint();
  bubbles.sort((a,b)=>a.page-b.page || (b.y-a.y) || (a.x-b.x));
  refresh();
  status('Bubbles sorted from top to bottom, then left to right on the drawing.');
}
function savedReviews(){try{return JSON.parse(localStorage.getItem('bubble-drawing:saves')||'[]')}catch{return[]}}
function refreshSavedViews(){
  const host=$('saved-reviews'); host.replaceChildren(); const saves=savedReviews();
  if(!saves.length){const empty=document.createElement('span');empty.className='muted small';empty.textContent='No saved reviews yet.';host.append(empty);return;}
  for(const save of saves){const row=document.createElement('div');row.className='saved-review';const text=document.createElement('span');text.innerHTML=`<strong>${escapeHTML(save.filename)}</strong><small>${new Date(save.savedAt).toLocaleString()} · ${save.bubbles.length} bubbles</small>`;const view=document.createElement('button');view.type='button';view.textContent='View';view.onclick=()=>restoreSave(save.id);row.append(text,view);host.append(row);}
}
function escapeHTML(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function saveReview(){
  const saves=savedReviews().filter(item=>item.filename!==filename||item.savedAt!==saveReview.lastSavedAt);
  const snapshot={id:crypto.randomUUID(),filename,savedAt:new Date().toISOString(),bubbles:structuredClone(bubbles),rotations:structuredClone(rotations)};
  localStorage.setItem('bubble-drawing:saves',JSON.stringify([snapshot,...saves].slice(0,20)));saveReview.lastSavedAt=snapshot.savedAt;refreshSavedViews();status(`Saved ${bubbles.length} bubbles for ${filename}.`);
}
async function restoreSave(id){
  const snapshot=savedReviews().find(item=>item.id===id);if(!snapshot)return;
  if(snapshot.filename!==filename){status(`Open ${snapshot.filename} to view this saved review.`,true);return;}
  checkpoint();bubbles=structuredClone(snapshot.bubbles);rotations=structuredClone(snapshot.rotations);selected=null;await render();refresh();status(`Showing saved review from ${new Date(snapshot.savedAt).toLocaleString()}.`);
}
async function suggest() {
  const pages=$('scan-pages').value==='all'?Array.from({length:pdf.numPages},(_,i)=>i+1):[pageNumber];
  const useOCR=$('scan-ocr').checked;scanCancelled=false;$('scan-progress').hidden=false;$('cancel-scan').disabled=false;
  let added=0,done=0;checkpoint();
  const progress=(message,percentage)=>{$('scan-message').textContent=message;$('scan-meter').value=percentage;status(message);};
  const addCandidates=(items,vp,pno,source)=>{
    for(const item of items){
      const fields=extractRequirement(item.text,corrections);if(!fields)continue;
      const [anchorX,anchorY]=vp.convertToPdfPoint(item.x,item.y);
      if(bubbles.some(b=>b.page===pno&&Math.hypot((b.anchorX??b.x)-anchorX,(b.anchorY??b.y)-anchorY)<18))continue;
      const px=Math.max(12*vp.scale,Math.min(vp.width-12*vp.scale,item.x-17*vp.scale));
      const py=Math.max(12*vp.scale,Math.min(vp.height-12*vp.scale,item.y-item.height/2));
      const [x,y]=vp.convertToPdfPoint(px,py);
      bubbles.push(createBubble(x,y,{...fields,page:pno,anchorX,anchorY,source,...(item.confidence!==undefined?{confidence:item.confidence}:{})}));added++;
    }
  };
  try{
    for(const pno of pages){
      if(scanCancelled)break;
      progress(`Reading page ${pno} (${done+1}/${pages.length})…`,done/pages.length*100);
      const page=await pdf.getPage(pno),vp=page.getViewport({scale:1,rotation:(page.rotate+(rotations[pno]||0))%360});
      const text=await page.getTextContent();addCandidates(groupTextItems(text.items,vp),vp,pno,'PDF text');
      if(useOCR&&!scanCancelled){
        if(!ocrWorker){
          const {default:{createWorker}}=await import('./vendor/ocr/tesseract.mjs');
          const root=new URL('./vendor/ocr/',import.meta.url).href;
          ocrWorker=await createWorker('eng',1,{workerPath:root+'worker.min.js',corePath:root,langPath:root.replace(/\/$/,''),workerBlobURL:false,cacheMethod:'none',logger:m=>{if(m.status==='recognizing text')progress(`OCR page ${pno}: ${Math.round(m.progress*100)}%`,(done+m.progress)/pages.length*100);}});
          await ocrWorker.setParameters({tessedit_pageseg_mode:'11',preserve_interword_spaces:'1'});
        }
        if(scanCancelled)break;
        const scanScale=Math.min(3,Math.sqrt(16000000/(vp.width*vp.height)));
        const scanVP=page.getViewport({scale:scanScale,rotation:vp.rotation});
        const canvas=document.createElement('canvas');canvas.width=Math.ceil(scanVP.width);canvas.height=Math.ceil(scanVP.height);
        await page.render({canvasContext:canvas.getContext('2d'),viewport:scanVP}).promise;
        if(scanCancelled)break;
        const result=await ocrWorker.recognize(canvas,{}, {text:true,blocks:true});
        if(!scanCancelled)addCandidates(ocrLines(result.data),scanVP,pno,'OCR');
        canvas.width=canvas.height=0;
      }
      done++;refresh();
    }
    status(`${scanCancelled?'Scan stopped':'Scan complete'}: ${added} suggestions added; ${done}/${pages.length} pages scanned. Review all results.`);
  }finally{
    if(ocrWorker){await ocrWorker.terminate();ocrWorker=null;}
    $('scan-progress').hidden=true;refresh();
  }
}

async function renderedExport(pno,dpi=150,doc=null){
  const owned=!doc;doc ||= await pdfjs.getDocument({data:await annotatePDF(original,bubbles,rotations),standardFontDataUrl:new URL('./vendor/standard_fonts/',import.meta.url).href,cMapUrl:new URL('./vendor/cmaps/',import.meta.url).href,cMapPacked:true,wasmUrl:new URL('./vendor/wasm/',import.meta.url).href,isEvalSupported:false}).promise;
  try{const page=await doc.getPage(pno),unit=page.getViewport({scale:1});const scale=Math.min(dpi/72,Math.sqrt(25000000/(unit.width*unit.height)));const vp=page.getViewport({scale});const canvas=document.createElement('canvas');canvas.width=Math.ceil(vp.width);canvas.height=Math.ceil(vp.height);await page.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;return {canvas,width:unit.width,height:unit.height};}finally{if(owned)await doc.destroy();}
}

async function saveImages(){
  const all=$('image-pages').value==='all',format=$('image-format').value,dpi=Number($('image-dpi').value),pages=all?Array.from({length:pdf.numPages},(_,i)=>i+1):[pageNumber];
  const zip=all?new window.JSZip():null;
  for(const pno of pages){status(`Preparing ${format.toUpperCase()} page ${pno}…`);const {canvas}=await renderedExport(pno,dpi);const blob=await new Promise(resolve=>canvas.toBlob(resolve,`image/${format}`,.94));if(!blob)throw new Error('Image could not be created. Try 150 DPI.');const name=`${base()}-page-${pno}.${format==='jpeg'?'jpg':'png'}`;if(zip)zip.file(name,blob);else download(blob,blob.type,name);canvas.width=canvas.height=0;}
  if(zip)download(await zip.generateAsync({type:'blob'}),'application/zip',`${base()}-images.zip`);
  status('Image download ready. Bubbles and page rotation are included.');
}

async function preparePrint(win,percentage,pages){
  try{
    const d=win.document;d.title=`Print ${filename}`;d.body.replaceChildren();
    const style=d.createElement('style');style.textContent='body{margin:0;background:#dce3e9;font:14px Arial}header{position:sticky;top:0;padding:14px;background:white}button{padding:10px 20px}section{position:relative;margin:16px auto;background:white;overflow:hidden;break-after:page}img{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)}@media print{header{display:none}body{background:white}section{margin:0;break-after:page}section:last-child{break-after:auto}}';d.head.append(style);
    const header=d.createElement('header'),button=d.createElement('button');button.textContent='Preparing pages…';button.disabled=true;header.append(button);d.body.append(header);
    for(const pno of pages){status(`Preparing print page ${pno}…`);const {canvas,width,height}=await renderedExport(pno,150);const sheet=d.createElement('section');sheet.style.width=width+'pt';sheet.style.height=height+'pt';sheet.style.page='sheet'+pno;style.textContent+=`@page sheet${pno}{size:${width}pt ${height}pt;margin:0}`;const img=d.createElement('img');img.src=canvas.toDataURL('image/png');img.alt=`Drawing page ${pno}`;img.style.width=(width*percentage/100)+'pt';img.style.height=(height*percentage/100)+'pt';sheet.append(img);d.body.append(sheet);await img.decode();canvas.width=canvas.height=0;}
    button.textContent='Print / Save as PDF';button.disabled=false;button.onclick=()=>win.print();header.append(d.createTextNode(`  ${percentage}% drawing scale · Check paper size and printer settings.`));status('Print preview is ready in the new window.');
  }catch(e){if(!win.closed)win.document.body.textContent='Print preparation failed. Close this window and try fewer pages.';throw e;}
}
function download(data,type,name){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
const base=()=>filename.replace(/\.pdf$/i,'');
$('open').onclick=$('choose').onclick=()=>$('file').click();
$('file').onchange=()=>{const file=$('file').files[0];$('file').value='';run(()=>openFile(file));};
$('sample').onclick=()=>run(async()=>loadPDF(await makeSample(),'Sample mounting plate.pdf'));
$('prev').onclick=()=>run(async()=>{pageNumber--;await render();});
$('next').onclick=()=>run(async()=>{pageNumber++;await render();});
$('page').onchange=()=>run(async()=>{pageNumber=Math.max(1,Math.min(pdf.numPages,Number.parseInt($('page').value,10)||1));await render();});
$('zoomin').onclick=()=>run(async()=>{scale=Math.min(3,scale*1.2);await render();});
$('zoomout').onclick=()=>run(async()=>{scale=Math.max(.15,scale/1.2);await render();});
$('fit').onclick=()=>run(()=>render(true));
$('add').onclick=()=>{setMode(!(adding&&!addingMsa));status(adding?'Click on the drawing to add a bubble. You can still move existing bubbles. Press Escape to finish.':'Select a bubble to edit it.');};
$('add-msa').onclick=()=>{setMode(!(adding&&addingMsa),true);status(addingMsa?'Click on the drawing to add a green MSA attribute. Press Escape to finish.':'Select a bubble to edit it.');};
$('detect').onclick=()=>$('scan-dialog').showModal();
$('start-scan').onclick=()=>{$('scan-dialog').close();run(suggest);};
$('cancel-scan').onclick=()=>{scanCancelled=true;$('cancel-scan').disabled=true;$('scan-message').textContent='Stopping after the current operation…';};
$('rotate').onclick=()=>run(async()=>{checkpoint();rotations[pageNumber]=((rotations[pageNumber]||0)+90)%360;await render(true);});
$('overlay').onclick=e=>{
  if(!adding||busy||e.target.closest('.bubble'))return;
  const rect=$('paper').getBoundingClientRect();const [vx,vy]=clampPoint(e.clientX-rect.left,e.clientY-rect.top);const [x,y]=viewport.convertToPdfPoint(vx,vy);
  checkpoint();const b=createBubble(x,y,{msa:addingMsa});bubbles.push(b);selected=b.id;refresh();status(`${addingMsa?'MSA attribute '+msaLabel(b):'Bubble '+normalLabel(b)} added. Enter its requirement in the register.`);
};
$('editor').onsubmit=e=>e.preventDefault();
for(const key of ['dimension','nominal','tolerance','feature','datums','notes']){
  $(key).addEventListener('focus',()=>{if(current())checkpoint();});
  $(key).addEventListener('input',()=>{const b=current();if(b){b[key]=$(key).value;b.reviewed=false;$('reviewed').checked=false;refresh(false,false);}});
}
$('reviewed').onchange=()=>{const b=current();if(b){checkpoint();b.reviewed=$('reviewed').checked;refresh(false);}};
$('delete').onclick=()=>{if(!current())return;checkpoint();bubbles=bubbles.filter(b=>b.id!==selected);selected=null;refresh();status('Bubble removed. Use Undo to restore it.');};
function reorder(delta){const i=bubbles.findIndex(b=>b.id===selected),j=i+delta;if(i<0||j<0||j>=bubbles.length)return;checkpoint();[bubbles[i],bubbles[j]]=[bubbles[j],bubbles[i]];refresh();}
$('moveup').onclick=()=>reorder(-1);$('movedown').onclick=()=>reorder(1);
$('undo').onclick=()=>run(async()=>{if(!history.length)return;const previous=JSON.parse(history.pop());bubbles=previous.bubbles;rotations=previous.rotations;if(!current())selected=null;await render();refresh();status('Last annotation change undone.');});
$('setnumber').onclick=()=>run(()=>{const result=moveBubble(bubbles,selected,Number($('bubble-number').value));checkpoint();bubbles=result;refresh();status('Bubble numbers updated across the drawing and inspection list.');});
$('sort').onclick=()=>run(()=>sortByPosition());
$('save').onclick=()=>run(()=>saveReview());
$('clear-saves').onclick=()=>{if(!savedReviews().length)return;localStorage.removeItem('bubble-drawing:saves');refreshSavedViews();status('Saved review history cleared.');};
$('exportpdf').onclick=()=>run(async()=>{status('Preparing annotated PDF…');download(await annotatePDF(original,bubbles,rotations),'application/pdf',`${base()}-bubbled.pdf`);status('Bubbled PDF downloaded with your page rotations.');});
$('exportimage').onclick=()=>$('image-dialog').showModal();
$('save-image').onclick=()=>{$('image-dialog').close();run(saveImages);};
$('print').onclick=()=>$('print-dialog').showModal();
$('prepare-print').onclick=()=>{const percentage=Number($('print-scale').value);if(!Number.isFinite(percentage)||percentage<10||percentage>200){$('print-scale').reportValidity();return;}const win=window.open('','_blank');if(!win){status('Allow pop-ups for this site to open print preview.',true);return;}$('print-dialog').close();const pages=$('print-pages').value==='all'?Array.from({length:pdf.numPages},(_,i)=>i+1):[pageNumber];run(()=>preparePrint(win,percentage,pages));};
$('learn').onclick=()=>{const b=current();if(!b?.reviewed||!b.rawText)return;corrections[correctionKey(b.rawText)]=Object.fromEntries(['dimension','nominal','tolerance','feature','datums','notes'].map(key=>[key,b[key]||'']));$('learning-status').textContent=`Learning: ${Object.keys(corrections).length} confirmed corrections this session.`;status('Correction remembered for matching text in future scans this session.');};
$('exportcsv').onclick=()=>{download(makeCSV(bubbles),'text/csv;charset=utf-8',`${base()}-inspection.csv`);status('Inspection CSV downloaded.');};
document.addEventListener('keydown',e=>{if(e.key==='Escape')setMode(false);});
refreshSavedViews();
window.addEventListener('beforeunload',e=>{if(bubbles.length){e.preventDefault();e.returnValue='';}});
$('viewer').addEventListener('dragover',e=>{e.preventDefault();$('viewer').classList.add('dragover');});
$('viewer').addEventListener('dragleave',()=>$('viewer').classList.remove('dragover'));
$('viewer').addEventListener('drop',e=>{e.preventDefault();$('viewer').classList.remove('dragover');run(()=>openFile(e.dataTransfer.files[0]));});
// Optional agent access uses the same local register and edit actions as the UI.
const mc=document.modelContext;
if(mc?.registerTool){
  const lifecycle=new AbortController();
  const register=tool=>{try{Promise.resolve(mc.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}};
  register({name:'read_bubble_register',description:'Read the current local PDF bubble register.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:()=>({filename,page:pageNumber,bubbles:bubbles.map((b,i)=>({...b,number:i+1}))})});
  register({name:'update_bubble_requirement',description:'Edit an existing bubble requirement and mark it for review. Does not export or upload files.',inputSchema:{type:'object',properties:{number:{type:'integer',minimum:1},dimension:{type:'string',maxLength:200},nominal:{type:'string',maxLength:80},tolerance:{type:'string',maxLength:80}},required:['number','dimension'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute:input=>{
    if(busy||!input||!Number.isInteger(input.number)||!bubbles[input.number-1]||typeof input.dimension!=='string'||input.dimension.length>200)throw new Error('Select a valid bubble and a requirement of 200 characters or fewer.');
    for(const key of ['nominal','tolerance'])if(input[key]!==undefined&&(typeof input[key]!=='string'||input[key].length>80))throw new Error('Invalid nominal or tolerance.');
    checkpoint();const b=bubbles[input.number-1];b.dimension=input.dimension;for(const key of ['nominal','tolerance'])if(input[key]!==undefined)b[key]=input[key];b.reviewed=false;refresh();return {number:input.number,dimension:b.dimension,reviewed:false};
  }});
  window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}
