const {app}=require('electron');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'cmux-file-mutations-'));
process.env.APPDATA=profile;process.env.CMUX_WINDOWS_CONFIG=path.join(profile,'cmux.json');
process.env.CMUX_WINDOWS_PIPE=`\\\\.\\pipe\\cmux-file-mutations-${process.pid}`;
app.setPath('userData',path.join(profile,'electron'));
const root=path.join(profile,'workspace');fs.mkdirSync(root);
let failed=false;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deadline=setTimeout(()=>{console.error('File mutations timed out');app.exit(1);},60000);
app.once('browser-window-created',(_event,win)=>win.webContents.once('did-finish-load',async()=>{
  const evaluate=code=>win.webContents.executeJavaScript(code);
  async function waitFor(code){for(let i=0;i<100;i++){if(await evaluate(code))return;await delay(100);}throw Error(`Timed out: ${code}`);}
  async function key(keyCode,modifiers=[]){win.focus();win.webContents.focus();for(const type of ['keyDown','keyUp'])win.webContents.sendInputEvent({type,keyCode,modifiers});await delay(80);}
  async function name(action,value){await evaluate(`document.querySelector('[data-file-mutation="${action}"]').click()`);await waitFor("document.activeElement.matches('.dialog-input')");await key('a',['control']);await win.webContents.insertText(value);await key('Enter');}
  try {
    win.setSize(1280,800);
    await waitFor("!!document.querySelector('.workspace-row')");
    await evaluate(`(async()=>{const token=new URL(location.href).searchParams.get('token');await fetch('/api/workspaces?token='+token,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'Files',cwd:${JSON.stringify(root)}})});})()`);
    await waitFor("document.getElementById('workspaceHeading').textContent==='Files'");
    win.webContents.send('cmux-command','shortcut.switchRightSidebarToFiles');
    await waitFor("!!document.querySelector('[data-file-mutation=folder]')");
    await name('folder','notes');
    await waitFor("!!document.querySelector('[data-file-path=notes]')");
    await evaluate("document.querySelector('[data-file-path=notes]').click()");
    await waitFor("document.querySelector('.workspace-files-path').textContent==='notes'");
    await name('file','draft.txt');
    await waitFor("!!document.querySelector('.workspace-file-preview textarea')");
    await evaluate("document.querySelector('[data-file-action=edit]').click()");
    await win.webContents.insertText('Created and saved\n');await key('s',['control']);
    await waitFor("document.querySelector('.workspace-file-preview [role=status]').textContent==='Saved'");
    assert.equal(fs.readFileSync(path.join(root,'notes','draft.txt'),'utf8'),'Created and saved\n');
    await name('rename','renamed.txt');
    await waitFor("!![...document.querySelectorAll('[data-file-path]')].find(node=>node.dataset.filePath.endsWith('renamed.txt'))");
    assert.equal(fs.existsSync(path.join(root,'notes','draft.txt')),false);
    assert.equal(fs.readFileSync(path.join(root,'notes','renamed.txt'),'utf8'),'Created and saved\n');
    await name('rename','Renamed.txt');
    await waitFor("!![...document.querySelectorAll('[data-file-path]')].find(node=>node.dataset.filePath.endsWith('Renamed.txt'))");
    assert(fs.readdirSync(path.join(root,'notes')).includes('Renamed.txt'));
    await name('file','Renamed.txt');
    await waitFor("document.querySelector('.workspace-file-mutation-status')?.textContent==='An item with this name already exists.'");
    assert.equal(fs.readFileSync(path.join(root,'notes','Renamed.txt'),'utf8'),'Created and saved\n');
    fs.mkdirSync(path.resolve(__dirname,'../test-output'),{recursive:true});fs.writeFileSync(path.resolve(__dirname,'../test-output/file-mutations.png'),(await win.webContents.capturePage()).toPNG());
    console.log('PASS file mutations: new folder, nested file, shared editor/save, rename, case-only rename and collision preservation');
  }catch(error){failed=true;console.error(error.stack||error);}
  finally{clearTimeout(deadline);win.destroy();app.quit();}
}));
app.on('will-quit',event=>{if(failed){event.preventDefault();app.exit(1);}});
require('../src/main.cjs');
