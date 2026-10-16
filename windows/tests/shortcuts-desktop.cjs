const {app,webContents} = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const http=require('node:http');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cmux-shortcuts-'));
process.env.APPDATA = profile;
process.env.CMUX_WINDOWS_CONFIG = path.join(profile, 'cmux.json');
process.env.CMUX_WINDOWS_PIPE = `\\\\.\\pipe\\cmux-shortcuts-${process.pid}`;
app.setPath('userData', path.join(profile, 'electron'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const errors=[];
let fixtureHits=0;
const fixture=http.createServer((_request,response)=>{fixtureHits++;response.end('<!doctype html><title>Shortcut fixture</title><input id="typing"><h1>Browser shortcut fixture</h1>');});
fixture.listen(0,'127.0.0.1');
const deadline = setTimeout(() => { console.error('Shortcut test timed out'); process.exit(1); }, 90000);
let failed = false;
let primaryWindow=false;
app.on('browser-window-created', (_event, win) => {
  if(primaryWindow)return;primaryWindow=true;
  win.webContents.on('console-message',details=>{if(details.level==='error')errors.push(details.message);});
  win.webContents.once('did-finish-load', async () => {
    const evaluate = expression => win.webContents.executeJavaScript(expression);
    async function waitFor(expression) {
      for (let attempt=0; attempt<80; attempt++) {
        if (await evaluate(expression)) return;
        await delay(100);
      }
      throw new Error(`Timed out: ${expression}`);
    }
    async function key(keyCode, modifiers=[]) {
      win.webContents.sendInputEvent({type:'keyDown', keyCode, modifiers});
      win.webContents.sendInputEvent({type:'keyUp', keyCode, modifiers});
      await delay(150);
    }
    async function api(route,body,method='POST') {
      return evaluate(`(async()=>{const token=new URL(location.href).searchParams.get('token');const r=await fetch(${JSON.stringify(route)}+'?token='+encodeURIComponent(token),{method:${JSON.stringify(method)},headers:{'Content-Type':'application/json'},${body===undefined?'':`body:JSON.stringify(${JSON.stringify(body)}),`}});if(!r.ok)throw Error('API '+r.status);return r.json();})()`);
    }
    const count=()=>evaluate("document.querySelectorAll('.pane').length");
    const activeId=async()=>{const state=await api('/api/state',undefined,'GET');return state.workspaces.find(w=>w.id===state.activeWorkspaceId)?.activePanelId;};
    try {
      await waitFor("document.querySelector('.xterm-helper-textarea') !== null");
      win.focus(); win.webContents.focus();
      await evaluate("document.querySelector('.xterm-helper-textarea').focus()");
      const before = await evaluate("document.querySelectorAll('.pane').length");
      await key('d', ['control']);
      await waitFor(`document.querySelectorAll('.pane').length === ${before+1}`);
      assert.equal(await evaluate("document.querySelectorAll('.pane').length"), before+1, 'Ctrl+D splits the focused terminal instead of sending shell EOF');
      console.log('PASS desktop shortcut: Ctrl+D creates a split through real keyboard input');
      await key('D',['control','shift']);
      await waitFor(`document.querySelectorAll('.pane').length === ${before+2}`);
      const anchor=await activeId();
      await key('t',['control']);
      await waitFor(`document.querySelectorAll('.pane-tab').length === ${before+3}`);
      assert.equal(await count(),before+2,'New surface is a tab in the focused split');
      await key('[',['control','shift']);
      assert.equal(await activeId(),anchor,'Previous surface stays within its split');
      await key('9',['alt']);
      assert.notEqual(await activeId(),anchor,'Alt+9 selects last surface in split');
      const moving=await activeId();
      await key('Left',['control','alt','shift']);
      await waitFor(`document.querySelector('.pane[data-panel-id="${moving}"] .pane-tab-strip').querySelectorAll('.pane-tab').length === 2`);
      assert.equal(await count(),before+2,'Moving a surface preserves the surviving source split');
      await key('[',['control','alt','shift']);
      assert.equal(await evaluate(`document.querySelector('.pane[data-panel-id="${moving}"] .pane-tab').dataset.tabPanelId`),moving,'Move surface left reorders only its tab group');
      await key('Space',['control','shift']);await key('1',['control']);
      assert.equal(await activeId(),await evaluate("document.querySelector('.pane').dataset.panelId"),'Prefixed numbering selects panes, not workspaces');
      await key('Enter',['control','shift']);
      await waitFor("document.querySelector('.pane.is-zoomed') !== null");
      await key('Enter',['control','shift']);
      await waitFor("document.querySelector('.pane.is-zoomed') === null");
      await key('h',['control','alt','shift']);
      assert(await evaluate("[...document.querySelectorAll('.pane-splitter')].some(node=>node.dataset.resizePercent!=='50')"),'Pane resize changes a split ratio');
      await key('Space',['control','shift']);await key('=',['control','shift']);
      assert(await evaluate("[...document.querySelectorAll('.pane-splitter')].every(node=>node.dataset.resizePercent==='50')"),'Equalize resets every split ratio');
      await key('f',['control']);
      await waitFor("document.activeElement.closest('.terminal-search') !== null");
      await key('F',['control','alt','shift']);
      await waitFor("document.querySelector('.terminal-search:not([hidden])') === null");
      await key('p',['control']);
      await waitFor("document.getElementById('palette').getAttribute('aria-hidden') === 'false'");
      assert(await evaluate("[...document.querySelectorAll('.palette-item')].every(node=>!node.textContent.includes('Split Terminal'))"),'Go to workspace excludes commands');
      await key('Escape');
      await key('n',['control']);
      await waitFor("document.querySelectorAll('.workspace-row').length === 2");
      await key('1',['control']);
      await waitFor(`document.querySelectorAll('.pane').length === ${before+2}`);
      await key('u',['control','alt']);
      await delay(250);
      let notified=await api('/api/state',undefined,'GET');
      assert(notified.workspaces.flatMap(w=>w.panels).some(p=>p.needsAttention),'Toggle unread marks focused panel');
      await key('u',['control','shift']);
      await delay(250);
      notified=await api('/api/state',undefined,'GET');
      assert(!notified.workspaces.flatMap(w=>w.panels).some(p=>p.needsAttention),'Jump to focused unread panel acknowledges notification');
      await api('/api/notify',{message:'Shortcut notification'});
      await key('i',['control']);
      await waitFor("document.querySelector('.notification-card') !== null");
      win.webContents.send('cmux-command','shortcut.markAllNotificationsRead');
      await waitFor("document.querySelectorAll('.notification-card').length === 0");
      await evaluate("document.querySelector('.pane .xterm-helper-textarea').focus()");
      await key('M',['control','shift']);
      await waitFor("document.querySelector('.pane.is-active .xterm-selection').children.length > 0");
      await key('Escape');
      await key('F11');await delay(250);assert(win.isFullScreen(),'Fullscreen alias reaches native window');
      await key('F11');await delay(250);assert(!win.isFullScreen(),'Fullscreen shortcut toggles back');
      console.log('PASS desktop defaults: split directions, per-split tabs, surface/pane/workspace numbers, zoom, terminal find and workspace switcher');

      fs.writeFileSync(process.env.CMUX_WINDOWS_CONFIG,JSON.stringify({shortcuts:{bindings:{splitRight:'ctrl+alt+d',newSurface:null}}}));
      await delay(900);
      const panelsBefore=await count();
      await key('d',['control']);await key('t',['control']);
      assert.equal(await count(),panelsBefore,'Old and unbound bindings do not fire through native menu accelerators');
      await key('d',['control','alt']);
      await waitFor(`document.querySelectorAll('.pane').length === ${panelsBefore+1}`);
      await key(',',['control']);
      await waitFor("[...document.querySelectorAll('.inspector button')].some(node=>node.textContent==='Keyboard Shortcuts')");
      await evaluate("[...document.querySelectorAll('.inspector button')].find(node=>node.textContent==='Keyboard Shortcuts').click()");
      await waitFor("document.querySelector('.shortcut-dialog[open]') !== null");
      await delay(250);
      assert(await evaluate("document.querySelector('.shortcut-dialog').getBoundingClientRect().width > 500"),'Shortcut editor is visibly rendered');
      const output=path.resolve(__dirname,'../test-output');fs.mkdirSync(output,{recursive:true});
      fs.writeFileSync(path.join(output,'keyboard-shortcuts.png'),(await win.webContents.capturePage()).toPNG());
      await evaluate("document.querySelector('[data-shortcut-action=newSurface] input').value='[\"ctrl+b\",\"c\"]';document.querySelector('[data-shortcut-action=newSurface] button').click()");
      await delay(300);
      assert.deepEqual(JSON.parse(fs.readFileSync(process.env.CMUX_WINDOWS_CONFIG,'utf8')).shortcuts.bindings.newSurface,['ctrl+b','c'],'Settings writes the shared cmux.json binding');
      await key('Escape');
      await evaluate("document.querySelector('.pane .xterm-helper-textarea').focus()");
      const tabsBefore=await evaluate("document.querySelectorAll('.pane-tab').length");
      await key('b',['control']);await key('c');
      await waitFor(`document.querySelectorAll('.pane-tab').length === ${tabsBefore+1}`);
      win.webContents.send('cmux-command','terminal.new');
      await waitFor(`document.querySelectorAll('.pane-tab').length === ${tabsBefore+2}`);
      console.log('PASS desktop configuration: live rebind, unbind, editable Settings, two-stroke chord and shared native menu action');

      const workspace=(await api('/api/state',undefined,'GET')).activeWorkspaceId;
      await api('/api/panels',{workspaceId:workspace,type:'browser',url:`http://127.0.0.1:${fixture.address().port}/`});
      let guest;
      for(let i=0;i<80;i++){guest=webContents.getAllWebContents().find(contents=>contents.getType()==='webview' && contents.getTitle()==='Shortcut fixture');if(guest)break;await delay(100);}
      assert(guest,'Browser fixture must load');
      function guestKey(code,modifiers=[]) {guest.focus();guest.sendInputEvent({type:'keyDown',keyCode:code,modifiers});guest.sendInputEvent({type:'keyUp',keyCode:code,modifiers});}
      const hits=fixtureHits;guestKey('r',['control']);
      for(let i=0;i<50 && fixtureHits===hits;i++)await delay(100);
      assert(fixtureHits>hits,'Browser reload uses browser action instead of terminal rename');
      await delay(250);
      const hardHits=fixtureHits;guestKey('R',['control','shift']);
      for(let i=0;i<50 && fixtureHits===hardHits;i++)await delay(100);
      assert(fixtureHits>hardHits,'Hard reload reaches the trusted guest native action');
      await delay(250);
      guestKey('=',['control']);await delay(250);assert(guest.getZoomFactor()>1,'Browser zoom changes guest scale');
      guestKey('0',['control']);await delay(250);assert.equal(guest.getZoomFactor(),1,'Browser zoom reset restores 100%');
      assert.equal(await evaluate(`window.cmuxNative.nativeShortcut('showBrowserJavaScriptConsole',${guest.id})`),true,'Console action opens the guest JavaScript console');
      assert(guest.isDevToolsOpened());
      assert.equal(await guest.devToolsWebContents.executeJavaScript("typeof DevToolsAPI.showPanel"),'function');
      guest.closeDevTools();
      await evaluate("document.getElementById('closeInspectorButton').click()");
      await delay(300);
      guestKey(',',['control']);
      await waitFor("document.getElementById('shell').classList.contains('inspector-open')");
      guestKey('l',['control']);
      await waitFor("document.activeElement.classList.contains('browser-address')");
      const browserPanels=await count();guestKey('d',['control','alt']);
      await waitFor(`document.querySelectorAll('.pane').length === ${browserPanels+1}`);
      assert.equal(errors.length,0,errors.join('\n'));
      console.log('PASS browser guest shortcuts: contextual reload, address focus and live rebound app shortcut from guest focus');
    } catch (error) { failed=true; console.error(error.stack || error); }
    finally {
      clearTimeout(deadline);
      fixture.close();
      win.destroy();
      app.quit();
    }
  });
});
app.on('window-all-closed', () => {});
app.on('will-quit', event => { if (failed) { event.preventDefault(); app.exit(1); } });
require('../src/main.cjs');
