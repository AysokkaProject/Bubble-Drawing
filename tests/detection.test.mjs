import test from 'node:test';
import assert from 'node:assert/strict';
import {extractRequirement,moveBubble,groupTextItems,correctionKey} from '../web/detection.js';
import {PDFDocument,degrees} from '../web/vendor/pdf-lib.mjs';
import {annotatePDF} from '../web/core.js';
test('captures GD&T feature, tolerance, datums and thread requirements',()=>{
 const value=extractRequirement('⌖ | ⌀0.10 | A | B | C');
 assert.equal(value.feature,'Position');assert.equal(value.tolerance,'⌀0.10');assert.equal(value.datums,'A | B | C');
 assert.equal(extractRequirement('M8 x 1.25').feature,'Thread');
 assert.equal(extractRequirement('12.00 +/-0.05').tolerance,'±0.05');
 assert.equal(extractRequirement('12.00 mm').nominal,'12.00');
 assert.equal(extractRequirement('DRAWING REV A'),null);
});
test('confirmed correction applies only to matching text',()=>{
 const corrections={[correctionKey('O.1O')]:{dimension:'0.10',nominal:'0.10',tolerance:'',feature:'Dimension'}};
 assert.equal(extractRequirement('O.1O',corrections).nominal,'0.10');
 assert.equal(extractRequirement('O.1O',corrections).learned,true);
 assert.equal(extractRequirement('0.20',corrections).learned,undefined);
});
test('direct renumbering shifts other bubbles without losing identity',()=>{
 const bubbles=[{id:'a'},{id:'b'},{id:'c'}];
 assert.deepEqual(moveBubble(bubbles,'c',1).map(b=>b.id),['c','a','b']);
 assert.deepEqual(bubbles.map(b=>b.id),['a','b','c']);
 assert.throws(()=>moveBubble(bubbles,'a',0));assert.throws(()=>moveBubble(bubbles,'a',1.5));
});
test('page rotation is included while annotation position stays in PDF coordinates',async()=>{
 const doc=await PDFDocument.create();doc.addPage([400,600]).setRotation(degrees(90));doc.addPage([600,400]);
 const bytes=await annotatePDF(await doc.save(),[{page:1,x:100,y:200}],{1:90});
 const result=await PDFDocument.load(bytes);assert.equal(result.getPage(0).getRotation().angle,180);assert.equal(result.getPage(1).getRotation().angle,0);
});
test('adjacent text fragments retain explicit tolerances',()=>{
 const items=[{str:'12.00',width:30,height:10,transform:[1,0,0,1,10,100]},{str:'±0.05',width:30,height:10,transform:[1,0,0,1,43,100]}];
 const lines=groupTextItems(items,{scale:1,convertToViewportPoint:(x,y)=>[x,y]});
 assert.equal(extractRequirement(lines[0].text).tolerance,'±0.05');
});
