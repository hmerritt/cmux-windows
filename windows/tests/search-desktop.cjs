const {app}=require('electron');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'cmux-search-'));
process.env.APPDATA=profile;process.env.CMUX_WINDOWS_CONFIG=path.join(profile,'cmux.json');
process.env.CMUX_WINDOWS_PIPE=`\\\\.\\pipe\\cmux-search-${process.pid}`;
app.setPath('userData',path.join(profile,'electron'));
const root=path.join(profile,'workspace');fs.mkdirSync(root);
fs.mkdirSync(path.join(root,'nested'));
fs.writeFileSync(path.join(root,'nested','[notes].txt'),'First line\nFind Needle here\nLast line\n');
fs.writeFileSync(path.join(root,'other.txt'),'needle lowercase\n');
let failed=false;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deadline=setTimeout(()=>{console.error('Directory search timed out');app.exit(1);},60000);
app.once('browser-window-created',(_event,win)=>win.webContents.once('did-finish-load',async()=>{
  const evaluate=code=>win.webContents.executeJavaScript(code);
  async function waitFor(code){for(let i=0;i<100;i++){if(await evaluate(code))return;await delay(100);}throw Error(`Timed out: ${code}`);}
  async function key(keyCode,modifiers=[]){win.focus();win.webContents.focus();for(const type of ['keyDown','keyUp'])win.webContents.sendInputEvent({type,keyCode,modifiers});await delay(100);}
  try {
    win.setSize(1280,800);
    await waitFor("!!document.querySelector('.workspace-row')");
    await evaluate(`(async()=>{const token=new URL(location.href).searchParams.get('token');await fetch('/api/workspaces?token='+token,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'Search',cwd:${JSON.stringify(root)}})});})()`);
    await waitFor("document.getElementById('workspaceHeading').textContent==='Search'");
    await evaluate("document.querySelector('.xterm-helper-textarea').focus()");await key('f',['control','shift']);
    await waitFor("document.activeElement.matches('.workspace-search-input')");
    await win.webContents.insertText('needle');
    await waitFor("document.querySelectorAll('.workspace-search-result').length===2");
    await key('a',['control']);await win.webContents.insertText('Needle');
    await waitFor("document.querySelectorAll('.workspace-search-result').length===1");
    await key('Down');
    await waitFor("document.activeElement.matches('.workspace-search-result')");
    await key('Enter');
    await waitFor("document.querySelector('.workspace-file-preview textarea')?.value.includes('Find Needle here')");
    assert.equal(await evaluate("document.querySelector('.workspace-file-preview textarea').selectionStart"),16);
    const beforeWrap=await evaluate("document.querySelector('.workspace-file-preview textarea').wrap");
    await key('z',['alt']);
    assert.notEqual(await evaluate("document.querySelector('.workspace-file-preview textarea').wrap"),beforeWrap);
    await evaluate("document.querySelector('[data-file-action=edit]').click()");
    await key('End');await win.webContents.insertText(' edited');await key('s',['control']);
    await waitFor("document.querySelector('.workspace-file-preview [role=status]').textContent==='Saved'");
    assert(fs.readFileSync(path.join(root,'nested','[notes].txt'),'utf8').includes('Find Needle here edited'));
    fs.writeFileSync(process.env.CMUX_WINDOWS_CONFIG,JSON.stringify({shortcuts:{bindings:{saveFilePreview:'ctrl+alt+s',toggleFileEditorWordWrap:'ctrl+alt+w'}}}));
    await delay(900);
    await win.webContents.insertText(' rebound');await key('s',['control']);
    assert(!fs.readFileSync(path.join(root,'nested','[notes].txt'),'utf8').includes('rebound'),'Old save binding must stop working');
    await key('s',['control','alt']);
    await waitFor("document.querySelector('.workspace-file-preview [role=status]').textContent==='Saved'");
    assert(fs.readFileSync(path.join(root,'nested','[notes].txt'),'utf8').includes('rebound'));
    const reboundWrap=await evaluate("document.querySelector('.workspace-file-preview textarea').wrap");
    await key('w',['control','alt']);assert.notEqual(await evaluate("document.querySelector('.workspace-file-preview textarea').wrap"),reboundWrap);
    await win.webContents.insertText(' menu');
    win.webContents.send('cmux-command','shortcut.saveFilePreview');
    await waitFor("document.querySelector('.workspace-file-preview [role=status]').textContent==='Saved'");
    assert(fs.readFileSync(path.join(root,'nested','[notes].txt'),'utf8').includes(' menu'));
    fs.mkdirSync(path.resolve(__dirname,'../test-output'),{recursive:true});
    fs.writeFileSync(path.resolve(__dirname,'../test-output/search.png'),(await win.webContents.capturePage()).toPNG());
    win.webContents.send('cmux-command','shortcut.findInDirectory');
    await waitFor("document.activeElement.matches('.workspace-search-input')");
    await key('a',['control']);await win.webContents.insertText('absent');
    await waitFor("document.querySelectorAll('.workspace-search-result').length===0 && document.querySelector('.workspace-search-status').dataset.state==='ready'");
    console.log('PASS directory search: keyboard/menu actions, smart case, literal filenames, line selection, shared editing, configurable save/wrap and no results');
  }catch(error){failed=true;console.error(error.stack||error);console.error(await evaluate("JSON.stringify({focus:document.activeElement?.outerHTML,preview:document.querySelector('.workspace-file-preview')?.textContent,status:document.querySelector('.workspace-search-status')?.textContent})"));}
  finally{clearTimeout(deadline);win.destroy();app.quit();}
}));
app.on('will-quit',event=>{if(failed){event.preventDefault();app.exit(1);}});
require('../src/main.cjs');
