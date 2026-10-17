const {app,clipboard,ClipboardItem}=require('electron');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'cmux-paste-'));
process.env.APPDATA=profile;process.env.CMUX_WINDOWS_CONFIG=path.join(profile,'cmux.json');process.env.CMUX_WINDOWS_PIPE=`\\\\.\\pipe\\cmux-paste-${process.pid}`;
app.setPath('userData',path.join(profile,'electron'));
let originalClipboard;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));let failed=false;
const deadline=setTimeout(async()=>{if(originalClipboard)await clipboard.write(originalClipboard);console.error('Paste test timed out');app.exit(1);},60000);
app.once('browser-window-created',(_event,win)=>win.webContents.once('did-finish-load',async()=>{
  const evaluate=code=>win.webContents.executeJavaScript(code);
  async function waitFor(code){for(let n=0;n<80;n++){if(await evaluate(code))return;await delay(100);}throw Error('Timed out: '+code);}
  async function click(selector,button='left'){
    const point=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    win.webContents.sendInputEvent({type:'mouseMove',...point});
    for(const type of ['mouseDown','mouseUp'])win.webContents.sendInputEvent({type,...point,button,clickCount:1});await delay(150);
  }
  try{
    originalClipboard=await Promise.all((await clipboard.read()).map(async item=>new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type=>[type,await item.getType(type)]))))));
    win.setSize(1280,800);win.focus();win.webContents.focus();
    await waitFor("!!document.querySelector('.terminal-host:not(.is-connecting) .xterm-screen')");
    await evaluate("window.pasteInputs=[];window.pasteOriginalSend=WebSocket.prototype.send;WebSocket.prototype.send=function(data){try{const message=JSON.parse(data);if(message.type==='input' && ['right_click_Ω','inactive_paste','menu_paste'].includes(message.data))window.pasteInputs.push({url:this.url,text:message.data})}catch{}return window.pasteOriginalSend.call(this,data)};void 0");
    const firstId=await evaluate("document.querySelector('.pane.is-active').dataset.panelId");
    await clipboard.writeText('right_click_Ω');
    await click('.terminal-host .xterm-screen','right');
    await waitFor("window.pasteInputs.length===1");
    assert.equal(await evaluate('window.pasteInputs[0].text'),'right_click_Ω');
    await waitFor("document.querySelector('.terminal-host .xterm-screen').textContent.includes('right_click_Ω')");
    assert.equal(await evaluate("!!document.querySelector('.context-menu:not([hidden])')"),false);
    await click('.pane.is-active .split-right');
    await waitFor("document.querySelectorAll('.terminal-host:not(.is-connecting)').length===2");
    assert.notEqual(await evaluate("document.querySelector('.pane.is-active').dataset.panelId"),firstId);
    await clipboard.writeText('inactive_paste');await click(`.pane[data-panel-id="${firstId}"] .xterm-screen`,'right');
    await waitFor('window.pasteInputs.length===2');
    assert((await evaluate('window.pasteInputs[1].url')).includes('/terminal/'+firstId));
    assert.equal(await evaluate('window.pasteInputs[1].text'),'inactive_paste');
    await waitFor(`document.querySelector('.pane.is-active').dataset.panelId===${JSON.stringify(firstId)}`);
    clipboard.clear();await click(`.pane[data-panel-id="${firstId}"] .xterm-screen`,'right');await delay(200);
    assert.equal(await evaluate('window.pasteInputs.length'),2,'Empty clipboard sends no terminal input');
    await clipboard.writeText('menu_paste');win.webContents.send('cmux-command','terminal.pasteClipboard');
    await waitFor('window.pasteInputs.length===3');assert.equal(await evaluate('window.pasteInputs[2].text'),'menu_paste');
    await click('.pane.is-active .pane-tab-label','right');
    await waitFor("!!document.querySelector('.context-menu:not([hidden])')");
    assert.equal(await evaluate('window.pasteInputs.length'),3,'Header context menu does not paste');
    console.log('PASS terminal paste: real right-click pastes exactly once, targets inactive panes, focuses target, handles empty clipboard and retains menu/header actions');
  }catch(error){failed=true;console.error(error.stack||error);}
  finally{if(originalClipboard)await clipboard.write(originalClipboard);clearTimeout(deadline);win.destroy();app.quit();}
}));
app.on('will-quit',event=>{if(failed){event.preventDefault();app.exit(1);}});require('../src/main.cjs');
