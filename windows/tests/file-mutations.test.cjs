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
