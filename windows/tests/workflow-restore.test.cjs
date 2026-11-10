const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
process.env.CMUX_WINDOWS_DISABLE_PTY = "1";
const { createCmuxWindowsRuntime } = require("../src/server.cjs");

test("agent hook setup preserves existing hooks and can be repeated", () => {
  const { setupAgentHooks } = require("../src/agent-hooks.cjs");
  const { parse } = require("jsonc-parser");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-test-hooks-"));
  const previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = directory;
  try {
    const file = path.join(directory, "hooks.json");
    fs.writeFileSync(file, `{
      // User configuration
      "hooks": {"SessionStart": [
        // Keep the existing start hook
        {"matcher":"startup","hooks":[{"type":"command","command":"existing"}]}
      ]}
    }`);
    const launcher = path.join(directory, "cmux.cmd");
    assert.equal(setupAgentHooks("codex", launcher), file);
    const source = fs.readFileSync(file, "utf8");
    assert.match(source, /Keep the existing start hook/);
    const { hooks } = parse(source);
    assert.equal(hooks.SessionStart.length, 2);
    assert.equal(hooks.SessionStart[0].hooks[0].command, "existing");
    assert.equal(hooks.SessionEnd.length, 1);
    setupAgentHooks("codex", launcher);
    assert.equal(fs.readFileSync(file, "utf8"), source);
  } finally {
    if (previous === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

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

test("recovering a detached profile preserves its layout and imports it once", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-legacy-recovery-"));
  const profileId = "c5be7baa-9887-4402-a327-004578b2c5a4";
  const legacyPath = path.join(dataDir, profileId, "session.json");
  fs.mkdirSync(path.dirname(legacyPath));
  const legacy = JSON.stringify({
    rendererPort: 25100, activeWorkspaceId: "old",
    workspaces: [{ id: "old", title: "Earlier window", activePanelId: "second",
      panels: [{ id: "first", type: "terminal" }, { id: "second", type: "terminal" }, { id: "browser", type: "browser" }] }]
  });
  fs.writeFileSync(legacyPath, legacy);
  let runtime = createCmuxWindowsRuntime({ dataDir });
  try {
    const candidates = runtime.recoverableWindows();
    assert.equal(candidates[0].id, profileId);
    const tree = { type: "split", id: "split", direction: "down", ratio: 0.65,
      first: { type: "pane", panelId: "second" }, second: { type: "pane", panelId: "browser" } };
    const groups = [{ workspaceId: "old", members: ["first", "second"], active: "second" }];
    const recovered = runtime.recoverWindow(profileId, { trees: { old: tree }, groups });
    assert.equal(recovered.activeWorkspaceId, "old");
    assert.equal(runtime.activeWorkspace(recovered.id).activePanelId, "second");
    assert.deepEqual(runtime.activeWorkspace(recovered.id).layout.tree, tree);
    assert.deepEqual(runtime.activeWorkspace(recovered.id).layout.groups, groups);
    assert.equal(runtime.recoverWindow(profileId), null);
    runtime.close();
    runtime = createCmuxWindowsRuntime({ dataDir });
    assert.equal(runtime.recoverWindow(profileId), null);
    assert.equal(fs.readFileSync(legacyPath, "utf8"), legacy);
  } finally {
    runtime.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
