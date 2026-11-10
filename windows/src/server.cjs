const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { fileURLToPath } = require("node:url");
const { spawn, spawnSync } = require("node:child_process");
const { WebSocket, WebSocketServer } = require("ws");
const { t } = require("./i18n.cjs");
const { browserCommands } = require("./browser-cli.cjs");
const { agentSession, atomicJson, plainScrollback, resumeScript } = require("./session-restore.cjs");
const {TerminalDirectoryReports, directoryReportingShellArgs} = require("./terminal-directory.cjs");

let pty = null;
try {
  if (process.env.CMUX_WINDOWS_DISABLE_PTY !== "1") {
    pty = require("node-pty");
  }
} catch {
  pty = null;
}

const defaultPipeName = process.env.CMUX_WINDOWS_PIPE || (process.platform === "win32"
  ? "\\\\.\\pipe\\cmux-windows"
  : path.join(os.tmpdir(), "cmux-windows.sock"));
const defaultBrowserHomeUrl = "https://www.google.com";
const terminalMetadataBroadcastDelayMs = 160;
const focusPersistDelayMs = 180;
const gitBranchCacheTtlMs = 5000;
const apiRequestBodyLimitBytes = 1024 * 1024;
const pipeReadBufferLimitBytes = 1024 * 1024;

const workspaceColors = [
  "oklch(62% 0.22 255)",
  "oklch(70% 0.16 145)",
  "oklch(76% 0.15 82)",
  "oklch(68% 0.18 330)",
  "oklch(70% 0.14 195)",
  "oklch(64% 0.17 28)",
  "oklch(74% 0.18 305)",
  "oklch(72% 0.17 230)",
  "oklch(74% 0.12 35)",
  "oklch(80% 0.1 115)",
  "oklch(66% 0.13 175)",
  "oklch(86% 0.11 70)"
];

const localImageContentTypes = new Map([
  [".avif", "image/avif"],
  [".bmp", "image/bmp"],
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".webp", "image/webp"]
]);

function isSafeColorValue(value) {
  const color = String(value || "").trim();
  return workspaceColors.includes(color) || /^#[0-9a-f]{6}$/i.test(color);
}

function normalizeWorkspaceColor(value, fallback = "") {
  const color = String(value || "").trim();
  if (!color) return "";
  return isSafeColorValue(color) ? color : fallback;
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function appDataRoot() {
  const root = process.env.APPDATA || path.join(os.homedir(), ".config");
  return path.join(root, "cmux-windows");
}

function writeJSON(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}

class RequestBodyTooLargeError extends Error {
  constructor() {
    super("request_body_too_large");
    this.name = "RequestBodyTooLargeError";
  }
}

function readBody(request, limitBytes = apiRequestBodyLimitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let settled = false;
    const cleanup = () => {
      request.removeListener("data", onData);
      request.removeListener("end", onEnd);
      request.removeListener("error", onError);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      request.resume();
      reject(error);
    };
    const onData = (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > limitBytes) {
        fail(new RequestBodyTooLargeError());
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    };
    const onError = (error) => fail(error);
    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
  });
}

function localImagePathFromUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (parsed.protocol !== "file:") return "";
    const filePath = path.resolve(fileURLToPath(parsed));
    const ext = path.extname(filePath).toLowerCase();
    if (!localImageContentTypes.has(ext)) return "";
    const stat = fs.statSync(filePath);
    return stat.isFile() ? filePath : "";
  } catch {
    return "";
  }
}

function validBrowserUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    if (parsed.username || parsed.password) return "";
    return parsed.href.length <= 2048 ? parsed.href : "";
  } catch {
    return "";
  }
}

function sanitizeBrowserUrl(value, fallback = defaultBrowserHomeUrl) {
  const url = validBrowserUrl(value);
  if (url) return url;
  const fallbackText = String(fallback || "").trim();
  if (fallbackText === defaultBrowserHomeUrl) return defaultBrowserHomeUrl;
  return validBrowserUrl(fallbackText) || defaultBrowserHomeUrl;
}

function sanitizeBackgroundImageValue(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 262144) return "";
  if (/^preset:[a-z0-9-]{1,64}$/i.test(raw)) return raw;
  if (/^data:image\//i.test(raw)) return raw;
  if (raw.startsWith("/") && raw.length <= 2048) return raw;
  try {
    const parsed = new URL(raw);
    if (parsed.username || parsed.password) return "";
    if (parsed.protocol === "file:") return localImagePathFromUrl(parsed.href) ? parsed.href : "";
    if (["http:", "https:"].includes(parsed.protocol)) return parsed.href.length <= 4096 ? parsed.href : "";
  } catch {
    return "";
  }
  return "";
}

const shellProfileIds = new Set(["auto", "pwsh", "powershell", "cmd", "wsl", "git-bash", "custom"]);
const executableExistsCache = new Map();
const resolvedShellCache = new Map();
const gitBranchCache = new Map();

function sanitizeShellProfile(value) {
  const profile = String(value || "auto").trim();
  return shellProfileIds.has(profile) ? profile : "auto";
}

function sanitizeShellPath(value) {
  return String(value || "").trim().slice(0, 512);
}

function sanitizeTerminalFontSize(value, fallback = 0) {
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0) return fallback;
  return Math.min(22, Math.max(10, Math.round(size)));
}

function sanitizeRendererPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : 0;
}

function defaultWorkspaceDirectory() {
  const home = os.homedir();
  return home && fs.existsSync(home) ? home : process.cwd();
}

function sanitizeDirectoryPath(value, fallback = defaultWorkspaceDirectory()) {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  const resolved = path.resolve(raw);
  try {
    return fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
      ? resolved
      : fallback;
  } catch {
    return fallback;
  }
}

function executableExists(candidate) {
  if (!candidate) return false;
  const cacheKey = process.platform === "win32" ? candidate.toLowerCase() : candidate;
  if (executableExistsCache.has(cacheKey)) return executableExistsCache.get(cacheKey);
  let exists = false;
  if (candidate.includes("\\") || candidate.includes("/") || path.isAbsolute(candidate)) {
    exists = fs.existsSync(candidate);
  } else if (process.platform === "win32") {
    exists = windowsExecutableOnPath(candidate);
  } else {
    const probe = spawnSync("command", ["-v", candidate], { shell: true, stdio: "ignore" });
    exists = probe.status === 0;
  }
  executableExistsCache.set(cacheKey, exists);
  return exists;
}

function windowsExecutableOnPath(candidate) {
  const pathext = (process.env.PATHEXT || process.env.Pathext || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((ext) => ext.trim().toLowerCase())
    .filter(Boolean);
  const names = path.extname(candidate)
    ? [candidate]
    : pathext.map((ext) => `${candidate}${ext}`);
  const pathEntries = (process.env.PATH || process.env.Path || "")
    .split(path.delimiter)
    .map((entry) => entry.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
  for (const entry of pathEntries) {
    for (const name of names) {
      try {
        if (fs.existsSync(path.join(entry, name))) return true;
      } catch {
        // Ignore malformed PATH entries.
      }
    }
  }
  return false;
}

function shellCandidates(profile, customShell) {
  if (process.platform !== "win32") return [process.env.SHELL || "/bin/sh", "/bin/bash", "/bin/sh"];
  if (profile === "custom") return [customShell, "pwsh.exe", "powershell.exe", "cmd.exe"];
  if (profile === "pwsh") return ["pwsh.exe", "powershell.exe", "cmd.exe"];
  if (profile === "powershell") return ["powershell.exe", "pwsh.exe", "cmd.exe"];
  if (profile === "cmd") return ["cmd.exe", "powershell.exe"];
  if (profile === "wsl") return ["wsl.exe", "pwsh.exe", "powershell.exe", "cmd.exe"];
  if (profile === "git-bash") {
    return [
      path.join(process.env.ProgramFiles || "C:\\Program Files", "Git", "bin", "bash.exe"),
      path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Git", "bin", "bash.exe"),
      "bash.exe",
      "pwsh.exe",
      "powershell.exe",
      "cmd.exe"
    ];
  }
  if (process.env.CMUX_WINDOWS_SHELL) return [process.env.CMUX_WINDOWS_SHELL, "pwsh.exe", "powershell.exe", "cmd.exe"];
  return ["pwsh.exe", "powershell.exe", "cmd.exe"];
}

function resolveShell(profile = "auto", customShell = "") {
  const sanitizedProfile = sanitizeShellProfile(profile);
  const sanitizedCustomShell = sanitizeShellPath(customShell);
  const cacheKey = `${sanitizedProfile}\0${sanitizedCustomShell}`;
  if (resolvedShellCache.has(cacheKey)) return resolvedShellCache.get(cacheKey);
  const candidates = shellCandidates(sanitizedProfile, sanitizedCustomShell);
  for (const candidate of candidates) {
    if (executableExists(candidate)) {
      resolvedShellCache.set(cacheKey, candidate);
      return candidate;
    }
  }
  const fallback = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
  resolvedShellCache.set(cacheKey, fallback);
  return fallback;
}

function shortPath(rawPath) {
  if (!rawPath) return "";
  const home = os.homedir();
  if (rawPath.toLowerCase().startsWith(home.toLowerCase())) {
    return `~${rawPath.slice(home.length)}`;
  }
  const parts = rawPath.split(/[\\/]+/).filter(Boolean);
  if (parts.length <= 3) return rawPath;
  return `${parts[0]}\\...\\${parts.slice(-2).join("\\")}`;
}

function terminalDirectoryTitle(cwd) {
  return path.basename(cwd || '') || cwd || t('panel.terminal');
}

function gitCommonDir(gitDir) {
  try {
    const value = fs
      .readFileSync(path.join(gitDir, "commondir"), "utf8")
      .trim();
    return value ? path.resolve(gitDir, value) : gitDir;
  } catch {
    return gitDir;
  }
}

function packedRefExists(gitDir, refName) {
  try {
    const content = fs.readFileSync(path.join(gitDir, "packed-refs"), "utf8");
    return content.split(/\r?\n/).some((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("^")) {
        return false;
      }
      const [, ref] = trimmed.split(/\s+/);
      return ref === refName;
    });
  } catch {
    return false;
  }
}

function gitRefExists(gitDir, refName) {
  const roots = Array.from(new Set([gitDir, gitCommonDir(gitDir)]));
  return roots.some((root) => {
    const refPath = path.join(root, ...refName.split("/"));
    return fs.existsSync(refPath) || packedRefExists(root, refName);
  });
}

function branchFromGitDir(gitDir) {
  try {
    const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    const refPrefix = "ref: ";
    const branchPrefix = "refs/heads/";
    if (!head.startsWith(refPrefix)) return "";
    const refName = head.slice(refPrefix.length).trim();
    if (!refName.startsWith(branchPrefix) || !gitRefExists(gitDir, refName)) {
      return "";
    }
    return refName.slice(branchPrefix.length).slice(0, 80);
  } catch {
    return "";
  }
}

function gitBranch(rawPath, options = {}) {
  const cwd = String(rawPath || "").trim();
  if (!cwd) return "";
  const resolved = path.resolve(cwd);
  const searchParents = options.searchParents !== false;
  const now = Date.now();
  const cacheKey = `${resolved}:${searchParents ? "parents" : "cwd"}`;
  const cached = gitBranchCache.get(cacheKey);
  if (cached && now - cached.at < gitBranchCacheTtlMs) return cached.branch;
  let branch = "";
  try {
    let current = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
      ? resolved
      : path.dirname(resolved);
    while (current) {
      const dotGit = path.join(current, ".git");
      if (fs.existsSync(dotGit)) {
        const stat = fs.statSync(dotGit);
        if (stat.isDirectory()) {
          branch = branchFromGitDir(dotGit);
        } else if (stat.isFile()) {
          const match = fs.readFileSync(dotGit, "utf8").match(/^gitdir:\s*(.+)\s*$/im);
          if (match) {
            const gitDir = path.isAbsolute(match[1]) ? match[1] : path.resolve(current, match[1]);
            branch = branchFromGitDir(gitDir);
          }
        }
        break;
      }
      const parent = path.dirname(current);
      if (!searchParents || parent === current) break;
      current = parent;
    }
  } catch {
    branch = "";
  }
  gitBranchCache.set(cacheKey, { at: now, branch });
  return branch;
}

function normalizedTitleKey(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function workspaceTitle(value, fallback = "Workspace") {
  const title = String(value || "").trim().replace(/\s+/g, " ");
  return (title || fallback).slice(0, 80);
}

function generatedWorkspaceTitleFromUsed(baseTitle = "Workspace", usedTitles = new Set()) {
  const base = workspaceTitle(baseTitle);
  const generatedMatch = base.match(/^Workspace(?:\s+(\d+))?$/i);
  if (generatedMatch) {
    const startIndex = Math.max(1, Number(generatedMatch[1] || 1) || 1);
    for (let index = startIndex; index < 10000; index += 1) {
      const candidate = `Workspace ${index}`;
      if (!usedTitles.has(normalizedTitleKey(candidate))) return candidate;
    }
  }
  if (!usedTitles.has(normalizedTitleKey(base))) return base;
  const truncatedBase = base.slice(0, 74).trim() || "Workspace";
  for (let index = 2; index < 10000; index += 1) {
    const candidate = `${truncatedBase} ${index}`.slice(0, 80);
    if (!usedTitles.has(normalizedTitleKey(candidate))) return candidate;
  }
  return `${truncatedBase} ${Date.now().toString(36)}`.slice(0, 80);
}

function repairWorkspaceTitles(workspaces) {
  const usedTitles = new Set();
  for (const workspace of workspaces) {
    const title = workspaceTitle(workspace.title);
    const key = normalizedTitleKey(title);
    const generatedTitle = /^workspace(?:\s+\d+)?$/i.test(title);
    if (!usedTitles.has(key)) {
      workspace.title = title;
      usedTitles.add(key);
      continue;
    }
    if (!generatedTitle) continue;
    const repairedTitle = generatedWorkspaceTitleFromUsed(title, usedTitles);
    workspace.title = repairedTitle;
    usedTitles.add(normalizedTitleKey(repairedTitle));
  }
  return workspaces;
}

function tokensMatch(expected, actual) {
  const left = Buffer.from(String(expected || ""));
  const right = Buffer.from(String(actual || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function jsonRpcResponse(id, result) {
  return JSON.stringify({ jsonrpc: "2.0", id: id ?? null, result });
}

function jsonRpcErrorResponse(id, code, message) {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code,
      message
    }
  });
}

function jsonRpcErrorForException(error, id = null) {
  if (error instanceof SyntaxError) return jsonRpcErrorResponse(null, -32700, "Parse error");
  const message = String(error?.message || "Internal error");
  if (/^unknown method:/i.test(message)) return jsonRpcErrorResponse(id, -32601, "Method not found");
  return jsonRpcErrorResponse(id, -32603, "Internal error");
}

function pipeErrorResponse(line, error) {
  const trimmed = String(line || "").trim();
  if (!trimmed.startsWith("{")) {
    return JSON.stringify({ ok: false, error: "internal_error" });
  }
  try {
    const request = JSON.parse(trimmed);
    return jsonRpcErrorForException(error, request?.id);
  } catch {
    return jsonRpcErrorResponse(null, -32700, "Parse error");
  }
}

function isPipeSocketDisconnectError(error) {
  return ["EPIPE", "ECONNRESET", "ERR_STREAM_DESTROYED"].includes(error?.code);
}

function writePipeSocketLine(socket, line) {
  if (!socket || socket.destroyed || !socket.writable) return false;
  try {
    socket.write(`${line}\n`, (error) => {
      if (error && !isPipeSocketDisconnectError(error)) console.error(error);
    });
    return true;
  } catch (error) {
    if (!isPipeSocketDisconnectError(error)) console.error(error);
    return false;
  }
}

function terminalProcessEnv(panel, panelToken, extra = {}) {
  const env = { ...process.env };
  delete env.CMUX_WINDOWS_TOKEN;
  delete env.CMUX_WINDOWS_PANEL_TOKEN;
  return {
    ...env,
    ...extra,
    CMUX_WINDOWS: "1",
    CMUX_WINDOWS_PIPE: panel.runtime?.pipeName || defaultPipeName,
    CMUX_WINDOWS_PANEL_TOKEN: panelToken,
    CMUX_WORKSPACE_ID: panel.workspaceId,
    CMUX_PANEL_ID: panel.id
  };
}

const terminalAttentionPatterns = [
  /\bwaiting for (?:your )?input\b/i,
  /\bneeds (?:your )?input\b/i,
  /\brequires? (?:your )?input\b/i,
  /\b(?:press|hit) (?:enter|return|y|n|a key) (?:to|for)\b/i,
  /\bpermission (?:requested|required|needed|prompt|approval)\b/i,
  /\b(?:approve|approval|confirm|authorize|allow|grant permission)\b.{0,120}\?/i,
  /\b(?:continue|proceed)\?\s*$/i
];

function terminalAttentionText(data) {
  return String(data || "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function terminalOutputNeedsAttention(data) {
  const text = terminalAttentionText(data);
  return Boolean(text && terminalAttentionPatterns.some((pattern) => pattern.test(text)));
}

class TerminalProcess {
  constructor(panel, options = {}) {
    this.panel = panel;
    this.cols = options.cols || 100;
    this.rows = options.rows || 30;
    this.clients = new Set();
    this.backlog = "";
    this.scrollback = plainScrollback(panel.scrollback);
    this.closed = false;
    this.ptyProcess = null;
    this.ptyExit = null;
    this.child = null;
    this.directoryReports = new TerminalDirectoryReports();
    this.panelToken = crypto.randomBytes(32).toString("hex");
    this.start();
  }

  start() {
    const shellPath = resolveShell(this.panel.shellProfile, this.panel.shellPath);
    const resume = this.panel.pendingResume;
    delete this.panel.pendingResume;
    const shellArgs = directoryReportingShellArgs(shellPath, resumeScript(resume));
    const cwd = this.panel.cwd && fs.existsSync(this.panel.cwd)
      ? this.panel.cwd
      : os.homedir();
    if (pty) {
      this.ptyProcess = pty.spawn(shellPath, shellArgs, {
        name: "xterm-256color",
        cols: this.cols,
        rows: this.rows,
        useConptyDll: process.platform === "win32",
        cwd,
        env: terminalProcessEnv(this.panel, this.panelToken, {
          TERM: "xterm-256color",
          COLORTERM: "truecolor"
        })
      });
      this.ptyProcess.onData((data) => this.emitOutput(data));
      this.ptyExit = new Promise((resolve) => {
        this.ptyProcess.onExit(({ exitCode }) => {
          this.closed = true;
          resolve();
          this.emitOutput(`\r\n[process exited: ${exitCode}]\r\n`);
        });
      });
      return;
    }

    this.child = spawn(shellPath, shellArgs, {
      cwd,
      env: terminalProcessEnv(this.panel, this.panelToken),
      stdio: "pipe",
      windowsHide: true
    });
    this.child.stdout.on("data", (chunk) => this.emitOutput(chunk.toString("utf8")));
    this.child.stderr.on("data", (chunk) => this.emitOutput(chunk.toString("utf8")));
    this.child.on("exit", (code) => {
      this.emitOutput(`\r\n[process exited: ${code ?? "unknown"}]\r\n`);
      this.closed = true;
    });
    this.emitOutput("cmux is using compatibility shell mode. Some interactive shell features may be limited.\r\n");
  }

  attach(socket) {
    this.clients.add(socket);
    if (this.scrollback) socket.send(JSON.stringify({ type: "output", data: this.scrollback + "\n" }));
    if (this.backlog) {
      socket.send(JSON.stringify({ type: "output", data: this.backlog }));
    }
    socket.on("message", (raw) => {
      let message = null;
      try {
        message = JSON.parse(raw.toString("utf8"));
      } catch {
        return;
      }
      if (socket.windowId && this.panel.runtime.findPanel(this.panel.id)?.workspace.windowId !== socket.windowId) return;
      if (message.type === "input" && typeof message.data === "string") {
        this.write(message.data);
      }
      if (message.type === "resize") {
        this.resize(message.cols, message.rows);
      }
    });
    socket.on("close", () => this.clients.delete(socket));
  }

  emitOutput(data) {
    if (this.panel.runtime.closed) return;
    for (const reported of this.directoryReports.read(data)) {
      const cwd = sanitizeDirectoryPath(reported, "");
      if (cwd && cwd !== this.panel.cwd) {
        this.panel.cwd = cwd;
        if (!this.panel.titleLocked) this.panel.title = terminalDirectoryTitle(cwd);
        const workspace = this.panel.runtime.findPanel(this.panel.id)?.workspace;
        if (workspace?.activePanelId === this.panel.id) workspace.cwd = cwd;
        this.panel.runtime.scheduleTerminalMetadataBroadcast();
      }
    }
    this.backlog = (this.backlog + data).slice(-200000);
    if (terminalOutputNeedsAttention(data)) {
      const notificationText = data.replace(/\s+/g, " ").trim().slice(0, 160);
      if (!this.panel.needsAttention || this.panel.notificationText !== notificationText) {
        this.panel.needsAttention = true;
        this.panel.notificationOrder = Date.now();
        this.panel.notificationText = notificationText;
        this.panel.runtime.scheduleTerminalMetadataBroadcast();
      }
    }
    const payload = JSON.stringify({ type: "output", data });
    for (const client of this.clients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  }

  write(data) {
    if (this.ptyProcess) {
      this.ptyProcess.write(data);
      return;
    }
    if (this.child?.stdin.writable) {
      this.child.stdin.write(data);
    }
  }

  resize(cols, rows) {
    const nextCols = Math.max(2, Math.floor(Number(cols) || this.cols));
    const nextRows = Math.max(2, Math.floor(Number(rows) || this.rows));
    this.cols = nextCols;
    this.rows = nextRows;
    if (this.ptyProcess) this.ptyProcess.resize(nextCols, nextRows);
  }

  close() {
    this.closed = true;
    if (this.ptyProcess) {
      this.ptyProcess.kill();
      this.ptyProcess = null;
    }
    if (this.child && !this.child.killed) {
      this.child.kill();
      this.child = null;
    }
    for (const client of this.clients) client.close();
    this.clients.clear();
  }
}

class CmuxWindowsRuntime {
  constructor(options = {}) {
    this.staticDir = options.staticDir || path.join(__dirname, "..", "renderer");
    this.dataDir = options.dataDir || process.env.CMUX_WINDOWS_DATA_DIR || appDataRoot();
    this.sessionFile = path.join(this.dataDir, "session.json");
    this.pipeName = options.pipeName || defaultPipeName;
    this.server = null;
    this.pipeServer = null;
    this.wss = new WebSocketServer({ noServer: true });
    this.eventSockets = new Set();
    this.windowTokens = new Map();
    this.surfaceRefs = new Map();
    this.terminals = new Map();
    this.pendingPtyExits = new Set();
    this.pendingTerminalPrewarms = new Map();
    this.terminalMetadataTimer = null;
    this.persistBroadcastTimer = null;
    this.persistSessionTimer = null;
    this.launchToken = String(options.launchToken || crypto.randomBytes(32).toString("base64url"));
    this.logPipeErrors = options.logPipeErrors !== false;
    this.closed = false;
    this.sessionRepaired = false;
    this.state = this.loadSession();
    for (const window of this.state.windows) this.registerRendererWindow(window.id);
    if (this.sessionRepaired) this.persistSession();
  }

  get ptyAvailable() {
    return Boolean(pty);
  }

  loadSession(file = this.sessionFile) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (Array.isArray(parsed.workspaces)) {
        const titleSignatureBefore = parsed.workspaces.map((workspace) => workspaceTitle(workspace.title)).join("\0");
        const workspaces = repairWorkspaceTitles(parsed.workspaces.map((workspace) => ({
          ...workspace,
          color: Object.hasOwn(workspace, "color") ? normalizeWorkspaceColor(workspace.color, workspaceColors[0]) : workspaceColors[0],
          cwd: sanitizeDirectoryPath(workspace.cwd),
          panels: Array.isArray(workspace.panels) && workspace.panels.length > 0
            ? workspace.panels.map((panel) => ({
              ...panel,
              title: panel.type === 'terminal' && !panel.titleLocked
                ? terminalDirectoryTitle(sanitizeDirectoryPath(panel.cwd || workspace.cwd)) : panel.title,
              titleLocked: Boolean(panel.titleLocked),
              color: panel.color || "",
              backgroundImage: panel.type === "terminal" ? sanitizeBackgroundImageValue(panel.backgroundImage) : "",
              cwd: sanitizeDirectoryPath(panel.cwd || workspace.cwd),
              shellProfile: panel.type === "terminal" ? sanitizeShellProfile(panel.shellProfile) : "",
              shellPath: panel.type === "terminal" ? sanitizeShellPath(panel.shellPath) : "",
              terminalFontSize: panel.type === "terminal" ? sanitizeTerminalFontSize(panel.terminalFontSize, 0) : 0,
              url: panel.type === "browser" ? sanitizeBrowserUrl(panel.url) : defaultBrowserHomeUrl,
              scrollback: panel.type === "terminal" ? plainScrollback(panel.scrollback) : undefined,
              pendingResume: parsed.autoResumeAgents === true && panel.type === "terminal"
                ? agentSession(panel.agentSession?.agent, panel.agentSession?.sessionId, panel.agentSession?.home) : null,
              agentSession: panel.type === "terminal"
                ? agentSession(panel.agentSession?.agent, panel.agentSession?.sessionId, panel.agentSession?.home) : null,
              runtime: this,
              needsAttention: false,
              notificationText: ""
            }))
            : []
        })));
        const titleSignatureAfter = workspaces.map((workspace) => workspace.title).join("\0");
        if (file === this.sessionFile) this.sessionRepaired = titleSignatureBefore !== titleSignatureAfter;
        const windows = this.restoreWindowOwners(parsed.windows, workspaces, parsed.activeWorkspaceId);
        return {
          activeWorkspaceId: windows[0].activeWorkspaceId,
          rendererPort: sanitizeRendererPort(parsed.rendererPort),
          windows,
          autoResumeAgents: parsed.autoResumeAgents === true,
          recoveredWindows: Array.isArray(parsed.recoveredWindows) ? parsed.recoveredWindows : [],
          workspaces
        };
      }
    } catch {
      // First run or corrupt state: start clean.
    }
    if (file !== this.sessionFile) return null;
    const workspace = this.newWorkspace("Workspace 1");
    const windows = this.restoreWindowOwners([], [workspace], workspace.id);
    return { activeWorkspaceId: workspace.id, rendererPort: 0, windows, workspaces: [workspace] };
  }

  restoreWindowOwners(saved, workspaces, activeWorkspaceId) {
    const windows = Array.isArray(saved) ? saved.filter(window =>
      typeof window?.id === "string" && /^window_[a-z0-9-]+$/i.test(window.id)
    ).map(({ id, activeWorkspaceId }) => ({ id, activeWorkspaceId })) : [];
    if (!windows.length) windows.push({ id: id("window"), activeWorkspaceId });
    const ids = new Set(windows.map(window => window.id));
    for (const workspace of workspaces) {
      if (!ids.has(workspace.windowId)) workspace.windowId = windows[0].id;
    }
    for (const window of windows) {
      const owned = workspaces.filter(workspace => workspace.windowId === window.id);
      if (!owned.some(workspace => workspace.id === window.activeWorkspaceId)) {
        window.activeWorkspaceId = owned[0]?.id || null;
      }
    }
    return windows;
  }

  registerRendererWindow(windowId) {
    this.windowTokens.set(windowId, crypto.randomBytes(32).toString("base64url"));
  }

  rendererWindow(windowId = this.state.windows[0].id) {
    const window = this.state.windows.find(item => item.id === windowId);
    return window && { ...window, token: this.windowTokens.get(windowId) };
  }

  createWindow() {
    const window = { id: id("window"), activeWorkspaceId: null };
    this.state.windows.push(window);
    this.registerRendererWindow(window.id);
    this.persistAndBroadcast();
    return this.rendererWindow(window.id);
  }

  recoverableWindows() {
    const recovered = new Set(this.state.recoveredWindows);
    return fs.readdirSync(this.dataDir, { withFileTypes: true, throwIfNoEntry: false })
      .filter(entry => entry.isDirectory() && /^[a-f0-9-]{36}$/i.test(entry.name) && !recovered.has(entry.name))
      .map(entry => ({ id: entry.name, state: this.loadSession(path.join(this.dataDir, entry.name, "session.json")) }))
      .filter(entry => entry.state?.workspaces.length)
      .map(({ id, state }) => ({ id, title: state.workspaces[0].title, count: state.workspaces.length }));
  }

  recoverWindow(profileId) {
    if (!this.recoverableWindows().some(candidate => candidate.id === profileId)) return null;
    const legacy = this.loadSession(path.join(this.dataDir, profileId, "session.json"));
    if (!legacy) return null;
    const window = { id: id("window"), activeWorkspaceId: null };
    for (const workspace of legacy.workspaces) {
      const previousActive = workspace.activePanelId;
      const wasActive = legacy.activeWorkspaceId === workspace.id;
      workspace.id = id("workspace");
      workspace.windowId = window.id;
      delete workspace.layout;
      for (const panel of workspace.panels) {
        const active = panel.id === previousActive;
        panel.id = id(panel.type === "browser" ? "browser" : "surface");
        panel.workspaceId = workspace.id;
        delete panel.pendingResume;
        delete panel.agentSession;
        if (active) workspace.activePanelId = panel.id;
      }
      if (wasActive || !window.activeWorkspaceId) window.activeWorkspaceId = workspace.id;
    }
    this.state.workspaces.push(...legacy.workspaces);
    this.state.windows.push(window);
    this.state.recoveredWindows = [...(this.state.recoveredWindows || []), profileId];
    this.registerRendererWindow(window.id);
    this.persistAndBroadcast();
    return this.rendererWindow(window.id);
  }

  closeWindow(windowId) {
    if (!this.rendererWindow(windowId) || this.state.windows.length <= 1) return false;
    for (const workspace of this.workspacesForWindow(windowId)) {
      this.disposeWorkspaceTerminals(workspace);
    }
    this.state.workspaces = this.state.workspaces.filter(workspace => workspace.windowId !== windowId);
    this.state.windows = this.state.windows.filter(window => window.id !== windowId);
    this.windowTokens.delete(windowId);
    this.state.activeWorkspaceId = this.state.windows[0].activeWorkspaceId;
    this.persistAndBroadcast();
    return true;
  }

  workspacesForWindow(windowId) {
    return this.state.workspaces.filter(workspace => workspace.windowId === windowId);
  }

  setWindowFocus(windowId, workspaceId) {
    const window = this.state.windows.find(item => item.id === windowId);
    if (window) window.activeWorkspaceId = workspaceId;
    if (window === this.state.windows[0]) this.state.activeWorkspaceId = workspaceId;
  }

  moveWorkspaceToWindow(workspaceId, sourceWindowId, targetWindowId, beforeWorkspaceId) {
    const workspace = this.state.workspaces.find(item => item.id === workspaceId);
    if (!workspace || workspace.windowId !== sourceWindowId || sourceWindowId === targetWindowId
      || !this.rendererWindow(targetWindowId)) return false;
    if (beforeWorkspaceId && !this.workspacesForWindow(targetWindowId).some(item => item.id === beforeWorkspaceId)) {
      return false;
    }
    workspace.windowId = targetWindowId;
    if (beforeWorkspaceId) {
      this.state.workspaces.splice(this.state.workspaces.indexOf(workspace), 1);
      const targetIndex = this.state.workspaces.findIndex(item => item.id === beforeWorkspaceId);
      this.state.workspaces.splice(targetIndex, 0, workspace);
    }
    if (this.rendererWindow(sourceWindowId)?.activeWorkspaceId === workspaceId) {
      this.setWindowFocus(sourceWindowId, this.workspacesForWindow(sourceWindowId)[0]?.id || null);
    }
    this.setWindowFocus(targetWindowId, workspaceId);
    for (const panel of workspace.panels) {
      for (const client of this.terminals.get(panel.id)?.clients || []) {
        if (client.windowId === sourceWindowId) client.terminate();
      }
    }
    this.persistAndBroadcast();
    return true;
  }

  disposeWorkspaceTerminals(workspace) {
    for (const panel of workspace.panels) {
      this.terminals.get(panel.id)?.close();
      this.terminals.delete(panel.id);
    }
  }

  resetSession(windowId = this.state.windows[0].id) {
    for (const workspace of this.workspacesForWindow(windowId)) this.disposeWorkspaceTerminals(workspace);
    const workspace = this.newWorkspace("cmux");
    workspace.windowId = windowId;
    this.state.workspaces = this.state.workspaces.filter(item => item.windowId !== windowId);
    this.state.workspaces.push(workspace);
    this.setWindowFocus(windowId, workspace.id);
    this.persistAndBroadcast();
    return this.serializedState(windowId);
  }

  persistSession() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const payload = {
      version: 2,
      autoResumeAgents: this.state.autoResumeAgents === true,
      recoveredWindows: this.state.recoveredWindows,
      activeWorkspaceId: this.state.activeWorkspaceId,
      rendererPort: sanitizeRendererPort(this.state.rendererPort),
      windows: this.state.windows,
      workspaces: this.state.workspaces.map((workspace) => ({
        id: workspace.id,
        windowId: workspace.windowId,
        layout: workspace.layout,
        browserAutomation: workspace.browserAutomation === true,
        title: workspace.title,
        color: workspace.color,
        cwd: workspace.cwd,
        activePanelId: workspace.activePanelId,
        splitDirection: workspace.splitDirection,
        panels: workspace.panels.map((panel) => ({
          id: panel.id,
          workspaceId: panel.workspaceId,
          type: panel.type,
          title: panel.title,
          titleLocked: Boolean(panel.titleLocked),
          color: panel.color || "",
          backgroundImage: panel.type === "terminal" ? sanitizeBackgroundImageValue(panel.backgroundImage) : "",
          cwd: panel.cwd,
          filePath: panel.filePath || '',
          diffSource: panel.diffSource || 'unstaged',
          diffBase: panel.diffBase || '',
          shellProfile: panel.type === "terminal" ? sanitizeShellProfile(panel.shellProfile) : "",
          shellPath: panel.type === "terminal" ? sanitizeShellPath(panel.shellPath) : "",
          terminalFontSize: panel.type === "terminal" ? sanitizeTerminalFontSize(panel.terminalFontSize, 0) : 0,
          url: panel.url,
          browserHistory: panel.browserHistory,
          agentSession: panel.agentSession,
          scrollback: panel.type === "terminal"
            ? plainScrollback((panel.scrollback || "") + "\n" + (this.terminals.get(panel.id)?.backlog || ""))
            : undefined
        }))
      }))
    };
    atomicJson(this.sessionFile, payload);
  }

  newWorkspace(title, options = {}) {
    const workspaceId = id("workspace");
    const cwd = sanitizeDirectoryPath(options.cwd);
    const panel = this.newPanel("terminal", workspaceId, { cwd });
    return {
      id: workspaceId,
      windowId: options.windowId || this.state?.windows[0].id,
      title: workspaceTitle(title),
      color: workspaceColors[this.state?.workspaces?.length % workspaceColors.length || 0],
      cwd,
      activePanelId: panel.id,
      splitDirection: "right",
      panels: [panel]
    };
  }

  generatedWorkspaceTitle(baseTitle = "Workspace") {
    const existing = new Set(this.state.workspaces.map((workspace) => normalizedTitleKey(workspace.title)));
    return generatedWorkspaceTitleFromUsed(baseTitle, existing);
  }

  newPanel(type, workspaceId, options = {}) {
    const defaultTitle = type === 'terminal' ? terminalDirectoryTitle(sanitizeDirectoryPath(options.cwd))
      : type === "browser" ? t("panel.browser") : t("panel.terminal");
    const explicitTitle = String(options.title || "").trim();
    const title = explicitTitle ? explicitTitle.slice(0, 80) : defaultTitle;
    const panel = {
      id: id(type === "browser" ? "browser" : "surface"),
      workspaceId,
      type,
      title,
      titleLocked: Boolean(explicitTitle || options.titleLocked),
      color: isSafeColorValue(options.color) ? options.color : "",
      backgroundImage: type === "terminal" ? sanitizeBackgroundImageValue(options.backgroundImage) : "",
      cwd: sanitizeDirectoryPath(options.cwd),
      filePath: type === 'markdown' ? String(options.filePath || '') : '',
      diffSource: type==='diff' && ['staged','branch'].includes(options.diffSource)?options.diffSource:'unstaged',
      diffBase: type==='diff'?String(options.diffBase || '').slice(0,1024):'',
      shellProfile: type === "terminal" ? sanitizeShellProfile(options.shellProfile) : "",
      shellPath: type === "terminal" ? sanitizeShellPath(options.shellPath) : "",
      terminalFontSize: type === "terminal" ? sanitizeTerminalFontSize(options.terminalFontSize, 0) : 0,
      url: type === "browser" ? sanitizeBrowserUrl(options.url) : defaultBrowserHomeUrl,
      needsAttention: false,
      notificationText: "",
      runtime: this
    };
    return panel;
  }

  serializedState(windowId = this.state.windows[0].id) {
    return {
      windowId,
      autoResumeAgents: this.state.autoResumeAgents === true,
      windows: this.state.windows.map(window => ({ id: window.id })),
      activeWorkspaceId: this.rendererWindow(windowId)?.activeWorkspaceId || null,
      rendererPort: sanitizeRendererPort(this.state.rendererPort),
      ptyAvailable: this.ptyAvailable,
      pipeName: this.pipeName,
      palette: workspaceColors,
      workspaces: this.workspacesForWindow(windowId).map((workspace) => this.serializeWorkspace(workspace))
    };
  }

  serializeWorkspace(workspace) {
    const panels = Array.isArray(workspace.panels) ? workspace.panels : [];
    let terminalCount = 0;
    let browserCount = 0;
    let firstTerminalCwd = "";
    let latestNotification = "";
    for (const panel of panels) {
      if (panel.type === "terminal") {
        terminalCount += 1;
        if (!firstTerminalCwd) firstTerminalCwd = panel.cwd || "";
      } else if (panel.type === "browser") {
        browserCount += 1;
      }
      if (!latestNotification && panel.needsAttention) {
        latestNotification = panel.notificationText || "";
      }
    }
    const activePanel = panels.find(panel => panel.id === workspace.activePanelId);
    const cwd = activePanel?.cwd || workspace.cwd || firstTerminalCwd || defaultWorkspaceDirectory();
    const branch = gitBranch(cwd);
    return {
      id: workspace.id,
      layout: workspace.layout,
      browserAutomation: workspace.browserAutomation === true,
      title: workspace.title,
      color: workspace.color || "",
      activePanelId: workspace.activePanelId,
      splitDirection: workspace.splitDirection,
      terminalCount,
      browserCount,
      cwd,
      cwdShort: shortPath(cwd),
      branch,
      latestNotification,
      panels: panels.map((panel) => this.serializePanel(panel))
    };
  }

  serializePanel(panel) {
    return {
      id: panel.id,
      workspaceId: panel.workspaceId,
      type: panel.type,
      title: panel.title,
      titleLocked: Boolean(panel.titleLocked),
      color: panel.color || "",
      backgroundImage: panel.type === "terminal" ? sanitizeBackgroundImageValue(panel.backgroundImage) : "",
      cwd: panel.cwd,
      filePath: panel.filePath || '',
      diffSource: panel.diffSource || 'unstaged',
      diffBase: panel.diffBase || '',
      cwdShort: shortPath(panel.cwd),
      shellProfile: panel.shellProfile || "",
      shellPath: panel.shellPath || "",
      terminalFontSize: panel.type === "terminal" ? sanitizeTerminalFontSize(panel.terminalFontSize, 0) : 0,
      url: panel.url,
      liveAgent: this.terminals.get(panel.id)?.liveAgent?.agent,
      needsAttention: panel.needsAttention,
      notificationText: panel.notificationText,
      notificationOrder: panel.notificationOrder || 0
    };
  }

  activeWorkspace(windowId = this.state.windows[0].id) {
    const workspaces = this.workspacesForWindow(windowId);
    const activeId = this.rendererWindow(windowId)?.activeWorkspaceId;
    return workspaces.find(workspace => workspace.id === activeId) || workspaces[0];
  }

  findPanel(panelId) {
    for (const workspace of this.state.workspaces) {
      const panel = workspace.panels.find((candidate) => candidate.id === panelId);
      if (panel) return { workspace, panel };
    }
    return null;
  }

  ensureTerminalProcess(panel) {
    if (this.closed || panel?.type !== "terminal") return null;
    let terminal = this.terminals.get(panel.id);
    if (!terminal || terminal.closed) {
      terminal = new TerminalProcess(panel);
      this.terminals.set(panel.id, terminal);
      const exit = terminal.ptyExit;
      if (exit) {
        this.pendingPtyExits.add(exit);
        exit.then(() => this.pendingPtyExits.delete(exit));
      }
    }
    return terminal;
  }

  hasRendererEventSocket() {
    for (const socket of this.eventSockets) {
      if (socket.readyState === WebSocket.OPEN) return true;
    }
    return false;
  }

  scheduleTerminalPrewarm(panel, response = null) {
    if (this.closed || !panel || panel.type !== "terminal") return;
    if (!response && !this.hasRendererEventSocket()) return;
    if (this.terminals.has(panel.id) || this.pendingTerminalPrewarms.has(panel.id)) return;
    const panelId = panel.id;
    const pending = { canceled: false, handle: null, handleType: "", response: null };
    const run = () => {
      if (pending.canceled) return;
      this.pendingTerminalPrewarms.delete(panelId);
      if (this.closed) return;
      try {
        const found = this.findPanel(panelId);
        if (!found || found.panel.type !== "terminal" || this.terminals.has(panelId)) return;
        this.ensureTerminalProcess(found.panel);
      } catch (error) {
        console.error("terminal prewarm failed");
        console.error(error);
      }
    };
    this.pendingTerminalPrewarms.set(panelId, pending);
    if (
      response
      && typeof response.once === "function"
      && !response.destroyed
      && !response.writableEnded
      && !response.writableFinished
    ) {
      pending.handleType = "response";
      pending.handle = run;
      pending.response = response;
      response.once("finish", run);
      return;
    }
    run();
  }

  createWorkspace(title, runtimeOptions = {}) {
    const explicitTitle = workspaceTitle(title, "");
    const workspace = this.newWorkspace(explicitTitle || this.generatedWorkspaceTitle(), runtimeOptions);
    workspace.activePanelId = workspace.panels[0]?.id || null;
    this.state.workspaces.push(workspace);
    this.setWindowFocus(workspace.windowId, workspace.id);
    this.persistAndBroadcast();
    this.scheduleTerminalPrewarm(workspace.panels[0], runtimeOptions.prewarmResponse);
    return workspace;
  }

  createWorkspaceFromOptions(options = {}, runtimeOptions = {}) {
    const hasRequestedCwd = Boolean(String(options.cwd || "").trim());
    const cwd = sanitizeDirectoryPath(options.cwd);
    const explicitTitle = workspaceTitle(options.title, "");
    const generatedTitleBase = hasRequestedCwd ? path.basename(cwd) : "Workspace";
    const title = explicitTitle || this.generatedWorkspaceTitle(generatedTitleBase || "Workspace");
    const workspace = this.newWorkspace(title, { cwd, windowId: runtimeOptions.windowId });
    workspace.activePanelId = workspace.panels[0]?.id || null;
    this.state.workspaces.push(workspace);
    this.setWindowFocus(workspace.windowId, workspace.id);
    this.persistAndBroadcast();
    this.scheduleTerminalPrewarm(workspace.panels[0], runtimeOptions.prewarmResponse);
    return workspace;
  }

  createPanel(workspaceId, type, options = {}, runtimeOptions = {}) {
    const workspace = this.state.workspaces.find((candidate) => candidate.id === workspaceId)
      || this.activeWorkspace();
    if (!workspace) throw new Error("Workspace not found");
    const panel = this.newPanel(type || "terminal", workspace.id, {
      ...options,
      cwd: sanitizeDirectoryPath(options.cwd || workspace.cwd)
    });
    workspace.cwd = panel.cwd || workspace.cwd;
    workspace.panels.push(panel);
    workspace.activePanelId = panel.id;
    if (options.direction === "down" || options.direction === "right") {
      workspace.splitDirection = options.direction;
    }
    this.schedulePersistAndBroadcast();
    this.scheduleTerminalPrewarm(panel, runtimeOptions.prewarmResponse);
    return panel;
  }

  closePanel(panelId) {
    const found = this.findPanel(panelId);
    if (!found) return false;
    const { workspace, panel } = found;
    workspace.panels = workspace.panels.filter((candidate) => candidate.id !== panel.id);
    if (workspace.activePanelId === panelId) workspace.activePanelId = workspace.panels[0]?.id || null;
    this.terminals.get(panel.id)?.close();
    this.terminals.delete(panel.id);
    this.persistAndBroadcast();
    return true;
  }

  moveWorkspace(workspaceId, beforeWorkspaceId = null) {
    const currentIndex = this.state.workspaces.findIndex((workspace) => workspace.id === workspaceId);
    if (currentIndex < 0 || beforeWorkspaceId === workspaceId) return false;
    const [workspace] = this.state.workspaces.splice(currentIndex, 1);
    const insertIndex = beforeWorkspaceId
      ? this.state.workspaces.findIndex((candidate) => candidate.id === beforeWorkspaceId)
      : -1;
    this.state.workspaces.splice(insertIndex >= 0 ? insertIndex : this.state.workspaces.length, 0, workspace);
    this.setWindowFocus(workspace.windowId, workspace.id);
    this.persistAndBroadcast();
    return true;
  }

  movePanel(panelId, targetWorkspaceId, beforePanelId = null) {
    const found = this.findPanel(panelId);
    if (!found) return false;
    const targetWorkspace = this.state.workspaces.find((workspace) => workspace.id === targetWorkspaceId) || found.workspace;
    if (!targetWorkspace) return false;
    if (beforePanelId === panelId) return true;
    found.workspace.panels = found.workspace.panels.filter((candidate) => candidate.id !== panelId);
    if (found.workspace.activePanelId === panelId) {
      found.workspace.activePanelId = found.workspace.panels[0]?.id || null;
    }
    found.panel.workspaceId = targetWorkspace.id;
    const insertIndex = beforePanelId
      ? targetWorkspace.panels.findIndex((candidate) => candidate.id === beforePanelId)
      : -1;
    targetWorkspace.panels.splice(insertIndex >= 0 ? insertIndex : targetWorkspace.panels.length, 0, found.panel);
    targetWorkspace.activePanelId = panelId;
    this.setWindowFocus(targetWorkspace.windowId, targetWorkspace.id);
    return true;
  }

  movePanels(panelIds, targetWorkspaceId, activePanelId) {
    const target=this.state.workspaces.find(workspace=>workspace.id===targetWorkspaceId);
    if(!target || !Array.isArray(panelIds) || !panelIds.length || new Set(panelIds).size!==panelIds.length || !panelIds.includes(activePanelId))return false;
    const found=panelIds.map(panelId=>this.findPanel(panelId));
    const source=found[0]?.workspace;
    if(!source || source===target || found.some(item=>!item || item.workspace!==source))return false;
    const moving=new Set(panelIds);
    source.panels=source.panels.filter(panel=>!moving.has(panel.id));
    if(moving.has(source.activePanelId))source.activePanelId=source.panels[0]?.id || null;
    for(const {panel} of found) {
      panel.workspaceId=target.id;
      target.panels.push(panel);
    }
    target.activePanelId=activePanelId;
    this.setWindowFocus(target.windowId, target.id);
    this.persistAndBroadcast();
    return true;
  }

  updatePanel(panelId, updates = {}) {
    if (Object.hasOwn(updates, "workspaceId") || Object.hasOwn(updates, "beforePanelId") || Object.hasOwn(updates, "moveToEnd")) {
      const ok = this.movePanel(panelId, updates.workspaceId, updates.moveToEnd ? null : updates.beforePanelId);
      if (!ok) return false;
    }
    const found = this.findPanel(panelId);
    if (!found) return false;
    if(found.panel.type==='diff') {
      if(Object.hasOwn(updates,'diffSource'))found.panel.diffSource=['staged','branch'].includes(updates.diffSource)?updates.diffSource:'unstaged';
      if(Object.hasOwn(updates,'diffBase'))found.panel.diffBase=String(updates.diffBase || '').slice(0,1024);
    }
    if(Object.hasOwn(updates,'filePath') && found.panel.type==='markdown') {
      found.panel.filePath=String(updates.filePath || '');
      if(!found.panel.titleLocked)found.panel.title=path.basename(found.panel.filePath);
    }
    if (Object.hasOwn(updates, "title")) {
      const title = String(updates.title || "").trim();
      if (title) {
        found.panel.title = title.slice(0, 80);
        found.panel.titleLocked = true;
      } else {
        found.panel.title = found.panel.type === 'terminal' ? terminalDirectoryTitle(found.panel.cwd)
          : found.panel.type === "browser" ? "Browser" : "Terminal";
        found.panel.titleLocked = false;
      }
    }
    if (Object.hasOwn(updates, "color")) {
      const color = String(updates.color || "").trim();
      found.panel.color = isSafeColorValue(color) ? color : "";
    }
    if (Object.hasOwn(updates, "backgroundImage") && found.panel.type === "terminal") {
      found.panel.backgroundImage = sanitizeBackgroundImageValue(updates.backgroundImage);
    }
    if (updates.direction === "down" || updates.direction === "right") {
      found.workspace.splitDirection = updates.direction;
    }
    if (Object.hasOwn(updates, "url") && found.panel.type === "browser") {
      found.panel.url = sanitizeBrowserUrl(updates.url, found.panel.url || defaultBrowserHomeUrl);
    }
    if (Object.hasOwn(updates, "terminalFontSize") && found.panel.type === "terminal") {
      found.panel.terminalFontSize = sanitizeTerminalFontSize(updates.terminalFontSize, 0);
    }
    if (typeof updates.needsAttention === 'boolean') {
      found.panel.needsAttention = updates.needsAttention;
      found.panel.notificationOrder = updates.needsAttention ? Date.now() : 0;
      if (!updates.needsAttention) found.panel.notificationText = '';
    }
    if (updates.notificationOrder === 0 && found.panel.needsAttention) found.panel.notificationOrder = 0;
    this.persistAndBroadcast();
    return true;
  }

  restartPanel(panelId) {
    const found = this.findPanel(panelId);
    if (!found || found.panel.type !== "terminal") return false;
    this.terminals.get(found.panel.id)?.close();
    this.terminals.delete(found.panel.id);
    if (!found.panel.titleLocked) found.panel.title = terminalDirectoryTitle(found.panel.cwd);
    found.panel.needsAttention = false;
    found.panel.notificationText = "";
    this.persistAndBroadcast();
    return true;
  }

  closeWorkspace(workspaceId) {
    const workspace = this.state.workspaces.find((candidate) => candidate.id === workspaceId);
    if (!workspace) return false;
    this.disposeWorkspaceTerminals(workspace);
    if (this.workspacesForWindow(workspace.windowId).length <= 1) {
      workspace.title = "cmux";
      workspace.panels = [];
      workspace.activePanelId = null;
      this.persistAndBroadcast();
      return true;
    }
    this.state.workspaces = this.state.workspaces.filter((candidate) => candidate.id !== workspace.id);
    if (this.rendererWindow(workspace.windowId)?.activeWorkspaceId === workspace.id) {
      this.setWindowFocus(workspace.windowId, this.workspacesForWindow(workspace.windowId)[0]?.id || null);
    }
    this.persistAndBroadcast();
    return true;
  }

  updateWorkspace(workspaceId, updates = {}) {
    if (Object.hasOwn(updates, "beforeWorkspaceId") || Object.hasOwn(updates, "moveToEnd")) {
      return this.moveWorkspace(workspaceId, updates.moveToEnd ? null : updates.beforeWorkspaceId);
    }
    const workspace = this.state.workspaces.find((candidate) => candidate.id === workspaceId);
    if (!workspace) return false;
    if (typeof updates.browserAutomation === "boolean") workspace.browserAutomation = updates.browserAutomation;
    if (Object.hasOwn(updates, "title")) {
      const trimmed = String(updates.title || "").trim();
      const used=new Set(this.state.workspaces.filter(item=>item.id!==workspaceId).map(item=>normalizedTitleKey(item.title)));
      workspace.title = trimmed?trimmed.slice(0,80):generatedWorkspaceTitleFromUsed(path.basename(workspace.cwd || '') || 'Workspace',used);
    }
    if (Object.hasOwn(updates, "color")) {
      const color = String(updates.color || "").trim();
      if (color === "" || isSafeColorValue(color)) workspace.color = color;
    }
    if (Object.hasOwn(updates, "cwd")) {
      const cwd = sanitizeDirectoryPath(updates.cwd, "");
      if (!cwd) return false;
      workspace.cwd = cwd;
    }
    this.persistAndBroadcast();
    return true;
  }

  renameWorkspace(workspaceId, title) {
    return this.updateWorkspace(workspaceId, { title });
  }

  focusWorkspace(workspaceId) {
    const workspace = this.state.workspaces.find(item => item.id === workspaceId);
    if (!workspace) return false;
    if (this.rendererWindow(workspace.windowId)?.activeWorkspaceId === workspaceId) return true;
    this.setWindowFocus(workspace.windowId, workspaceId);
    this.broadcastState();
    this.schedulePersistSession();
    return true;
  }

  focusPanel(panelId) {
    const found = this.findPanel(panelId);
    if (!found) return false;
    const alreadyFocused = this.rendererWindow(found.workspace.windowId)?.activeWorkspaceId === found.workspace.id
      && found.workspace.activePanelId === panelId;
    const hadAttention = Boolean(found.panel.needsAttention || found.panel.notificationText);
    this.setWindowFocus(found.workspace.windowId, found.workspace.id);
    found.workspace.activePanelId = panelId;
    found.panel.needsAttention = false;
    found.panel.notificationText = "";
    if (alreadyFocused && !hadAttention) return true;
    this.broadcastState();
    this.schedulePersistSession();
    return true;
  }

  notify(message, windowId) {
    const workspace = this.activeWorkspace(windowId);
    if (!workspace) return null;
    const panel = workspace.panels.find((candidate) => candidate.id === workspace.activePanelId)
      || workspace.panels[0];
    if (!panel) return null;
    panel.needsAttention = true;
    panel.notificationOrder = Date.now();
    panel.notificationText = String(message || "Notification").slice(0, 160);
    this.broadcastState();
    return panel;
  }

  sendInput(text, panelId) {
    const workspace = this.activeWorkspace();
    const targetPanelId = panelId || workspace?.activePanelId;
    const found = targetPanelId ? this.findPanel(targetPanelId) : null;
    const terminal = this.ensureTerminalProcess(found?.panel);
    if (!terminal) return false;
    terminal.write(String(text || ""));
    return true;
  }

  persistAndBroadcast() {
    if (this.persistBroadcastTimer) {
      clearTimeout(this.persistBroadcastTimer);
      this.persistBroadcastTimer = null;
    }
    if (this.persistSessionTimer) {
      clearTimeout(this.persistSessionTimer);
      this.persistSessionTimer = null;
    }
    if (this.terminalMetadataTimer) {
      clearTimeout(this.terminalMetadataTimer);
      this.terminalMetadataTimer = null;
    }
    this.persistSession();
    this.broadcastState();
  }

  schedulePersistAndBroadcast() {
    if (this.persistBroadcastTimer) return;
    this.persistBroadcastTimer = setTimeout(() => {
      this.persistBroadcastTimer = null;
      this.persistAndBroadcast();
    }, 0);
  }

  schedulePersistSession(delayMs = focusPersistDelayMs) {
    if (this.persistSessionTimer) return;
    this.persistSessionTimer = setTimeout(() => {
      this.persistSessionTimer = null;
      this.persistSession();
    }, delayMs);
  }

  scheduleTerminalMetadataBroadcast() {
    if (this.terminalMetadataTimer) clearTimeout(this.terminalMetadataTimer);
    this.terminalMetadataTimer = setTimeout(() => {
      this.terminalMetadataTimer = null;
      this.persistAndBroadcast();
    }, terminalMetadataBroadcastDelayMs);
  }

  broadcastState() {
    this.onStateChanged?.();
    const payloads = new Map();
    for (const socket of this.eventSockets) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      if (socket.windowId && !this.windowTokens.has(socket.windowId)) {
        socket.terminate();
        continue;
      }
      if (!payloads.has(socket.windowId)) {
        payloads.set(socket.windowId, JSON.stringify({ type: "state", state: this.serializedState(socket.windowId) }));
      }
      socket.send(payloads.get(socket.windowId));
    }
  }

  requestToken(request, url) {
    const headerToken = request.headers["x-local-token"];
    if (Array.isArray(headerToken)) return headerToken[0] || "";
    return String(headerToken || url.searchParams.get("token") || "");
  }

  requestContext(request, url) {
    const token = this.requestToken(request, url);
    if (tokensMatch(this.launchToken, token)) return { windowId: this.state.windows[0].id, full: true };
    for (const [windowId, expected] of this.windowTokens) {
      if (tokensMatch(expected, token)) return { windowId, full: false };
    }
    return null;
  }

  requestHasAllowedOrigin(request) {
    const origin = request.headers.origin;
    if (!origin) return true;
    const host = request.headers.host;
    return origin === `http://${host}`;
  }

  async handleApi(request, response, url) {
    if (!this.requestHasAllowedOrigin(request)) {
      writeJSON(response, 403, { error: "forbidden_origin" });
      return;
    }
    const context = this.requestContext(request, url);
    if (!context) {
      writeJSON(response, 401, { error: "unauthorized" });
      return;
    }
    const { windowId, full } = context;
    const ownsWorkspace = workspaceId => this.windowTokens.has(windowId) && this.state.workspaces.some(
      workspace => workspace.id === workspaceId && (full || workspace.windowId === windowId)
    );
    const ownsPanel = panelId => ownsWorkspace(this.findPanel(panelId)?.workspace.id);
    const notFound = () => writeJSON(response, 404, { error: "not_found" });
    try {
      if (request.method === "GET" && url.pathname === "/api/state") {
        writeJSON(response, 200, this.serializedState(windowId));
        return;
      }
      if (full && request.method === "POST" && url.pathname === "/api/windows") {
        writeJSON(response, 201, this.createWindow());
        return;
      }
      const moveWindow = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/move-to-window$/);
      if (request.method === "POST" && moveWindow) {
        const body = await readBody(request);
        if (!ownsWorkspace(moveWindow[1])) return notFound();
        const ok = this.moveWorkspaceToWindow(moveWindow[1], windowId, body.windowId, body.beforeWorkspaceId);
        writeJSON(response, ok ? 200 : 409, { ok });
        return;
      }
      const layout = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/layout$/);
      if (request.method === "PUT" && layout) {
        const body = await readBody(request);
        if (!ownsWorkspace(layout[1])) return notFound();
        const workspace = this.state.workspaces.find(item => item.id === layout[1]);
        workspace.layout = { tree: body.tree || null, groups: Array.isArray(body.groups) ? body.groups : [] };
        this.schedulePersistSession();
        writeJSON(response, 200, { ok: true });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/workspaces") {
        const body = await readBody(request);
        if (!this.windowTokens.has(windowId)) return notFound();
        writeJSON(response, 200, this.serializeWorkspace(this.createWorkspaceFromOptions(body, { prewarmResponse: response, windowId })));
        return;
      }
      if (request.method === "PUT" && url.pathname === "/api/session/agent-resume") {
        const body = await readBody(request);
        this.state.autoResumeAgents = body.enabled === true;
        this.persistAndBroadcast();
        writeJSON(response, 200, { ok: true });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/session/save") {
        this.persistSession();
        writeJSON(response, 200, { ok: true });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/session/reset") {
        writeJSON(response, 200, this.resetSession(windowId));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/panels") {
        const body = await readBody(request);
        const workspaceId = body.workspaceId || this.activeWorkspace(windowId)?.id;
        if (!ownsWorkspace(workspaceId)) return notFound();
        writeJSON(response, 200, this.serializePanel(this.createPanel(workspaceId, body.type, body, { prewarmResponse: response })));
        return;
      }
      const focusWorkspaceMatch = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/focus$/);
      if (request.method === "POST" && focusWorkspaceMatch) {
        if (!ownsWorkspace(focusWorkspaceMatch[1])) return notFound();
        const ok = this.focusWorkspace(focusWorkspaceMatch[1]);
        writeJSON(response, ok ? 200 : 404, { ok });
        return;
      }
      const workspaceDeleteMatch = url.pathname.match(/^\/api\/workspaces\/([^/]+)$/);
      if (request.method === "DELETE" && workspaceDeleteMatch) {
        if (!ownsWorkspace(workspaceDeleteMatch[1])) return notFound();
        const ok = this.closeWorkspace(workspaceDeleteMatch[1]);
        writeJSON(response, ok ? 200 : 409, { ok });
        return;
      }
      const workspaceRenameMatch = url.pathname.match(/^\/api\/workspaces\/([^/]+)$/);
      if (request.method === "PATCH" && workspaceRenameMatch) {
        const body = await readBody(request);
        if (!ownsWorkspace(workspaceRenameMatch[1]) || (body.beforeWorkspaceId && !ownsWorkspace(body.beforeWorkspaceId))) return notFound();
        const ok = this.updateWorkspace(workspaceRenameMatch[1], body);
        writeJSON(response, ok ? 200 : 404, { ok });
        return;
      }
      const panelFocusMatch = url.pathname.match(/^\/api\/panels\/([^/]+)\/focus$/);
      if (request.method === "POST" && panelFocusMatch) {
        if (!ownsPanel(panelFocusMatch[1])) return notFound();
        const ok = this.focusPanel(panelFocusMatch[1]);
        writeJSON(response, ok ? 200 : 404, { ok });
        return;
      }
      const panelRestartMatch = url.pathname.match(/^\/api\/panels\/([^/]+)\/restart$/);
      if (request.method === "POST" && panelRestartMatch) {
        if (!ownsPanel(panelRestartMatch[1])) return notFound();
        const ok = this.restartPanel(panelRestartMatch[1]);
        writeJSON(response, ok ? 200 : 404, { ok });
        return;
      }
      const panelDeleteMatch = url.pathname.match(/^\/api\/panels\/([^/]+)$/);
      if (request.method === "DELETE" && panelDeleteMatch) {
        if (!ownsPanel(panelDeleteMatch[1])) return notFound();
        const ok = this.closePanel(panelDeleteMatch[1]);
        writeJSON(response, ok ? 200 : 409, { ok });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/panels/transfer") {
        const body=await readBody(request);
        if (!ownsWorkspace(body.workspaceId) || !Array.isArray(body.panelIds) || !body.panelIds.every(ownsPanel)) return notFound();
        const ok=this.movePanels(body.panelIds,body.workspaceId,body.activePanelId);
        writeJSON(response,ok?200:409,{ok});
        return;
      }
      const panelUpdateMatch = url.pathname.match(/^\/api\/panels\/([^/]+)$/);
      if (request.method === "PATCH" && panelUpdateMatch) {
        const body = await readBody(request);
        if (!ownsPanel(panelUpdateMatch[1]) || (body.workspaceId && !ownsWorkspace(body.workspaceId))
          || (body.beforePanelId && !ownsPanel(body.beforePanelId))) return notFound();
        const ok = this.updatePanel(panelUpdateMatch[1], body);
        writeJSON(response, 200, { ok });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/notify") {
        const body = await readBody(request);
        const panel = this.notify(body.message, windowId);
        writeJSON(response, 200, { panel: panel ? this.serializePanel(panel) : null });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/input") {
        const body = await readBody(request);
        const panelId = body.panelId || this.activeWorkspace(windowId)?.activePanelId;
        if (!ownsPanel(panelId)) return notFound();
        const ok = this.sendInput(body.text, panelId);
        writeJSON(response, ok ? 200 : 404, { ok });
        return;
      }
      writeJSON(response, 404, { error: "not_found" });
    } catch (error) {
      const bodyTooLarge = error instanceof RequestBodyTooLargeError;
      const badRequest = error instanceof SyntaxError;
      if (!badRequest && !bodyTooLarge) console.error(error);
      writeJSON(response, bodyTooLarge ? 413 : badRequest ? 400 : 500, {
        error: bodyTooLarge ? "request_too_large" : badRequest ? "invalid_request" : "internal_error"
      });
    }
  }

  serveStatic(request, response, url) {
    const vendor = this.vendorFile(url.pathname);
    const filePath = vendor || path.join(this.staticDir, url.pathname === "/" ? "index.html" : url.pathname);
    const resolved = path.resolve(filePath);
    const allowedRoots = [path.resolve(this.staticDir), path.resolve(path.join(__dirname, "..", "node_modules"))];
    if (!allowedRoots.some((root) => resolved === root || resolved.startsWith(root + path.sep))) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    fs.readFile(resolved, (error, data) => {
      if (error) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      response.writeHead(200, { "content-type": this.contentType(resolved) });
      response.end(data);
    });
  }

  serveLocalImage(request, response, url) {
    if (!this.requestHasAllowedOrigin(request)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    if (!this.requestContext(request, url)) {
      response.writeHead(401);
      response.end("Unauthorized");
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405);
      response.end("Method not allowed");
      return;
    }
    const filePath = localImagePathFromUrl(url.searchParams.get("url"));
    if (!filePath) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    const contentType = localImageContentTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream";
    fs.stat(filePath, (statError, stat) => {
      if (statError || !stat.isFile()) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      response.writeHead(200, {
        "content-type": contentType,
        "content-length": stat.size,
        "cache-control": "private, max-age=60"
      });
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      fs.createReadStream(filePath).on("error", () => {
        if (!response.headersSent) response.writeHead(500);
        response.end();
      }).pipe(response);
    });
  }

  vendorFile(pathname) {
    const root = path.join(__dirname, "..", "node_modules");
    const files = {
      "/vendor/xterm.css": path.join(root, "@xterm", "xterm", "css", "xterm.css"),
      "/vendor/xterm.js": path.join(root, "@xterm", "xterm", "lib", "xterm.js"),
      "/vendor/addon-fit.js": path.join(root, "@xterm", "addon-fit", "lib", "addon-fit.js"),
      "/vendor/addon-web-links.js": path.join(root, "@xterm", "addon-web-links", "lib", "addon-web-links.js"),
      "/vendor/addon-search.js": path.join(root, "@xterm", "addon-search", "lib", "addon-search.js"),
      "/vendor/addon-image.js": path.join(root, "@xterm", "addon-image", "lib", "addon-image.js"),
      "/vendor/addon-webgl.js": path.join(root, "@xterm", "addon-webgl", "lib", "addon-webgl.js")
    };
    return files[pathname];
  }

  contentType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".html") return "text/html; charset=utf-8";
    if (ext === ".css") return "text/css; charset=utf-8";
    if (ext === ".js" || ext === ".mjs") return "text/javascript; charset=utf-8";
    if (ext === ".json") return "application/json; charset=utf-8";
    if (ext === ".svg") return "image/svg+xml; charset=utf-8";
    return "application/octet-stream";
  }

  handleUpgrade(request, socket, head) {
    const url = new URL(request.url, "http://127.0.0.1");
    const context = this.requestContext(request, url);
    if (!this.requestHasAllowedOrigin(request) || !context) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      ws.windowId = context.full ? undefined : context.windowId;
      if (url.pathname === "/events") {
        this.eventSockets.add(ws);
        ws.send(JSON.stringify({ type: "state", state: this.serializedState(context.windowId) }));
        ws.on("close", () => this.eventSockets.delete(ws));
        return;
      }
      const match = url.pathname.match(/^\/terminal\/([^/]+)$/);
      if (match) {
        const found = this.findPanel(match[1]);
        const terminal = found && (!ws.windowId || found.workspace.windowId === ws.windowId)
          ? this.ensureTerminalProcess(found.panel) : null;
        if (!terminal) {
          ws.close();
          return;
        }
        terminal.attach(ws);
        return;
      }
      ws.close();
    });
  }

  listen(port = null) {
    const requestedPort = port === null || port === undefined
      ? sanitizeRendererPort(this.state.rendererPort)
      : sanitizeRendererPort(port);
    return this.listenOnPort(requestedPort || 0).catch((error) => {
      if (requestedPort > 0 && error?.code === "EADDRINUSE") {
        try { this.server?.close(); } catch {}
        this.server = null;
        return this.listenOnPort(0);
      }
      throw error;
    });
  }

  listenOnPort(port) {
    return new Promise((resolve, reject) => {
      const server = http.createServer((request, response) => {
        const url = new URL(request.url, "http://127.0.0.1");
        if (url.pathname.startsWith("/api/")) {
          this.handleApi(request, response, url);
        } else if (url.pathname === "/_cmux/local-image") {
          this.serveLocalImage(request, response, url);
        } else {
          this.serveStatic(request, response, url);
        }
      });
      this.server = server;
      const onError = (error) => reject(error);
      server.on("upgrade", (request, socket, head) => this.handleUpgrade(request, socket, head));
      server.once("error", onError);
      server.listen(port, "127.0.0.1", async () => {
        server.removeListener("error", onError);
        server.on("error", (error) => console.error(error));
        try {
          await this.startPipeServer();
        } catch (error) {
          server.close();
          reject(error);
          return;
        }
        const address = server.address();
        this.state.rendererPort = address.port;
        this.persistSession();
        resolve({
          port: address.port,
          url: `http://127.0.0.1:${address.port}/`,
          pipeName: this.pipeName,
          launchToken: this.launchToken,
          ptyAvailable: this.ptyAvailable
        });
      });
    });
  }

  startPipeServer() {
    return new Promise((resolve, reject) => {
      if (process.platform !== "win32" && fs.existsSync(this.pipeName)) {
        fs.unlinkSync(this.pipeName);
      }
      this.pipeServer = net.createServer((socket) => {
        let buffer = "";
        let bufferedBytes = 0;
        let authContext = null;
        socket.on("error", () => {});
        socket.on("data", (chunk) => {
          if (bufferedBytes + chunk.length > pipeReadBufferLimitBytes) {
            socket.destroy();
            return;
          }
          buffer += chunk.toString("utf8");
          bufferedBytes += chunk.length;
          let index = buffer.indexOf("\n");
          while (index >= 0) {
            const line = buffer.slice(0, index).trim();
            buffer = buffer.slice(index + 1);
            bufferedBytes = Buffer.byteLength(buffer);
            if (!authContext) {
              authContext = this.authenticatePipeLine(line);
              if (authContext) {
                if (!authContext.processLine) {
                  index = buffer.indexOf("\n");
                  continue;
                }
              } else {
                writePipeSocketLine(socket, "ERROR unauthorized");
                socket.end();
                return;
              }
            }
            this.handlePipeLine(line, authContext).then((reply) => {
              writePipeSocketLine(socket, reply);
            }).catch((error) => {
              if (this.logPipeErrors) console.error(error);
              writePipeSocketLine(socket, pipeErrorResponse(line, error));
            });
            index = buffer.indexOf("\n");
          }
        });
      });
      this.pipeServer.once("error", reject);
      this.pipeServer.once("listening", () => {
        this.pipeServer.removeListener("error", reject);
        resolve();
      });
      this.pipeServer.listen(this.pipeName);
    });
  }

  authenticatePipeLine(line) {
    if (!line) return null;
    if (tokensMatch(this.launchToken, line)) return { scope: "full", processLine: false };
    if (line.startsWith("auth ")) {
      return tokensMatch(this.launchToken, line.slice(5).trim()) ? { scope: "full", processLine: false } : null;
    }
    const panelAuth = line.match(/^auth-panel\s+(\S+)\s+(\S+)$/);
    if (panelAuth) {
      const context = this.authenticatePanelPipe(panelAuth[1], panelAuth[2]);
      return context ? { ...context, processLine: false } : null;
    }
    if (!line.startsWith("{")) return null;
    try {
      const request = JSON.parse(line);
      if (tokensMatch(this.launchToken, request.token || request.params?.token)) return { scope: "full", processLine: true };
      const context = this.authenticatePanelPipe(request.params?.panelId, request.params?.panelToken);
      return context ? { ...context, processLine: true } : null;
    } catch {
      return null;
    }
  }

  authenticatePanelPipe(panelId, panelToken) {
    const terminal = this.terminals.get(String(panelId || ""));
    if (!terminal || terminal.closed || !terminal.panelToken) return null;
    if (!tokensMatch(terminal.panelToken, panelToken)) return null;
    return { scope: "panel", panelId: terminal.panel.id, panelToken };
  }

  async handlePipeLine(line, authContext = { scope: "full" }) {
    if (!line) return "ERROR empty command";
    if (authContext.scope === "panel") {
      if (!this.authenticatePanelPipe(authContext.panelId, authContext.panelToken)) return "ERROR unauthorized";
      return this.handlePanelPipeLine(line, authContext.panelId, authContext.panelToken);
    }
    if (line.startsWith("{")) {
      let request = null;
      try {
        request = JSON.parse(line);
        if (request.method === "browser.command") return this.handleBrowserPipe(request, authContext);
        return jsonRpcResponse(request.id, await this.handleRpc(request.method, request.params || {}));
      } catch (error) {
        return jsonRpcErrorForException(error, request?.id);
      }
    }
    const [command, ...args] = line.split(/\s+/);
    switch (command) {
      case "ping":
        return "OK";
      case "list-workspaces":
        return JSON.stringify(this.serializedState().workspaces);
      case "new-workspace":
        return JSON.stringify(this.serializeWorkspace(this.createWorkspace(args.join(" ") || undefined)));
      case "reset-session":
        return JSON.stringify(this.resetSession());
      case "new-terminal":
        return JSON.stringify(this.serializePanel(this.createPanel(this.state.activeWorkspaceId, "terminal")));
      case "browser-open":
        return JSON.stringify(this.serializePanel(this.createPanel(this.state.activeWorkspaceId, "browser", { url: args.join(" ") || defaultBrowserHomeUrl })));
      case "restart-terminal":
        return this.restartPanel(this.activeWorkspace()?.activePanelId) ? "OK" : "ERROR no active terminal";
      case "notify":
        return JSON.stringify(this.serializePanel(this.notify(args.join(" ") || "Notification")));
      case "send":
        return this.sendInput(`${args.join(" ")}\r`) ? "OK" : "ERROR no active terminal";
      default:
        return `ERROR unknown command: ${command}`;
    }
  }

  async handlePanelPipeLine(line, panelId, panelToken) {
    if (line.startsWith("{")) {
      let request = null;
      try {
        request = JSON.parse(line);
        if (request.method === "system.ping") {
          return jsonRpcResponse(request.id, { ok: true });
        }
        if (request.method === "browser.command") {
          return this.handleBrowserPipe(request, { scope: "panel", panelId, panelToken });
        }
        if (request.method === "agent.session") {
          const terminal = this.terminals.get(panelId);
          const params = request.params || {};
          const session = agentSession(params.agent, params.sessionId, params.home);
          if (!terminal || terminal.closed || !session) return jsonRpcErrorResponse(request.id, -32602, "Invalid session");
          if (params.event === "start") {
            terminal.liveAgent = session;
            terminal.panel.agentSession = session;
          } else if (params.event === "end" && terminal.liveAgent?.sessionId === session.sessionId) {
            terminal.liveAgent = null;
          }
          this.schedulePersistAndBroadcast();
          return jsonRpcResponse(request.id, { ok: true });
        }
        if (request.method === "terminal.send") {
          const result = { ok: this.sendInput(String(request.params?.text || ""), panelId) };
          return jsonRpcResponse(request.id, result);
        }
        return jsonRpcErrorResponse(request.id, -32601, "Method not found");
      } catch (error) {
        return jsonRpcErrorForException(error, request?.id);
      }
    }
    const [command, ...args] = line.split(/\s+/);
    switch (command) {
      case "ping":
        return "OK";
      case "send":
        return this.sendInput(`${args.join(" ")}\r`, panelId) ? "OK" : "ERROR no terminal";
      default:
        return `ERROR unauthorized command: ${command}`;
    }
  }

  browserRef(panel) {
    if (!this.surfaceRefs.has(panel.id)) this.surfaceRefs.set(panel.id, "surface:" + (this.surfaceRefs.size + 1));
    return this.surfaceRefs.get(panel.id);
  }

  async handleBrowserPipe(request, context) {
    const params = request.params || {};
    const { command, surface } = params;
    const scoped = context.scope === "panel";
    const caller = scoped ? this.findPanel(context.panelId) : null;
    const callerWorkspace = caller?.workspace;
    const permitted = () => !scoped || (
      this.authenticatePanelPipe(context.panelId, context.panelToken)
      && this.findPanel(context.panelId)?.workspace === callerWorkspace
      && callerWorkspace?.browserAutomation === true && !callerWorkspace.remote
    );
    if (!permitted()) return jsonRpcErrorResponse(request.id, -32001, "Browser automation is disabled for this workspace");
    if (!this.browserCommand || !browserCommands.has(command)) {
      return jsonRpcErrorResponse(request.id, -32601, "Browser command unavailable");
    }
    const workspace = callerWorkspace || this.activeWorkspace();
    const workspaces = scoped ? [workspace] : this.state.workspaces;
    let target;
    if (surface) {
      target = workspaces.flatMap(item => item.panels).find(panel =>
        panel.type === "browser" && (panel.id === surface || this.browserRef(panel) === surface)
      );
    } else {
      target = workspace?.panels.find(panel => panel.id === workspace.activePanelId && panel.type === "browser")
        || workspace?.panels.find(panel => panel.type === "browser");
    }
    try {
      if (command === "open-split" || (command === "open" && !surface && !target)) {
        if (!workspace) throw new Error("Create a workspace before opening a browser");
        target = this.createPanel(workspace.id, "browser", { url: params.url });
      }
      if (!target) throw new Error("Browser surface not found");
      const authorized = () => permitted() && this.findPanel(target.id)?.panel === target
        && (!scoped || this.findPanel(target.id)?.workspace === callerWorkspace);
      const result = await this.browserCommand(target, params, authorized);
      if (["identify", "open", "open-split"].includes(command) && result && typeof result === "object") {
        result.surface_ref = this.browserRef(target);
      }
      return jsonRpcResponse(request.id, result);
    } catch (error) {
      return jsonRpcErrorResponse(request.id, -32000, String(error.message).slice(0, 512));
    }
  }

  handleRpc(method, params) {
    switch (method) {
      case "system.ping":
        return { ok: true };
      case "workspace.list":
        return this.serializedState().workspaces;
      case "workspace.create":
        return this.serializeWorkspace(this.createWorkspaceFromOptions(params));
      case "workspace.update":
        return { ok: this.updateWorkspace(params.workspaceId || this.state.activeWorkspaceId, params) };
      case "workspace.rename":
        return { ok: this.renameWorkspace(params.workspaceId || this.state.activeWorkspaceId, params.title) };
      case "workspace.close":
        return { ok: this.closeWorkspace(params.workspaceId || this.state.activeWorkspaceId) };
      case "session.reset":
        return this.resetSession();
      case "panel.create":
        return this.serializePanel(this.createPanel(params.workspaceId || this.state.activeWorkspaceId, params.type || "terminal", params));
      case "browser.open":
        return this.serializePanel(this.createPanel(params.workspaceId || this.state.activeWorkspaceId, "browser", { url: params.url || defaultBrowserHomeUrl }));
      case "panel.update":
        return { ok: this.updatePanel(params.panelId, params) };
      case "terminal.restart":
        return { ok: this.restartPanel(params.panelId || this.activeWorkspace()?.activePanelId) };
      case "notification.create":
        return this.serializePanel(this.notify(params.message || params.body || "Notification"));
      case "terminal.send":
        return { ok: this.sendInput(params.text || "", params.panelId) };
      default:
        throw new Error(`unknown method: ${method}`);
    }
  }

  async waitForPtyExits() {
    if (!this.pendingPtyExits.size) return;
    let timeout;
    try {
      await Promise.race([
        Promise.all(this.pendingPtyExits),
        new Promise((resolve) => { timeout = setTimeout(resolve, 6000); })
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }

  close() {
    this.closed = true;
    if (this.terminalMetadataTimer) {
      clearTimeout(this.terminalMetadataTimer);
      this.terminalMetadataTimer = null;
    }
    if (this.persistBroadcastTimer) {
      clearTimeout(this.persistBroadcastTimer);
      this.persistBroadcastTimer = null;
    }
    if (this.persistSessionTimer) {
      clearTimeout(this.persistSessionTimer);
      this.persistSessionTimer = null;
      this.persistSession();
    }
    for (const pending of this.pendingTerminalPrewarms.values()) {
      pending.canceled = true;
      if (!pending.handle) continue;
      if (pending.handleType === "response") pending.response?.removeListener?.("finish", pending.handle);
    }
    this.pendingTerminalPrewarms.clear();
    this.persistSession();
    for (const terminal of this.terminals.values()) terminal.close();
    this.terminals.clear();
    for (const socket of this.eventSockets) socket.close();
    this.eventSockets.clear();
    this.wss.close();
    this.pipeServer?.close();
    this.server?.close();
    if (process.platform !== "win32" && fs.existsSync(this.pipeName)) {
      try { fs.unlinkSync(this.pipeName); } catch {}
    }
  }
}

function createCmuxWindowsRuntime(options) {
  return new CmuxWindowsRuntime(options);
}

module.exports = { createCmuxWindowsRuntime, defaultPipeName };
