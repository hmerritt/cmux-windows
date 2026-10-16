const {app}=require('electron');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'cmux-tab-interactions-'));
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
    win.setSize(1280,800);win.focus();win.webContents.focus();await waitFor("!!document.querySelector('.pane-tab')");
    const initial=await evaluate("document.querySelectorAll('.pane-tab').length");
    const empty=await evaluate("(()=>{const r=document.querySelector('.pane-tab-strip').getBoundingClientRect();return {x:Math.round(r.right-10),y:Math.round(r.top+r.height/2)};})()");
    await clickAt(empty.x,empty.y);assert.equal(await evaluate("document.querySelectorAll('.pane-tab').length"),initial,'Single background clicks must not create tabs');
    await clickAt(empty.x,empty.y,2);
    assert.equal(await evaluate("document.querySelectorAll('.pane-tab').length"),initial+1,'Double-click empty horizontal space creates exactly one tab');
    console.log('PASS empty horizontal tab bar: pointer single/double clicks');
  }catch(error){failed=true;console.error(error.stack||error);}
  finally{clearTimeout(deadline);win.destroy();app.quit();}
}));
app.on('will-quit',event=>{if(failed){event.preventDefault();app.exit(1);}});require('../src/main.cjs');
