const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
process.env.CMUX_WINDOWS_DISABLE_PTY = '1';
const {createCmuxWindowsRuntime} = require('../src/server.cjs');

function fixture(run) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmux-terminal-metadata-'));
  const runtime = createCmuxWindowsRuntime({dataDir});
  const first = path.join(dataDir, 'first folder Ω');
  const second = path.join(dataDir, 'second');
  fs.mkdirSync(first); fs.mkdirSync(second);
  try { run(runtime, {dataDir, first, second}); }
  finally { runtime.close(); fs.rmSync(dataDir, {recursive:true, force:true}); }
}

test('workspace path follows focus, close, transfer, nonterminal tabs and fallback', () => fixture((runtime, {first, second}) => {
  const workspace = runtime.createWorkspaceFromOptions({cwd:first});
  const a = workspace.panels[0];
  const b = runtime.createPanel(workspace.id, 'terminal', {cwd:second});
  const view = () => runtime.serializeWorkspace(workspace);
  runtime.focusPanel(a.id);
  assert.equal(view().cwd, first);
  runtime.focusPanel(b.id);
  assert.equal(view().cwd, second);
  for (const type of ['browser', 'markdown', 'diff']) {
    const panel = runtime.createPanel(workspace.id, type, {cwd:first});
    runtime.focusPanel(panel.id);
    assert.equal(view().cwd, first, type);
    runtime.closePanel(panel.id);
  }
  runtime.focusPanel(b.id);
  runtime.closePanel(b.id);
  assert.equal(view().cwd, first);
  const target = runtime.createWorkspaceFromOptions({cwd:second});
  runtime.movePanel(a.id, target.id);
  assert.equal(runtime.serializeWorkspace(target).cwd, first);
  a.cwd = '';
  assert.equal(runtime.serializeWorkspace(target).cwd, second);
}));

test('automatic titles use directory names and ignore shell titles; custom titles reset and restore', () => fixture((runtime, {dataDir, first, second}) => {
  const workspace = runtime.createWorkspaceFromOptions({cwd:first});
  const a = workspace.panels[0];
  assert.equal(a.title, path.basename(first));
  const terminal = runtime.ensureTerminalProcess(a);
  const report = '\x1b]7;' + pathToFileURL(second).href + '\x07';
  terminal.emitOutput(report.slice(0, 8)); terminal.emitOutput(report.slice(8));
  terminal.emitOutput('\x1b]0;Shell title\x07');
  assert.equal(a.title, 'second');
  runtime.updatePanel(a.id, {title:'My terminal'});
  terminal.emitOutput('\x1b]9;9;"' + first + '"\x1b\\');
  assert.equal(a.title, 'My terminal');
  runtime.updatePanel(a.id, {title:''});
  assert.equal(a.title, path.basename(first));
  runtime.restartPanel(a.id);
  assert.equal(a.title, path.basename(first));
  const b = runtime.createPanel(workspace.id, 'terminal', {cwd:second, title:'Keep me'});
  runtime.focusPanel(b.id);
  runtime.ensureTerminalProcess(a).emitOutput(report);
  assert.equal(a.title, 'second');
  assert.equal(runtime.serializeWorkspace(workspace).cwd, second);
  runtime.focusPanel(a.id);
  runtime.ensureTerminalProcess(b).emitOutput('\x1b]9;9;"' + first + '"\x07');
  assert.equal(runtime.serializeWorkspace(workspace).cwd, second, 'background reports do not replace focused path');
  runtime.persistSession();
  const saved = JSON.parse(fs.readFileSync(runtime.sessionFile, 'utf8'));
  saved.workspaces.find(w => w.id === workspace.id).panels.find(p => p.id === a.id).title = 'Legacy shell title';
  fs.writeFileSync(runtime.sessionFile, JSON.stringify(saved));
  const restored = createCmuxWindowsRuntime({dataDir});
  try {
    const view = restored.serializedState().workspaces.find(w => w.id === workspace.id);
    assert.equal(view.cwd, second);
    assert.equal(view.panels.find(p => p.id === a.id).title, 'second');
    assert.equal(view.panels.find(p => p.id === b.id).title, 'Keep me');
  } finally { restored.close(); }
}));

test('drive roots retain a usable automatic terminal title', () => fixture((runtime, {first}) => {
  const root = path.parse(first).root;
  const workspace = runtime.createWorkspaceFromOptions({cwd:root});
  assert.equal(workspace.panels[0].title, root);
}));
