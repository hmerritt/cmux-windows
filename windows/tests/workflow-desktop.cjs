const { app, BrowserWindow, webContents } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { once } = require("node:events");
const assert = require("node:assert/strict");

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-workflow-desktop-"));
process.env.CMUX_WINDOWS_DATA_DIR = path.join(profile, "runtime");
process.env.CMUX_WINDOWS_CONFIG = path.join(profile, "cmux.json");
process.env.CMUX_WINDOWS_PIPE = `\\\\.\\pipe\\cmux-workflow-${process.pid}`;
app.setPath("userData", path.join(profile, "electron"));
const fixture = http.createServer((request, response) => {
  response.setHeader("Content-Type", "text/html");
  response.end(`<title>Workflow fixture</title><input id="edit"><button id="save" onclick="document.body.dataset.clicked='yes'">Save</button><p>${request.url}</p>`);
});
fixture.listen(0, "127.0.0.1");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(check, label) {
  for (let i = 0; i < 180; i++) {
    const value = await check();
    if (value) return value;
    await delay(100);
  }
  throw new Error("Timed out waiting for " + label);
}

async function request(window, route, method = "GET", body) {
  const url = new URL(window.webContents.getURL());
  const response = await fetch(new URL(route, url), {
    method,
    headers: { origin: url.origin, "x-local-token": url.searchParams.get("token"), "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return { status: response.status, body: await response.json() };
}

let failed = false;
const deadline = setTimeout(() => app.exit(1), 90000);
app.once("browser-window-created", (_event, source) => source.webContents.once("did-finish-load", async () => {
  try {
    const origin = `http://127.0.0.1:${fixture.address().port}`;
    const state = (await request(source, "/api/state")).body;
    const workspace = state.workspaces[0];
    const terminal = workspace.panels[0];
    const credential = path.join(profile, "credential.txt").replaceAll("'", "''");
    await request(source, "/api/input", "POST", {
      panelId: terminal.id, text: `[IO.File]::WriteAllText('${credential}', $env:CMUX_WINDOWS_PANEL_TOKEN + ' ' + $PID)\r`
    });
    await until(() => fs.existsSync(credential), "source terminal credential");
    const [token, pid] = fs.readFileSync(credential, "utf8").trim().split(" ");
    const cli = async (...args) => (await promisify(execFile)(process.execPath, [path.join(__dirname, "../src/cli.cjs"), "browser", ...args], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", CMUX_WINDOWS_PANEL_TOKEN: token, CMUX_PANEL_ID: terminal.id },
      windowsHide: true
    })).stdout.trim();
    await assert.rejects(cli("open", origin), /disabled/);
    await request(source, `/api/workspaces/${workspace.id}`, "PATCH", { browserAutomation: true });
    const opened = JSON.parse(await cli("open", origin + "/first"));
    const ref = opened.surface_ref;
    await cli(ref, "navigate", origin + "/second");
    await cli(ref, "back");
    await cli(ref, "wait", "--url-contains", "/first", "--load-state", "complete");
    await cli(ref, "forward");
    await cli(ref, "wait", "--url-contains", "/second", "--load-state", "complete");
    await cli(ref, "reload");
    await cli(ref, "wait", "--selector", "#edit");
    assert.equal(await cli("--surface", ref, "url"), origin + "/second");
    const snapshot = await cli(ref, "snapshot");
    assert.match(snapshot, /Workflow fixture/);
    const buttonRef = /button Save \[ref=([^\]]+)/.exec(snapshot)[1];
    await cli(ref, "click", buttonRef);
    assert.equal(await cli(ref, "eval", "document.body.dataset.clicked"), "yes");
    await cli(ref, "fill", "#edit", "--text", "live");
    await cli(ref, "type", "#edit", " form");
    await cli(ref, "press", "End");
    const screenshot = path.join(profile, "browser.png");
    await cli(ref, "screenshot", "--out", screenshot);
    assert.equal(fs.readFileSync(screenshot).subarray(1, 4).toString(), "PNG");
    const guest = webContents.fromId(opened.id);
    const originalForm = await guest.executeJavaScript("document.querySelector('#edit').value");
    assert.equal(originalForm, "live form");
    const split = JSON.parse(await cli("open-split", origin + "/split"));
    const identified = JSON.parse(await cli("--surface", split.surface_ref, "identify"));
    assert.match(JSON.stringify(identified), new RegExp(split.surface_ref));
    const originalLocation = await cli(ref, "url");
    await cli(ref, "eval", "location.hash = 'updated'");
    await cli(ref, "wait", "--url-contains", "#updated");
    assert.equal(await cli(ref, "url"), originalLocation + "#updated");
    await assert.rejects(cli(ref, "click", buttonRef), /expired|snapshot/i);
    const created = once(app, "browser-window-created");
    await source.webContents.executeJavaScript("window.cmuxNative.nativeShortcut('newWindow')");
    const [, destination] = await created;
    const targetState = (await request(destination, "/api/state")).body;
    source.focus();
    source.webContents.focus();
    const moveButton = `[data-move-workspace-window="${targetState.windowId}"]`;
    await until(() => source.webContents.executeJavaScript(`(() => {
      const row = document.querySelector('[data-workspace-id="${workspace.id}"]');
      if (!row) return false;
      row.focus();
      row.dispatchEvent(new KeyboardEvent('keydown', {key:'F10',shiftKey:true,bubbles:true,cancelable:true}));
      return document.activeElement.matches(${JSON.stringify(moveButton)});
    })()`), "keyboard Move to Window action");
    await source.webContents.executeJavaScript("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',bubbles:true,cancelable:true}))");
    await until(async () => (await request(destination, "/api/state")).body.workspaces.some(item => item.id === workspace.id), "workspace move");
    assert.equal((await request(source, `/api/panels/${terminal.id}`, "DELETE")).status, 404);
    const sourceClosed = once(source, "closed");
    source.close();
    await sourceClosed;
    await until(() => destination.webContents.executeJavaScript("!!document.querySelector('.browser-view')"), "destination browser pane");
    assert.equal(await guest.executeJavaScript("document.querySelector('#edit').value"), originalForm);
    const output = path.join(profile, "destination-pid.txt");
    await request(destination, "/api/input", "POST", {
      panelId: terminal.id, text: `[IO.File]::WriteAllText('${output.replaceAll("'", "''")}', [string]$PID)\r`
    });
    await until(() => fs.existsSync(output), "destination terminal input");
    assert.equal(fs.readFileSync(output, "utf8"), pid);
    console.log("PASS live window transfer, renderer credential revocation and browser CLI against a local fixture");
    if (process.env.CMUX_TEST_SSH_DESTINATION) {
      await verifySsh(destination);
    }
  } catch (error) {
    failed = true;
    console.error(error);
  } finally {
    clearTimeout(deadline);
    fixture.close();
    app.quit();
  }
}));

async function verifySsh(window) {
  const destination = process.env.CMUX_TEST_SSH_DESTINATION;
  const port = process.env.CMUX_TEST_SSH_PORT;
  const identity = process.env.CMUX_TEST_SSH_IDENTITY;
  const address = `http://localhost:${process.env.CMUX_TEST_SSH_HTTP_PORT}`;
  const created = await request(window, "/api/workspaces/ssh", "POST", { destination, port, identity });
  assert.equal(created.status, 200);
  const workspace = created.body;
  const connection = async () => (await request(window, "/api/state")).body.workspaces.find(item => item.id === workspace.id)?.ssh;
  const connected = () => until(async () => {
    const status = await connection();
    if (status?.error) throw new Error(status.error);
    return status?.state === "connected";
  }, "SSH connection");
  const ssh = action => request(window, `/api/workspaces/${workspace.id}/ssh/${action}`, "POST");
  try {
    await connected();
    const response = await request(window, "/api/panels", "POST", {
      workspaceId: workspace.id, type: "browser", url: address
    });
    assert.equal(response.status, 200);
    const guest = await until(() => webContents.getAllWebContents().find(contents => contents.getTitle() === "Remote SSH fixture"), "SSH browser");
    const verifyHttp = () => guest.executeJavaScript(`fetch(location.href, {cache:'no-store'}).then(response=>response.text())`);
    const verifyWebSocket = () => guest.executeJavaScript(`new Promise((resolve,reject) => {
      const socket = new WebSocket(location.href.replace('http:', 'ws:'));
      socket.onmessage = event => { socket.close(); resolve(event.data); };
      socket.onerror = () => reject(new Error('WebSocket failed'));
      setTimeout(() => { socket.close(); reject(new Error('WebSocket timed out')); }, 5000);
    })`);
    assert.match(await verifyHttp(), /remote-linux-loopback/);
    assert.equal(await verifyWebSocket(), "remote-websocket");
    await ssh("disconnect");
    await assert.rejects(verifyHttp());
    await assert.rejects(verifyWebSocket());
    await ssh("reconnect");
    await connected();
    assert.match(await verifyHttp(), /remote-linux-loopback/);
    assert.equal(await verifyWebSocket(), "remote-websocket");
    console.log("PASS Linux SSH workspace forwards loopback HTTP and WebSocket through Chromium and blocks requests while disconnected");
  } finally {
    await request(window, `/api/workspaces/${workspace.id}`, "DELETE");
  }
}

app.on("will-quit", event => {
  if (failed) {
    event.preventDefault();
    app.exit(1);
  }
});
require("../src/main.cjs");
