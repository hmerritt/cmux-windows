const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {DiffPreferences}=require('../src/diff-preferences.cjs');

test('diff layouts retain line identity, unequal changes, zero ranges and missing newline notes',async()=>{
  const {parseDiffLines,splitDiffRows}=await import('../renderer/diff-lines.mjs');
  const blocks=parseDiffLines('diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -7,4 +9,3 @@ fn\n context\n-old one\n-old two\n+new\n\\ No newline at end of file\n after\n@@ -0,0 +1,2 @@\n+first\n+second\n');
  assert.equal(blocks.length,3);
  const rows=blocks[1].rows;
  assert.deepEqual(rows.map(row=>[row.oldLine,row.newLine]),[[7,9],[8,null],[9,null],[null,10],[10,11]]);
  assert.equal(rows[3].note,'\\ No newline at end of file');
  const split=splitDiffRows(rows);
  assert.deepEqual(split.map(row=>[row.left?.oldLine??null,row.right?.newLine??null]),[[7,9],[8,10],[9,null],[10,11]]);
  assert.equal(split[1].right.text,'+new');assert.equal(split[1].left.text,'-old one');
  assert.equal(split[1].right.note,'\\ No newline at end of file');
  assert.deepEqual(blocks[2].rows.map(row=>[row.oldLine,row.newLine]),[[null,1],[null,2]]);
  assert.deepEqual(parseDiffLines(''),[]);
  assert.deepEqual(splitDiffRows(parseDiffLines('@@ -1,2 +0,0 @@\n-a\n-b\n')[0].rows).map(row=>row.right),[null,null]);
});

test('diff preferences survive process recreation, validate native keys and serialize merged updates',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cmux-diff-preferences-'));
  try {
    const file=path.join(root,'diff-viewer','preferences.json'),store=new DiffPreferences(file);
    assert.deepEqual(await store.get(),{});
    await Promise.all([store.merge({layout:'split',wordWrap:true}),store.merge({lineNumbers:false,showBackgrounds:false})]);
    assert.deepEqual(await new DiffPreferences(file).get(),{layout:'split',wordWrap:true,lineNumbers:false,showBackgrounds:false});
    await store.merge({layout:'bad',lineNumbers:'true',wordWrap:0,unknown:true,diffIndicators:'classic',wordDiffs:false,expandUnchanged:true});
    assert.deepEqual(await store.get(),{layout:'split',wordWrap:true,lineNumbers:false,showBackgrounds:false,diffIndicators:'classic',wordDiffs:false,expandUnchanged:true});
    assert.deepEqual(await fs.readdir(path.dirname(file)),['preferences.json']);
    await fs.writeFile(file,'invalid');assert.deepEqual(await store.get(),{});
    await store.merge({layout:'unified'});assert.deepEqual(await store.get(),{layout:'unified'});
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('word highlights retain exact text, isolate replacements and handle Unicode and bounded large changes',async()=>{
  const {diffWords,wordDiffRows}=await import('../renderer/diff-words.mjs');
  const {parseDiffLines}=await import('../renderer/diff-lines.mjs');
  const diff=diffWords('const color = "red"; keep = 1','const color = "blue"; keep = 2');
  assert.equal(diff.before.filter(part=>part.changed).map(part=>part.text).join(''),'red1');
  assert.equal(diff.after.filter(part=>part.changed).map(part=>part.text).join(''),'blue2');
  for(const [before,after] of [['café 日本語 👩🏽‍💻 مرحبا','café 한국어 👩🏽‍💻 أهلا'],['','insert'],['deleted',''],['same','same'],['a '.repeat(300)+'old end','b '.repeat(300)+'new end']]) {
    const result=diffWords(before,after,{maxCells:64});
    assert.equal(result.before.map(part=>part.text).join(''),before);
    assert.equal(result.after.map(part=>part.text).join(''),after);
    assert(result.work<=64);
  }
  const rows=parseDiffLines('@@ -1 +1 @@\n-Line 3\n+Changed 3\n')[0].rows;
  const highlighted=wordDiffRows(rows);
  assert.equal(highlighted.get(rows[0]).filter(part=>part.changed).map(part=>part.text).join(''),'Line');
  assert.equal(highlighted.get(rows[1]).filter(part=>part.changed).map(part=>part.text).join(''),'Changed');
});
