const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
process.env.CMUX_WINDOWS_DISABLE_PTY = "1";
const { createCmuxWindowsRuntime } = require("../src/server.cjs");

test("browser automation requires workspace consent and refuses another workspace", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-browser-auth-"));
  const runtime = createCmuxWindowsRuntime({ dataDir });
  try {
    const source = runtime.activeWorkspace();
    const caller = runtime.ensureTerminalProcess(source.panels[0]);
    const local = runtime.createPanel(source.id, "browser");
    const other = runtime.createWorkspace("Other");
    const foreign = runtime.createPanel(other.id, "browser");
    runtime.browserCommand = async panel => panel.url;
    const call = async surface => JSON.parse(await runtime.handlePipeLine(JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "browser.command", params: { command: "url", surface }
    }), { scope: "panel", panelId: caller.panel.id, panelToken: caller.panelToken }));
    assert.ok((await call(local.id)).error);
    runtime.updateWorkspace(source.id, { browserAutomation: true });
    assert.equal((await call(local.id)).result, local.url);
    assert.ok((await call(foreign.id)).error);
    runtime.updateWorkspace(source.id, { browserAutomation: false });
    assert.ok((await call(local.id)).error);
  } finally {
    runtime.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
