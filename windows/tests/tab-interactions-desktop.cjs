const {app}=require('electron');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const profile=process.env.CMUX_TAB_TEST_PROFILE || fs.mkdtempSync(path.join(os.tmpdir(),'cmux-tab-interactions-'));
process.env.APPDATA=profile;process.env.CMUX_WINDOWS_CONFIG=path.join(profile,'cmux.json');process.env.CMUX_WINDOWS_PIPE=`\\\\.\\pipe\\cmux-tab-interactions-${process.pid}`;
app.setPath('userData',path.join(profile,'electron'));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));let failed=false;
const deadline=setTimeout(()=>{console.error('Tab interaction tests timed out');app.exit(1);},90000);
app.once('browser-window-created',(_event,win)=>win.webContents.once('did-finish-load',async()=>{
  const evaluate=code=>win.webContents.executeJavaScript(code);
  async function waitFor(code){for(let n=0;n<100;n++){if(await evaluate(code))return;await delay(75);}throw Error(`Timed out: ${code}`);}
  async function clickAt(x,y,count=1){win.webContents.sendInputEvent({type:'mouseMove',x,y});for(let n=1;n<=count;n++){win.webContents.sendInputEvent({type:'mouseDown',x,y,button:'left',clickCount:n});win.webContents.sendInputEvent({type:'mouseUp',x,y,button:'left',clickCount:n});}await delay(150);}
  async function point(selector,empty=false){return evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(${empty?'r.right-20':'r.left+r.width/2'}),y:Math.round(${empty?'r.bottom-20':'r.top+r.height/2'})};})()`);}
  async function click(selector,count=1){const {x,y}=await point(selector);await clickAt(x,y,count);}
  async function key(keyCode,modifiers=[]){win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await delay(100);}
  try {
    win.setSize(1280,800);console.log('Display scale:',await evaluate('devicePixelRatio'));win.focus();win.webContents.focus();await waitFor("!!document.querySelector('.pane-tab')");
    if(process.argv.includes('--restore-names')){
      const expected=JSON.parse(fs.readFileSync(path.join(profile,'expected-names.json'),'utf8'));
      await waitFor(`document.querySelector('.workspace-row.is-active .workspace-name')?.textContent===${JSON.stringify(expected.activeName)}`);
      const restored=await evaluate("(async()=>{const token=new URL(location.href).searchParams.get('token');return (await fetch('/api/state?token='+token)).json()})()");
      for(const workspace of expected.workspaces){const saved=restored.workspaces.find(item=>item.id===workspace.id);assert.equal(saved.title,workspace.title);for(const panel of workspace.panels.filter(panel=>panel.titleLocked))assert.equal(saved.panels.find(item=>item.id===panel.id).title,panel.title);}
      console.log('PASS full desktop restart: custom panel and workspace reset names restored');return;
    }
    const toolbarButtons=await evaluate("[...document.querySelectorAll('.pane-toolbar .pane-tool')].filter(button=>button.getBoundingClientRect().width>0).map(button=>({selector:'.pane-tool.'+[...button.classList].find(name=>name!=='pane-tool'),label:button.getAttribute('aria-label')}))");
    for(const button of toolbarButtons){
      const hover=await point(button.selector);win.webContents.sendInputEvent({type:'mouseMove',...hover});await delay(70);
      const alignment=await evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(button.selector)}),r=b.getBoundingClientRect(),s=b.querySelector('svg').getBoundingClientRect();return {hover:b.matches(':hover'),x:Math.abs(r.x+r.width/2-s.x-s.width/2),y:Math.abs(r.y+r.height/2-s.y-s.height/2)}})()`);
      assert(alignment.hover,button.label+' hover box is active');
      assert(alignment.x<0.6,button.label+' icon must be centered horizontally within its hover box');
      assert(alignment.y<0.6,button.label+' icon must be centered vertically within its hover box');
    }
    win.webContents.sendInputEvent({type:'mouseMove',x:0,y:0});
    console.log('PASS toolbar hover: every visible icon is centered in its button');
    const plusBounds=await evaluate("(()=>{const r=document.querySelector('.pane-new-tab').getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}})()");
    const plusImage=await win.webContents.capturePage(plusBounds),plusSize=plusImage.getSize(),plusPixels=plusImage.toBitmap();
    let minX=plusSize.width,minY=plusSize.height,maxX=-1,maxY=-1;
    for(let y=0;y<plusSize.height;y++)for(let x=0;x<plusSize.width;x++){const i=(y*plusSize.width+x)*4;if(Math.min(plusPixels[i],plusPixels[i+1],plusPixels[i+2])>100){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}}
    assert(maxX>=minX,'New-tab plus must be visible');
    assert(Math.abs((minX+maxX+1)/2-plusSize.width/2)<=1,'Toolbar plus ink must be centered horizontally');
    assert(Math.abs((minY+maxY+1)/2-plusSize.height/2)<=1,'Toolbar plus ink must be centered vertically');
    console.log('PASS toolbar plus: rendered icon is centered in its button');
    const initial=await evaluate("document.querySelectorAll('.pane-tab').length");
    const empty=await evaluate("(()=>{const r=document.querySelector('.pane-tab-strip').getBoundingClientRect();return {x:Math.round(r.right-10),y:Math.round(r.top+r.height/2)};})()");
    await clickAt(empty.x,empty.y);assert.equal(await evaluate("document.querySelectorAll('.pane-tab').length"),initial,'Single background clicks must not create tabs');
    await clickAt(empty.x,empty.y,2);
    assert.equal(await evaluate("document.querySelectorAll('.pane-tab').length"),initial+1,'Double-click empty horizontal space creates exactly one tab');
    console.log('PASS empty horizontal tab bar: pointer single/double clicks');
    await waitFor(`document.querySelectorAll('.pane-tab').length===${initial+1}`);
    const panelId=await evaluate("document.querySelector('.pane-tab.is-selected').dataset.tabPanelId");
    const label=`[data-tab-panel-id="${panelId}"] .pane-tab-label`;
    const rect=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(label)}).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()`);
    await click(label,2);await waitFor("!!document.querySelector('.inline-rename-input')");
    const inputRect=await evaluate("(()=>{const r=document.querySelector('.inline-rename-input').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()");
    for(const field of ['x','y','width','height'])assert(Math.abs(rect[field]-inputRect[field])<1,`Inline ${field} must match the label`);
    assert(await evaluate("document.querySelector('.inline-rename-input').selectionEnd===document.querySelector('.inline-rename-input').value.length && document.querySelector('.inline-rename-input').selectionStart===0"));
    await win.webContents.insertText('Inline terminal');await key('Enter');
    await waitFor(`document.querySelector(${JSON.stringify(label)}).textContent==='Inline terminal' && !document.querySelector('.inline-rename-input')`);
    await click(label,2);await waitFor("!!document.querySelector('.inline-rename-input')");await win.webContents.insertText('Cancelled');await key('Escape');
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(label)}).textContent`),'Inline terminal');
    await click(label,2);await waitFor("!!document.querySelector('.inline-rename-input')");await win.webContents.insertText('Saved outside');
    const blank=await point('#workspaceList',true);await clickAt(blank.x,blank.y);
    await waitFor(`document.querySelector(${JSON.stringify(label)}).textContent==='Saved outside' && !document.querySelector('.inline-rename-input')`);
    await click(label,2);await waitFor("!!document.querySelector('.inline-rename-input')");await key('a',['control']);await key('Backspace');await key('Enter');
    await waitFor(`document.querySelector(${JSON.stringify(label)}).textContent!=='Saved outside' && !document.querySelector('.inline-rename-input')`);
    win.webContents.send('cmux-command','shortcut.renameTab');await waitFor("!!document.querySelector('.inline-rename-input')");await win.webContents.insertText('Stable tab draft');
    await evaluate(`(async()=>{const token=new URL(location.href).searchParams.get('token');await fetch('/api/panels/${panelId}?token='+token,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'Background title'})});})()`);await delay(200);
    assert.equal(await evaluate("document.querySelector('.inline-rename-input').value"),'Stable tab draft');
    const otherTab=await evaluate(`document.querySelector('.pane-tab:not([data-tab-panel-id="${panelId}"])').dataset.tabPanelId`);
    await click(`[data-tab-panel-id="${otherTab}"] .pane-tab-label`);await waitFor(`document.querySelector('[data-tab-panel-id="${otherTab}"]').classList.contains('is-selected') && !document.querySelector('.inline-rename-input')`);
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(label)}).textContent`),'Stable tab draft','Outside click both saves and activates the clicked tab');
    assert.equal(await evaluate("document.querySelectorAll('.pane-tab').length"),initial+1,'Existing tab clicks do not create');
    const tabContext=await point(label);for(const type of ['mouseDown','mouseUp'])win.webContents.sendInputEvent({type,...tabContext,button:'right',clickCount:1});
    await waitFor("!!document.querySelector('.context-menu:not([hidden]) button')");
    const tabRename=await evaluate("(()=>{const b=[...document.querySelectorAll('.context-menu button')].find(b=>b.textContent.trim()==='Rename');const r=b.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()");
    await clickAt(tabRename.x,tabRename.y);await waitFor("!!document.querySelector('.inline-rename-input')");assert.equal(await evaluate("document.querySelector('.inline-rename-input').value"),'Stable tab draft','Context rename targets the clicked inactive tab');await key('Escape');
    console.log('PASS tab inline rename: exact geometry, selected text, Enter, outside click, Escape and blank reset');
    const count=await evaluate("document.querySelectorAll('.workspace-row').length");
    await clickAt(blank.x,blank.y);assert.equal(await evaluate("document.querySelectorAll('.workspace-row').length"),count,'Single workspace background click does not create');
    await clickAt(blank.x,blank.y,2);await waitFor(`document.querySelectorAll('.workspace-row').length===${count+1}`);
    const workspaceId=await evaluate("document.querySelector('.workspace-row.is-active').dataset.workspaceId");
    const workspaceLabel=`.workspace-row[data-workspace-id="${workspaceId}"] .workspace-name`;
    assert.equal(await evaluate("document.querySelectorAll('.pane-tab').length"),1,'New workspace starts with one terminal');
    await click(workspaceLabel,2);await waitFor("!!document.querySelector('.inline-rename-input')");
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(workspaceLabel)}).closest('.workspace-row').draggable`),false);
    const workspaceGeometry=await evaluate(`(()=>{const a=document.querySelector(${JSON.stringify(workspaceLabel)}).getBoundingClientRect(),b=document.querySelector('.inline-rename-input').getBoundingClientRect();return ['x','y','width','height'].every(key=>Math.abs(a[key]-b[key])<1)})()`);assert(workspaceGeometry);
    await win.webContents.insertText('Workspace inline');await key('Enter');
    await waitFor(`document.querySelector(${JSON.stringify(workspaceLabel)}).textContent==='Workspace inline' && !document.querySelector('.inline-rename-input')`);
    await click(workspaceLabel,2);await waitFor("!!document.querySelector('.inline-rename-input')");await win.webContents.insertText('Draft survives');
    // Force an authoritative background update while the input owns focus.
    await evaluate(`(async()=>{const token=new URL(location.href).searchParams.get('token');await fetch('/api/workspaces/${workspaceId}?token='+token,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({color:'#ff8800'})});})()`);
    await delay(250);
    assert(await evaluate("document.activeElement===document.querySelector('.inline-rename-input') && document.activeElement.value==='Draft survives'"));
    await evaluate("window.renameTestFetch=window.fetch;window.fetch=(url,options)=>options?.method==='PATCH'?Promise.resolve(new Response('forced failure',{status:500})):window.renameTestFetch(url,options);void 0");
    await key('Enter');await waitFor("document.querySelector('.inline-rename-input')?.getAttribute('aria-invalid')==='true' && !document.querySelector('.inline-rename-error').hidden");
    assert.equal(await evaluate("document.querySelector('.inline-rename-input').value"),'Draft survives');
    await evaluate("window.fetch=window.renameTestFetch;delete window.renameTestFetch");await key('Enter');
    await waitFor(`document.querySelector(${JSON.stringify(workspaceLabel)}).textContent==='Draft survives' && !document.querySelector('.inline-rename-input')`);
    await click(workspaceLabel,2);await waitFor("!!document.querySelector('.inline-rename-input')");await key('a',['control']);await key('Backspace');await key('Enter');
    await waitFor(`document.querySelector(${JSON.stringify(workspaceLabel)}).textContent!=='Draft survives' && !document.querySelector('.inline-rename-input')`);
    const resetName=await evaluate(`document.querySelector(${JSON.stringify(workspaceLabel)}).textContent`);
    // Window blur commits once even when the input also loses focus.
    await click(workspaceLabel,2);await waitFor("!!document.querySelector('.inline-rename-input')");await win.webContents.insertText('Window saved');
    await evaluate("window.renameSaves=0;window.renameTestFetch=window.fetch;window.fetch=(url,options)=>{if(options?.method==='PATCH')window.renameSaves++;return window.renameTestFetch(url,options)};window.dispatchEvent(new Event('blur'));document.activeElement.blur()");
    await waitFor(`document.querySelector(${JSON.stringify(workspaceLabel)}).textContent==='Window saved' && !document.querySelector('.inline-rename-input')`);
    assert.equal(await evaluate('window.renameSaves'),1,'Each edit commits once');await evaluate('window.fetch=window.renameTestFetch;delete window.renameTestFetch');
    await click(workspaceLabel,2);await waitFor("!!document.querySelector('.inline-rename-input')");await key('a',['control']);await key('Backspace');await key('Enter');await waitFor(`document.querySelector(${JSON.stringify(workspaceLabel)}).textContent===${JSON.stringify(resetName)} && !document.querySelector('.inline-rename-input')`);
    // Keyboard command and context menu enter the same editor.
    win.webContents.send('cmux-command','shortcut.renameWorkspace');await waitFor("!!document.querySelector('.inline-rename-input')");await key('Escape');
    const context=await point(workspaceLabel);for(const type of ['mouseDown','mouseUp'])win.webContents.sendInputEvent({type,...context,button:'right',clickCount:1});
    await waitFor("!!document.querySelector('.context-menu:not([hidden]) .context-actions button')");
    const renameButton=await evaluate("(()=>{const b=[...document.querySelectorAll('.context-menu button')].find(b=>b.textContent==='Rename');const r=b.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()");
    await clickAt(renameButton.x,renameButton.y);await waitFor("!!document.querySelector('.inline-rename-input')");await key('Escape');
    console.log('PASS workspace inline rename: double-click creation, rerender stability, failed-save draft and retry');
    const reloaded=new Promise(resolve=>win.webContents.once('did-finish-load',resolve));win.webContents.reload();await reloaded;
    await waitFor(`document.querySelector(${JSON.stringify(workspaceLabel)})?.textContent===${JSON.stringify(resetName)}`);
    assert(await evaluate("getComputedStyle(document.querySelector('.pane-tab')).flexBasis==='160px'"));
    assert(await evaluate("getComputedStyle(document.querySelector('.pane.is-active .pane-header')).boxShadow==='none'"));
    assert(await evaluate("getComputedStyle(document.querySelector('.pane.is-active .pane-tab.is-selected')).boxShadow.includes('2px')"));
    await clickAt(blank.x,blank.y);
    assert(await evaluate("getComputedStyle(document.getElementById('sidebar'),'::after').backgroundColor==='rgba(0, 0, 0, 0)'"));
    const sidebar=await evaluate("(()=>{const r=document.getElementById('sidebar').getBoundingClientRect();return {x:Math.round(r.right-2),y:Math.round(r.top+100),width:r.width}})()");
    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:sidebar.x,y:sidebar.y});win.webContents.sendInputEvent({type:'mouseMove',x:sidebar.x+70,y:sidebar.y,buttons:['left']});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:sidebar.x+70,y:sidebar.y});
    await waitFor(`document.getElementById('sidebar').getBoundingClientRect().width>${sidebar.width+40}`);
    assert.equal(await evaluate("document.querySelectorAll('.workspace-row').length"),count+1,'Resize does not create a workspace');
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.pane-tab-strip')).cursor"),'default');
    await click('.pane.is-active .split-right');await waitFor("document.querySelectorAll('.pane').length===2");
    assert.equal(await evaluate("[...document.querySelectorAll('.pane-tab')].filter(tab=>getComputedStyle(tab).boxShadow.includes('rgb(10, 132, 255)')).length"),1,'Only active pane selected tab has the blue indicator');
    assert(await evaluate("getComputedStyle(document.querySelector('.pane:not(.is-active) .pane-tab.is-selected')).boxShadow.includes('1px')"));
    assert.equal(await evaluate("document.querySelectorAll('.workspace-row').length"),count+1,'Existing controls do not create workspaces');
    fs.mkdirSync(path.resolve(__dirname,'../test-output'),{recursive:true});fs.writeFileSync(path.resolve(__dirname,'../test-output/tab-interactions.png'),(await win.webContents.capturePage()).toPNG());
    if(process.env.CMUX_TAB_TEST_PROFILE){const saved=await evaluate("(async()=>{const token=new URL(location.href).searchParams.get('token');return (await fetch('/api/state?token='+token)).json()})()");fs.writeFileSync(path.join(profile,'expected-names.json'),JSON.stringify({workspaces:saved.workspaces,activeName:resetName}));}
    console.log('PASS tab presentation: restored names, 160px preferred width, active-tab 2px line and neutral sidebar hover');

  }catch(error){failed=true;console.error(error.stack||error);}
  finally{clearTimeout(deadline);win.destroy();app.quit();}
}));
app.on('will-quit',event=>{if(failed){event.preventDefault();app.exit(1);}});require('../src/main.cjs');
