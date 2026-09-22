import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, degrees } from '../web/vendor/pdf-lib.mjs';
import { parseDimension, makeCSV, annotatePDF, makeSample } from '../web/core.js';

test('dimension suggestions retain explicit tolerances and never invent defaults', () => {
  assert.equal(parseDimension('12.00').tolerance, '');
  assert.deepEqual(parseDimension('4X Ø8.00 ±0.05'), { dimension:'4X Ø8.00 ±0.05', nominal:'Ø8.00', tolerance:'±0.05', notes:'Quantity: 4' });
  assert.equal(parseDimension('90°').tolerance, '');
  assert.equal(parseDimension('DRAWING 12.00 REV A'), null);
  assert.equal(parseDimension('2026'), null);
});

test('CSV preserves quotes, Unicode, multiline notes and guards formulas', () => {
  const csv=makeCSV([{page:2,dimension:'Ø8.00',nominal:'8.00',tolerance:'',notes:'line "one"\nline two',reviewed:false},{page:1,dimension:'=1+1',nominal:'-2.00',tolerance:'±0.05',notes:'',reviewed:true}]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"line ""one""\nline two"'));
  assert.ok(csv.includes('"\'=1+1"'));
  assert.ok(csv.includes('"±0.05"'));
});

test('PDF export keeps unannotated pages, crop boxes, rotation and page dimensions', async () => {
  const doc=await PDFDocument.create();
  doc.addPage([420,300]);
  const page=doc.addPage([900,700]); page.setRotation(degrees(90));page.setCropBox(20,30,850,640);
  doc.addPage([300,500]);
  const original=await doc.save();
  const result=await PDFDocument.load(await annotatePDF(original,[{page:2,x:140,y:220}]));
  assert.equal(result.getPageCount(),3);
  assert.deepEqual(result.getPage(0).getSize(),{width:420,height:300});
  assert.equal(result.getPage(1).getRotation().angle,90);
  assert.deepEqual(result.getPage(1).getCropBox(),{x:20,y:30,width:850,height:640});
  assert.deepEqual(result.getPage(2).getSize(),{width:300,height:500});
  assert.equal((await PDFDocument.load(original)).getPageCount(),3);
  await assert.rejects(()=>annotatePDF(original,[{page:4,x:0,y:0}]),/Invalid bubble/);
});

test('sample is a usable multi-page PDF and supports export without bubbles', async () => {
  const bytes=await makeSample();
  assert.equal((await PDFDocument.load(bytes)).getPageCount(),2);
  assert.equal((await PDFDocument.load(await annotatePDF(bytes,[]))).getPageCount(),2);
});
