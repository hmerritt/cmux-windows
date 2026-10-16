const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {WorkspaceSearch}=require('../src/workspace-search.cjs');
test('directory search uses literal smart-case queries, ignore rules, Unicode columns and bounded results',async()=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'cmux-search-model-')),root=path.join(folder,'root');
  try {
    await fs.mkdir(path.join(root,'nested'),{recursive:true});
    await fs.writeFile(path.join(root,'nested','[notes].txt'),'First\n😀 café Needle [x].*\nneedle lowercase\n');
    await fs.writeFile(path.join(root,'.hidden.txt'),'needle hidden\n');
    await fs.writeFile(path.join(root,'.ignore'),'ignored.txt\n');await fs.writeFile(path.join(root,'ignored.txt'),'needle ignored');
    await fs.mkdir(path.join(root,'node_modules'));await fs.writeFile(path.join(root,'node_modules','ignore'),'needle dependency');
    await fs.writeFile(path.join(folder,'outside.txt'),'needle outside');
    await fs.symlink(folder,path.join(root,'outside-link'),'junction');
    await fs.writeFile(path.join(root,'binary'),Buffer.from('needle\0binary'));
    const search=new WorkspaceSearch();
    const all=await search.search(root,'needle');
    assert.equal(all.results.length,3);assert.equal(all.truncated,false);
    assert(all.results.every(entry=>!entry.path.includes('outside') && !entry.path.includes('node_modules')));
    const exact=await search.search(root,'Needle');assert.equal(exact.results.length,1);
    assert.equal(exact.results[0].lineNumber,2);assert.equal(exact.results[0].columnNumber,9);assert.equal(exact.results[0].length,6);
    assert.equal((await search.search(root,'[x].*')).results.length,1);
    assert.equal((await search.search(root,'--hidden')).results.length,0);
    assert.equal((await search.search(root,'absent')).results.length,0);
    assert.equal((await search.search(root,'')).results.length,0);
    const limited=await new WorkspaceSearch({maxResults:1}).search(root,'needle');assert.equal(limited.results.length,1);assert(limited.truncated);
    await assert.rejects(search.search(root,'a\nb'),/invalid_query/);
    await assert.rejects(new WorkspaceSearch({executable:path.join(folder,'missing.exe')}).search(root,'needle'),/ripgrep_missing/);
    const controller=new AbortController();controller.abort();await assert.rejects(search.search(root,'needle',{signal:controller.signal}),/cancelled/);
    assert.equal(await fs.readFile(path.join(folder,'outside.txt'),'utf8'),'needle outside');
  }finally{await fs.rm(folder,{recursive:true,force:true});}
});
test('cancelling a live directory search terminates its process; a stalled search times out',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cmux-search-cancel-'));
  try {
    const fixture=path.join(root,'slow.cjs'),marker=path.join(root,'pid');
    await fs.writeFile(fixture,"require('node:fs').writeFileSync('pid',String(process.pid));setInterval(()=>{},1000);");
    const search=new WorkspaceSearch({executable:process.execPath,prefixArguments:[fixture],timeout:5000});
    const controller=new AbortController(),running=search.search(root,'needle',{signal:controller.signal});
    const rejection=assert.rejects(running,/cancelled/);
    for(let i=0;i<100;i++){try{await fs.access(marker);break;}catch{}await new Promise(resolve=>setTimeout(resolve,10));}
    const pid=Number(await fs.readFile(marker,'utf8'));assert(pid>0);
    controller.abort();await rejection;
    assert.throws(()=>process.kill(pid,0));
    await assert.rejects(new WorkspaceSearch({executable:process.execPath,prefixArguments:[fixture],timeout:100}).search(root,'needle'),/search_timeout/);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
