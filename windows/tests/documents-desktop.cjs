const {app}=require('electron');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'cmux-documents-'));
process.env.APPDATA=profile;
process.env.CMUX_WINDOWS_CONFIG=path.join(profile,'cmux.json');
process.env.CMUX_WINDOWS_PIPE=`\\\\.\\pipe\\cmux-documents-${process.pid}`;
app.setPath('userData',path.join(profile,'electron'));
const root=path.join(profile,'workspace');fs.mkdirSync(root);
const markdown='# Document parity\n\n| Name | Value |\n| --- | --- |\n| Safe | Yes |\n\n```js\nconst answer = 42;\n```\n\n<script>window.documentAttack=true</script>\n<img src="x" onerror="window.documentAttack=true">\n[Bad](javascript:alert(1))\n';
fs.writeFileSync(path.join(root,'notes.md'),markdown);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let failed=false;
const deadline=setTimeout(()=>{console.error('Document tests timed out');app.exit(1);},90000);
app.once('browser-window-created',(_event,win)=>{
  win.webContents.once('did-finish-load',async()=>{
    const evaluate=expression=>win.webContents.executeJavaScript(expression);
    async function waitFor(expression){for(let n=0;n<100;n++){if(await evaluate(expression))return;await delay(100);}throw Error(`Timed out: ${expression}`);}
    async function key(keyCode,modifiers=[]){win.focus();win.webContents.focus();win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await delay(100);}
    async function api(route,body){return evaluate(`(async()=>{const token=new URL(location.href).searchParams.get('token');const response=await fetch(${JSON.stringify(route)}+'?token='+encodeURIComponent(token),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(body)})});if(!response.ok)throw Error(await response.text());return response.json();})()`);}
    try {
      win.setSize(1280,800);
      await waitFor("document.querySelector('.workspace-row') !== null");
      const workspace=await api('/api/workspaces',{title:'Documents',cwd:root});
      await waitFor("document.getElementById('workspaceHeading').textContent==='Documents'");
      const panel=await api('/api/panels',{workspaceId:workspace.id,type:'markdown',cwd:root,filePath:'notes.md',title:'notes.md'});
      await waitFor("document.querySelector('.document-pane .markdown-body h1')?.textContent==='Document parity'");
      assert.equal(await evaluate("document.querySelectorAll('.document-pane table tbody tr').length"),1);
      assert(await evaluate("document.querySelector('.document-pane code').textContent.includes('answer = 42')"));
      assert(await evaluate("!window.documentAttack && !document.querySelector('.markdown-body script,.markdown-body [onerror],.markdown-body a[href^=javascript]')"));
      await evaluate("document.querySelector('.document-pane').focus()");
      await key('=',['control']);
      await waitFor("Number.parseFloat(document.querySelector('.markdown-body').style.fontSize)>16");
      console.log('PASS Markdown: real pane, headings, tables, code, shared sanitizer and contextual zoom');
      fs.writeFileSync(path.join(root,'notes.md'),'# Live update\n');
      await waitFor("document.querySelector('.markdown-body h1')?.textContent==='Live update'");
      await evaluate("document.querySelector('.document-pane [data-document-action=text]').click()");
      await waitFor("document.querySelector('.document-pane textarea') !== null");
      await evaluate("document.querySelector('.document-pane [data-file-action=edit]').click();document.querySelector('.document-pane textarea').focus()");
      await key('a',['control']);await win.webContents.insertText('# Saved from document\n');await key('s',['control']);
      await waitFor("document.querySelector('.document-pane [role=status]').textContent==='Saved'");
      assert.equal(fs.readFileSync(path.join(root,'notes.md'),'utf8'),'# Saved from document\n');
      await evaluate("document.querySelector('.document-pane [data-document-action=preview]').click()");
      await waitFor("document.querySelector('.markdown-body h1')?.textContent==='Saved from document'");
      const reloaded=new Promise(resolve=>win.webContents.once('did-finish-load',resolve));win.webContents.reload();await reloaded;
      await waitFor("document.querySelector('.markdown-body h1')?.textContent==='Saved from document'");
      assert(await evaluate(`document.querySelector('.pane[data-panel-id="${panel.id}"]') !== null`));
      console.log('PASS Markdown: live disk changes, shared text editor, keyboard save and pane restoration');
    }catch(error){failed=true;console.error(error.stack||error);}
    finally{clearTimeout(deadline);win.destroy();app.quit();}
  });
});
app.on('will-quit',event=>{if(failed){event.preventDefault();app.exit(1);}});
require('../src/main.cjs');
