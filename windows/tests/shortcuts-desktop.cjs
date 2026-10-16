const {app} = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cmux-shortcuts-'));
process.env.APPDATA = profile;
process.env.CMUX_WINDOWS_CONFIG = path.join(profile, 'cmux.json');
process.env.CMUX_WINDOWS_PIPE = `\\\\.\\pipe\\cmux-shortcuts-${process.pid}`;
app.setPath('userData', path.join(profile, 'electron'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const deadline = setTimeout(() => { console.error('Shortcut test timed out'); process.exit(1); }, 60000);
let failed = false;
app.on('browser-window-created', (_event, win) => {
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
    try {
      await waitFor("document.querySelector('.xterm-helper-textarea') !== null");
      win.focus(); win.webContents.focus();
      await evaluate("document.querySelector('.xterm-helper-textarea').focus()");
      const before = await evaluate("document.querySelectorAll('.pane').length");
      await key('d', ['control']);
      await waitFor(`document.querySelectorAll('.pane').length === ${before+1}`);
      assert.equal(await evaluate("document.querySelectorAll('.pane').length"), before+1, 'Ctrl+D splits the focused terminal instead of sending shell EOF');
      console.log('PASS desktop shortcut: Ctrl+D creates a split through real keyboard input');
    } catch (error) { failed=true; console.error(error.stack || error); }
    finally {
      clearTimeout(deadline);
      win.destroy();
      app.quit();
    }
  });
});
app.on('window-all-closed', () => {});
app.on('will-quit', event => { if (failed) { event.preventDefault(); app.exit(1); } });
require('../src/main.cjs');
