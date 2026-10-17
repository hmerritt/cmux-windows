const {app}=require('electron');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const profile=process.env.CMUX_RESTORE_TEST_PROFILE || fs.mkdtempSync(path.join(os.tmpdir(),'cmux-session-restore-'));
process.env.APPDATA=profile;process.env.CMUX_WINDOWS_CONFIG=path.join(profile,'cmux.json');process.env.CMUX_WINDOWS_PIPE=`\\\\.\\pipe\\cmux-session-restore-${process.pid}`;
app.setPath('userData',path.join(profile,'electron'));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));let failed=false;
const deadline=setTimeout(()=>{console.error('Session restore test timed out');app.exit(1);},90000);
app.once('browser-window-created',(_event,win)=>win.webContents.once('did-finish-load',async()=>{
  const evaluate=code=>win.webContents.executeJavaScript(code);
  async function waitFor(code){for(let n=0;n<120;n++){if(await evaluate(code))return;await delay(75);}throw Error('Timed out: '+code);}
  async function api(route,body,method='POST'){
    return evaluate(`(async()=>{const token=new URL(location.href).searchParams.get('token');const r=await fetch(${JSON.stringify(route)}+'?token='+encodeURIComponent(token),{method:${JSON.stringify(method)},headers:{'Content-Type':'application/json'},${body===undefined?'':`body:JSON.stringify(${JSON.stringify(body)}),`}});if(!r.ok)throw Error('API '+r.status);return r.json();})()`);
  }
  const expectedFile=path.join(profile,'expected-session.json');
  try{
    win.setSize(1280,800);win.focus();win.webContents.focus();
    await waitFor("!!document.querySelector('.xterm-helper-textarea')");
    if(process.argv.includes('--restore')){
      const expected=JSON.parse(fs.readFileSync(expectedFile,'utf8'));
      const state=await api('/api/state',undefined,'GET');
      assert.equal(state.activeWorkspaceId,expected.workspaceId,'Active workspace restores');
      assert.equal(state.workspaces.find(w=>w.id===expected.workspaceId).activePanelId,expected.focusId,'Focused panel/tab restores');
      await waitFor(`document.activeElement.closest('.pane')?.dataset.panelId===${JSON.stringify(expected.focusId)}`);
      for(const [id,cwd] of Object.entries(expected.directories)){
        assert.equal(state.workspaces.flatMap(w=>w.panels).find(p=>p.id===id).cwd,cwd,'Saved directory restores for '+id);
        await api('/api/input',{panelId:id,text:`[IO.File]::WriteAllText('${path.join(profile,id+'.txt').replaceAll("'","''")}', $PWD.Path)\r`.replace('\\r','\r')});
      }
      for(const [id,cwd] of Object.entries(expected.directories)){
        const file=path.join(profile,id+'.txt');for(let n=0;n<100 && !fs.existsSync(file);n++)await delay(75);
        assert.equal(fs.readFileSync(file,'utf8'),cwd,'Restarted shell actually starts in its saved directory');
      }
      console.log('PASS full app restart: per-tab shell directories, active workspace, focused split and selected tab');return;
    }
    const state=await api('/api/state',undefined,'GET'),workspaceId=state.activeWorkspaceId;
    const first=state.workspaces[0].panels[0].id;
    win.webContents.send('cmux-command','terminal.new');
    await waitFor("document.querySelectorAll('.pane-tab').length===2");
    const second=await evaluate("document.querySelector('.pane-tab.is-selected').dataset.tabPanelId");
    const third=(await api('/api/panels',{workspaceId,type:'terminal',direction:'right'})).id;
    const directories={};
    for(const [n,id] of [first,second,third].entries()){
      const cwd=path.join(profile,'directory '+n+' Ω');fs.mkdirSync(cwd);directories[id]=cwd;
      await api('/api/input',{panelId:id,text:`Set-Location -LiteralPath '${cwd.replaceAll("'","''")}'; [Console]::WriteLine('DIRECTORY_READY_${n}')\r`.replace('\\r','\r')});
    }
    await delay(2000);
    const updated=await api('/api/state',undefined,'GET');
    for(const [id,cwd] of Object.entries(directories))assert.equal(updated.workspaces.flatMap(w=>w.panels).find(p=>p.id===id).cwd,cwd,'cd updates saved tab directory');
    const other=await api('/api/workspaces',{title:'Other workspace'});
    await api('/api/panels/'+first+'/focus',{});
    await waitFor(`!!document.querySelector('[data-tab-panel-id="${second}"]')`);
    const point=await evaluate(`(()=>{const r=document.querySelector('[data-tab-panel-id="${second}"]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    win.webContents.sendInputEvent({type:'mouseMove',...point});
    for(const type of ['mouseDown','mouseUp'])win.webContents.sendInputEvent({type,...point,button:'left',clickCount:1});
    await waitFor(`document.querySelector('.pane.is-active')?.dataset.panelId===${JSON.stringify(second)}`);
    fs.writeFileSync(expectedFile,JSON.stringify({workspaceId,focusId:second,directories}));
    console.log('PASS session setup: independent cd changes for hidden tabs and split panes; close immediately after pointer focus');
  }catch(error){failed=true;console.error(error.stack||error);}
  finally{clearTimeout(deadline);win.close();}
}));
app.on('will-quit',event=>{if(failed){event.preventDefault();app.exit(1);}});require('../src/main.cjs');
