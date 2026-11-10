const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
const { createHash, randomUUID } = require("node:crypto");
const { StringDecoder } = require("node:string_decoder");
const path = require("node:path");
const manifest = require("./remote-daemon-manifest.json");

function validateSshConfig({ destination, port, identity, name, slot } = {}) {
  if (typeof destination !== "string" || destination.length > 255 ||
      !/^(?:[\w][\w.-]*@)?(?:[\w][\w.-]*|\[[0-9a-f:]+\])$/i.test(destination)) {
    throw new Error("Enter an SSH destination such as user@host or a config alias");
  }
  if (port !== undefined && (!/^\d+$/.test(String(port)) || +port < 1 || +port > 65535)) {
    throw new Error("SSH port must be between 1 and 65535");
  }
  if (identity !== undefined && (typeof identity !== "string" || !identity.trim() || /[\x00-\x1f]/.test(identity))) {
    throw new Error("Invalid SSH identity file");
  }
  if (slot !== undefined && (typeof slot !== "string" || !/^[\w-]{1,100}$/.test(slot))) {
    throw new Error("Invalid SSH workspace slot");
  }
  return {
    destination, ...(port === undefined ? {} : { port: +port }),
    ...(identity === undefined ? {} : { identity }),
    ...(typeof name === "string" && name.trim() ? { name: name.trim().slice(0, 80) } : {}),
    ...(slot ? { slot } : {})
  };
}

function parseSshArgs(args) {
  const [destination, ...options] = args;
  const config = validateSshConfig({ destination });
  for (let index = 0; index < options.length; index += 2) {
    const field = { "-p": "port", "--port": "port", "-i": "identity", "--identity": "identity", "--name": "name" }[options[index]];
    if (!field || !options[index + 1] || Object.hasOwn(config, field)) throw new Error("Invalid SSH options");
    config[field] = options[index + 1];
  }
  return validateSshConfig(config);
}

function sshProcess(config, command) {
  const args = ["-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
    "-o", "ClearAllForwardings=yes", "-o", "ConnectTimeout=10",
    "-o", "ServerAliveInterval=5", "-o", "ServerAliveCountMax=2"];
  if (config.port) args.push("-p", String(config.port));
  if (config.identity) args.push("-i", config.identity);
  const executable = process.platform === "win32"
    ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "OpenSSH", "ssh.exe") : "ssh";
  return spawn(executable, [...args, "--", config.destination, command], { stdio: "pipe", windowsHide: true });
}

function execSsh(config, command, input, signal) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const child = sshProcess(config, command);
    let stdout = "";
    let stderr = "";
    const stop = () => child.kill();
    const timeout = setTimeout(stop, 30000);
    signal?.addEventListener("abort", stop, { once: true });
    child.stdout.on("data", chunk => {
      stdout += chunk.toString("utf8");
      if (stdout.length > 8192) stop();
    });
    child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-2048); });
    child.stdin.on("error", () => {});
    child.once("error", reject);
    child.once("close", code => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", stop);
      if (code === 0 && !signal?.aborted) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || "SSH command did not complete"));
    });
    child.stdin.end(input);
  });
}

class DaemonBridge extends EventEmitter {
  constructor(child) {
    super();
    this.child = child;
    this.requests = new Map();
    this.sequence = 0;
    this.decoder = new StringDecoder("utf8");
    this.buffer = "";
    this.stderr = "";
    child.stdout.on("data", chunk => this.receive(this.decoder.write(chunk)));
    child.stderr.on("data", chunk => { this.stderr = (this.stderr + chunk).slice(-2048); });
    child.stdin.on("error", error => this.close(error));
    child.once("error", error => this.close(error));
    child.once("close", () => this.close(new Error(this.stderr.trim() || "SSH connection closed")));
  }

  receive(text) {
    this.buffer += text;
    while (this.buffer.includes("\n")) {
      const end = this.buffer.indexOf("\n");
      if (end > 2_000_000) return this.close();
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      let frame;
      try { frame = JSON.parse(line); } catch { return this.close(new Error("Invalid SSH daemon response")); }
      if (!frame || typeof frame !== "object") return this.close();
      if (frame.event) this.emit("event", frame);
      const pending = this.requests.get(frame.id);
      if (!pending) continue;
      clearTimeout(pending.timeout);
      this.requests.delete(frame.id);
      if (frame.ok) pending.resolve(frame.result);
      else pending.reject(new Error(frame.error?.message || "SSH daemon request failed"));
    }
    if (this.buffer.length > 2_000_000) this.close();
  }

  call(method, params = {}) {
    if (this.closed || this.requests.size >= 128) return Promise.reject(new Error("SSH daemon unavailable"));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timeout = setTimeout(() => this.close(new Error(`SSH daemon timed out: ${method}`)), 20000);
      this.requests.set(id, { resolve, reject, timeout });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }

  close(error = new Error("SSH disconnected")) {
    if (this.closed) return;
    this.closed = true;
    this.child.kill();
    for (const { reject, timeout } of this.requests.values()) {
      clearTimeout(timeout);
      reject(error);
    }
    this.requests.clear();
    this.emit("closed", error);
  }
}

const daemonPath = `"$HOME/.cmux/bin/windows-${manifest.releaseTag}/cmuxd-remote"`;

async function connectDaemon(config, signal) {
  const platform = await execSsh(config, "uname -s; uname -m", undefined, signal);
  const target = { "Linux\nx86_64": "linux-amd64", "Linux\naarch64": "linux-arm64" }[platform.replace(/\r/g, "")];
  if (!target) throw new Error("SSH workspaces require a Linux x64 or ARM64 host");
  const digest = manifest[target];
  const verify = `printf '%s  %s\\n' '${digest}' ${daemonPath} | sha256sum -c - >/dev/null 2>&1`;
  const probe = await execSsh(config, `if ${verify}; then printf ready; fi`, undefined, signal);
  if (probe !== "ready") {
    const url = `https://github.com/manaflow-ai/cmux/releases/download/${manifest.releaseTag}/cmuxd-remote-${target}`;
    const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) });
    if (!response.ok) throw new Error("Could not download the pinned SSH daemon");
    const binary = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(binary).digest("hex") !== digest) throw new Error("SSH daemon checksum mismatch");
    const install = `set -eu; umask 077; dest=${daemonPath}; mkdir -p "${"$"}{dest%/*}"; ` +
      "temp=$(mktemp \"$dest.XXXXXXXX\"); trap 'rm -f \"$temp\"' EXIT; cat >\"$temp\"; " +
      `printf '%s  %s\\n' '${digest}' "$temp" | sha256sum -c - >/dev/null; chmod 700 "$temp"; mv -f "$temp" "$dest"`;
    await execSsh(config, install, binary, signal);
  }
  signal.throwIfAborted();
  const bridge = new DaemonBridge(sshProcess(config,
    `${verify} && exec ${daemonPath} serve --stdio --persistent --slot '${config.slot}'`));
  const abort = () => bridge.close();
  signal.addEventListener("abort", abort, { once: true });
  try {
    const hello = await bridge.call("hello");
    if (!hello?.capabilities?.includes("pty.session.persistent_daemon")) throw new Error("SSH daemon lacks persistent PTY support");
    return bridge;
  } catch (error) {
    bridge.close();
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

class RemoteWorkspace extends EventEmitter {
  constructor(config, { connect = connectDaemon } = {}) {
    super();
    this.config = validateSshConfig(config);
    this.connect = connect;
    this.terminals = new Set();
    this.state = "disconnected";
  }

  status(state, error = "") {
    this.state = state;
    this.error = error;
    this.emit("status");
  }

  reconnect() {
    if (this.bridge) return Promise.resolve();
    if (this.connecting) return this.connecting;
    const controller = new AbortController();
    this.controller = controller;
    this.status("connecting");
    this.connecting = (async () => {
      try {
        const bridge = await this.connect(this.config, controller.signal);
        if (controller.signal.aborted) return bridge.close();
        this.bridge = bridge;
        bridge.once("closed", error => {
          if (this.bridge !== bridge) return;
          this.bridge = null;
          this.status("disconnected", error?.message);
        });
        bridge.on("event", event => {
          if (this.bridge === bridge) this.onEvent(event);
        });
        await Promise.all([...this.terminals].map(terminal => this.attach(terminal)));
        if (this.bridge === bridge) this.status("connected");
      } catch (error) {
        if (!controller.signal.aborted) this.status("disconnected", error.message);
      } finally {
        if (this.controller === controller) this.connecting = null;
      }
    })();
    return this.connecting;
  }

  disconnect() {
    this.controller?.abort();
    this.connecting = null;
    const bridge = this.bridge;
    this.bridge = null;
    bridge?.close();
    this.status("disconnected");
  }

  async attach(terminal) {
    const bridge = this.bridge;
    if (!bridge || terminal.attachment?.bridge === bridge) return;
    const identity = {
      session_id: terminal.panel.id,
      attachment_id: randomUUID(),
      client_attachment_token: randomUUID()
    };
    terminal.attachment = { bridge, identity, ready: false, decoder: new StringDecoder("utf8") };
    try {
      await bridge.call("pty.attach", {
        ...identity, cols: terminal.cols, rows: terminal.rows, require_existing: Boolean(terminal.panel.remoteAttached)
      });
      if (this.bridge !== bridge) return;
      terminal.attachment.ready = true;
      terminal.panel.remoteAttached = true;
      this.emit("status");
      if (terminal.closed) await bridge.call("pty.close", { session_id: terminal.panel.id });
    } catch (error) {
      if (this.bridge === bridge && !terminal.closed) terminal.emitOutput(`\r\n[SSH terminal: ${error.message}]\r\n`);
    }
  }

  onEvent(event) {
    if (!event.event.startsWith("pty.")) return;
    const terminal = [...this.terminals].find(candidate => candidate.panel.id === event.session_id);
    const attachment = terminal?.attachment;
    if (!attachment || event.attachment_token !== attachment.identity.client_attachment_token) return;
    if (event.event === "pty.data") terminal.emitOutput(attachment.decoder.write(Buffer.from(event.data_base64 || "", "base64")));
    if (event.event === "pty.exit") {
      attachment.ready = false;
      terminal.emitOutput("\r\n[Remote terminal ended]\r\n");
    }
  }

  send(terminal, method, data) {
    const attachment = terminal.attachment;
    if (terminal.closed || !attachment?.ready || this.bridge !== attachment.bridge) return false;
    void this.bridge.call(method, { ...attachment.identity, ...data }).catch(error => {
      if (this.bridge === attachment.bridge) terminal.emitOutput(`\r\n[SSH terminal: ${error.message}]\r\n`);
    });
    return true;
  }

  stop() {
    this.disconnect();
    return execSsh(this.config, `exec ${daemonPath} serve --persistent-stop --slot '${this.config.slot}'`);
  }

  closeTerminal(panel) {
    if (!panel.remoteAttached || !this.bridge) return;
    void this.bridge.call("pty.close", { session_id: panel.id }).catch(() => {});
    delete panel.remoteAttached;
  }
}

module.exports = { RemoteWorkspace, parseSshArgs, validateSshConfig };
