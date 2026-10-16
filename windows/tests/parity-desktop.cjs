const {app}=require('electron');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'cmux-parity-'));
process.env.APPDATA=profile;
process.env.CMUX_WINDOWS_CONFIG=path.join(profile,'cmux.json');
process.env.CMUX_WINDOWS_PIPE=`\\\\.\\pipe\\cmux-parity-${process.pid}`;
app.setPath('userData',path.join(profile,'electron'));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let failed=false;
const deadline=setTimeout(()=>{console.error('Parity test timed out');app.exit(1);},90000);
app.once('browser-window-created',(_event,win)=>{
  win.webContents.once('did-finish-load',async()=>{
    const evaluate=expression=>win.webContents.executeJavaScript(expression);
    async function waitFor(expression) {
      for(let attempt=0;attempt<70;attempt++) {if(await evaluate(expression))return;await delay(100);}
      throw Error(`Timed out: ${expression}`);
    }
    async function key(keyCode,modifiers=[]) {
      win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});
      win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});
      await delay(200);
    }
    async function drag(source,target,edge='center',wholeGroup=false) {
      return evaluate(`(()=>{
        const source=document.querySelector(${JSON.stringify(source)}),target=document.querySelector(${JSON.stringify(target)});
        const rect=target.getBoundingClientRect(), dataTransfer=new DataTransfer();
        const x=${JSON.stringify(edge)}==='left'?rect.left+2:rect.left+rect.width*.5;
        const y=rect.top+rect.height*.5;
        const options={bubbles:true,cancelable:true,dataTransfer,clientX:x,clientY:y,shiftKey:${wholeGroup}};
        source.dispatchEvent(new DragEvent('dragstart',options));
        target.dispatchEvent(new DragEvent('dragover',options));
        target.dispatchEvent(new DragEvent('drop',options));
        source.dispatchEvent(new DragEvent('dragend',options));
      })()`);
    }
    const tab=id=>`[data-tab-panel-id="${id}"]`;
    try {
      win.setSize(1280,800);win.focus();win.webContents.focus();
      await waitFor("document.querySelector('.xterm-helper-textarea') !== null");
      await evaluate("document.querySelector('.xterm-helper-textarea').focus()");
      await key('d',['control']);
      await waitFor("document.querySelectorAll('.pane').length===2");
      const target=await evaluate("document.querySelector('.pane').dataset.panelId");
      await key('t',['control']);
      await waitFor("document.querySelectorAll('.pane-tab').length===3");
      const ids=await evaluate("[...document.querySelectorAll('.pane-tab-strip')].find(s=>s.children.length===2).querySelectorAll('.pane-tab').length && [...[...document.querySelectorAll('.pane-tab-strip')].find(s=>s.children.length===2).children].map(n=>n.dataset.tabPanelId)");
      await drag(tab(ids[1]),tab(ids[0]),'left');
      await waitFor(`document.querySelector(${JSON.stringify(tab(ids[0]))}).parentElement.firstElementChild.dataset.tabPanelId===${JSON.stringify(ids[1])}`);
      console.log('PASS tab drag: reorder within a split');
      await drag(tab(ids[1]),tab(target));
      await waitFor(`document.querySelector(${JSON.stringify(tab(target))}).parentElement.children.length===2`);
      assert.equal(await evaluate("document.querySelectorAll('.pane').length"),2,'Moving one tab preserves the source split');
      await drag(tab(ids[1]),`.pane[data-panel-id="${ids[0]}"]`,'center',true);
      await waitFor("document.querySelectorAll('.pane').length===1 && document.querySelector('.pane-tab-strip').children.length===3");
      console.log('PASS tab drag: move a tab and an entire group without closing processes');
      await drag(tab(ids[1]),`.pane[data-panel-id="${ids[1]}"]`,'left');
      await waitFor("document.querySelectorAll('.pane').length===2 && document.querySelectorAll('.pane-tab').length===3");
      console.log('PASS tab drag: detach into a new split');
      await evaluate(`document.querySelector(${JSON.stringify(tab(ids[0]))}).click()`);
      await evaluate(`document.querySelector(${JSON.stringify(tab(ids[0]))}).focus()`);
      await key('Home');
      await waitFor("document.activeElement.matches('.pane-tab[aria-selected=true]')");
      const a11y=await win.webContents.debugger.attach('1.3');
      const tree=await win.webContents.debugger.sendCommand('Accessibility.getFullAXTree');
      assert(tree.nodes.some(node=>node.role?.value==='tablist' && node.name?.value),'Split tab lists have accessible names');
      assert(tree.nodes.some(node=>node.role?.value==='tabpanel'),'Visible pane content is exposed as tabpanel');
      win.webContents.debugger.detach();
      fs.mkdirSync(path.join(__dirname,'../test-output'),{recursive:true});
      fs.writeFileSync(path.join(__dirname,'../test-output/parity.png'),(await win.webContents.capturePage()).toPNG());
      console.log('PASS accessibility: keyboard tab navigation and native accessibility tree');
    } catch(error) {failed=true;console.error(error.stack||error);}
    finally {clearTimeout(deadline);win.destroy();app.quit();}
  });
});
app.on('will-quit',event=>{if(failed){event.preventDefault();app.exit(1);}});
require('../src/main.cjs');
