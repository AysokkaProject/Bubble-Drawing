import { parseDimension } from './core.js';

const CELL_ROWS = [
  ...Array.from({ length: 10 }, (_, index) => 13 + index),
  ...Array.from({ length: 10 }, (_, index) => 58 + index),
  ...Array.from({ length: 10 }, (_, index) => 103 + index),
  ...Array.from({ length: 10 }, (_, index) => 148 + index),
  ...Array.from({ length: 10 }, (_, index) => 193 + index),
];

const NS = {
  drawing: 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing',
  image: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  officeRel: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  packageRel: 'http://schemas.openxmlformats.org/package/2006/relationships',
};

function xmlEscape(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function attrs(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w:.-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
}

function worksheetPath(workbookXml, relationshipsXml, sheetName) {
  const sheet = [...workbookXml.matchAll(/<sheet\b[^>]*\/?\s*>/g)].map(match => attrs(match[0])).find(item => item.name === sheetName);
  if (!sheet?.['r:id']) throw new Error(`The selected workbook is missing the ${sheetName} sheet.`);
  const relation = [...relationshipsXml.matchAll(/<Relationship\b[^>]*\/?\s*>/g)].map(match => attrs(match[0])).find(item => item.Id === sheet['r:id']);
  if (!relation?.Target) throw new Error(`Could not locate the ${sheetName} sheet in the workbook.`);
  return decodeURIComponent(new URL(relation.Target, 'https://xlsx.local/xl/workbook.xml').pathname.slice(1));
}

function cellPattern(reference) {
  return new RegExp(`<c\\b(?=[^>]*\\br="${reference}")[^>]*(?:\\/>|>[\\s\\S]*?<\\/c>)`);
}

function writeStringCell(xml, reference, value) {
  const match = xml.match(cellPattern(reference));
  if (!match) throw new Error(`The Check Point cell ${reference} is missing from the selected template.`);
  let opening = match[0].slice(0, match[0].indexOf('>') + 1);
  if (opening.endsWith('/>')) opening = opening.slice(0, -2) + '>';
  opening = opening.replace(/\s+t="[^"]*"/, '') + ' t="inlineStr"';
  const replacement = `${opening}<is><t>${xmlEscape(value)}</t></is></c>`;
  return xml.replace(match[0], replacement);
}

function writeNumberCell(xml, reference, value) {
  const match = xml.match(cellPattern(reference));
  if (!match) throw new Error(`The Min/Max cell ${reference} is missing from the selected template.`);
  let opening = match[0].slice(0, match[0].indexOf('>') + 1);
  if (opening.endsWith('/>')) opening = opening.slice(0, -2) + '>';
  opening = opening.replace(/\s+t="[^"]*"/, '');
  return xml.replace(match[0], `${opening}<v>${xmlEscape(value)}</v></c>`);
}

function writeFormulaCache(xml, reference, value) {
  const match = xml.match(cellPattern(reference));
  if (!match) return xml;
  let replacement = match[0].replace(/\s+t="[^"]*"/, '');
  replacement = replacement.replace(/<v>[\s\S]*?<\/v>/, `<v>${xmlEscape(value)}</v>`);
  return xml.replace(match[0], replacement);
}

function numberValue(value) {
  const text = String(value ?? '').trim().replace(/[−–]/g, '-');
  const match = text.match(/^\s*(?:[Øø⌀Rr]\s*)?([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(?:(?:mm|cm|in(?:ches)?|µm|μm|um|deg(?:rees)?|°|%)\s*)?$/i);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isFinite(number) ? number : null;
}

function toleranceBounds(tolerance) {
  const text = String(tolerance ?? '').trim().replace(/[−–]/g, '-').replace(/,/g, '');
  if (!text) return null;
  const numeric = '(\\d+(?:\\.\\d*)?|\\.\\d+)';
  const asymmetric = text.match(new RegExp(`^\\s*\\+\\s*${numeric}(?:\\s*\\/\\s*|\\s+)-\\s*${numeric}(?:\\s*(?:mm|cm|in(?:ches)?|µm|μm|um|°)\\s*)?$`, 'i'));
  if (asymmetric) return { lower: Math.abs(Number(asymmetric[2])), upper: Math.abs(Number(asymmetric[1])) };
  const single = text.match(new RegExp(`^\\s*(±|\\+\\/\\-|\\+\\s*\\/\\s*-)?\\s*([+-]?)\\s*${numeric}(?:\\s*(?:mm|cm|in(?:ches)?|µm|μm|um|°)\\s*)?$`, 'i'));
  if (!single) return null;
  const amount = Math.abs(Number(single[3]));
  if (!Number.isFinite(amount)) return null;
  if (single[1] && single[1].includes('+') && !single[1].includes('±') && !/\+\s*\/\s*-/.test(single[1])) {
    return single[2] === '-' ? { lower: amount, upper: 0 } : { lower: 0, upper: amount };
  }
  if (!single[1] && single[2] === '+') return { lower: 0, upper: amount };
  if (!single[1] && single[2] === '-') return { lower: amount, upper: 0 };
  return { lower: amount, upper: amount };
}

function limitsFor(bubble) {
  if ((bubble.toleranceMode || 'nominal-tolerance') === 'min-max') {
    const min = numberValue(bubble.minValue), max = numberValue(bubble.maxValue);
    return min !== null && max !== null ? { min, max, nominal: Number(((min + max) / 2).toFixed(10)) } : null;
  }
  const parsed = parseDimension(String(bubble.dimension || ''));
  const nominal = numberValue(bubble.nominal) ?? numberValue(parsed?.nominal);
  const bounds = toleranceBounds(bubble.tolerance || parsed?.tolerance);
  if (nominal === null || !bounds) return null;
  return { min: Number((nominal - bounds.lower).toFixed(10)), max: Number((nominal + bounds.upper).toFixed(10)), nominal };
}

function relationshipTarget(path, target) {
  const parts = path.split('/');
  parts.pop();
  for (const part of target.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

function relativeTarget(fromFilePath, toFilePath) {
  const from = fromFilePath.split('/');
  from.pop();
  const to = toFilePath.split('/');
  while (from.length && to.length && from[0] === to[0]) { from.shift(); to.shift(); }
  return [...from.map(() => '..'), ...to].join('/');
}

function drawingAreaAspect(xml) {
  const format = xml.match(/<sheetFormatPr\b[^>]*>/)?.[0] || '';
  const defaultWidth = Number(attrs(format).defaultColWidth || 8.43);
  const defaultHeight = Number(attrs(format).defaultRowHeight || 15);
  const colsXml = xml.match(/<cols>([\s\S]*?)<\/cols>/)?.[1] || '';
  const columns = [...colsXml.matchAll(/<col\b[^>]*\/?\s*>/g)].map(match => attrs(match[0]));
  let width = 0;
  for (let index = 1; index <= 17; index++) {
    const column = columns.find(item => Number(item.min) <= index && Number(item.max) >= index);
    const charWidth = Number(column?.width || defaultWidth);
    width += Math.floor(charWidth * 7 + 5);
  }
  const rowsXml = xml.match(/<sheetData>([\s\S]*?)<\/sheetData>/)?.[1] || '';
  const rows = [...rowsXml.matchAll(/<row\b[^>]*\/?\s*>/g)].map(match => attrs(match[0]));
  let height = 0;
  for (let index = 1; index <= 45; index++) {
    const row = rows.find(item => Number(item.r) === index);
    height += Number(row?.ht || defaultHeight) * 96 / 72;
  }
  return width / height;
}

async function drawingPNG(pages, aspectRatio) {
  if (!pages.length) throw new Error('No drawing pages are available for the DRW sheet.');
  const output = document.createElement('canvas');
  output.width = 2400;
  output.height = Math.max(1, Math.round(output.width / aspectRatio));
  const context = output.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, output.width, output.height);
  const pageAspect = pages.reduce((total, page) => total + page.width / page.height, 0) / pages.length;
  const columns = pages.length === 1 ? 1 : Math.max(1, Math.ceil(Math.sqrt(pages.length * aspectRatio / pageAspect)));
  const rows = Math.ceil(pages.length / columns);
  const gap = 28;
  const tileWidth = (output.width - gap * (columns + 1)) / columns;
  const tileHeight = (output.height - gap * (rows + 1)) / rows;
  pages.forEach((page, index) => {
    const column = index % columns, row = Math.floor(index / columns);
    const scale = Math.min(tileWidth / page.canvas.width, tileHeight / page.canvas.height);
    const width = page.canvas.width * scale, height = page.canvas.height * scale;
    const x = gap + column * (tileWidth + gap) + (tileWidth - width) / 2;
    const y = gap + row * (tileHeight + gap) + (tileHeight - height) / 2;
    context.drawImage(page.canvas, x, y, width, height);
  });
  const blob = await new Promise(resolve => output.toBlob(resolve, 'image/png'));
  output.width = output.height = 0;
  if (!blob) throw new Error('Could not prepare the bubbled drawing for the OQC form.');
  return new Uint8Array(await blob.arrayBuffer());
}

function drawingXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="${NS.drawing}" xmlns:a="${NS.image}" xmlns:r="${NS.officeRel}"><xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>17</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>45</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="Finished bubbled drawing"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`;
}

function addDrawingRelationship(xml, relationshipId) {
  const drawingTag = `<drawing r:id="${xmlEscape(relationshipId)}"/>`;
  if (/<drawing\b/.test(xml)) throw new Error('The selected template already has a drawing on its DRW sheet.');
  const extension = xml.search(/<extLst\b/);
  if (extension >= 0) return xml.slice(0, extension) + drawingTag + xml.slice(extension);
  return xml.replace('</worksheet>', `${drawingTag}</worksheet>`);
}

function addContentType(xml, drawingName) {
  if (!/Extension="png"/.test(xml)) xml = xml.replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>');
  const partName = `/xl/drawings/${drawingName}.xml`;
  if (!xml.includes(`PartName="${partName}"`)) xml = xml.replace('</Types>', `<Override PartName="${partName}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
  return xml;
}

export async function makeOqcWorkbook(templateBytes, bubbles, drawingPages) {
  const zip = await window.JSZip.loadAsync(templateBytes);
  const workbookXml = await zip.file('xl/workbook.xml')?.async('string');
  const workbookRels = await zip.file('xl/_rels/workbook.xml.rels')?.async('string');
  if (!workbookXml || !workbookRels) throw new Error('The selected file is not a readable Excel workbook.');
  const reportPath = worksheetPath(workbookXml, workbookRels, 'OQCIR');
  const drawingPath = worksheetPath(workbookXml, workbookRels, 'DRW');
  let reportXml = await zip.file(reportPath)?.async('string');
  let drawingSheetXml = await zip.file(drawingPath)?.async('string');
  let contentTypes = await zip.file('[Content_Types].xml')?.async('string');
  if (!reportXml || !drawingSheetXml || !contentTypes) throw new Error('The selected workbook does not match the OQC report template.');
  if (!/<mergeCell\b[^>]*ref="A1:Q45"/.test(drawingSheetXml)) throw new Error('The DRW sheet does not have the expected drawing area A1:Q45.');

  const normalBubbles = bubbles.filter(bubble => !bubble.msa);
  if (normalBubbles.length > CELL_ROWS.length) throw new Error('This OQC form has room for 50 red bubble checkpoints.');
  let missingLimits = 0;
  normalBubbles.forEach((bubble, index) => {
    const row = CELL_ROWS[index];
    reportXml = writeStringCell(reportXml, `A${row}`, String(index + 1));
    const limits = limitsFor(bubble);
    if (!limits) { missingLimits++; return; }
    reportXml = writeNumberCell(reportXml, `D${row}`, limits.min);
    reportXml = writeNumberCell(reportXml, `F${row}`, limits.max);
    reportXml = writeFormulaCache(reportXml, `E${row}`, limits.nominal);
  });

  const drawingRelsFilePath = `${drawingPath.slice(0, drawingPath.lastIndexOf('/'))}/_rels/${drawingPath.slice(drawingPath.lastIndexOf('/') + 1)}.rels`;
  const drawingRelsXml = await zip.file(drawingRelsFilePath)?.async('string') || `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS.packageRel}"/>`;
  const existingDrawing = [...drawingRelsXml.matchAll(/<Relationship\b[^>]*\/?\s*>/g)].map(match => attrs(match[0])).find(item => item.Type?.endsWith('/drawing'));
  if (existingDrawing) throw new Error('The selected template already has a drawing on its DRW sheet.');
  const usedIds = new Set([...drawingRelsXml.matchAll(/<Relationship\b[^>]*\/?\s*>/g)].map(match => attrs(match[0]).Id));
  let sheetRelIndex = 1;
  while (usedIds.has(`rId${sheetRelIndex}`)) sheetRelIndex++;
  const sheetRelId = `rId${sheetRelIndex}`;
  const drawingName = (() => { let index = 1; while (zip.file(`xl/drawings/drawing${index}.xml`)) index++; return `drawing${index}`; })();
  const imageName = (() => { let index = 1; while (zip.file(`xl/media/image${index}.png`)) index++; return `image${index}.png`; })();
  const drawingRelId = 'rId1';
  const picture = await drawingPNG(drawingPages, drawingAreaAspect(drawingSheetXml));
  drawingSheetXml = addDrawingRelationship(drawingSheetXml, sheetRelId);
  const drawingPackagePath = `xl/drawings/${drawingName}.xml`;
  const relativeDrawingPath = relativeTarget(drawingPath, drawingPackagePath);
  const correctedRels = drawingRelsXml.replace('</Relationships>', `<Relationship Id="${sheetRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="${xmlEscape(relativeDrawingPath)}"/></Relationships>`);
  const drawingRelsPath = `xl/drawings/_rels/${drawingName}.xml.rels`;
  zip.file(reportPath, reportXml);
  zip.file(drawingPath, drawingSheetXml);
  zip.file(drawingRelsFilePath, correctedRels);
  zip.file(drawingRelsPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS.packageRel}"><Relationship Id="${drawingRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${imageName}"/></Relationships>`);
  zip.file(`xl/drawings/${drawingName}.xml`, drawingXml());
  zip.file(`xl/media/${imageName}`, picture);
  zip.file('[Content_Types].xml', addContentType(contentTypes, drawingName));
  const output = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return { output, missingLimits, exportedCount: normalBubbles.length };
}
