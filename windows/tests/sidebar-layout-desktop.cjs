const {app}=require('electron');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'cmux-sidebar-layout-'));
process.env.APPDATA=profile;process.env.CMUX_WINDOWS_CONFIG=path.join(profile,'cmux.json');
process.env.CMUX_WINDOWS_PIPE=`\\\\.\\pipe\\cmux-sidebar-layout-${process.pid}`;
app.setPath('userData',path.join(profile,'electron'));
const root=path.join(profile,'workspace');fs.mkdirSync(root);fs.writeFileSync(path.join(root,'notes.md'),'# Visible document\n');
const policy=fs.readFileSync(path.resolve(__dirname,'../../Packages/macOS/CmuxSettings/Sources/CmuxSettings/Policies/RightSidebarWidthSettings.swift'),'utf8');
const minimum=Number(policy.match(/static let minimumWidth = ([\d.]+)/)[1]);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));let failed=false;
const deadline=setTimeout(()=>{console.error('Sidebar layout timed out');app.exit(1);},60000);
app.once('browser-window-created',(_event,win)=>win.webContents.once('did-finish-load',async()=>{
  const evaluate=code=>win.webContents.executeJavaScript(code);
  async function waitFor(code){for(let i=0;i<100;i++){if(await evaluate(code))return;await delay(100);}throw Error(`Timed out: ${code}`);}
  async function key(keyCode,modifiers=[]){win.focus();win.webContents.focus();for(const type of ['keyDown','keyUp'])win.webContents.sendInputEvent({type,keyCode,modifiers});await delay(120);}
  async function api(route,body){return evaluate(`(async()=>{const token=new URL(location.href).searchParams.get('token');return (await fetch(${JSON.stringify(route)}+'?token='+token,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(body)})})).json();})()`);}
  const geometry=()=>evaluate(`(()=>{const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,height:r.height}};return {sidebar:rect(document.getElementById('sidebar')),inspector:rect(document.getElementById('inspector')),panes:[...document.querySelectorAll('.pane')].map(rect),width:innerWidth}})()`);
  function assertDocked(result){assert(result.panes.length===2);for(const pane of result.panes){assert(pane.width>20);assert(pane.left>=result.sidebar.right-1);assert(pane.right<=result.inspector.left+1,'Right sidebar must reserve space rather than cover a live pane');}assert(result.inspector.right<=result.width+1);}
  try {
    win.setSize(1280,800);await waitFor("!!document.querySelector('.workspace-row')");
    const workspace=await api('/api/workspaces',{title:'Sidebar layout',cwd:root});
    await api('/api/panels',{workspaceId:workspace.id,type:'markdown',cwd:root,filePath:'notes.md',title:'notes.md'});
    await waitFor("document.querySelector('.markdown-body h1')?.textContent==='Visible document'");
    win.webContents.send('cmux-command','shortcut.switchRightSidebarToFiles');
    await waitFor("!!document.querySelector('.workspace-file-tree')");await delay(150);
    assertDocked(await geometry());assert(Math.abs((await geometry()).inspector.width-minimum)<1,'New right sidebar uses the native minimum/default width');
    const initial=(await geometry()).inspector;
    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:Math.round(initial.left+2),y:110});
    win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(initial.left-150),y:110,buttons:['left']});
    win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:Math.round(initial.left-150),y:110});
    await waitFor(`document.getElementById('inspector').getBoundingClientRect().width>${minimum+100}`);
    const resized=(await geometry()).inspector.width;
    for(const [width,height] of [[640,480],[1920,1080],[1280,800]]){win.setSize(width,height);await delay(200);assertDocked(await geometry());}
    assert(Math.abs((await geometry()).inspector.width-resized)<2,'Resizing the window restores the preferred tool width');
    await key('b',['control']);await delay(100);const collapsed=await geometry();assert(collapsed.sidebar.width<1);assertDocked(collapsed);
    await key('b',['control']);
    await evaluate("document.getElementById('closeInspectorButton').click()");
    await waitFor("document.getElementById('inspector').getBoundingClientRect().width===0");
    win.webContents.send('cmux-command','shortcut.findInDirectory');await waitFor("!!document.querySelector('.workspace-search-input')");await delay(100);assertDocked(await geometry());
    assert(Math.abs((await geometry()).inspector.width-resized)<2,'Files and Find share their docked width');
    fs.mkdirSync(path.resolve(__dirname,'../test-output'),{recursive:true});fs.writeFileSync(path.resolve(__dirname,'../test-output/sidebar-layout.png'),(await win.webContents.capturePage()).toPNG());
    const reloaded=new Promise(resolve=>win.webContents.once('did-finish-load',resolve));win.webContents.reload();await reloaded;
    await waitFor("!!document.querySelector('.markdown-body h1')");win.webContents.send('cmux-command','shortcut.switchRightSidebarToFiles');await waitFor("!!document.querySelector('.workspace-file-tree')");await delay(100);
    assertDocked(await geometry());assert(Math.abs((await geometry()).inspector.width-resized)<2,'Tool width persists across renderer reload');
    console.log('PASS docked sidebar: native default width, unobscured panes at three sizes, pointer resize, collapse, Files/Find sharing and persisted width');
  }catch(error){failed=true;console.error(error.stack||error);}
  finally{clearTimeout(deadline);win.destroy();app.quit();}
}));
app.on('will-quit',event=>{if(failed){event.preventDefault();app.exit(1);}});require('../src/main.cjs');
