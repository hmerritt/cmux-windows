const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
test('Git viewer lists staged, working, renamed and untracked paths and never runs external diff drivers',async()=>{
  const {WorkspaceGit}=require('../src/workspace-git.cjs');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cmux-git-'));
  const git=(...args)=>execFileSync('git',['-C',root,...args],{windowsHide:true,stdio:'pipe'}).toString();
  try {
    git('init');git('config','user.name','Test');git('config','user.email','test@example.invalid');
    await fs.writeFile(path.join(root,'notes.md'),'# Original\n');
    await fs.writeFile(path.join(root,'rename me.txt'),'before\n');
    git('add','.');git('commit','-m','Fixture');
    await fs.writeFile(path.join(root,'notes.md'),'# Staged\n');git('add','notes.md');
    await fs.writeFile(path.join(root,'notes.md'),'# Working\n');
    git('mv','rename me.txt','renamed.txt');
    await fs.writeFile(path.join(root,'[draft] file.txt'),'日本語\n');
    await fs.writeFile(path.join(root,'binary.dat'),Buffer.from([0,1,2]));
    git('config','diff.external','cmux-must-never-execute');
    const viewer=new WorkspaceGit();
    const status=await viewer.status(root);
    assert.equal(status.root,await fs.realpath(root));
    assert.equal(status.entries.find(entry=>entry.path==='notes.md').status,'MM');
    assert.equal(status.entries.find(entry=>entry.path==='renamed.txt').originalPath,'rename me.txt');
    const diff=await viewer.diff(root,'notes.md');
    assert.match(diff.staged,/\+# Staged/);assert.match(diff.unstaged,/\+# Working/);
    assert.match((await viewer.diff(root,'[draft] file.txt')).unstaged,/\+日本語/);
    assert.equal((await viewer.diff(root,'binary.dat')).binary,true);
    await assert.rejects(viewer.diff(root,'../private'),/unknown_file/);
    await assert.rejects(viewer.diff(root,':(glob)*'),/unknown_file/);
    assert.equal(git('status','--porcelain').includes('notes.md'),true,'Viewer must leave Git state unchanged');
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
