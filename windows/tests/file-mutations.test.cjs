const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {WorkspaceFiles}=require('../src/workspace-files.cjs');
test('file creation and rename preserve content, reject collisions and stay inside the workspace',async()=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'cmux-file-mutations-model-')),root=path.join(folder,'root');
  try {
    await fs.mkdir(root);const files=new WorkspaceFiles();
    assert.equal((await files.create(root,'','notes','folder')).path,'notes');
    const created=await files.create(root,'notes','café [draft].txt');
    const original=await files.read(root,created.path);await files.write(root,created.path,'retained\r\n',original.revision);
    const renamed=await files.rename(root,created.path,'renamed.txt');assert.equal((await files.read(root,renamed.path)).text,'retained\r\n');
    await files.rename(root,renamed.path,'Renamed.txt');assert((await fs.readdir(path.join(root,'notes'))).includes('Renamed.txt'));
    await files.create(root,'notes','existing.txt');
    await assert.rejects(files.rename(root,'notes/Renamed.txt','existing.txt'),/entry_exists/);
    assert.equal((await files.read(root,'notes/existing.txt')).text,'');assert.equal((await files.read(root,'notes/Renamed.txt')).text,'retained\r\n');
    const attempts=await Promise.allSettled([files.create(root,'','exclusive.txt'),files.create(root,'','exclusive.txt')]);assert.equal(attempts.filter(result=>result.status==='fulfilled').length,1);
    const literal="quote'$() & [x].txt",moved="after'$() & [x].txt";
    await files.create(root,'',literal);await files.rename(root,literal,moved);assert.equal((await files.read(root,moved)).text,'');
    await files.create(root,'','other','folder');await assert.rejects(files.rename(root,'notes','other'),/entry_exists/);
    await files.rename(root,'notes','renamed folder');assert.equal((await files.read(root,'renamed folder/Renamed.txt')).text,'retained\r\n');
    for(const name of ['../escape','a/b','a\\b','a:b','CON','com1.txt','NUL','dot.','space ','','..','LPT¹.txt'])await assert.rejects(files.create(root,'',name),/invalid_name/);
    await fs.writeFile(path.join(folder,'outside.txt'),'outside');await fs.symlink(folder,path.join(root,'outside-link'),'junction');
    await assert.rejects(files.create(root,'outside-link','escape.txt'),/outside_root/);
    await assert.rejects(files.rename(root,'outside-link/outside.txt','moved.txt'),/outside_root/);
    await assert.rejects(files.rename(root,'','moved-root'),/outside_root/);
    await files.rename(root,'outside-link','renamed-link');assert.equal(await fs.readFile(path.join(folder,'outside.txt'),'utf8'),'outside');
    assert((await fs.lstat(path.join(root,'renamed-link'))).isSymbolicLink());
    assert.equal(await fs.readFile(path.join(root,'exclusive.txt'),'utf8'),'');
  }finally{await fs.rm(folder,{recursive:true,force:true});}
});

test('duplicate and trash preserve siblings, copy folders and act on links rather than their targets',async()=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'cmux-file-removal-model-')),root=path.join(folder,'root'),bin=path.join(folder,'bin');
  try {
    await fs.mkdir(root);await fs.mkdir(bin);
    const trashed=[];
    const files=new WorkspaceFiles({trash:async target=>{trashed.push(target);await fs.rename(target,path.join(bin,path.basename(target)));}});
    await fs.writeFile(path.join(root,'notes.md'),'original');
    const first=await files.duplicate(root,'notes.md');assert.equal(first.path,'notes copy.md');
    const second=await files.duplicate(root,'notes.md');assert.equal(second.path,'notes copy 2.md');
    assert.equal(await fs.readFile(path.join(root,first.path),'utf8'),'original');
    await fs.mkdir(path.join(root,'folder'));await fs.writeFile(path.join(root,'folder','child.txt'),'child');
    assert.equal((await files.duplicate(root,'folder')).path,'folder copy');
    assert.equal(await fs.readFile(path.join(root,'folder copy','child.txt'),'utf8'),'child');
    await fs.writeFile(path.join(root,'.env'),'hidden');assert.equal((await files.duplicate(root,'.env')).path,'.env copy');
    assert.equal((await files.duplicate(root,'notes.md','%@ copie')).path,'notes copie.md');
    await fs.writeFile(path.join(folder,'outside.txt'),'outside');await fs.symlink(folder,path.join(root,'outside-link'),'junction');
    await assert.rejects(files.trash(root,''),/outside_root/);
    await assert.rejects(files.trash(root,'../outside.txt'),/outside_root/);
    await assert.rejects(files.trash(root,'outside-link/outside.txt'),/outside_root/);
    await assert.rejects(files.duplicate(root,'outside-link/outside.txt'),/outside_root/);
    await files.duplicate(root,'outside-link');assert((await fs.lstat(path.join(root,'outside-link copy'))).isSymbolicLink());
    await files.trash(root,'outside-link');assert((await fs.lstat(path.join(bin,'outside-link'))).isSymbolicLink());
    assert.equal(await fs.readFile(path.join(folder,'outside.txt'),'utf8'),'outside');
    await files.trash(root,'folder');assert.equal(await fs.readFile(path.join(bin,'folder','child.txt'),'utf8'),'child');
    await files.trash(root,'notes.md');assert.equal(await fs.readFile(path.join(bin,'notes.md'),'utf8'),'original');
    assert.equal(await fs.readFile(path.join(root,'notes copy.md'),'utf8'),'original');
    assert.equal(trashed.length,3);
    const failing=new WorkspaceFiles({trash:async()=>{throw Error('recycle_failed');}});
    await assert.rejects(failing.trash(root,'notes copy.md'),/recycle_failed/);
    assert.equal(await fs.readFile(path.join(root,'notes copy.md'),'utf8'),'original');
    const copies=await Promise.all([files.duplicate(root,'notes copy.md'),files.duplicate(root,'notes copy.md')]);
    assert.notEqual(copies[0].path,copies[1].path);
    for(const copy of copies)assert.equal(await fs.readFile(path.join(root,copy.path),'utf8'),'original');
    const unavailable=new WorkspaceFiles();await assert.rejects(unavailable.trash(root,'notes copy.md'),/trash_unavailable/);
    assert.equal(await fs.readFile(path.join(root,'notes copy.md'),'utf8'),'original');
  }finally{await fs.rm(folder,{recursive:true,force:true});}
});
