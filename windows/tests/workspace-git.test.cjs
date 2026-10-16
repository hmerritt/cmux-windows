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


test('diff sources isolate index and worktree and compare branches from the merge base',async()=>{
  const {WorkspaceGit}=require('../src/workspace-git.cjs');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cmux-git-sources-'));
  const git=(...args)=>execFileSync('git',['-C',root,...args],{windowsHide:true,stdio:'pipe'}).toString();
  try {
    git('init','-b','main');git('config','user.name','Test');git('config','user.email','test@example.invalid');
    for(const name of ['both.txt','index.txt','work.txt','gone.txt','old.txt'])await fs.writeFile(path.join(root,name),name==='old.txt'?'rename original\n':'original\n');
    git('add','.');git('commit','-m','Base');const base=git('rev-parse','HEAD').trim();
    git('checkout','-b','feature');
    await fs.writeFile(path.join(root,'committed.txt'),'feature commit\n');
    git('rm','gone.txt');git('mv','old.txt','renamed.txt');git('add','.');git('commit','-m','Feature');
    git('checkout','main');await fs.writeFile(path.join(root,'upstream.txt'),'upstream only\n');git('add','.');git('commit','-m','Upstream');git('checkout','feature');
    await fs.writeFile(path.join(root,'both.txt'),'index content\n');await fs.writeFile(path.join(root,'index.txt'),'index only\n');git('add','.');
    await fs.writeFile(path.join(root,'both.txt'),'worktree content\n');await fs.writeFile(path.join(root,'work.txt'),'worktree only\n');
    await fs.writeFile(path.join(root,'untracked.txt'),'new file\n');
    const viewer=new WorkspaceGit();
    const staged=await viewer.status(root,{source:'staged'}),unstaged=await viewer.status(root,{source:'unstaged'});
    assert.deepEqual(staged.entries.map(e=>e.path).sort(),['both.txt','index.txt'],'Staged must exclude working-only and untracked files');
    assert.deepEqual(unstaged.entries.map(e=>e.path).sort(),['both.txt','untracked.txt','work.txt']);
    const indexPatch=await viewer.diff(root,'both.txt',{source:'staged'}),workPatch=await viewer.diff(root,'both.txt',{source:'unstaged'});
    assert.match(indexPatch.staged,/\+index content/);assert.equal(indexPatch.unstaged,'');
    assert.equal(workPatch.staged,'');assert.match(workPatch.unstaged,/-index content\n\+worktree content/);
    await assert.rejects(viewer.diff(root,'index.txt',{source:'unstaged'}),/unknown_file/);
    const branch=await viewer.status(root,{source:'branch',base:'main'});
    assert.equal(branch.baseRef,'main');assert.equal(branch.mergeBase,base);
    assert(branch.entries.some(e=>e.path==='committed.txt') && branch.entries.some(e=>e.path==='gone.txt'));
    assert(!branch.entries.some(e=>['upstream.txt','untracked.txt'].includes(e.path)),'Branch diff uses the merge base and native tracked-file semantics');
    assert.equal(branch.entries.find(e=>e.path==='renamed.txt').originalPath,'old.txt');
    const branchPatch=await viewer.diff(root,'both.txt',{source:'branch',base:'main'});
    assert.match(branchPatch.branch,/-original\n\+worktree content/);assert.equal(branchPatch.staged,'');assert.equal(branchPatch.unstaged,'');
    assert.notEqual(branchPatch.revision,workPatch.revision);
    assert.match((await viewer.diff(root,'gone.txt',{source:'branch',base:'main'})).branch,/--- a\/gone.txt/);
    assert.equal((await viewer.diff(root,'both.txt',{source:'branch',base:'main',expandUnchanged:true})).revision,branchPatch.revision);
    assert.equal((await viewer.status(root,{source:'branch'})).baseRef,'main');
    git('config','branch.feature.cmuxBase',base);assert.equal((await viewer.status(root,{source:'branch'})).baseRef,base);
    git('config','--unset','branch.feature.cmuxBase');git('update-ref','refs/remotes/origin/feature','HEAD');
    git('config','remote.origin.url','.');git('config','remote.origin.fetch','+refs/heads/*:refs/remotes/origin/*');
    git('config','branch.feature.remote','origin');git('config','branch.feature.merge','refs/heads/feature');
    assert.equal((await viewer.status(root,{source:'branch'})).baseRef,'main','An own-branch tracking ref must not hide pushed commits');
    git('update-ref','refs/remotes/origin/integration',base);git('config','branch.feature.merge','refs/heads/integration');
    assert.equal((await viewer.status(root,{source:'branch'})).baseRef,'origin/integration');
    const unrelated=git('commit-tree','HEAD^{tree}','-m','Unrelated').trim();
    await assert.rejects(viewer.status(root,{source:'branch',base:unrelated}),/unrelated_base/);
    await assert.rejects(viewer.status(root,{source:'branch',base:'--output=escape'}),/invalid_base/);
    await assert.rejects(viewer.status(root,{source:'branch',base:'missing'}),/invalid_base/);
    await assert.rejects(viewer.status(root,{source:'unsupported'}),/invalid_source/);
    assert.equal(git('diff','--cached','--name-only').trim().split(/\r?\n/).length,2,'Viewing must leave the index unchanged');
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
