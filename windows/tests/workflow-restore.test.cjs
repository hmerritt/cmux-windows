const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
process.env.CMUX_WINDOWS_DISABLE_PTY = "1";
const { createCmuxWindowsRuntime } = require("../src/server.cjs");

test("a restart preserves safe terminal history before fresh shell output", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-workflow-restore-"));
  let runtime = createCmuxWindowsRuntime({ dataDir });
  try {
    const panel = runtime.activeWorkspace().panels[0];
    const terminal = runtime.ensureTerminalProcess(panel);
    terminal.emitOutput("\x1b]52;c;Zm9v\x07\x1b[31mSaved line\x1b[0m\r\n");
    runtime.close();
    runtime = createCmuxWindowsRuntime({ dataDir });
    const restored = runtime.ensureTerminalProcess(runtime.findPanel(panel.id).panel);
    const output = [];
    restored.attach({ send: data => output.push(JSON.parse(data).data), on() {}, close() {} });
    assert.match(output[0], /Saved line/);
    assert.doesNotMatch(output[0], /\x1b|Zm9v/);
  } finally {
    runtime.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
