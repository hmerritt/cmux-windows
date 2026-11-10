const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const pipeName = process.env.CMUX_WINDOWS_PIPE || (
  process.platform === "win32"
    ? "\\\\.\\pipe\\cmux-windows"
    : path.join(os.tmpdir(), "cmux-windows.sock")
);

const fs = require("node:fs");
const { setupAgentHooks } = require("./agent-hooks.cjs");
const args = process.argv.slice(2);

function request(command, { scoped = false, timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const launchToken = process.env.CMUX_WINDOWS_TOKEN || "";
    const panelToken = process.env.CMUX_WINDOWS_PANEL_TOKEN || "";
    const panelId = process.env.CMUX_PANEL_ID || "";
    if ((scoped || !launchToken) && (!panelToken || !panelId)) {
      reject(new Error("authentication required"));
      return;
    }
    const auth = !scoped && launchToken ? "auth " + launchToken : "auth-panel " + panelId + " " + panelToken;
    const socket = net.createConnection(pipeName);
    let output = "";
    socket.setEncoding("utf8");
    socket.setTimeout(timeout, () => socket.destroy(new Error("request timed out")));
    socket.on("connect", () => socket.write(auth + "\n" + command + "\n"));
    socket.on("data", chunk => {
      output += chunk;
      if (output.length > 12 * 1024 * 1024) socket.destroy(new Error("response is too large"));
      else if (output.includes("\n")) {
        resolve(output.slice(0, output.indexOf("\n")));
        socket.end();
      }
    });
    socket.on("error", reject);
    socket.on("close", () => reject(new Error("cmux disconnected before replying")));
  });
}

async function rpc(method, params, options) {
  const line = await request(JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), options);
  if (line.startsWith("ERROR ")) throw new Error(line.slice(6));
  const response = JSON.parse(line);
  if (response.error) throw new Error(response.error.message);
  return response.result;
}

async function main() {
  if (["help", "--help", "-h"].includes(args[0])) {
    process.stdout.write("cmux commands\n  ping | list-workspaces | reset-session | new-workspace | new-terminal\n  restart-terminal | browser-open | notify | send\n  hooks setup codex|claude\n  browser [--surface <surface>] <command>\n  ssh <destination> [-p <port>] [-i <identity>] [--name <name>]\n");
    return;
  }
  if (args[0] === "hooks" && args[1] === "setup") {
    process.stdout.write(setupAgentHooks(args[2], process.env.CMUX_WINDOWS_LAUNCHER) + "\n");
    return;
  }
  if (args[0] === "agent-hook") {
    if (!process.env.CMUX_WINDOWS_PANEL_TOKEN) return;
    const stat = fs.fstatSync(0);
    if (stat.size > 1024 * 1024) throw new Error("hook input is too large");
    const input = fs.readFileSync(0, "utf8");
    if (input.length > 1024 * 1024) throw new Error("hook input is too large");
    const payload = JSON.parse(input);
    await rpc("agent.session", {
      agent: args[1], event: args[2], sessionId: payload.session_id, home: process.env.CODEX_HOME
    }, { scoped: true });
    return;
  }
  if (args[0] === "browser") {
    const { parseBrowserArgs } = require("./browser-cli.cjs");
    const { params, output, json } = parseBrowserArgs(args.slice(1));
    const result = await rpc("browser.command", params);
    if (params.command === "screenshot" && output) {
      fs.writeFileSync(output, Buffer.from(result.png, "base64"));
      process.stdout.write(output + "\n");
      return;
    }
    process.stdout.write((typeof result === "string" && !json ? result : JSON.stringify(result)) + "\n");
    return;
  }
  if (args[0] === "ssh") {
    const { parseSshArgs } = require("./ssh-workspaces.cjs");
    const result = await rpc("workspace.ssh", parseSshArgs(args.slice(1)));
    process.stdout.write(JSON.stringify(result) + "\n");
    return;
  }
  const response = await request(args.join(" ") || "ping");
  process.stdout.write(response + "\n");
  if (response.startsWith("ERROR ")) process.exitCode = 1;
}

main().catch(error => {
  process.stderr.write("cmux: " + error.message + "\n");
  process.exitCode = 1;
});
