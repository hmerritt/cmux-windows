const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
process.env.CMUX_WINDOWS_DISABLE_PTY='1';
const {createCmuxWindowsRuntime}=require('../src/server.cjs');
test('Markdown and diff panes retain their type, file path and workspace through full runtime recreation',()=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'cmux-document-model-'));
  const runtime=createCmuxWindowsRuntime({dataDir});
  try {
    const workspace=runtime.activeWorkspace();
    const markdown=runtime.createPanel(workspace.id,'markdown',{cwd:dataDir,filePath:'notes.md',title:'notes.md'});
    const diff=runtime.createPanel(workspace.id,'diff',{cwd:dataDir,title:'Changes'});
    assert.equal(runtime.ensureTerminalProcess(markdown),null);assert.equal(runtime.ensureTerminalProcess(diff),null);
    assert(runtime.updatePanel(markdown.id,{filePath:'renamed/notes.md'}));
    runtime.persistSession();
    const restored=createCmuxWindowsRuntime({dataDir});
    try {
      const saved=restored.serializedState().workspaces.find(item=>item.id===workspace.id);
      assert.equal(saved.panels.find(panel=>panel.id===markdown.id).type,'markdown');
      assert.equal(saved.panels.find(panel=>panel.id===markdown.id).filePath,'renamed/notes.md');
      assert.equal(saved.panels.find(panel=>panel.id===diff.id).type,'diff');
      assert.equal(saved.activePanelId,diff.id);assert.equal(restored.terminals.size,0);
    }finally{restored.close();}
  }finally{runtime.close();fs.rmSync(dataDir,{recursive:true,force:true});}
});
