import { parseDimension } from './core.js';

export const FEATURES = { '⌖':'Position','⏥':'Flatness','⌭':'Cylindricity','○':'Circularity','⌓':'Profile of a surface','⌒':'Profile of a line','∥':'Parallelism','⊥':'Perpendicularity','∠':'Angularity','⌯':'Symmetry','◎':'Concentricity','↗':'Circular runout','⌰':'Total runout','⏤':'Straightness' };
const featureNames = Object.values(FEATURES).sort((a,b)=>b.length-a.length);
export const correctionKey = text => String(text).trim().replace(/\s+/g,' ').toUpperCase();

export function extractRequirement(raw, corrections = {}) {
  const text=String(raw).trim().replace(/[−–]/g,'-').replace(/\+\s*\//g,'+/').replace(/\+\s*-\s*(?=\d)/g,'±').replace(/\s+/g,' ');
  if(!text || text.length>200)return null;
  const learned=corrections[correctionKey(raw)];
  if(learned)return {...learned,rawText:raw,learned:true};
  const symbol=Object.keys(FEATURES).find(s=>text.includes(s));
  const name=featureNames.find(s=>new RegExp(`\\b${s}\\b`,'i').test(text));
  if(symbol||name){
    const feature=symbol?FEATURES[symbol]:name;
    const remaining=text.replace(symbol||new RegExp(name,'i'),'');
    const tol=remaining.match(/[Øø⌀]?\s*(?:\d+(?:\.\d+)?|\.\d+)(?:\s*[ⓂⓁⓈ])?/);
    if(!tol)return null;
    const datums=[...remaining.matchAll(/(?:\||\s)([A-Z])(?:[ⓂⓁⓈ])?(?=\s|\||$)/g)].map(m=>m[1]).join(' | ');
    return {dimension:text,nominal:'',tolerance:tol[0].trim(),feature,datums,notes:'Verify feature-control frame and datum order against the drawing.',rawText:raw};
  }
  const clean=text.replace(/\s*(mm|in|inch|inches|μm|µm)\s*$/i,'').replace(/\s*\+\/\-\s*/g,' ±');
  const parsed=parseDimension(clean);
  if(parsed)return {...parsed,feature:'Dimension',datums:'',rawText:raw};
  const thread=clean.match(/^(?:\d+\s*[Xx×]\s*)?M\s*\d+(?:\.\d+)?\s*[xX×]\s*\d+(?:\.\d+)?(?:\s*-\s*\d+[gGhH])?$/);
  if(thread)return {dimension:text,nominal:clean,tolerance:'',feature:'Thread',datums:'',notes:'',rawText:raw};
  return null;
}

export function groupTextItems(items, viewport) {
  const words=items.filter(i=>i.str?.trim()).map(item=>{
    const [x,y]=viewport.convertToViewportPoint(item.transform[4],item.transform[5]);
    return {text:item.str.trim(),x,y,width:Math.abs(item.width*viewport.scale),height:Math.max(5,item.height*viewport.scale)};
  });
  const result=[...words];
  const sorted=[...words].sort((a,b)=>a.y-b.y||a.x-b.x);
  for(let i=0;i<sorted.length;i++){
    const start=sorted[i];let text=start.text,end=start.x+start.width;
    const neighbors=sorted.filter(w=>w!==start&&w.x>=end-1&&Math.abs(w.y-start.y)<Math.max(start.height,w.height)*.45).sort((a,b)=>a.x-b.x);
    for(const next of neighbors.slice(0,12)){
      if(next.x-end>Math.max(start.height,next.height)*1.6)break;
      text+=' '+next.text;end=next.x+next.width;
      if(text.length>200)break;
      result.push({...start,text,width:end-start.x});
    }
  }
  // Longest valid assembled requirement is considered first to retain tolerances.
  return result.sort((a,b)=>b.text.length-a.text.length);
}

export function ocrLines(data) {
  const lines=[];
  for(const block of data.blocks||[]) for(const paragraph of block.paragraphs||[]) for(const line of paragraph.lines||[]) {
    const text=(line.text||line.words?.map(w=>w.text).join(' ')||'').trim();
    if(text&&line.bbox)lines.push({text,x:line.bbox.x0,y:line.bbox.y1,width:line.bbox.x1-line.bbox.x0,height:line.bbox.y1-line.bbox.y0,confidence:line.confidence??data.confidence??0});
    // A dimension may share a line with unrelated text. Keep individual words too.
    for(const word of line.words||[])if(word.text&&word.bbox)lines.push({text:word.text,x:word.bbox.x0,y:word.bbox.y1,width:word.bbox.x1-word.bbox.x0,height:word.bbox.y1-word.bbox.y0,confidence:word.confidence??0});
  }
  return lines.sort((a,b)=>b.text.length-a.text.length);
}

export function moveBubble(bubbles,id,number) {
  if(!Number.isInteger(number)||number<1||number>bubbles.length)throw new Error(`Enter a number from 1 to ${bubbles.length}.`);
  const i=bubbles.findIndex(b=>b.id===id);if(i<0)throw new Error('Select a bubble first.');
  const result=[...bubbles], [bubble]=result.splice(i,1);result.splice(number-1,0,bubble);return result;
}
