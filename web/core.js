import { PDFDocument, StandardFonts, rgb, degrees } from './vendor/pdf-lib.mjs';

export function parseDimension(text) {
  const value = text.trim().replace(/\s+/g, ' ');
  // Conservative suggestions: accept a complete dimension, never general drawing prose.
  const match = value.match(/^(?:(\d+)\s*[xX×]\s*)?([Øø⌀RrMm]?\s*[+-]?(?:\d+(?:\.\d+)?|\.\d+)\s*°?)(?:\s*(±\s*(?:\d+(?:\.\d+)?|\.\d+)\s*°?|\+\s*[\d.]+\s*\/\s*-\s*[\d.]+))?$/);
  if (!match || !/[.±°Øø⌀RrMm]/.test(value)) return null;
  return { dimension: value, nominal: match[2].trim(), tolerance: match[3]?.trim() || '', notes: match[1] ? `Quantity: ${match[1]}` : '' };
}

export function csvCell(value) {
  let text = String(value ?? '');
  // Prevent text fields from being interpreted as spreadsheet formulas.
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function makeCSV(bubbles) {
  const rows = [['Bubble', 'Page', 'Dimension / requirement', 'Nominal', 'Tolerance', 'Feature', 'Datums', 'Notes', 'Reviewed', 'Source', 'OCR confidence'],
    ...bubbles.map((b, i) => [i + 1, b.page, b.dimension, b.nominal, b.tolerance, b.feature, b.datums, b.notes, b.reviewed ? 'Yes' : 'No', b.source||'Manual', b.confidence??''])];
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function alphabetLabel(index) {
  let n = index + 1, label = '';
  while (n) { n--; label = String.fromCharCode(65 + n % 26) + label; n = Math.floor(n / 26); }
  return label;
}

export async function annotatePDF(bytes, bubbles, rotations = {}) {
  const doc = await PDFDocument.load(bytes);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();
  pages.forEach((page,i)=>page.setRotation(degrees(((page.getRotation().angle+(rotations[i+1]||0))%360+360)%360)));
  let normalIndex = 0, msaIndex = 0;
  for (let i = 0; i < bubbles.length; i++) {
    const b = bubbles[i], page = pages[b.page - 1];
    if (!page || !Number.isFinite(b.x) || !Number.isFinite(b.y)) throw new Error('Invalid bubble position.');
    const label = b.msa ? alphabetLabel(msaIndex++) : String(++normalIndex), radius = Math.max(10, font.widthOfTextAtSize(label, 10) / 2 + 4);
    const rotation = page.getRotation().angle;
    const green = Boolean(b.msa);
    page.drawCircle({ x: b.x, y: b.y, size: radius, color: green ? rgb(.91, .98, .93) : rgb(1, .995, .94), borderColor: green ? rgb(.13, .52, .29) : rgb(.78, .2, .14), borderWidth: 1.5, opacity: .96 });
    const angle = rotation * Math.PI / 180;
    const dx = -font.widthOfTextAtSize(label, 10) / 2, dy = -3.5;
    page.drawText(label, { x: b.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: b.y + dx * Math.sin(angle) + dy * Math.cos(angle), size: 10, font, color: green ? rgb(.09, .4, .22) : rgb(.7, .15, .09), rotate: degrees(rotation) });
  }
  return doc.save();
}

export async function makeSample() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let n = 0; n < 2; n++) {
    const page = doc.addPage([792, 612]);
    const ink = rgb(.12, .2, .27), gray = rgb(.4, .47, .52);
    const text = (s, x, y, size = 12, f = font) => page.drawText(s, { x, y, size, font: f, color: ink });
    const line = (x1, y1, x2, y2) => page.drawLine({start:{x:x1,y:y1},end:{x:x2,y:y2},thickness:.8,color:gray});
    page.drawRectangle({x:24,y:24,width:744,height:564,borderColor:gray,borderWidth:.8});
    text('BUBBLE DRAWING / SAMPLE', 45, 552, 11, bold);
    text(n ? 'SIDE ELEVATION' : 'MOUNTING PLATE', 45, 521, 22, bold);
    text('Demonstration drawing only - not for manufacturing', 45, 499, 10);
    page.drawRectangle({x:190,y:205,width:400,height:n ? 80 : 210,borderColor:ink,borderWidth:1.6});
    if (!n) for(const x of [230,550]) for(const y of [245,375]) page.drawCircle({x,y,size:14,borderColor:ink,borderWidth:1.2});
    line(190,185,590,185); line(190,175,190,202); line(590,175,590,202);
    text('100.00 ±0.10', 344, 162);
    line(615,205,615,n?285:415); line(598,205,625,205); line(598,n?285:415,625,n?285:415);
    text(n?'20.00':'50.00 ±0.05', 634, n?242:304);
    if(!n){line(230,375,280,451);line(280,451,375,451);text('4X Ø8.00 ±0.05',282,459);text('R2.00',160,427);}
    else text('90°',160,298);
    line(24,95,768,95);text('PART: DEMO-001',45,70,11,bold);text('UNITS: mm',350,70,11);text(`SHEET ${n+1} / 2`,650,70,11);
    text('Tolerances apply only where explicitly shown.',45,46,10);
  }
  return doc.save();
}
