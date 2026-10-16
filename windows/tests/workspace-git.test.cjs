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
    await fs.writeFile(path.join(root,'.gitattributes'),'notes.md diff=unsafe\n');
    git('config','diff.unsafe.textconv','cmux-must-never-execute');
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

test('expanded diff context includes unchanged lines without changing file review identity',async()=>{
  const {WorkspaceGit}=require('../src/workspace-git.cjs');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cmux-git-context-'));
  const git=(...args)=>execFileSync('git',['-C',root,...args],{windowsHide:true,stdio:'pipe'});
  try {
    git('init');git('config','user.name','Test');git('config','user.email','test@example.invalid');
    const original=Array.from({length:60},(_,i)=>`unchanged ${i}`);
    await fs.writeFile(path.join(root,'context.txt'),original.join('\n'));git('add','.');git('commit','-m','Fixture');
    const changed=[...original];changed[4]='first change';changed[50]='second change';
    await fs.writeFile(path.join(root,'context.txt'),changed.join('\n'));
    const viewer=new WorkspaceGit(),collapsed=await viewer.diff(root,'context.txt');
    assert(!collapsed.unstaged.includes('unchanged 25'));
    const expanded=await viewer.diff(root,'context.txt',{expandUnchanged:true});
    assert(expanded.unstaged.includes('unchanged 25'),'Expanded context must include the unchanged middle of the file');
    assert.equal(expanded.revision,collapsed.revision,'Display preferences cannot invalidate a viewed file');
    assert(expanded.unstaged.includes('unchanged 0') && expanded.unstaged.includes('unchanged 59'));
    assert.equal(git('diff','--cached').length,0,'Context expansion must not alter the index');
    const run=viewer.git.bind(viewer);let modified=false;
    viewer.git=async(directory,args)=>{
      if(args.includes('--unified=2147483647') && !modified){modified=true;await fs.appendFile(path.join(root,'context.txt'),'concurrent change\n');}
      return run(directory,args);
    };
    await assert.rejects(viewer.diff(root,'context.txt',{expandUnchanged:true}),/file_changed/,'Never bind a changed expanded patch to an older viewed revision');

  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('oversized full context falls back visibly while keeping bounded compact diffs and review identity',async()=>{
  const {WorkspaceGit}=require('../src/workspace-git.cjs');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cmux-git-context-limit-'));
  const git=(...args)=>execFileSync('git',['-C',root,...args],{windowsHide:true,stdio:'pipe'});
  try {
    git('init');git('config','user.name','Test');git('config','user.email','test@example.invalid');
    const text=('wide context '.repeat(24)+'\n').repeat(16000);
    await fs.writeFile(path.join(root,'large.txt'),text);git('add','.');git('commit','-m','Fixture');
    await fs.writeFile(path.join(root,'large.txt'),'changed first line\n'+text.slice(text.indexOf('\n')+1));
    const viewer=new WorkspaceGit(),compact=await viewer.diff(root,'large.txt'),expanded=await viewer.diff(root,'large.txt',{expandUnchanged:true});
    assert.equal(expanded.contextLimited,true);
    assert.equal(expanded.revision,compact.revision);assert.equal(expanded.unstaged,compact.unstaged);
    assert(expanded.unstaged.includes('+changed first line'));assert(expanded.unstaged.length<10000);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
