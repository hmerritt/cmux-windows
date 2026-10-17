const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
process.env.CMUX_WINDOWS_DISABLE_PTY='1';
const {createCmuxWindowsRuntime}=require('../src/server.cjs');
test('group transfer is atomic, retains live terminal objects and persists workspace ownership',()=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'cmux-transfer-'));
  const runtime=createCmuxWindowsRuntime({dataDir});
  try {
    const source=runtime.activeWorkspace(),a=source.panels[0];
    const b=runtime.newPanel('terminal',source.id);source.panels.push(b);
    const destination=runtime.newWorkspace('Destination');runtime.state.workspaces.push(destination);
    const terminal={close(){throw Error('Transfer must not close a terminal');}};
    runtime.terminals.set(a.id,terminal);
    const before=JSON.stringify(runtime.serializedState());
    assert.equal(runtime.movePanels([a.id,'missing'],destination.id,a.id),false);
    assert.equal(JSON.stringify(runtime.serializedState()),before,'Invalid batches must not partially move');
    assert.equal(runtime.movePanels([a.id,b.id],'missing',a.id),false);
    assert.equal(runtime.movePanels([a.id,a.id],destination.id,a.id),false);
    assert.equal(runtime.movePanels([a.id,b.id],destination.id,b.id),true);
    assert.equal(source.panels.length,0);assert.equal(source.activePanelId,null);
    assert.deepEqual(destination.panels.slice(-2).map(p=>p.id),[a.id,b.id]);
    assert.equal(destination.activePanelId,b.id);assert.equal(runtime.terminals.get(a.id),terminal);
    const restored=createCmuxWindowsRuntime({dataDir});
    assert.equal(restored.findPanel(a.id).workspace.id,destination.id);
    assert.equal(restored.activeWorkspace().activePanelId,b.id);restored.close();
  } finally {runtime.terminals.clear();runtime.close();fs.rmSync(dataDir,{recursive:true,force:true});}
});
