// Verify the distributable with its packaged, in-process runtime and native PTY.
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const lease = net.createServer();
  await new Promise(resolve => lease.listen(0, '127.0.0.1', resolve));
  const port = lease.address().port;
  await new Promise(resolve => lease.close(resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cmux-packaged-test-'));
  const binary = process.env.CMUX_TEST_BINARY || path.resolve(__dirname, '../release/win-unpacked/cmux.exe');
  const env = {...process.env, APPDATA:profile, CMUX_WINDOWS_CONFIG:path.join(profile,'cmux.json'), CMUX_WINDOWS_PIPE:`\\\\.\\pipe\\cmux-packaged-test-${process.pid}`};
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(binary, [`--user-data-dir=${path.join(profile,'electron')}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], {env, windowsHide:true, stdio:'ignore'});
  const exited = new Promise(resolve => child.once('exit', resolve));
  let socket;
  try {
    let target;
    for (let i=0; i<200; i++) {
      try {
        const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        target = targets.find(t=>t.type==='page' && t.url.startsWith('http://127.0.0.1:'));
        if (target) break;
      } catch {}
      if (child.exitCode !== null) throw new Error(`Packaged app exited early: ${child.exitCode}`);
      await delay(100);
    }
    assert(target, 'Packaged renderer must start');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
    const pending = new Map();
    let id=0;
    socket.on('message', raw=>{
      const response=JSON.parse(raw);
      if (!response.id) return;
      const waiter=pending.get(response.id);
      if (!waiter) return;
      pending.delete(response.id);
      clearTimeout(waiter.timer);
      response.error ? waiter.reject(new Error(response.error.message)) : waiter.resolve(response.result);
    });
    function call(method,params={}) {
      return new Promise((resolve,reject)=>{
        const requestId=++id;
        const timer=setTimeout(()=>{pending.delete(requestId);reject(new Error(`CDP timeout: ${method}`));},15000);
        pending.set(requestId,{resolve,reject,timer});
        socket.send(JSON.stringify({id:requestId,method,params}));
      });
    }
    async function evaluate(expression) {
      const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      return result.result.value;
    }
    async function api(route,body,method='POST') {
      return evaluate(`(async()=>{
        const token=new URL(location.href).searchParams.get('token');
        const response=await fetch(${JSON.stringify(route)}+'?token='+encodeURIComponent(token),{
          method:${JSON.stringify(method)}, headers:{'Content-Type':'application/json'},
          ${body===undefined?'':`body:JSON.stringify(${JSON.stringify(body)}),`}
        });
        if(!response.ok) throw new Error('API status '+response.status);
        return response.json();
      })()`);
    }
    let loaded=false;
    for(let i=0;i<150;i++) {
      try { loaded=await evaluate("location.protocol==='http:' && document.readyState==='complete' && !!document.querySelector('.workspace-row') && !!new URL(location.href).searchParams.get('token')"); } catch {}
      if(loaded) break;
      await delay(100);
    }
    assert(loaded,'Packaged renderer must finish loading');
    assert(await evaluate("typeof ImageAddon?.ImageAddon==='function' && typeof WebglAddon?.WebglAddon==='function'"),'Packaged renderer must load both terminal addons');
    const files=await evaluate(`window.cmuxNative.listWorkspaceFiles(${JSON.stringify(path.resolve(__dirname,'../..'))},'')`);
    assert(files.ok && files.entries.some(entry=>entry.name==='CLAUDE.md'),'Packaged file browser IPC must list the workspace');
    const state=await api('/api/state',undefined,'GET');
    assert.equal(state.ptyAvailable,true,'Packaged native ConPTY must load');
    await api('/api/workspaces',{title:'Packaged verification',cwd:path.resolve(__dirname,'../..')});
    let ready=false;
    for(let i=0;i<150;i++) {
      ready=await evaluate("!!document.querySelector('.xterm-screen') && (document.querySelector('.xterm-screen').textContent.includes('❯') || document.querySelector('.xterm-screen').textContent.includes('>'))");
      if(ready) break;
      await delay(100);
    }
    assert(ready,'Packaged terminal must reach a shell prompt');
    await api('/api/input',{text:"Write-Output ('CMUX_PACKAGED_' + 'VERIFIED')\r"});
    let rendered=false;
    for(let i=0;i<100;i++) {
      rendered=await evaluate("document.querySelector('.xterm-screen').textContent.includes('CMUX_PACKAGED_VERIFIED')");
      if(rendered) break;
      await delay(100);
    }
    assert(rendered,'Packaged ConPTY must execute a command and render its output');
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:',',code:'Comma',windowsVirtualKeyCode:188,modifiers:2});
    await call('Input.dispatchKeyEvent',{type:'keyUp',key:',',code:'Comma',windowsVirtualKeyCode:188,modifiers:2});
    for(let i=0;i<100;i++) {
      if(await evaluate("!!document.querySelector('[data-settings-category=terminal]')"))break;
      await delay(100);
    }
    await evaluate("document.querySelector('[data-settings-category=terminal]').click()");
    await evaluate("const select=document.querySelector('[data-setting-control=terminalRenderer]');select.value='webgl';select.dispatchEvent(new Event('change'));document.getElementById('closeInspectorButton').click()");
    let gpu=false;
    for(let i=0;i<100;i++) {
      gpu=await evaluate("document.querySelector('.terminal-host').dataset.renderer==='webgl'");
      if(gpu)break;
      await delay(100);
    }
    assert(gpu,'Packaged WebGL renderer must activate');
    const imagePath=path.resolve(__dirname,'../src/assets/cmux.png').replaceAll("'","''");
    await api('/api/input',{text:`$image=[IO.File]::ReadAllBytes('${imagePath}'); [Console]::Write(([char]27)+']1337;File=inline=1;width=32px;height=32px;size='+$image.Length+':'+[Convert]::ToBase64String($image)+[char]7)\r`});
    let image=false;
    for(let i=0;i<100;i++) {
      image=await evaluate("[...document.querySelectorAll('.xterm-image-layer')].some(canvas=>canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data.some((value,index)=>index%4===3 && value>0))");
      if(image)break;
      await delay(100);
    }
    assert(image,'Packaged image decoder and WebAssembly CSP must render inline image pixels');
    const paneCount=await evaluate("document.querySelectorAll('.pane').length");
    await evaluate("document.querySelector('.xterm-helper-textarea').focus()");
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'d',code:'KeyD',windowsVirtualKeyCode:68,modifiers:2});
    await call('Input.dispatchKeyEvent',{type:'keyUp',key:'d',code:'KeyD',windowsVirtualKeyCode:68,modifiers:2});
    let split=false;
    for(let i=0;i<100;i++) {
      split=await evaluate(`document.querySelectorAll('.pane').length===${paneCount+1}`);
      if(split)break;
      await delay(100);
    }
    assert(split,'Packaged Ctrl+D must create a split through the shipped shortcut module');
    const documentRoot=path.join(profile,'documents');
    fs.mkdirSync(documentRoot);
    fs.writeFileSync(path.join(documentRoot,'notes.md'),'# Packaged document\n\n![Local](local.png)\n\n```mermaid\nflowchart LR\nA --> B\n```\n');
    fs.copyFileSync(path.resolve(__dirname,'../src/assets/cmux.png'),path.join(documentRoot,'local.png'));
    const git=(...args)=>execFileSync('git',['-C',documentRoot,...args],{windowsHide:true,stdio:'pipe'});
    git('init');git('config','user.name','Test');git('config','user.email','test@example.invalid');
    git('add','.');git('commit','-m','Packaged fixture');
    fs.appendFileSync(path.join(documentRoot,'notes.md'),'\nPackaged change\n');
    const documents=await api('/api/workspaces',{title:'Packaged documents',cwd:documentRoot});
    await api('/api/panels',{workspaceId:documents.id,type:'markdown',cwd:documentRoot,filePath:'notes.md',title:'notes.md'});
    let documentReady=false;
    for(let i=0;i<150;i++) {
      documentReady=await evaluate("document.querySelector('.markdown-body h1')?.textContent==='Packaged document' && document.querySelector('.markdown-body img')?.naturalWidth>0 && !!document.querySelector('.document-diagram svg')");
      if(documentReady)break;
      await delay(100);
    }
    assert(documentReady,'Packaged Markdown, scoped local images and Mermaid assets must render');
    await api('/api/panels',{workspaceId:documents.id,type:'diff',cwd:documentRoot,title:'Git diff'});
    let diffReady=false;
    for(let i=0;i<100;i++) {
      diffReady=await evaluate("document.querySelector('.diff-patch')?.textContent.includes('+Packaged change')");
      if(diffReady)break;
      await delay(100);
    }
    assert(diffReady,'Packaged Git IPC and real diff pane must load');
    await evaluate("document.querySelector('.diff-pane').focus()");
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'F',code:'KeyF',windowsVirtualKeyCode:70,modifiers:10});
    await call('Input.dispatchKeyEvent',{type:'keyUp',key:'F',code:'KeyF',windowsVirtualKeyCode:70,modifiers:10});
    let searchReady=false;
    for(let i=0;i<100;i++) {
      searchReady=await evaluate("document.activeElement.matches('.workspace-search-input')");
      if(searchReady)break;
      await delay(100);
    }
    assert(searchReady,'Packaged directory-search shortcut must focus its input');
    await call('Input.insertText',{text:'Packaged change'});
    let matches=false;
    for(let i=0;i<100;i++) {
      matches=await evaluate("document.querySelector('.workspace-search-result')?.textContent.includes('Packaged change')");
      if(matches)break;
      await delay(100);
    }
    assert(matches,'Packaged directory search must execute ripgrep and render a real match');
    const created=await evaluate(`window.cmuxNative.createWorkspaceEntry(${JSON.stringify(documentRoot)},'','new.txt','file')`);
    assert(created.ok,'Packaged file creation IPC must load');
    fs.writeFileSync(path.join(documentRoot,'new.txt'),'Packaged rename content');
    const renamed=await evaluate(`window.cmuxNative.renameWorkspaceEntry(${JSON.stringify(documentRoot)},'new.txt','renamed.txt')`);
    assert(renamed.ok,'Packaged no-replace rename helper must execute');
    assert.equal(fs.readFileSync(path.join(documentRoot,'renamed.txt'),'utf8'),'Packaged rename content');
    const screenshot=await call('Page.captureScreenshot',{format:'png'});
    fs.mkdirSync(path.resolve(__dirname,'../test-output'),{recursive:true});
    fs.writeFileSync(path.resolve(__dirname,'../test-output/packaged.png'),Buffer.from(screenshot.data,'base64'));
    await evaluate('window.cmuxNative.closeWindow()');
    await Promise.race([exited,delay(10000).then(()=>{throw new Error('Packaged app did not close');})]);
    console.log('PASS packaged cmux.exe: ConPTY, WebGL, inline images, file IPC, keyboard split, Markdown, local images, Mermaid, Git diff, directory search, file creation/rename, clean close');
  } finally {
    socket?.close();
    if(child.exitCode===null) {
      child.kill();
      await Promise.race([exited,delay(5000)]);
    }
    const resolved=path.resolve(profile);
    if(path.dirname(resolved)===path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('cmux-packaged-test-')) {
      try { fs.rmSync(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:200}); }
      catch { console.error(`Test profile retained for diagnosis: ${profile}`); }
    }
  }
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
