const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {WorkspaceFiles}=require('../src/workspace-files.cjs');
test('workspace file edits preserve UTF-8 BOM and line endings, reject stale revisions and unsafe writes',async()=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'cmux-file-edit-')),root=path.join(folder,'workspace');
  try {
    await fs.mkdir(root);await fs.writeFile(path.join(root,'notes.md'),'\ufeff# 日本語\r\n');
    await fs.writeFile(path.join(folder,'outside.txt'),'private');
    await fs.symlink(folder,path.join(root,'outside-link'),'junction');
    const files=new WorkspaceFiles(),initial=await files.read(root,'notes.md');
    const saved=await files.write(root,'notes.md','# café\r\n',initial.revision);
    assert.equal(await fs.readFile(path.join(root,'notes.md'),'utf8'),'\ufeff# café\r\n');
    assert.notEqual(saved.revision,initial.revision);
    await fs.writeFile(path.join(root,'notes.md'),'external change');
    await assert.rejects(files.write(root,'notes.md','stale edit',saved.revision),/file_changed/);
    assert.equal(await fs.readFile(path.join(root,'notes.md'),'utf8'),'external change');
    await assert.rejects(files.write(root,'outside-link/outside.txt','overwrite',initial.revision),/outside_root/);
    await assert.rejects(files.write(root,'../outside.txt','overwrite',initial.revision),/outside_root/);
    await assert.rejects(files.write(root,'notes.md','no revision'),/invalid_revision/);
    await assert.rejects(files.write(root,'notes.md','\0',saved.revision),/binary_file/);
    await assert.rejects(files.write(root,'notes.md','x'.repeat(1024*1024+1),saved.revision),/file_too_large/);
    assert.equal(await fs.readFile(path.join(folder,'outside.txt'),'utf8'),'private');
    assert.deepEqual(await fs.readdir(root),['notes.md','outside-link']);
  } finally {await fs.rm(folder,{recursive:true,force:true});}
});
test('workspace files browse directories and preview bounded UTF-8 without escaping the root',async()=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'cmux-files-')),root=path.join(folder,'workspace');
  try {
    await fs.mkdir(path.join(root,'nested'),{recursive:true});
    await fs.writeFile(path.join(root,'notes.md'),'# 日本語 café\n<script>untrusted()</script>');
    await fs.writeFile(path.join(folder,'outside.txt'),'private');
    await fs.writeFile(path.join(root,'binary'),Buffer.from([0,1,2]));
    await fs.writeFile(path.join(root,'large.txt'),Buffer.alloc(1024*1024+1,65));
    await fs.copyFile(path.resolve(__dirname,'../src/assets/cmux.png'),path.join(root,'logo.png'));
    await fs.symlink(folder,path.join(root,'outside-link'),'junction');
    const files=new WorkspaceFiles();
    const list=await files.list(root);
    assert(list.entries.some(entry=>entry.name==='nested' && entry.directory));
    assert.equal((await files.read(root,'notes.md')).text,'# 日本語 café\n<script>untrusted()</script>');
    await assert.rejects(files.read(root,'../outside.txt'),/outside_root/);
    await assert.rejects(files.read(root,path.join(folder,'outside.txt')),/outside_root/);
    await assert.rejects(files.read(root,'outside-link/outside.txt'),/outside_root/);
    await assert.rejects(files.read(root,'binary'),/binary_file/);
    await assert.rejects(files.read(root,'large.txt'),/file_too_large/);
    assert.match((await files.readImage(root,'logo.png')).dataUrl,/^data:image\/png;base64,/);
    await assert.rejects(files.readImage(root,'binary'),/binary_file/);
    await assert.rejects(files.readImage(root,'outside-link/outside.txt'),/outside_root/);
  } finally {await fs.rm(folder,{recursive:true,force:true});}
});
test('new Windows controls render translated copy for every supported locale',async()=>{
  const {parityText,messages}=await import('../renderer/parity-messages.mjs');
  const previous=globalThis.location;
  try {
    for(const locale of ['en','de','fr','ar','es','zh-Hant','zh-Hans','ko','ja']) {
      globalThis.location=new URL(`http://localhost/?locale=${locale}`);
      for(const key of Object.keys(messages.en)) {
        assert.equal(parityText(key),messages[locale][key],`${locale}: ${key}`);
        assert(parityText(key).length>0);
        if(locale!=='en')assert.notEqual(parityText(key),messages.en[key],`${locale}: ${key} must not fall back to English`);
      }
    }
  } finally {if(previous===undefined)delete globalThis.location;else globalThis.location=previous;}
});
