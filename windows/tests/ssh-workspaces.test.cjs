const test = require("node:test");
const assert = require("node:assert/strict");

test("SSH workspaces accept config aliases and keep the same PTY across reconnect", async () => {
  const { parseSshArgs, RemoteWorkspace } = require("../src/ssh-workspaces.cjs");
  const { EventEmitter } = require("node:events");
  const config = parseSshArgs(["build-box", "-p", "2222", "-i", "test key", "--name", "Build"]);
  assert.deepEqual(config, { destination: "build-box", port: 2222, identity: "test key", name: "Build" });
  assert.throws(() => parseSshArgs(["-oProxyCommand=echo"]), /destination/i);
  const attached = [];
  const connections = [];
  const connect = async () => {
    const bridge = new EventEmitter();
    bridge.close = () => bridge.emit("closed");
    bridge.call = async (method, params) => {
      if (method === "pty.attach") attached.push(params);
      return {};
    };
    connections.push(bridge);
    return bridge;
  };
  const workspace = new RemoteWorkspace({ ...config, slot: "fixture" }, { connect });
  const panel = { id: "terminal-1" };
  const terminal = { panel, cols: 100, rows: 30, emitOutput() {} };
  workspace.terminals.add(terminal);
  await workspace.reconnect();
  workspace.disconnect();
  await workspace.reconnect();
  assert.equal(attached.length, 2);
  assert.equal(attached[0].session_id, attached[1].session_id);
  assert.equal(attached[0].require_existing, false);
  assert.equal(attached[1].require_existing, true);
  assert.notEqual(attached[0].client_attachment_token, attached[1].client_attachment_token);
  assert.equal(connections.length, 2);
  workspace.disconnect();
});
