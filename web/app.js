import * as pdfjs from './vendor/pdf.mjs';
import { parseDimension, makeCSV, annotatePDF, makeSample } from './core.js';
pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.mjs', import.meta.url).href;
const $ = id => document.getElementById(id);
let pdf = null, original = null, filename = '', pageNumber = 1, viewport = null;
let scale = 1, bubbles = [], selected = null, adding = false, history = [], busy = false;
let renderTask = null, renderVersion = 0, drag = null;
const status = (message, error = false) => { $('status').textContent = message; $('status').classList.toggle('error', error); };
const current = () => bubbles.find(b => b.id === selected);
function checkpoint() { history.push(JSON.stringify(bubbles)); if(history.length > 60) history.shift(); $('undo').disabled = false; }
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
}
async function run(action) {
  if(busy) return;
  busy = true; controls();
  try { await action(); } catch(e) { console.error(e); status(e.message || 'Something went wrong. Please try again.', true); }
  finally { busy = false; controls(); }
}
function setMode(value) { adding = value; $('add').setAttribute('aria-pressed', String(adding)); $('paper').classList.toggle('adding', adding); $('mode').textContent = adding ? 'PLACE BUBBLES' : 'REVIEW MODE'; }
function clampPoint(x, y) { const margin = 12 * scale; return [Math.max(Math.min(margin,viewport.width/2),Math.min(viewport.width-margin,x)),Math.max(Math.min(margin,viewport.height/2),Math.min(viewport.height-margin,y))]; }
async function render(fit = false) {
  if(!pdf) return;
  const version = ++renderVersion;
  if(renderTask) { renderTask.cancel(); try {await renderTask.promise;} catch {} }
  const page = await pdf.getPage(pageNumber);
  if(version !== renderVersion) return;
  const natural = page.getViewport({ scale: 1 });
  if(fit) scale = Math.max(.15, Math.min(2, ($('viewer').clientWidth - 52)/natural.width));
  viewport = page.getViewport({ scale });
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
  $('filename').textContent = name; $('filemeta').textContent = `${pdf.numPages} page${pdf.numPages===1?'':'s'} · ${(bytes.length/1024/1024).toFixed(1)} MB`;
  $('empty').hidden = true; $('paper').hidden = false; setMode(false); refresh();
  await render(true); status('Drawing ready. Add bubbles manually or suggest dimensions on this page.');
}
async function openFile(file) {
  if(!file) return;
  if(!/\.pdf$/i.test(file.name)) throw new Error('Choose a PDF file.');
  if(file.size > 50*1024*1024) throw new Error('This file is larger than 50 MB. Please use a smaller PDF.');
  await loadPDF(new Uint8Array(await file.arrayBuffer()), file.name);
}
function createBubble(x, y, fields = {}) {
  return { id: crypto.randomUUID(), page: pageNumber, x, y, dimension: '', nominal: '', tolerance: '', notes: '', reviewed: false, ...fields };
}
function drawBubbles() {
  $('overlay').replaceChildren();
  if(!viewport) return;
  bubbles.forEach((b,i) => {
    if(b.page !== pageNumber) return;
    const [x,y] = viewport.convertToViewportPoint(b.x,b.y);
    const button = document.createElement('button'); button.className = 'bubble' + (b.id === selected ? ' selected' : '');
    button.textContent = i+1; button.dataset.id = b.id; button.title = `Bubble ${i+1}: ${b.dimension || 'No dimension entered'}`;
    button.setAttribute('aria-label', button.title); button.style.left = `${x}px`; button.style.top = `${y}px`;
    const radius = Math.max(10, String(i+1).length * 3 + 4);
    button.style.width = button.style.height = `${radius*2*scale}px`; button.style.fontSize = `${10*scale}px`;
    button.style.borderWidth = `${1.5*scale}px`;
    button.addEventListener('pointerdown',e => {
      if(busy || e.button !== 0) return;
      e.preventDefault(); e.stopPropagation(); selected = b.id; setMode(false);
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
    const num=document.createElement('span');num.className='register-number';num.textContent=i+1;
    const text=document.createElement('span');text.className='register-text';
    const title=document.createElement('strong');title.textContent=b.dimension||'Untitled requirement';
    const meta=document.createElement('small');meta.textContent=`Page ${b.page} · ${b.reviewed?'Reviewed':'Needs review'}`;
    text.append(title,meta);row.append(num,text);
    if(b.reviewed){const check=document.createElement('span');check.className='review-check';check.textContent='✓';row.append(check);}
    row.onclick=()=>run(async()=>{selected=b.id;setMode(false);if(pageNumber!==b.page){pageNumber=b.page;await render();}refresh();});
    $('register').append(row);
  });
  const b=current();$('editor').hidden=!b;
  if(b&&editor){$('selected-label').textContent=`Bubble ${bubbles.indexOf(b)+1}`;for(const key of ['dimension','nominal','tolerance','notes']) $(key).value=b[key];$('reviewed').checked=b.reviewed;$('moveup').disabled=bubbles.indexOf(b)===0;$('movedown').disabled=bubbles.indexOf(b)===bubbles.length-1;}
  if(paint) drawBubbles();controls();
}
async function suggest() {
  status('Finding dimension suggestions on this page…');
  const page=await pdf.getPage(pageNumber), text=await page.getTextContent();
  const suggestions=[];
  for(const item of text.items){
    if(!item.str) continue;
    const fields=parseDimension(item.str); if(!fields)continue;
    const [vx,vy]=viewport.convertToViewportPoint(item.transform[4],item.transform[5]);
    const [cx,cy]=clampPoint(vx-16*scale,vy-Math.max(4,item.height/2)*scale);
    const [x,y]=viewport.convertToPdfPoint(cx,cy);
    if(bubbles.some(b=>b.page===pageNumber&&Math.hypot(b.x-x,b.y-y)<15)||suggestions.some(b=>Math.hypot(b.x-x,b.y-y)<15))continue;
    suggestions.push(createBubble(x,y,fields));
    if(suggestions.length>=200)break;
  }
  if(suggestions.length){checkpoint();bubbles.push(...suggestions);selected=suggestions[0].id;refresh();status(`Added ${suggestions.length} suggestions on page ${pageNumber}. Check each against the drawing.`);}
  else status('No new text dimensions found. For scanned PDFs, use Add bubble; OCR is not included.');
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
$('add').onclick=()=>{setMode(!adding);status(adding?'Click on the drawing to add a bubble. Press Escape to finish.':'Select a bubble to edit it.');};
$('detect').onclick=()=>run(suggest);
$('overlay').onclick=e=>{
  if(!adding||busy||e.target.closest('.bubble'))return;
  const rect=$('paper').getBoundingClientRect();const [vx,vy]=clampPoint(e.clientX-rect.left,e.clientY-rect.top);const [x,y]=viewport.convertToPdfPoint(vx,vy);
  checkpoint();const b=createBubble(x,y);bubbles.push(b);selected=b.id;refresh();status(`Bubble ${bubbles.length} added. Enter its requirement in the register.`);
};
$('editor').onsubmit=e=>e.preventDefault();
for(const key of ['dimension','nominal','tolerance','notes']){
  $(key).addEventListener('focus',()=>{if(current())checkpoint();});
  $(key).addEventListener('input',()=>{const b=current();if(b){b[key]=$(key).value;b.reviewed=false;$('reviewed').checked=false;refresh(false,false);}});
}
$('reviewed').onchange=()=>{const b=current();if(b){checkpoint();b.reviewed=$('reviewed').checked;refresh(false,false);}};
$('delete').onclick=()=>{if(!current())return;checkpoint();bubbles=bubbles.filter(b=>b.id!==selected);selected=null;refresh();status('Bubble removed. Use Undo to restore it.');};
function reorder(delta){const i=bubbles.findIndex(b=>b.id===selected),j=i+delta;if(i<0||j<0||j>=bubbles.length)return;checkpoint();[bubbles[i],bubbles[j]]=[bubbles[j],bubbles[i]];refresh();}
$('moveup').onclick=()=>reorder(-1);$('movedown').onclick=()=>reorder(1);
$('undo').onclick=()=>{if(!history.length)return;bubbles=JSON.parse(history.pop());if(!current())selected=null;refresh();status('Last annotation change undone.');};
$('exportpdf').onclick=()=>run(async()=>{status('Preparing annotated PDF…');download(await annotatePDF(original,bubbles),'application/pdf',`${base()}-bubbled.pdf`);status('Bubbled PDF downloaded. Original pages and page sizes are preserved.');});
$('exportcsv').onclick=()=>{download(makeCSV(bubbles),'text/csv;charset=utf-8',`${base()}-inspection.csv`);status('Inspection CSV downloaded.');};
document.addEventListener('keydown',e=>{if(e.key==='Escape')setMode(false);});
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
