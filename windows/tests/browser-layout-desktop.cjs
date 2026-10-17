const {app,webContents} = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const http=require('node:http');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cmux-browser-layout-'));
process.env.APPDATA = profile;
process.env.CMUX_WINDOWS_CONFIG = path.join(profile, 'cmux.json');
process.env.CMUX_WINDOWS_PIPE = `\\\\.\\pipe\\cmux-browser-layout-${process.pid}`;
app.setPath('userData', path.join(profile, 'electron'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const fixture=http.createServer((_request,response)=>response.end('<!doctype html><title>Browser layout fixture</title><style>body{margin:0;background:#abcdef}footer{position:fixed;bottom:0}</style><footer>Viewport bottom</footer>'));
fixture.listen(0,'127.0.0.1');
let failed=false;
const deadline=setTimeout(()=>{console.error('Browser layout test timed out');app.exit(1);},60000);
app.once('browser-window-created',(_event,win)=>win.webContents.once('did-finish-load',async()=>{
  const evaluate=code=>win.webContents.executeJavaScript(code);
  async function waitFor(code){for(let n=0;n<80;n++){if(await evaluate(code))return;await delay(100);}throw Error('Timed out: '+code);}
  async function api(route,body,method='POST'){
    return evaluate(`(async()=>{const token=new URL(location.href).searchParams.get('token');const r=await fetch(${JSON.stringify(route)}+'?token='+encodeURIComponent(token),{method:${JSON.stringify(method)},headers:{'Content-Type':'application/json'},${body===undefined?'':`body:JSON.stringify(${JSON.stringify(body)}),`}});if(!r.ok)throw Error('API '+r.status);return r.json();})()`);
  }
  try{
    await waitFor("!!document.querySelector('.terminal-host')");
    const workspaceId=(await api('/api/state',undefined,'GET')).activeWorkspaceId;
    await api('/api/panels',{workspaceId,type:'browser',url:`http://127.0.0.1:${fixture.address().port}/`});
    let guest;
    for(let n=0;n<80;n++){guest=webContents.getAllWebContents().find(contents=>contents.getType()==='webview' && contents.getTitle()==='Browser layout fixture');if(guest)break;await delay(100);}
    assert(guest,'Local browser fixture loads');
    async function checkLayout(label){
      await delay(400);
      const bounds=await evaluate(`(()=>{const view=document.querySelector('.browser-view');const content=view.closest('.browser-content').getBoundingClientRect();const body=view.closest('.pane-body').getBoundingClientRect();const host=view.getBoundingClientRect();return {width:host.width,height:host.height,bottom:host.bottom,contentBottom:content.bottom,bodyBottom:body.bottom}})()`);
      for(let n=0;n<80;n++){guest=webContents.getAllWebContents().find(contents=>contents.getType()==='webview' && contents.getTitle()==='Browser layout fixture');if(guest)break;await delay(100);}
      assert(guest,label+': browser guest remains available');
      const viewport=await guest.executeJavaScript('({width:innerWidth,height:innerHeight})');
      assert(bounds.height>200,label+': browser has available pane height');
      assert(Math.abs(bounds.bottom-bounds.bodyBottom)<=2,label+': browser host fills pane bottom');
      assert(Math.abs(viewport.height-bounds.height)<=2,label+': guest viewport fills browser host '+JSON.stringify({bounds,viewport}));
      assert(Math.abs(viewport.width-bounds.width)<=2,label+': guest viewport fills browser width');
    }
    win.setSize(1280,800);await checkLayout('Initial window');
    win.setSize(1000,650);await checkLayout('Resized window');
    await api('/api/panels',{workspaceId,type:'terminal',direction:'down'});
    await checkLayout('Split pane');
    console.log('PASS browser layout: actual guest viewport fills pane height and width after window resizing and splitting');
  }catch(error){failed=true;console.error(error.stack||error);}
  finally{clearTimeout(deadline);fixture.close();win.destroy();app.quit();}
}));
app.on('will-quit',event=>{if(failed){event.preventDefault();app.exit(1);}});
require('../src/main.cjs');
