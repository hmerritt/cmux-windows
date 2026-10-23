// Run with Electron; all shells and session state belong to a disposable profile.
const {app} = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cmux-terminal-paths-'));
process.env.APPDATA = profile;
process.env.CMUX_WINDOWS_CONFIG = path.join(profile, 'cmux.json');
process.env.CMUX_WINDOWS_PIPE = `\\\\.\\pipe\\cmux-terminal-paths-${process.pid}`;
app.setPath('userData', path.join(profile, 'electron'));
const first = path.join(profile, 'first folder Ω');
const second = path.join(profile, 'second');
fs.mkdirSync(first); fs.mkdirSync(second);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let failed = false;
const deadline = setTimeout(() => { console.error('Terminal metadata test timed out'); app.exit(1); }, 90000);
app.once('browser-window-created', (_event, win) => win.webContents.once('did-finish-load', async () => {
  const evaluate = code => win.webContents.executeJavaScript(code);
  async function waitFor(code) {
    for (let i = 0; i < 150; i++) { if (await evaluate(code)) return; await delay(100); }
    throw Error(`Timed out: ${code}`);
  }
  async function api(route, body, method = 'POST') {
    return evaluate(`(async()=>{const token=new URL(location.href).searchParams.get('token');
      const response=await fetch(${JSON.stringify(route)}+'?token='+token,{method:${JSON.stringify(method)},headers:{'Content-Type':'application/json'},body:${body === undefined ? 'undefined' : JSON.stringify(JSON.stringify(body))}});
      if(!response.ok)throw Error(await response.text());return response.json();})()`);
  }
  const tab = panel => `.pane-tab[data-tab-panel-id="${panel.id}"]`;
  async function focus(panel) {
    await evaluate(`document.querySelector(${JSON.stringify(tab(panel))}).click()`);
    await waitFor(`document.querySelector(${JSON.stringify(tab(panel))})?.closest('.pane').classList.contains('is-active')`);
  }
  async function send(panel, command) {
    await evaluate(`new Promise((resolve,reject)=>{const url=new URL('/terminal/${panel.id}',location.href);url.protocol='ws:';url.search=location.search;
      const socket=new WebSocket(url);socket.onerror=()=>reject(Error('Terminal socket failed'));socket.onopen=()=>{socket.send(JSON.stringify({type:'input',data:${JSON.stringify(command + '\r')}}));setTimeout(()=>{socket.close();resolve();},100);};})`);
  }
  const label = panel => `document.querySelector(${JSON.stringify(tab(panel) + ' .pane-tab-label')})?.textContent`;
  const subtitle = `document.querySelector('.workspace-row.is-active .workspace-path')?.textContent`;
  try {
    win.setSize(1280, 800);
    await waitFor("!!document.querySelector('.workspace-row')");
    const workspace = await api('/api/workspaces', {cwd:first});
    const a = workspace.panels[0];
    const b = await api('/api/panels', {workspaceId:workspace.id, type:'terminal', cwd:second, shellProfile:'cmd'});
    const ps = await api('/api/panels', {workspaceId:workspace.id, type:'terminal', cwd:first, shellProfile:'powershell'});
    await api(`/api/workspaces/${workspace.id}/focus`, {});
    await waitFor(`${label(a)}==='first folder Ω' && ${label(b)}==='second'`);
    assert(await evaluate(`document.querySelector(${JSON.stringify(tab(a))}).title.includes(${JSON.stringify(first)})`));
    await focus(b);
    await waitFor(`${subtitle}.endsWith('second')`);
    // Hold the focus request: the subtitle must change before server confirmation.
    await evaluate(`window.originalFetch=window.fetch;window.fetch=(url,options)=>String(url).includes('/focus')
      ? new Promise(resolve=>{window.releaseFocus=()=>resolve(window.originalFetch(url,options));}) : window.originalFetch(url,options);void 0;`);
    await focus(a);
    await waitFor(`${subtitle}.endsWith('first folder Ω') && document.getElementById('workspaceSubheading').textContent.endsWith('first folder Ω')`);
    const before = await api('/api/state', undefined, 'GET');
    assert.equal(before.workspaces.find(w => w.id === workspace.id).activePanelId, b.id);
    await waitFor('typeof window.releaseFocus === "function"');
    await evaluate('window.releaseFocus();window.fetch=window.originalFetch;void 0');
    await delay(200);
    // Exercise real prompt reporting in PowerShell and CMD, including a background tab.
    await send(ps, `Set-Location -LiteralPath '${second.replace(/'/g, "''")}'`);
    await waitFor(`${label(ps)}==='second'`);
    assert(await evaluate(`${subtitle}.endsWith('first folder Ω')`));
    await focus(ps);
    await waitFor(`${subtitle}.endsWith('second')`);
    await send(b, `cd /d "${first}"`);
    await waitFor(`${label(b)}==='first folder Ω'`);
    assert(await evaluate(`${subtitle}.endsWith('second')`));
    await api(`/api/panels/${ps.id}`, {title:'My terminal'}, 'PATCH');
    await send(ps, `Set-Location -LiteralPath '${first.replace(/'/g, "''")}'`);
    await waitFor(`${label(ps)}==='My terminal' && ${subtitle}.endsWith('first folder Ω')`);
    await api(`/api/panels/${ps.id}`, {title:''}, 'PATCH');
    await waitFor(`${label(ps)}==='first folder Ω'`);
    const document = await api('/api/panels', {workspaceId:workspace.id, type:'markdown', cwd:second});
    await waitFor(`${subtitle}.endsWith('second')`);
    await api(`/api/panels/${document.id}`, undefined, 'DELETE');
    await waitFor(`${subtitle}.endsWith('first folder Ω')`);
    // Title settings continue to select the amount of detail.
    for (const mode of ['smart', 'folder', 'detailed', 'compact']) {
      await evaluate(`localStorage.setItem('cmux.settings',JSON.stringify({...JSON.parse(localStorage.getItem('cmux.settings')||'{}'),titleDetailMode:${JSON.stringify(mode)}}));location.reload()`);
      await waitFor(`${label(a)}?.includes('first folder Ω')`);
      if (mode === 'compact') assert.equal(await evaluate(label(a)), 'first folder Ω');
      await api(`/api/panels/${a.id}`, {title:'Custom'}, 'PATCH');
      await waitFor(`${label(a)}?.includes('Custom')`);
      await api(`/api/panels/${a.id}`, {title:''}, 'PATCH');
    }
    assert.equal((await api('/api/state', undefined, 'GET')).ptyAvailable, true, 'live checks use ConPTY');
    console.log('PASS terminal metadata: optimistic focus, split focus, full-path tooltips, PowerShell/CMD cd, background reports, custom/reset names, nonterminal paths and title modes');
  } catch (error) { failed = true; console.error(error.stack || error); }
  finally { clearTimeout(deadline); win.destroy(); app.quit(); }
}));
app.on('will-quit', event => { if (failed) { event.preventDefault(); app.exit(1); } });
require('../src/main.cjs');
