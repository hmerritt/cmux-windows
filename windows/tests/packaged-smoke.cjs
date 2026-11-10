// Verify the distributable with its packaged, in-process runtime and native PTY.
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const terminalCloseOnly = process.argv.includes('--pty-close-only');
const agentFixture = process.argv.includes('--codex-only') ? 'codex' : process.argv.includes('--claude-only') ? 'claude' : null;

(async () => {
  const lease = net.createServer();
  await new Promise(resolve => lease.listen(0, '127.0.0.1', resolve));
  const port = lease.address().port;
  await new Promise(resolve => lease.close(resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cmux-packaged-test-'));
  const binary = process.env.CMUX_TEST_BINARY || path.resolve(__dirname, '../release/win-unpacked/cmux.exe');
  const env = {...process.env, APPDATA:profile, CMUX_WINDOWS_CONFIG:path.join(profile,'cmux.json'), CMUX_WINDOWS_DATA_DIR:path.join(profile,'runtime'), CMUX_WINDOWS_PIPE:`\\\\.\\pipe\\cmux-packaged-test-${process.pid}`};
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CMUX_WINDOWS_NODE;
  delete env.CMUX_WINDOWS_DISABLE_PTY;
  const modelRequests = [];
  const model = agentFixture && http.createServer(async (request, response) => {
    const parts = [];
    for await (const part of request) parts.push(part);
    if (/\/(responses|messages)(\?|$)/.test(request.url)) modelRequests.push(Buffer.concat(parts).toString());
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Local fixture response' } }));
  });
  if (model) await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
  const modelOrigin = model && `http://127.0.0.1:${model.address().port}`;
  if (agentFixture === 'codex') {
    env.CODEX_HOME = path.join(profile, 'codex');
    env.CMUX_CODEX_TEST_KEY = 'test-key';
    fs.mkdirSync(env.CODEX_HOME);
    fs.writeFileSync(path.join(env.CODEX_HOME, 'config.toml'), [
      'model = "gpt-5"', 'model_provider = "fixture"', 'check_for_update_on_startup = false',
      '[model_providers.fixture]', 'name = "Local fixture"', `base_url = "${modelOrigin}/v1"`,
      'env_key = "CMUX_CODEX_TEST_KEY"', 'wire_api = "responses"',
      'request_max_retries = 0', 'stream_max_retries = 0',
      `[projects.${JSON.stringify(path.join(profile, 'repo'))}]`, 'trust_level = "trusted"', ''
    ].join('\n'));
  } else if (agentFixture === 'claude') {
    env.CLAUDE_CONFIG_DIR = path.join(profile, 'claude');
    delete env.ANTHROPIC_AUTH_TOKEN;
    env.ANTHROPIC_API_KEY = 'local-test-key';
    env.ANTHROPIC_BASE_URL = modelOrigin;
    env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
    fs.mkdirSync(env.CLAUDE_CONFIG_DIR);
    fs.writeFileSync(path.join(env.CLAUDE_CONFIG_DIR, '.claude.json'), JSON.stringify({
      hasCompletedOnboarding: true, theme: 'dark',
      projects: { [path.join(profile, 'repo').replaceAll('\\', '/')]: { hasTrustDialogAccepted: true } },
      customApiKeyResponses: { approved: [env.ANTHROPIC_API_KEY], rejected: [] }
    }));
  }
  const scale = process.env.CMUX_TEST_DEVICE_SCALE;
  let child, exited, socket, target;
  const pending = new Map();
  async function launch() {
    target = null;
    child = spawn(binary, [`--user-data-dir=${path.join(profile,'electron')}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1',
      ...(scale ? [`--force-device-scale-factor=${scale}`] : [])], {env, windowsHide:true, stdio:'ignore'});
    exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({code, signal})));
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
    socket.on('message', raw=>{
      const response=JSON.parse(raw);
      if (!response.id) return;
      const waiter=pending.get(response.id);
      if (!waiter) return;
      pending.delete(response.id);
      clearTimeout(waiter.timer);
      response.error ? waiter.reject(new Error(response.error.message)) : waiter.resolve(response.result);
    });
  }
  try {
    await launch();
    let id=0;
    function call(method,params={},sessionId) {
      return new Promise((resolve,reject)=>{
        const requestId=++id;
        const timer=setTimeout(()=>{pending.delete(requestId);reject(new Error(`CDP timeout: ${method}`));},15000);
        pending.set(requestId,{resolve,reject,timer});
        socket.send(JSON.stringify({id:requestId,method,params,sessionId}));
      });
    }
    async function evaluate(expression,sessionId) {
      const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
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
    async function terminalOutput(panelId, command, marker) {
      const pageUrl = new URL(target.url);
      const terminalUrl = new URL(`/terminal/${panelId}`, pageUrl);
      terminalUrl.protocol = 'ws:';
      terminalUrl.searchParams.set('token', pageUrl.searchParams.get('token'));
      const terminal = new WebSocket(terminalUrl, {origin:pageUrl.origin});
      let timeout;
      try {
        return await new Promise((resolve, reject) => {
          timeout = setTimeout(() => reject(new Error(`Terminal ${panelId} did not execute a command`)), 10000);
          terminal.once('error', reject);
          terminal.once('close', () => reject(new Error(`Terminal ${panelId} closed before producing output`)));
          terminal.once('open', () => {
            terminal.send(JSON.stringify({type:'input', data:command}));
          });
          let output = '';
          terminal.on('message', raw => {
            const message = JSON.parse(raw);
            if (message.type !== 'output') return;
            output += message.data;
            const match = marker.exec(output);
            if (match) resolve(match);
          });
        });
      } finally {
        clearTimeout(timeout);
        terminal.close();
      }
    }
    function verifyTerminal(panelId) {
      // cmd strips the caret, so the command echo cannot match the output marker.
      return terminalOutput(panelId, 'echo CMUX_PTY_^READY\r', /CMUX_PTY_READY/);
    }
    async function waitFor(check, label) {
      for (let i = 0; i < 160; i++) {
        const result = await check();
        if (result) return result;
        await delay(100);
      }
      throw new Error(`Timed out waiting for ${label}`);
    }
    function focusPane(workspaceId, panelId) {
      return waitFor(() => evaluate(`(() => {
        const row = document.querySelector('.workspace-row[data-workspace-id="${workspaceId}"]');
        if (!row) return false;
        if (!row.classList.contains('is-active')) { row.click(); return false; }
        if (document.querySelector('.pane.is-active[data-panel-id="${panelId}"]')) return true;
        document.querySelector('.surface-tab[data-panel-id="${panelId}"]')?.click();
        return false;
      })()`), 'focused packaged pane');
    }
    async function verifyPackagedSsh() {
      const workspace = await api('/api/workspaces/ssh', {
        destination: process.env.CMUX_TEST_SSH_DESTINATION,
        port: process.env.CMUX_TEST_SSH_PORT,
        identity: process.env.CMUX_TEST_SSH_IDENTITY
      });
      const connected = () => waitFor(async () => {
        const current = (await api('/api/state', undefined, 'GET')).workspaces.find(item => item.id === workspace.id);
        if (current?.ssh?.error) throw new Error(current.ssh.error);
        return current?.ssh?.state === 'connected' && current;
      }, 'packaged SSH workspace');
      const ssh = action => api(`/api/workspaces/${workspace.id}/ssh/${action}`);
      try {
        const { panels } = await connected();
        const panelId = panels.find(panel => panel.type === 'terminal').id;
        const pid = async label => (await terminalOutput(panelId,
          `printf 'CMUX_SSH_${label}_%s\\n' "$$"\r`, new RegExp(`CMUX_SSH_${label}_(\\d+)`)))[1];
        const before = await pid('BEFORE');
        const browser = await api('/api/panels', { workspaceId: workspace.id, type: 'browser', url: `http://localhost:${process.env.CMUX_TEST_SSH_HTTP_PORT}` });
        await focusPane(workspace.id, browser.id);
        const remotePage = await waitFor(async () => {
          const targets = await call('Target.getTargets');
          return targets.targetInfos.find(target => target.title === 'Remote SSH fixture');
        }, 'remote loopback browser page');
        const { sessionId } = await call('Target.attachToTarget', { targetId: remotePage.targetId, flatten: true });
        const http = () => evaluate("fetch(location.href,{cache:'no-store'}).then(response=>response.text())", sessionId);
        const webSocket = () => evaluate(`new Promise((resolve,reject)=>{
          const socket=new WebSocket(location.href.replace('http:','ws:'));
          socket.onmessage=event=>{socket.close();resolve(event.data)};
          socket.onerror=()=>reject(new Error('WebSocket failed'));
          setTimeout(()=>{socket.close();reject(new Error('WebSocket timed out'))},5000);
        })`, sessionId);
        assert.match(await http(), /remote-linux-loopback/);
        assert.equal(await webSocket(), 'remote-websocket');
        await ssh('disconnect');
        await assert.rejects(http());
        await assert.rejects(webSocket());
        await ssh('reconnect');
        await connected();
        assert.equal(await pid('AFTER'), before);
        assert.match(await http(), /remote-linux-loopback/);
        assert.equal(await webSocket(), 'remote-websocket');
        console.log('PASS packaged SSH: same Linux PID after reconnect, remote loopback HTTP and WebSocket, fail-closed disconnect');
      } finally {
        await api(`/api/workspaces/${workspace.id}`, undefined, 'DELETE');
      }
    }
    async function verifyPackagedAgent(agent) {
      const repo = path.join(profile, 'repo');
      fs.mkdirSync(repo);
      const git = (...args) => execFileSync('git', ['-C', repo, ...args], { windowsHide: true, stdio: 'pipe' });
      git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
      fs.writeFileSync(path.join(repo, 'review.txt'), 'old\n');
      git('add', '.'); git('commit', '-m', 'Review fixture');
      fs.writeFileSync(path.join(repo, 'review.txt'), 'new\n');
      const workspace = await api('/api/workspaces', { title: `Local ${agent} fixture`, cwd: repo });
      const panelId = workspace.panels[0].id;
      const diff = await api('/api/panels', { workspaceId: workspace.id, type: 'diff', cwd: repo });
      await api(`/api/panels/${diff.id}/review-comments`, { path: 'review.txt', side: 'new', line: 1, context: '+new', text: 'Packaged agent review fixture' });
      await terminalOutput(panelId, `cmux hooks setup ${agent}; Write-Output ('HOOK_' + 'READY')\r`, /HOOK_READY/);
      const agentHome = agent === 'codex' ? env.CODEX_HOME : env.CLAUDE_CONFIG_DIR;
      assert(fs.existsSync(path.join(agentHome, agent === 'codex' ? 'hooks.json' : 'settings.json')), 'Packaged CLI must install the agent hooks');
      const executable = (process.env[`CMUX_TEST_${agent.toUpperCase()}_EXE`] || agent).replaceAll("'", "''");
      const flags = agent === 'codex' ? '--dangerously-bypass-hook-trust --no-alt-screen' : '';
      await api(`/api/panels/${panelId}/focus`, {});
      await api('/api/input', { panelId, text: `& '${executable}' ${flags} 'Session hook fixture'\r` });
      await waitFor(async () => {
        const current = (await api('/api/state', undefined, 'GET')).workspaces.find(item => item.id === workspace.id);
        return current?.panels.find(panel => panel.id === panelId)?.liveAgent === agent;
      }, `${agent} SessionStart hook from the originating terminal`);
      const saved = await waitFor(() => {
        try {
          const snapshot = JSON.parse(fs.readFileSync(path.join(profile, 'runtime', 'session.json'), 'utf8'));
          return snapshot.workspaces.find(item => item.id === workspace.id)?.panels[0].agentSession;
        } catch { return null; }
      }, `saved native ${agent} session ID`);
      assert.match(saved.sessionId, /^[\da-f-]{36}$/i);
      assert.equal(saved.home, agentHome);
      console.log(`PASS packaged ${agent}: real CLI launched the installed hook and recorded its native session ID`);
      await waitFor(() => modelRequests.some(body => body.includes('Session hook fixture')), `${agent} initial model request`);
      await focusPane(workspace.id, panelId);
      await waitFor(() => evaluate("!!document.querySelector('.pane-review-chip:not([hidden])')"), 'pending review chip');
      await evaluate("document.querySelector('.pane-review-chip:not([hidden])').click()");
      await waitFor(() => evaluate("document.querySelector('.dialog-input')?.value.includes('Packaged agent review fixture')"), 'review composer preview');
      await evaluate("document.querySelector('.dialog-confirm').click()");
      await waitFor(() => modelRequests.some(body => body.includes('Packaged agent review fixture') && body.includes('new line 1')), `${agent} submitted review prompt`);
      await waitFor(async () => {
        const comments = await api(`/api/panels/${diff.id}/review-comments`, undefined, 'GET');
        return comments[0]?.delivery === 'sent';
      }, `${agent} review delivery record`);
      console.log(`PASS packaged ${agent} composer: review text and file/line context reached the agent`);

      const nativeExe = process.env[`CMUX_TEST_${agent.toUpperCase()}_EXE`];
      if (!nativeExe) return;
      const shimDir = path.join(profile, 'resume-bin');
      fs.mkdirSync(shimDir);
      const argsFile = path.join(profile, 'resume-args.txt');
      const quote = value => `"${value.replaceAll('%', '%%')}"`;
      fs.writeFileSync(path.join(shimDir, `${agent}.cmd`), [
        '@echo off', `>>${quote(argsFile)} echo %*`, `${quote(nativeExe)} ${flags} %*`, ''
      ].join('\r\n'));
      const pathKey = Object.keys(env).find(key => key.toUpperCase() === 'PATH') || 'Path';
      env[pathKey] = shimDir + path.delimiter + env[pathKey];
      await api('/api/session/agent-resume', { enabled: true }, 'PUT');
      await closePackagedWindow();
      await launch();
      await waitFor(() => fs.existsSync(argsFile) && fs.statSync(argsFile).size > 0, `${agent} native resume arguments`);
      if (agent === 'codex') {
        // Codex defers the resumed SessionStart hook until a new turn starts.
        await waitFor(async () => {
          try { return await evaluate("document.querySelector('.xterm-rows')?.textContent.includes('Ask Codex to do anything')"); }
          catch { return false; }
        }, 'Codex resumed prompt');
        await delay(1000);
        await api('/api/input', { panelId, text: 'Confirm the saved conversation is present' });
        await delay(250);
        await api('/api/input', { panelId, text: '\r' });
        await waitFor(() => modelRequests.some(body => body.includes('Confirm the saved conversation is present') &&
          body.includes('Packaged agent review fixture')), 'Codex resumed conversation history in the native request');
      }
      await waitFor(async () => {
        try {
          const current = (await api('/api/state', undefined, 'GET')).workspaces.find(item => item.id === workspace.id);
          return current?.panels.find(panel => panel.id === panelId)?.liveAgent === agent;
        } catch { return false; }
      }, `resumed native ${agent} session`);
      assert.deepEqual(fs.readFileSync(argsFile, 'utf8').trim().split(/\r?\n/), [
        `${agent === 'codex' ? 'resume' : '--resume'} ${saved.sessionId}`
      ]);
      console.log(`PASS packaged ${agent} restart: the native session resumed once with its saved ID`);
    }
    async function closePackagedWindow() {
      socket.send(JSON.stringify({ id: ++id, method: 'Runtime.evaluate', params: { expression: 'window.cmuxNative.closeWindow()' } }));
      let timer;
      try {
        const outcome = await Promise.race([exited, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Packaged window did not close')), 10000);
        })]);
        assert.deepEqual(outcome, { code: 0, signal: null });
      } finally { clearTimeout(timer); }
      socket.close();
    }
    async function startTerminalWorkspace(title) {
      const workspace = await api('/api/workspaces', {title, cwd:profile});
      const panels = [];
      for (let i = 0; i < 6; i++) {
        panels.push(await api('/api/panels', {workspaceId:workspace.id, type:'terminal', shellProfile:'cmd'}));
      }
      await Promise.all(panels.map(panel => verifyTerminal(panel.id)));
      return workspace.id;
    }
    async function verifyTerminalClose() {
      for (let i = 1; i <= 3; i++) {
        const workspaceId = await startTerminalWorkspace(`ConPTY workspace close ${i}`);
        assert.equal((await api(`/api/workspaces/${workspaceId}`, undefined, 'DELETE')).ok, true);
        const afterClose = await api('/api/state', undefined, 'GET');
        assert(!afterClose.workspaces.some(workspace => workspace.id === workspaceId), 'Workspace close must remove its terminals');
      }
      console.log('PASS packaged ConPTY: closed three workspaces with live terminals and started new shells between closes');

      await startTerminalWorkspace('ConPTY app quit');
      // The window can close before CDP delivers the command response.
      socket.send(JSON.stringify({id:++id, method:'Runtime.evaluate', params:{expression:'window.cmuxNative.closeWindow()'}}));
      let quitTimeout;
      const quitResult = await Promise.race([
        exited,
        new Promise((_, reject) => {
          quitTimeout = setTimeout(() => reject(new Error('Packaged app did not quit with live ConPTY terminals')), 10000);
        })
      ]).finally(() => clearTimeout(quitTimeout));
      assert.deepEqual(quitResult, {code:0, signal:null}, 'Packaged app must quit cleanly with live ConPTY terminals');
      console.log('PASS packaged ConPTY: quit cleanly with live terminals');
    }
    let loaded=false;
    for(let i=0;i<150;i++) {
      try { loaded=await evaluate("location.protocol==='http:' && document.readyState==='complete' && !!document.querySelector('.workspace-row') && !!new URL(location.href).searchParams.get('token')"); } catch {}
      if(loaded) break;
      await delay(100);
    }
    assert(loaded,'Packaged renderer must finish loading');
    await call('Page.bringToFront');
    const state=await api('/api/state',undefined,'GET');
    assert.equal(state.ptyAvailable,true,'Packaged native ConPTY must load');
    if (agentFixture) {
      try { await verifyPackagedAgent(agentFixture); }
      catch (error) {
        console.error(await evaluate("[...document.querySelectorAll('.xterm-rows')].map(rows=>rows.textContent.slice(-3000))"));
        throw error;
      }
      await closePackagedWindow();
      return;
    }
    if (process.argv.includes('--ssh-only')) {
      assert(process.env.CMUX_TEST_SSH_DESTINATION, 'Set the Linux SSH fixture connection variables');
      await verifyPackagedSsh();
      await closePackagedWindow();
      return;
    }
    if (terminalCloseOnly) {
      await verifyTerminalClose();
      return;
    }
    assert(await evaluate("typeof ImageAddon?.ImageAddon==='function' && typeof WebglAddon?.WebglAddon==='function'"),'Packaged renderer must load both terminal addons');
    const files=await evaluate(`window.cmuxNative.listWorkspaceFiles(${JSON.stringify(path.resolve(__dirname,'../..'))},'')`);
    assert(files.ok && files.entries.some(entry=>entry.name==='CLAUDE.md'),'Packaged file browser IPC must list the workspace');
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
    for (let i=0; i<100; i++) {
      if (await evaluate("!!document.querySelector('[data-setting-control=terminalRenderer]')")) break;
      await delay(100);
    }
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
    async function pointerClick(point,count=1){
      await call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
      for(let clickCount=1;clickCount<=count;clickCount++)for(const type of ['mousePressed','mouseReleased'])await call('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount});
      await delay(200);
    }
    async function tabWait(expression){for(let i=0;i<100;i++){if(await evaluate(expression))return;await delay(100);}throw Error('Packaged tabs: '+expression);}
    const tabCount=await evaluate("document.querySelectorAll('.pane-tab').length");
    const emptyBar=await evaluate("(()=>{const r=document.querySelector('.pane.is-active .pane-tab-strip').getBoundingClientRect();return {x:r.right-10,y:r.top+r.height/2}})()");
    await pointerClick(emptyBar);assert.equal(await evaluate("document.querySelectorAll('.pane-tab').length"),tabCount);
    await pointerClick(emptyBar,2);await tabWait(`document.querySelectorAll('.pane-tab').length===${tabCount+1}`);
    const renameLabel=await evaluate("(()=>{const r=document.querySelector('.pane.is-active .pane-tab.is-selected .pane-tab-label').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
    await pointerClick(renameLabel,2);await tabWait("!!document.querySelector('.inline-rename-input')");
    await call('Input.insertText',{text:'Packaged inline tab'});
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    await tabWait("document.querySelector('.pane.is-active .pane-tab.is-selected .pane-tab-label').textContent==='Packaged inline tab' && !document.querySelector('.inline-rename-input')");
    assert(await evaluate("getComputedStyle(document.querySelector('.pane-tab')).flexBasis==='160px' && getComputedStyle(document.querySelector('.pane.is-active .pane-tab.is-selected')).boxShadow.includes('2px')"));
    const workspaceCount=await evaluate("document.querySelectorAll('.workspace-row').length");
    const emptyList=await evaluate("(()=>{const r=document.getElementById('workspaceList').getBoundingClientRect();return {x:r.right-20,y:r.bottom-20}})()");
    await pointerClick(emptyList);assert.equal(await evaluate("document.querySelectorAll('.workspace-row').length"),workspaceCount);
    await pointerClick(emptyList,2);await tabWait(`document.querySelectorAll('.workspace-row').length===${workspaceCount+1}`);
    assert.equal(await evaluate("document.querySelectorAll('.pane-tab').length"),1);
    console.log('PASS packaged tab interactions: real pointer creation, inline rename, 160px width and active 2px indicator');
    const documentRoot=path.join(profile,'documents');
    fs.mkdirSync(documentRoot);
    fs.writeFileSync(path.join(documentRoot,'notes.md'),'# Packaged document\n\n![Local](local.png)\n\n```mermaid\nflowchart LR\nA --> B\n```\n');
    fs.appendFileSync(path.join(documentRoot,'notes.md'),'\n```vega-lite\n'+JSON.stringify({data:{values:[{category:'A',value:4},{category:'B',value:9}]},mark:'bar',encoding:{x:{field:'category',type:'nominal'},y:{field:'value',type:'quantitative'}}})+'\n```\n');
    fs.writeFileSync(path.join(documentRoot, 'review.txt'), 'original line\n');
    fs.copyFileSync(path.resolve(__dirname,'../src/assets/cmux.png'),path.join(documentRoot,'local.png'));
    const git=(...args)=>execFileSync('git',['-C',documentRoot,...args],{windowsHide:true,stdio:'pipe'});
    git('init');git('config','user.name','Test');git('config','user.email','test@example.invalid');
    git('add','.');git('commit','-m','Packaged fixture');
    fs.appendFileSync(path.join(documentRoot,'notes.md'),'\nPackaged change\n');
    fs.writeFileSync(path.join(documentRoot, 'review.txt'), 'changed line\n');
    const documents=await api('/api/workspaces',{title:'Packaged documents',cwd:documentRoot});
    await api('/api/panels',{workspaceId:documents.id,type:'markdown',cwd:documentRoot,filePath:'notes.md',title:'notes.md'});
    let documentReady=false;
    for(let i=0;i<150;i++) {
      documentReady=await evaluate("document.querySelector('.markdown-body h1')?.textContent==='Packaged document' && document.querySelector('.markdown-body img')?.naturalWidth>0 && !!document.querySelector('.document-diagram:not(.document-vega) svg') && !!document.querySelector('.document-vega svg') && !document.querySelector('iframe[src*=document-chart-frame]')");
      if(documentReady)break;
      await delay(100);
    }
    assert(documentReady,'Packaged Markdown, scoped local images, Mermaid and sandboxed Vega assets must render');
    const diffPanel = await api('/api/panels',{workspaceId:documents.id,type:'diff',cwd:documentRoot,title:'Git diff'});
    let diffReady=false;
    for(let i=0;i<100;i++) {
      diffReady=await evaluate("document.querySelector('.diff-patch')?.textContent.includes('+Packaged change')");
      if(diffReady)break;
      await delay(100);
    }
    assert(diffReady,'Packaged Git IPC and real diff pane must load');
    const preferences=await evaluate("window.cmuxNative.setDiffPreferences({layout:'split',wordWrap:true,wordDiffs:true,expandUnchanged:true,diffIndicators:'classic'})");
    assert(preferences.ok,'Packaged display preferences must save');
    let splitReady=false;
    for(let i=0;i<100;i++) {
      splitReady=await evaluate("document.querySelector('.diff-pane')?.dataset.diffLayout==='split' && document.querySelector('.diff-pane')?.dataset.expandUnchanged==='true' && document.querySelector('.diff-pane')?.dataset.diffIndicators==='classic' && !!document.querySelector('.diff-split-row .diff-old-line') && document.querySelector('.diff-patch').textContent.includes('# Packaged document')");
      if(splitReady)break;
      await delay(100);
    }
    assert(splitReady,'Packaged split diff layout and line numbers must render');
    assert.equal(JSON.parse(fs.readFileSync(path.join(profile,'cmux','diff-viewer','preferences.json'),'utf8')).layout,'split');

    await evaluate("document.querySelector('[data-git-path=\"review.txt\"]').click()");
    await tabWait("document.querySelector('.diff-patch').textContent.includes('+changed line')");
    for (const [side, kind] of [['old', 'removed'], ['new', 'added']]) {
      await evaluate(`document.querySelector('.diff-${kind} + .diff-review-add').click()`);
      await tabWait("!!document.querySelector('.dialog-input')");
      await evaluate(`document.querySelector('.dialog-input').value='Review ${side} line';document.querySelector('.dialog-confirm').click()`);
      await tabWait(`document.querySelector('.diff-patch').textContent.includes('Review ${side} line')`);
    }
    const reviewRoute = `/api/panels/${diffPanel.id}/review-comments`;
    const comments = await api(reviewRoute, undefined, 'GET');
    assert.deepEqual(comments.map(comment => comment.side), ['old', 'new']);
    const terminalReview = `/api/panels/${documents.panels[0].id}/review-comments`;
    assert.equal((await api(terminalReview, undefined, 'GET')).length, 2);
    fs.writeFileSync(path.join(documentRoot, 'review.txt'), 'updated after review\n');
    await tabWait("document.querySelector('.diff-review-outdated').textContent.includes('Review new line')");
    await api(`${reviewRoute}/${comments[1].id}`, undefined, 'DELETE');
    assert.equal((await api(reviewRoute, undefined, 'GET')).length, 1);
    await evaluate("document.querySelector('[data-git-path=\"notes.md\"]').click()");
    console.log('PASS packaged diff review: comments on both sides, pending batch, outdated anchor and deletion');

    git('branch','packaged-base','HEAD');
    fs.writeFileSync(path.join(documentRoot,'branch.txt'),'packaged branch content\n');git('add','branch.txt');git('commit','-m','Packaged branch fixture');
    git('add','notes.md');fs.appendFileSync(path.join(documentRoot,'notes.md'),'Packaged working content\n');
    await evaluate("{const source=document.querySelector('[data-diff-source]');source.value='staged';source.dispatchEvent(new Event('change',{bubbles:true}));}");
    let stagedReady=false;
    for(let i=0;i<100;i++) {
      stagedReady=await evaluate("document.querySelector('[data-diff-source]')?.value==='staged' && document.querySelector('.diff-patch')?.textContent.includes('Packaged change') && !document.querySelector('.diff-patch').textContent.includes('Packaged working content')");
      if(stagedReady)break;await delay(100);
    }
    assert(stagedReady,'Packaged staged source excludes working changes');
    await evaluate("{const source=document.querySelector('[data-diff-source]');source.value='branch';source.dispatchEvent(new Event('change',{bubbles:true}));}");
    for(let i=0;i<100;i++){if(await evaluate("document.querySelector('[data-diff-compare]').disabled===false && document.querySelector('[data-diff-base]').hidden===false"))break;await delay(100);}
    await evaluate("document.querySelector('[data-diff-base]').value='packaged-base';document.querySelector('[data-diff-compare]').click()");
    await tabWait("document.querySelector('.diff-base-status').textContent.includes('packaged-base') && !!document.querySelector('[data-git-path=\"branch.txt\"]')");
    await evaluate("document.querySelector('[data-git-path=\"branch.txt\"]').click()");
    let branchReady=false;
    for(let i=0;i<100;i++) {
      branchReady=await evaluate("document.querySelector('.diff-base-status').textContent.includes('packaged-base') && !!document.querySelector('[data-git-path=\"branch.txt\"]') && document.querySelector('.diff-patch').textContent.includes('packaged branch content')");
      if(branchReady)break;await delay(100);
    }
    assert(branchReady,'Packaged branch source includes committed changes from the selected merge base');

    await evaluate("document.querySelector('.diff-pane').focus()");
    await tabWait("document.activeElement.matches('.diff-pane')");
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'F',code:'KeyF',windowsVirtualKeyCode:70,modifiers:10});
    await call('Input.dispatchKeyEvent',{type:'keyUp',key:'F',code:'KeyF',windowsVirtualKeyCode:70,modifiers:10});
    let searchReady=false;
    for(let i=0;i<100;i++) {
      searchReady=await evaluate("document.activeElement.matches('.workspace-search-input')");
      if(searchReady)break;
      await delay(100);
    }
    assert(searchReady,'Packaged directory-search shortcut must focus its input');
    const sidebarGeometry=await evaluate(`(()=>{const dock=document.getElementById('inspector').getBoundingClientRect();return {width:dock.width,unobscured:[...document.querySelectorAll('.pane')].every(pane=>pane.getBoundingClientRect().right<=dock.left+1)}})()`);
    assert.equal(sidebarGeometry.width,295,'Packaged right sidebar uses the native default width');
    assert(sidebarGeometry.unobscured,'Packaged right sidebar must reserve space for live panes');
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
    const duplicated=await evaluate(`window.cmuxNative.duplicateWorkspaceEntry(${JSON.stringify(documentRoot)},'renamed.txt','%@ copy')`);
    assert(duplicated.ok,'Packaged duplicate IPC must load');
    assert.equal(fs.readFileSync(path.join(documentRoot,duplicated.path),'utf8'),'Packaged rename content');
    const trashed=await evaluate(`window.cmuxNative.trashWorkspaceEntry(${JSON.stringify(documentRoot)},${JSON.stringify(duplicated.path)})`);
    assert(trashed.ok,'Packaged Recycle Bin IPC must execute');
    assert(!fs.existsSync(path.join(documentRoot,duplicated.path)));
    assert.equal(fs.readFileSync(path.join(documentRoot,'renamed.txt'),'utf8'),'Packaged rename content');
    const screenshot=await call('Page.captureScreenshot',{format:'png'});
    fs.mkdirSync(path.resolve(__dirname,'../test-output'),{recursive:true});
    fs.writeFileSync(path.resolve(__dirname,'../test-output/packaged.png'),Buffer.from(screenshot.data,'base64'));
    await verifyTerminalClose();
    console.log('PASS packaged cmux.exe: ConPTY, WebGL, inline images, file IPC, keyboard split, Markdown, local images, Mermaid, sandboxed Vega, split Git diff and saved display preferences, directory search, file creation/rename/duplicate and Recycle Bin, clean close');
  } finally {
    model?.close();
    if (child?.exitCode === null && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ id: 0, method: 'Runtime.evaluate', params: { expression: 'window.cmuxNative.closeWindow()' } }));
      await Promise.race([exited, delay(3500)]);
    }
    socket?.close();
    if(child?.exitCode===null) {
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
