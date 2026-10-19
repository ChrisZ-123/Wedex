import test from 'node:test';
import assert from 'node:assert/strict';
import {takeQueuedBatch} from '../src/queue.js';
const message=(id,text='',status='queued')=>({id,text,status});
test('100/101 queued boundary leaves the last record untouched',()=>{
  const records=Array.from({length:101},(_,i)=>message(i,'消息'+i)),before=structuredClone(records),batch=takeQueuedBatch(records);
  assert.equal(batch.length,100);assert.equal(batch[99],records[99]);assert.deepEqual(records,before);assert.equal(records[100].status,'queued');
});
test('14 valid 4000-character messages split into ordered 12 and 2 without truncation',()=>{
  const records=Array.from({length:14},(_,i)=>message(i,'字'.repeat(4000))),batch=takeQueuedBatch(records);
  assert.equal(batch.length,12);assert.equal(batch.map(m=>m.text).join('\n').length,48011);
  for(const m of batch)m.status='completed';const remainder=takeQueuedBatch(records);assert.deepEqual(remainder.map(m=>m.id),[12,13]);assert.equal(remainder[0].text.length,4000);
});
test('newline counts toward exact character boundary; raw order, text and states unchanged',()=>{
  const records=[message('past','already','completed'),message(1,' a '),message('pause','skip','paused'),message(2,'\nB'),message(3,'C')],before=structuredClone(records);
  assert.deepEqual(takeQueuedBatch(records,{maxChars:6}).map(m=>m.id),[1,2]);assert.deepEqual(takeQueuedBatch(records,{maxChars:5}).map(m=>m.id),[1]);assert.deepEqual(records,before);
  assert.equal(takeQueuedBatch(records,{maxChars:6})[0],records[1]);
});
test('oversized first queued message is isolated; after explicit failure later messages still batch',()=>{
  const records=[message(1,'字'.repeat(50001)),message(2,'下一条'),message(3,'再下一条')],batch=takeQueuedBatch(records);
  assert.deepEqual(batch.map(m=>m.id),[1]);assert.equal(records[1].status,'queued');assert.equal(batch[0].text.length,50001);
  records[0].status='failed';assert.deepEqual(takeQueuedBatch(records).map(m=>m.id),[2,3]);assert.equal(records[0].status,'failed');
});
test('first exactly 50000-character message is accepted alone; zero candidates returns empty',()=>{
  assert.deepEqual(takeQueuedBatch([message(1,'字'.repeat(50000)),message(2,'')]).map(m=>m.id),[1]);assert.deepEqual(takeQueuedBatch([message(1,'','completed')]),[]);
});
test('invalid explicit limits and non-text queued records fail clearly',()=>{
  assert.throws(()=>takeQueuedBatch([],{maxMessages:0}),/正整数/);assert.throws(()=>takeQueuedBatch([],{maxChars:-1}),/正整数/);assert.throws(()=>takeQueuedBatch([message(1,null)]),/字符串/);
});
