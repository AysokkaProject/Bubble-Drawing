import { parseDimension } from './core.js';

export const FEATURES = { '⌖':'Position','⏥':'Flatness','⌭':'Cylindricity','○':'Circularity','⌓':'Profile of a surface','⌒':'Profile of a line','∥':'Parallelism','⊥':'Perpendicularity','∠':'Angularity','⌯':'Symmetry','◎':'Concentricity','↗':'Circular runout','⌰':'Total runout','⏤':'Straightness' };
const featureNames = Object.values(FEATURES).sort((a,b)=>b.length-a.length);
export const correctionKey = text => String(text).trim().replace(/\s+/g,' ').toUpperCase();

export function extractRequirement(raw, corrections = {}) {
  const text=String(raw).trim().replace(/[−–]/g,'-').replace(/\+\s*\//g,'+/').replace(/\+\s*-\s*(?=\d)/g,'±').replace(/\s+/g,' ').replace(/(Ø|ø|⌀|\d)\s+(?=mm\b|cm\b|in(?:ches)?\b|µm\b|μm\b|um\b)/gi,'$1');
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

export function groupLimitItems(items, viewport = null) {
  const plainValue = /^(?:[Øø⌀Rr]\s*)?(?:\d+(?:\.\d+)?|\.\d+)(?:\s*°)?(?:\s*(?:mm|in|inch|inches|μm|µm))?$/i;
  const values = items.map(item => {
    const text = String(item.str ?? item.text ?? '').trim();
    if (!plainValue.test(text)) return null;
    let x = item.x, y = item.y, width = item.width, height = item.height;
    if (item.transform && viewport) {
      [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
      width = Math.abs(item.width * viewport.scale);
      height = Math.max(5, item.height * viewport.scale);
    }
    const unit = (text.match(/(mm|in|inch|inches|μm|µm)\s*$/i) || [])[1]?.toLowerCase() || '';
    const value = text.replace(/\s*(mm|in|inch|inches|μm|µm)\s*$/i, '').trim();
    const match = value.match(/^([Øø⌀Rr]?\s*)((?:\d+(?:\.\d+)?|\.\d+))(°?)$/i);
    if (!match || !/[.Øø⌀°]/.test(value) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { text: text.replace(/\s+/g, ' '), x, y, width: Math.max(1, width || 1), height: Math.max(5, height || 5), symbol: match[1].trim().toUpperCase(), unit: `${match[3]}|${unit}`, numeric: Number(match[2]), confidence: item.confidence };
  }).filter(Boolean);

  const unique = [...new Map(values.map(value => [`${value.text}|${Math.round(value.x)}|${Math.round(value.y)}`, value])).values()];
  const pairs = [];
  for (let i = 0; i < unique.length; i++) for (let j = i + 1; j < unique.length; j++) {
    const a = unique[i], b = unique[j];
    if (a.numeric === b.numeric || a.symbol !== b.symbol || a.unit !== b.unit) continue;
    const maxHeight = Math.max(a.height, b.height), dy = Math.abs(a.y - b.y);
    const overlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
    const overlapRatio = overlap / Math.min(a.width, b.width);
    const centerGap = Math.abs((a.x + a.width / 2) - (b.x + b.width / 2));
    if (dy < maxHeight * .45 || dy > maxHeight * 2.8 || (overlapRatio < .5 && centerGap > maxHeight * .8)) continue;
    pairs.push({ a, b, score: dy / maxHeight + centerGap / maxHeight });
  }
  pairs.sort((a, b) => a.score - b.score);
  const used = new Set(), grouped = [];
  for (const {a, b} of pairs) {
    if (used.has(a) || used.has(b)) continue;
    used.add(a); used.add(b);
    const [low, high] = a.numeric < b.numeric ? [a, b] : [b, a];
    grouped.push({ text: `${low.text} | ${high.text}`, x: Math.min(a.x, b.x), y: (a.y + b.y) / 2, top: Math.min(a.y - a.height, b.y - b.height), bottom: Math.max(a.y, b.y), width: Math.max(a.width, b.width), height: Math.max(a.height, b.height) * 2, ...(a.confidence !== undefined || b.confidence !== undefined ? { confidence: Math.min(a.confidence ?? 100, b.confidence ?? 100) } : {}) });
  }
  return grouped.sort((a, b) => b.text.length - a.text.length);
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

