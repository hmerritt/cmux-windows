const {app}=require('electron');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'cmux-middle-close-'));
process.env.APPDATA=profile;process.env.CMUX_WINDOWS_CONFIG=path.join(profile,'cmux.json');process.env.CMUX_WINDOWS_PIPE=`\\\\.\\pipe\\cmux-middle-close-${process.pid}`;
app.setPath('userData',path.join(profile,'electron'));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));let failed=false;
const deadline=setTimeout(()=>{console.error('Middle-click test timed out');app.exit(1);},60000);
app.once('browser-window-created',(_event,win)=>win.webContents.once('did-finish-load',async()=>{
  const evaluate=code=>win.webContents.executeJavaScript(code);
  async function waitFor(code){for(let n=0;n<100;n++){if(await evaluate(code))return;await delay(75);}throw Error('Timed out: '+code);}
  async function click(selector,button='left'){
    const point=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    win.webContents.sendInputEvent({type:'mouseMove',...point});
    for(const type of ['mouseDown','mouseUp'])win.webContents.sendInputEvent({type,...point,button,clickCount:1});await delay(150);
  }
  async function api(route,body,method='POST'){
    return evaluate(`(async()=>{const token=new URL(location.href).searchParams.get('token');const r=await fetch(${JSON.stringify(route)}+'?token='+encodeURIComponent(token),{method:${JSON.stringify(method)},headers:{'Content-Type':'application/json'},${body===undefined?'':`body:JSON.stringify(${JSON.stringify(body)}),`}});if(!r.ok)throw Error('API '+r.status);return r.json();})()`);
  }
  try{
    win.setSize(1280,800);win.focus();win.webContents.focus();
    await waitFor("!!document.querySelector('.pane-tab')");
    const initial=await api('/api/state',undefined,'GET'),workspaceId=initial.activeWorkspaceId;
    const first=initial.workspaces[0].panels[0].id;
    await click('.pane-new-tab');await waitFor("document.querySelectorAll('.pane-tab').length===2");
    const second=await evaluate("document.querySelector('.pane-tab.is-selected').dataset.tabPanelId");
    await click('.pane-new-tab');await waitFor("document.querySelectorAll('.pane-tab').length===3");
    const third=await evaluate("document.querySelector('.pane-tab.is-selected').dataset.tabPanelId");
    await click('.split-right');await waitFor("document.querySelectorAll('.pane').length===2");
    const adjacent=await evaluate("document.querySelector('.pane.is-active').dataset.panelId");
    const tab=id=>`[data-tab-panel-id="${id}"]`;
    await click(tab(second),'middle');
    await waitFor(`!document.querySelector(${JSON.stringify(tab(second))})`);
    let saved=await api('/api/state',undefined,'GET');
    assert.deepEqual(saved.workspaces.find(w=>w.id===workspaceId).panels.map(p=>p.id).sort(),[first,third,adjacent].sort(),'Only the clicked inactive tab is closed');
    assert.equal(saved.workspaces.find(w=>w.id===workspaceId).activePanelId,adjacent,'Closing an inactive tab preserves focused pane');
    assert.equal(await evaluate("document.querySelectorAll('.pane').length"),2,'Tab close preserves both split panes');
    await click(tab(third));await click(tab(third),'middle');
    await waitFor(`!document.querySelector(${JSON.stringify(tab(third))})`);
    assert.equal(await evaluate("document.querySelectorAll('.pane').length"),2,'Closing selected tab retains its sibling and split');
    assert(await evaluate(`!!document.querySelector(${JSON.stringify(tab(first))})`));
    await click(tab(first)+' .pane-tab-close','middle');
    saved=await api('/api/state',undefined,'GET');
    assert.equal(saved.workspaces.find(w=>w.id===workspaceId).panels.length,1,'Closing the last tab has the same behavior as its close button');
    // Empty strip space and toolbar backgrounds must not close the remaining tab.
    const empty=await evaluate("(()=>{const r=document.querySelector('.pane-tab-strip').getBoundingClientRect();return {x:Math.round(r.right-8),y:Math.round(r.y+r.height/2)}})()");
    for(const type of ['mouseDown','mouseUp'])win.webContents.sendInputEvent({type,...empty,button:'middle',clickCount:1});await delay(150);
    assert.equal((await api('/api/state',undefined,'GET')).workspaces.find(w=>w.id===workspaceId).panels.length,1);
    console.log('PASS middle-click tab close: inactive and selected tabs, retained siblings/splits/focus, last-tab close and empty-space exclusion');
  }catch(error){failed=true;console.error(error.stack||error);}
  finally{clearTimeout(deadline);win.destroy();app.quit();}
}));
app.on('will-quit',event=>{if(failed){event.preventDefault();app.exit(1);}});require('../src/main.cjs');
