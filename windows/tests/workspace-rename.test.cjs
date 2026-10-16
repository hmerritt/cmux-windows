const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
process.env.CMUX_WINDOWS_DISABLE_PTY='1';
const {createCmuxWindowsRuntime}=require('../src/server.cjs');
test('blank workspace names reset from their directory, exclude themselves, avoid collisions and survive restart',()=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'cmux-rename-model-'));
  let runtime=createCmuxWindowsRuntime({dataDir});
  try {
    const cwd=path.join(dataDir,'project');fs.mkdirSync(cwd);
    const workspace=runtime.createWorkspaceFromOptions({cwd});
    assert.equal(workspace.title,'project');
    assert(runtime.updateWorkspace(workspace.id,{title:'   '}));
    assert.equal(workspace.title,'project','Reset excludes the workspace itself');
    const other=runtime.createWorkspaceFromOptions({cwd});
    assert.equal(other.title,'project 2');
    runtime.updateWorkspace(workspace.id,{title:'Custom'});
    runtime.updateWorkspace(other.id,{title:'project'});
    runtime.updateWorkspace(workspace.id,{title:''});
    assert.equal(workspace.title,'project 2','Reset follows creation collision naming');
    const panel=workspace.panels[0];runtime.updatePanel(panel.id,{title:'Custom terminal'});
    runtime.updatePanel(panel.id,{title:''});assert.equal(panel.titleLocked,false);
    runtime.persistSession();runtime.close();runtime=createCmuxWindowsRuntime({dataDir});
    const saved=runtime.serializedState().workspaces.find(item=>item.id===workspace.id);
    assert.equal(saved.title,'project 2');assert.equal(saved.panels[0].titleLocked,false);
  }finally{runtime.close();fs.rmSync(dataDir,{recursive:true,force:true});}
});
