const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
process.env.CMUX_WINDOWS_DISABLE_PTY = "1";
const { createCmuxWindowsRuntime } = require("../src/server.cjs");

test("a live workspace moves to another window and the source loses access", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-window-transfer-"));
  const pipeName = process.platform === "win32"
    ? `\\\\.\\pipe\\cmux-window-transfer-${process.pid}`
    : path.join(dataDir, "cmux.sock");
  const runtime = createCmuxWindowsRuntime({ dataDir, pipeName });
  try {
    const { url, launchToken } = await runtime.listen(0);
    const request = (route, token, method = "GET", body) => fetch(new URL(route, url), {
      method, headers: { "x-local-token": token, "content-type": "application/json" },
      body: body && JSON.stringify(body)
    });
    const source = runtime.activeWorkspace();
    const panelId = source.activePanelId;
    const terminal = runtime.ensureTerminalProcess(source.panels[0]);
    const create = await request("/api/windows", launchToken, "POST");
    assert.equal(create.status, 201, "New Window creates a window on the same runtime");
    const { id: destination, token: destinationToken } = await create.json();
    const { token: sourceToken } = runtime.rendererWindow(source.windowId);
    const move = await request(`/api/workspaces/${source.id}/move-to-window`, sourceToken, "POST", { windowId: destination });
    assert.equal(move.status, 200);
    assert.equal(runtime.terminals.get(panelId), terminal);
    assert.deepEqual((await (await request("/api/state", sourceToken)).json()).workspaces, []);
    const destinationState = await (await request("/api/state", destinationToken)).json();
    assert.equal(destinationState.activeWorkspaceId, source.id);
    assert.equal(destinationState.workspaces[0].activePanelId, panelId);
    assert.equal((await request(`/api/panels/${panelId}`, sourceToken, "DELETE")).status, 404);
  } finally {
    runtime.close();
    await runtime.waitForPtyExits();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
