const { app, BrowserWindow, Menu, ipcMain, shell, clipboard, dialog, screen } = require("electron");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { formatMessage, t } = require("./i18n.cjs");
const { runBrowserCommand } = require("./browser-automation.cjs");
const { BrowserSurfaces } = require("./browser-surfaces.cjs");
const {ShortcutConfig} = require('./shortcut-config.cjs');
const workspaceFiles=new (require('./workspace-files.cjs').WorkspaceFiles)({trash:target=>shell.trashItem(target)});
const workspaceGit=new (require('./workspace-git.cjs').WorkspaceGit)();
const diffPreferences=new (require('./diff-preferences.cjs').DiffPreferences)(process.env.CMUX_DIFF_VIEWER_PREFS_PATH || path.join(process.env.APPDATA || app.getPath('appData'),'cmux','diff-viewer','preferences.json'));
const workspaceSearch=new (require('./workspace-search.cjs').WorkspaceSearch)();
const workspaceSearchRequests=new Map();
const workspaceSearchRenderers=new WeakSet();
const {ShortcutRouter, catalog} = require('../renderer/shortcut-engine.mjs');
const {actionAvailable, actionPriority} = require('../renderer/shortcut-scopes.mjs');
const shortcutConfig = new ShortcutConfig();
const guestShortcutRouter = new ShortcutRouter([...catalog].sort((a,b)=>actionPriority(a.id)-actionPriority(b.id)));
guestShortcutRouter.configure(shortcutConfig.settings);
function publishShortcutSnapshot(snapshot) {
  if(!snapshot.error) guestShortcutRouter.configure(snapshot.settings);
  for (const window of windows.values()) window.webContents.send('cmux-shortcuts-changed', snapshot);
  return snapshot;
}

const windows = new Map();
let runtimeInfo;
let browserSurfaces;
let quitting = false;
let inProcessRuntime = null;
let trustedRendererOrigin = "";
let windowResizeSession = null;
const zoomLockedContents = new WeakSet();
const navigationGuardedContents = new WeakSet();
const commandShortcutContents = new WeakSet();
const browserGuestOwners = new WeakMap();
const workspaceDrags = new Map();

const appRoot = path.resolve(__dirname, "..");
const appName = "cmux";
const appUserModelId = "com.cmux.windows";
const appIconPath = path.join(__dirname, "assets", "cmux.ico");
const clipboardImageDataUrlLimitBytes = 2 * 1024 * 1024;
const windowResizeEdges = new Set([
  "top",
  "right",
  "bottom",
  "left",
  "top-left",
  "top-right",
  "bottom-right",
  "bottom-left"
]);
function redactLogMessage(message) {
  return String(message || "")
    .replace(/([?&](?:token|panelToken|launchToken)=)[^&\s)]+/gi, "$1[redacted]")
    .replace(/("(?:token|panelToken|launchToken)"\s*:\s*")[^"]+/gi, "$1[redacted]");
}

function log(message) {
  try {
    const logPath = path.join(app.getPath("userData"), "cmux-windows.log");
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${new Date().toISOString()} ${redactLogMessage(message)}\n`);
  } catch {
    // Best-effort debug logging.
  }
}

function resetWebContentsZoom(contents) {
  if (!contents || contents.isDestroyed?.()) return;
  try {
    contents.setZoomFactor(1);
    const limits = contents.setVisualZoomLevelLimits?.(1, 1);
    limits?.catch?.((error) => log(`setVisualZoomLevelLimits failed: ${error?.message || error}`));
  } catch (error) {
    log(`reset zoom failed: ${error?.message || error}`);
  }
}

function lockWebContentsZoom(contents) {
  if (!contents || contents.isDestroyed?.()) return;
  resetWebContentsZoom(contents);
  if (zoomLockedContents.has(contents)) return;
  zoomLockedContents.add(contents);
  contents.on("zoom-changed", (event) => {
    event.preventDefault();
    resetWebContentsZoom(contents);
  });
  contents.on("did-finish-load", () => resetWebContentsZoom(contents));
}

function sendCmuxCommand(commandId) {
  BrowserWindow.getFocusedWindow()?.webContents.send("cmux-command", commandId);
}

function installCommandShortcutBridge(contents) {
  if (!contents || commandShortcutContents.has(contents)) return;
  commandShortcutContents.add(contents);
  let altGraph=false;
  contents.on('blur',()=>{altGraph=false;guestShortcutRouter.pending=null;});
  contents.on("before-input-event", (event, input) => {
    if(input.code==='AltRight' || input.key==='AltGraph') {
      altGraph=input.type==='keyDown' && (input.key==='AltGraph' || input.control);
      guestShortcutRouter.pending=null;
    }
    // Host renderer owns terminal/input contexts. Guests cannot bubble keys to
    // it, so use the same matcher here and forward only recognized app actions.
    const owner = browserGuestOwners.get(contents);
    if (!owner || owner.isDestroyed() || input.type!=='keyDown' || altGraph) return;
    const context={browserFocus:true,terminalFocus:false,appFocus:true,sidebarFocus:false,commandPaletteVisible:false};
    const result=guestShortcutRouter.handle({key:input.key,code:input.code,ctrlKey:input.control,altKey:input.alt,shiftKey:input.shift,metaKey:input.meta,repeat:input.isAutoRepeat,isComposing:input.isComposing},context,actionAvailable);
    if(!result) return;
    event.preventDefault();
    if(result.id) owner.send('cmux-shortcut',{...result,guestId:contents.id});
  });
}

async function openExternalSafely(url) {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
    return { ok: false, error: "unsupported_url" };
  }
  try {
    await shell.openExternal(url);
    return { ok: true };
  } catch (error) {
    log(`open external failed: ${error?.message || error}`);
    return { ok: false, error: "open_external_failed" };
  }
}

function externalWindowOpenHandler({ url }) {
  openExternalSafely(url).then((result) => {
    if (!result.ok) log(`window open denied without external launch: ${result.error}`);
  });
  return { action: "deny" };
}

function hardenWebContents(contents) {
  lockWebContentsZoom(contents);
  if (typeof contents?.setWindowOpenHandler === "function") {
    contents.setWindowOpenHandler(externalWindowOpenHandler);
  }
}

function isAllowedWebviewNavigationUrl(url) {
  return /^https?:\/\//i.test(String(url || "")) || url === "about:blank";
}

function webviewNavigationUrl(details, fallbackUrl = "") {
  return String(details?.url || fallbackUrl || "");
}

function blockDisallowedWebviewNavigation(event, details, fallbackUrl = "") {
  const url = webviewNavigationUrl(details, fallbackUrl);
  if (isAllowedWebviewNavigationUrl(url)) return;
  event.preventDefault();
  log(`blocked webview navigation url=${url}`);
}

function guardWebviewNavigation(webContents) {
  if (!webContents || navigationGuardedContents.has(webContents)) return;
  navigationGuardedContents.add(webContents);
  webContents.on("will-frame-navigate", (event) => {
    if (event.isMainFrame === false) return;
    blockDisallowedWebviewNavigation(event, event);
  });
  webContents.on("will-navigate", (event, url) => {
    blockDisallowedWebviewNavigation(event, event, url);
  });
  webContents.on("will-redirect", (event, url) => {
    blockDisallowedWebviewNavigation(event, event, url);
  });
}

function isTrustedIpcEvent(event) {
  if (!event || !event.sender.cmuxWindowId || !trustedRendererOrigin || event.senderFrame?.parent) return false;
  if (windows.get(event.sender.cmuxWindowId)?.webContents !== event.sender) return false;
  const frameUrl = event.senderFrame?.url || event.sender.getURL?.() || "";
  try {
    return new URL(frameUrl).origin === trustedRendererOrigin;
  } catch {
    return false;
  }
}

function trustedIpcHandler(handler, fallback) {
  return async (event, ...args) => {
    if (!isTrustedIpcEvent(event)) {
      log(`blocked ipc ${event?.senderFrame?.url || "unknown"}`);
      return typeof fallback === "function" ? fallback() : fallback;
    }
    return handler(event, ...args);
  };
}

function trustedIpcListener(listener) {
  return (event, ...args) => {
    if (!isTrustedIpcEvent(event)) {
      log(`blocked ipc ${event?.senderFrame?.url || "unknown"}`);
      return;
    }
    listener(event, ...args);
  };
}

function normalizeWindowResizeEdge(edge) {
  const normalized = String(edge || "").trim().toLowerCase();
  return windowResizeEdges.has(normalized) ? normalized : "";
}

function windowResizePoint(point) {
  const x = Number(point?.x);
  const y = Number(point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function beginWindowResize(mainWindow, edge, point) {
  const normalizedEdge = normalizeWindowResizeEdge(edge);
  const start = windowResizePoint(point);
  if (!mainWindow || !normalizedEdge || !start || mainWindow.isMaximized() || mainWindow.isFullScreen?.()) {
    windowResizeSession = null;
    return;
  }
  const minimumSize = typeof mainWindow.getMinimumSize === "function"
    ? mainWindow.getMinimumSize()
    : [480, 400];
  windowResizeSession = {
    window: mainWindow,
    edge: normalizedEdge,
    start,
    bounds: mainWindow.getBounds(),
    minWidth: Math.max(1, Number(minimumSize?.[0]) || 480),
    minHeight: Math.max(1, Number(minimumSize?.[1]) || 400)
  };
}

function windowResizeBoundsForPoint(point) {
  if (!windowResizeSession) return null;
  const current = windowResizePoint(point);
  if (!current) return null;
  const { edge, start, bounds, minWidth, minHeight } = windowResizeSession;
  const dx = Math.round(current.x - start.x);
  const dy = Math.round(current.y - start.y);
  const next = { ...bounds };
  if (edge.includes("right")) {
    next.width = bounds.width + dx;
  }
  if (edge.includes("left")) {
    next.x = bounds.x + dx;
    next.width = bounds.width - dx;
  }
  if (edge.includes("bottom")) {
    next.height = bounds.height + dy;
  }
  if (edge.includes("top")) {
    next.y = bounds.y + dy;
    next.height = bounds.height - dy;
  }
  if (next.width < minWidth) {
    if (edge.includes("left")) next.x = bounds.x + bounds.width - minWidth;
    next.width = minWidth;
  }
  if (next.height < minHeight) {
    if (edge.includes("top")) next.y = bounds.y + bounds.height - minHeight;
    next.height = minHeight;
  }
  return next;
}

function continueWindowResize(mainWindow, point) {
  if (!mainWindow || windowResizeSession?.window !== mainWindow || mainWindow.isDestroyed()) return;
  const bounds = windowResizeBoundsForPoint(point);
  if (!bounds) return;
  mainWindow.setBounds(bounds, false);
}

function initialWindowBounds() {
  const fallbackWorkArea = { x: 0, y: 0, width: 1280, height: 720 };
  const workArea = screen.getPrimaryDisplay?.()?.workArea || fallbackWorkArea;
  const availableWidth = Math.max(480, Math.round(workArea.width) - 96);
  const availableHeight = Math.max(400, Math.round(workArea.height) - 48);
  const width = Math.min(1120, availableWidth);
  const height = Math.min(820, availableHeight);
  return {
    width,
    height,
    x: Math.round(workArea.x + Math.max(0, (workArea.width - width) / 2)),
    y: Math.round(workArea.y + Math.max(0, (workArea.height - height) / 2))
  };
}

function firstExistingPath(paths) {
  return paths.find((candidate) => candidate && fs.existsSync(candidate)) || "";
}

function browserInstallSources() {
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return [
    {
      id: "chrome",
      label: "Chrome",
      executablePaths: [
        path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe")
      ],
      userDataDir: path.join(localAppData, "Google", "Chrome", "User Data")
    },
    {
      id: "edge",
      label: "Edge",
      executablePaths: [
        path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
        path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
        path.join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe")
      ],
      userDataDir: path.join(localAppData, "Microsoft", "Edge", "User Data")
    },
    {
      id: "brave",
      label: "Brave",
      executablePaths: [
        path.join(programFiles, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
        path.join(programFilesX86, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
        path.join(localAppData, "BraveSoftware", "Brave-Browser", "Application", "brave.exe")
      ],
      userDataDir: path.join(localAppData, "BraveSoftware", "Brave-Browser", "User Data")
    }
  ];
}

function browserProfileName(userDataDir, profileDirectory) {
  const fallback = profileDirectory === "Default" ? "Default" : profileDirectory.replace(/^Profile\s+/i, "Profile ");
  try {
    const preferencesPath = path.join(userDataDir, profileDirectory, "Preferences");
    const preferences = JSON.parse(fs.readFileSync(preferencesPath, "utf8"));
    const name = String(preferences?.profile?.name || "").trim();
    return name || fallback;
  } catch {
    return fallback;
  }
}

function browserProfileDirectories(userDataDir) {
  try {
    const entries = fs.readdirSync(userDataDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => name === "Default" || /^Profile \d+$/i.test(name));
    return entries.sort((left, right) => {
      if (left === "Default") return -1;
      if (right === "Default") return 1;
      return left.localeCompare(right, undefined, { numeric: true });
    });
  } catch {
    return [];
  }
}

function detectedBrowserProfiles() {
  const profiles = [{
    id: "system",
    label: t("browser.systemDefault"),
    browser: t("browser.system"),
    profileName: t("browser.defaultProfile"),
    profileDirectory: "",
    executable: ""
  }];
  for (const source of browserInstallSources()) {
    const executable = firstExistingPath(source.executablePaths);
    if (!executable) continue;
    const directories = browserProfileDirectories(source.userDataDir);
    const profileDirectories = directories.length ? directories : ["Default"];
    for (const profileDirectory of profileDirectories) {
      const profileName = browserProfileName(source.userDataDir, profileDirectory);
      profiles.push({
        id: `${source.id}:${profileDirectory}`,
        label: formatMessage("browser.profileLabel", { browser: source.label, profile: profileName }),
        browser: source.label,
        profileName,
        profileDirectory,
        executable
      });
    }
  }
  return profiles;
}

function publicBrowserProfiles() {
  return detectedBrowserProfiles().map(({ executable, ...profile }) => profile);
}

async function openUrlInBrowserProfile(url, profileId = "system") {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
    return { ok: false, error: "unsupported_url" };
  }
  const profiles = detectedBrowserProfiles();
  const profile = profiles.find((candidate) => candidate.id === profileId) || profiles[0];
  if (!profile || profile.id === "system" || !profile.executable) {
    const result = await openExternalSafely(url);
    return { ok: result.ok, profileId: "system", error: result.error };
  }
  try {
    const child = spawn(profile.executable, [`--profile-directory=${profile.profileDirectory}`, url], {
      detached: true,
      stdio: "ignore",
      windowsHide: false
    });
    child.unref();
    return { ok: true, profileId: profile.id };
  } catch (error) {
    log(`profile browser launch failed: ${error?.message || error}`);
    const result = await openExternalSafely(url);
    return { ok: result.ok, profileId: "system", error: result.ok ? "profile_launch_failed" : result.error };
  }
}

async function startRuntime() {
  const { createCmuxWindowsRuntime } = require("./server.cjs");
  if (process.platform === "win32") {
    const bin = path.join(app.getPath("userData"), "bin");
    fs.mkdirSync(bin, { recursive: true });
    const launcher = path.join(bin, "cmux.cmd");
    const cli = path.join(__dirname, "cli.cjs");
    const batchPath = value => value.replaceAll("%", "%%");
    fs.writeFileSync(launcher, [
      "@echo off", "setlocal", "set ELECTRON_RUN_AS_NODE=1",
      `"${batchPath(process.execPath)}" "${batchPath(cli)}" %*`, ""
    ].join("\r\n"));
    process.env.CMUX_WINDOWS_LAUNCHER = launcher;
    const pathKey = Object.keys(process.env).find(key => key.toUpperCase() === "PATH") || "PATH";
    process.env[pathKey] = bin + path.delimiter + (process.env[pathKey] || "");
  }
  inProcessRuntime = createCmuxWindowsRuntime({ staticDir: path.join(appRoot, "renderer") });
  browserSurfaces = new BrowserSurfaces({
    runtime: inProcessRuntime,
    windows,
    configure(contents, owner) {
      if (owner) browserGuestOwners.set(contents, owner);
      hardenWebContents(contents);
      guardWebviewNavigation(contents);
      installCommandShortcutBridge(contents);
    }
  });
  inProcessRuntime.onStateChanged = () => browserSurfaces.reconcile();
  inProcessRuntime.browserCommand = (panel, params, authorized) =>
    runBrowserCommand(browserSurfaces, panel, params, authorized);
  runtimeInfo = await inProcessRuntime.listen();
  trustedRendererOrigin = new URL(runtimeInfo.url).origin;
}

async function recoverOlderWindows() {
  const parent = BrowserWindow.getFocusedWindow();
  if (!parent) return;
  const candidates = inProcessRuntime.recoverableWindows();
  if (!candidates.length) {
    await dialog.showMessageBox(parent, { message: t("window.noOlderWindows") });
    return;
  }
  const choices = candidates.slice(0, 8);
  const choice = await dialog.showMessageBox(parent, {
    message: t("window.recoverOlderWindows"), cancelId: 0,
    buttons: [t("dialog.cancel"), ...choices.map(({ title, count }) => title + " (" + count + ")")]
  });
  const selected = choices[choice.response - 1];
  if (!selected) return;
  const owner = inProcessRuntime.recoverWindow(selected.id);
  if (owner) await createWindow(owner);
}

function buildMenu() {
  const template = [
    {
      label: t("menu.file"),
      submenu: [
        { label: t("window.recoverOlderWindows"), click: () => void recoverOlderWindows() },
        { label: t("menu.newWorkspace"), accelerator: "Ctrl+N", click: () => sendCmuxCommand("workspace.new") },
        { label: t("menu.renameWorkspace"), click: () => sendCmuxCommand("workspace.rename") },
        { label: t("menu.workspaceBlueprints"), click: () => sendCmuxCommand("settings.blueprints") },
        { label: t("menu.newTerminal"), accelerator: "Ctrl+T", click: () => sendCmuxCommand("terminal.new") },
        { label: t("menu.runCommand"), accelerator: "Ctrl+Shift+Enter", click: () => sendCmuxCommand("terminal.runCommand") },
        { label: t("menu.reopenClosedPane"), accelerator: "Ctrl+Shift+T", click: () => sendCmuxCommand("terminal.reopenClosed") },
        { label: t("menu.copyTerminalSelection"), accelerator: "Ctrl+Shift+C", click: () => sendCmuxCommand("terminal.copySelection") },
        { label: t("menu.pasteClipboard"), accelerator: "Ctrl+Shift+V", click: () => sendCmuxCommand("terminal.pasteClipboard") },
        { label: t("menu.restartTerminal"), accelerator: "Ctrl+Shift+R", click: () => sendCmuxCommand("terminal.restart") },
        { label: t("menu.closeActivePane"), accelerator: "Ctrl+W", click: () => sendCmuxCommand("terminal.close") },
        { label: t("menu.openBrowser"), accelerator: "Ctrl+Shift+L", click: () => sendCmuxCommand("browser.new") },
        { type: "separator" },
        { label: t("menu.settings"), accelerator: "Ctrl+,", click: () => sendCmuxCommand("settings.open") },
        { label: t("menu.colorSettings"), click: () => sendCmuxCommand("settings.colors") },
        { label: t("menu.backgroundSettings"), click: () => sendCmuxCommand("settings.backgrounds") },
        { label: t("menu.settingsProfiles"), click: () => sendCmuxCommand("settings.profiles") },
        { label: t("menu.commandSnippets"), click: () => sendCmuxCommand("settings.commands") },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: t("menu.edit"),
      submenu: [
        { label: t("menu.findTerminal"), accelerator: "Ctrl+F", click: () => sendCmuxCommand("terminal.find") },
        { label: t("menu.findNext"), accelerator: "F3", click: () => sendCmuxCommand("terminal.findNext") },
        { label: t("menu.findPrevious"), accelerator: "Shift+F3", click: () => sendCmuxCommand("terminal.findPrevious") },
        { type: "separator" },
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" }
      ]
    },
    {
      label: t("menu.view"),
      submenu: [
        { label: t("menu.commandPalette"), accelerator: "Ctrl+Shift+P", click: () => sendCmuxCommand("palette.toggle") },
        { label: t("menu.toggleSidebar"), accelerator: "Ctrl+B", click: () => sendCmuxCommand("sidebar.toggle") },
        { type: "separator" },
        { label: t("menu.nextPane"), accelerator: "Ctrl+Tab", click: () => sendCmuxCommand("terminal.nextPane") },
        { label: t("menu.previousPane"), accelerator: "Ctrl+Shift+Tab", click: () => sendCmuxCommand("terminal.previousPane") },
        { label: t("menu.lastPane"), accelerator: "Ctrl+Shift+Backspace", click: () => sendCmuxCommand("terminal.lastPane") },
        { label: t("menu.nextWorkspace"), accelerator: "Ctrl+PageDown", click: () => sendCmuxCommand("workspace.next") },
        { label: t("menu.previousWorkspace"), accelerator: "Ctrl+PageUp", click: () => sendCmuxCommand("workspace.previous") },
        { label: t("menu.lastWorkspace"), accelerator: "Ctrl+Alt+Backspace", click: () => sendCmuxCommand("workspace.last") },
        { type: "separator" },
        { label: t("menu.tunePerformance"), click: () => sendCmuxCommand("settings.tunePerformance") },
        { label: t("menu.performanceSettings"), click: () => sendCmuxCommand("settings.performance") },
        { type: "separator" },
        { role: "reload" },
        { role: "toggleDevTools" }
      ]
    }
  ];
  // All keyboard dispatch belongs to the context-aware router. Menu accelerators
  // previously bypassed rebinding and could fire a second conflicting action.
  function clearAccelerators(items) { for(const item of items) {
    if(item.role && !['undo','redo','cut','copy','paste','selectAll'].includes(item.role)) item.accelerator='';
    else delete item.accelerator;
    if(item.submenu) clearAccelerators(item.submenu);
  } }
  clearAccelerators(template);
  return Menu.buildFromTemplate(template);
}

async function createWindow(owner = inProcessRuntime.createWindow()) {
  const bounds = initialWindowBounds();

  const mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 480,
    minHeight: 400,
    title: appName,
    icon: appIconPath,
    backgroundColor: "#111316",
    frame: false,
    thickFrame: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  windows.set(owner.id, mainWindow);
  mainWindow.webContents.cmuxWindowId = owner.id;
  mainWindow.once("closed", () => {
    windows.delete(owner.id);
    if (!quitting && windows.size) inProcessRuntime.closeWindow(owner.id);
  });

  let sessionFlushed = false;
  let sessionFlushTimer;
  mainWindow.on('close', event => {
    if (sessionFlushed || mainWindow.webContents.isDestroyed()) return;
    event.preventDefault();
    if (sessionFlushTimer) return;
    const finish = () => {
      clearTimeout(sessionFlushTimer);
      ipcMain.removeListener('session:flushed', flushListener);
      sessionFlushed = true;
      mainWindow?.close();
    };
    sessionFlushTimer = setTimeout(finish, 2000);
    const flushListener = reply => {
      if (reply.sender === mainWindow.webContents && isTrustedIpcEvent(reply)) finish();
    };
    ipcMain.on('session:flushed', flushListener);
    mainWindow.webContents.send('session:flush');
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.on("console-message", details => {
    log(`renderer console level=${details.level} ${details.sourceId}:${details.lineNumber} ${details.message}`);
  });
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    log(`did-fail-load code=${errorCode} description=${errorDescription} url=${validatedURL}`);
  });
  installCommandShortcutBridge(mainWindow.webContents);
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    log(`render-process-gone ${JSON.stringify(details)}`);
  });
  hardenWebContents(mainWindow.webContents);
  mainWindow.on("maximize", () => mainWindow?.webContents.send("window-state", { maximized: true }));
  mainWindow.on("unmaximize", () => mainWindow?.webContents.send("window-state", { maximized: false }));
  const launchUrl = new URL(runtimeInfo.url);
  launchUrl.searchParams.set("locale", process.env.CMUX_WINDOWS_LOCALE || app.getLocale());
  launchUrl.searchParams.set("token", owner.token);
  await mainWindow.loadURL(launchUrl.href);
}

function stopRuntime(event) {
  const runtime = inProcessRuntime;
  if (!runtime) return;
  // Keep Electron's Node environment alive while ConPTY delivers its exit callbacks.
  if (!runtime.closed) {
    runtime.close();
    void runtime.waitForPtyExits().then(() => {
      inProcessRuntime = null;
      app.quit();
    });
  }
  event.preventDefault();
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.setName(appName);
  if (process.platform === "win32") app.setAppUserModelId(appUserModelId);

  ipcMain.handle("window:minimize", trustedIpcHandler(event => {
    const mainWindow = BrowserWindow.fromWebContents(event.sender);
    mainWindow?.minimize();
    return true;
  }, false));
  ipcMain.handle("window:toggle-maximize", trustedIpcHandler(event => {
    const mainWindow = BrowserWindow.fromWebContents(event.sender);
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
    return mainWindow.isMaximized();
  }, false));
  ipcMain.handle("window:close", trustedIpcHandler(event => {
    const mainWindow = BrowserWindow.fromWebContents(event.sender);
    mainWindow?.close();
    return true;
  }, false));
  ipcMain.handle('shortcuts:get', trustedIpcHandler(()=>shortcutConfig.snapshot(),null));
  ipcMain.handle('accessibility:get',trustedIpcHandler(()=>app.accessibilitySupportEnabled,false));
  ipcMain.handle('files:list',trustedIpcHandler(async(_event,root,relative)=>{
    try{return {ok:true,...await workspaceFiles.list(root,relative)};}catch(error){return {ok:false,error:error.message};}
  },null));
  ipcMain.handle('files:read',trustedIpcHandler(async(_event,root,relative)=>{
    try{return {ok:true,...await workspaceFiles.read(root,relative)};}catch(error){return {ok:false,error:error.message};}
  },null));
  ipcMain.handle('files:write',trustedIpcHandler(async(_event,root,relative,text,revision)=>{
    try{return {ok:true,...await workspaceFiles.write(root,relative,text,revision)};}catch(error){return {ok:false,error:error.message};}
  },null));
  ipcMain.handle('files:create',trustedIpcHandler(async(_event,root,parent,name,kind)=>{
    try{return {ok:true,...await workspaceFiles.create(root,parent,name,kind)};}catch(error){return {ok:false,error:error.message};}
  },null));
  ipcMain.handle('files:rename',trustedIpcHandler(async(_event,root,relative,name)=>{
    try{return {ok:true,...await workspaceFiles.rename(root,relative,name)};}catch(error){return {ok:false,error:error.message};}
  },null));
  ipcMain.handle('files:duplicate',trustedIpcHandler(async(_event,root,relative,format)=>{
    try{return {ok:true,...await workspaceFiles.duplicate(root,relative,format)};}catch(error){return {ok:false,error:error.message};}
  },null));
  ipcMain.handle('files:trash',trustedIpcHandler(async(_event,root,relative)=>{
    try{return {ok:true,...await workspaceFiles.trash(root,relative)};}catch(error){return {ok:false,error:error.message};}
  },null));
  ipcMain.handle('files:image',trustedIpcHandler(async(_event,root,relative)=>{
    try{return {ok:true,...await workspaceFiles.readImage(root,relative)};}catch(error){return {ok:false,error:error.message};}
  },null));
  ipcMain.handle('files:search',trustedIpcHandler(async(event,root,query)=>{
    const id=event.sender.id;
    if(!workspaceSearchRenderers.has(event.sender)) {
      workspaceSearchRenderers.add(event.sender);
      event.sender.once('destroyed',()=>{workspaceSearchRequests.get(id)?.abort();workspaceSearchRequests.delete(id);});
    }
    workspaceSearchRequests.get(id)?.abort();
    const controller=new AbortController();workspaceSearchRequests.set(id,controller);
    try{return {ok:true,...await workspaceSearch.search(root,query,{signal:controller.signal})};}
    catch(error){return {ok:false,error:error.message};}
    finally{if(workspaceSearchRequests.get(id)===controller)workspaceSearchRequests.delete(id);}
  },null));
  ipcMain.handle('diff:preferences:get',trustedIpcHandler(async()=>({ok:true,preferences:await diffPreferences.get()}),null));
  ipcMain.handle('diff:preferences:set',trustedIpcHandler(async(_event,updates)=>{
    try {
      const preferences=await diffPreferences.merge(updates);
      for(const window of BrowserWindow.getAllWindows())window.webContents.send('diff:preferences-changed',preferences);
      return {ok:true,preferences};
    }catch{return {ok:false,error:'preferences_error'};}
  },null));
  ipcMain.handle('git:status',trustedIpcHandler(async(_event,root,options)=>{
    try{return {ok:true,...await workspaceGit.status(root,options)};}catch(error){return {ok:false,error:error.message};}
  },null));
  ipcMain.handle('git:diff',trustedIpcHandler(async(_event,root,filePath,options)=>{
    try{return {ok:true,...await workspaceGit.diff(root,filePath,options)};}catch(error){return {ok:false,error:error.message};}
  },null));
  app.on('accessibility-support-changed', (_event, enabled) => {
    for (const window of windows.values()) window.webContents.send('cmux-accessibility', enabled);
  });
  ipcMain.handle('shortcuts:update', trustedIpcHandler((_event,id,value,reset)=>publishShortcutSnapshot(shortcutConfig.update(id,value,reset)),null));
  ipcMain.handle('shortcuts:reload', trustedIpcHandler(()=>publishShortcutSnapshot(shortcutConfig.reload()),null));
  ipcMain.handle("workspace:drag", trustedIpcHandler((event, workspaceId, nonce) => {
    const windowId = event.sender.cmuxWindowId;
    if (!/^[a-f0-9-]{36}$/i.test(nonce) ||
        !inProcessRuntime.workspacesForWindow(windowId).some(workspace => workspace.id === workspaceId)) return false;
    workspaceDrags.set(windowId, { nonce, workspaceId, expires: Date.now() + 60000 });
    return true;
  }, false));
  ipcMain.handle("workspace:drop", trustedIpcHandler((event, nonce, beforeId) => {
    const source = [...workspaceDrags].find(([, drag]) => drag.nonce === nonce && drag.expires >= Date.now());
    if (!source) return false;
    const [sourceId, drag] = source;
    workspaceDrags.delete(sourceId);
    return inProcessRuntime.moveWorkspaceToWindow(drag.workspaceId, sourceId, event.sender.cmuxWindowId, beforeId);
  }, false));
  ipcMain.handle('shortcut:native', trustedIpcHandler(async (event,action,guestId)=>{
    const mainWindow = BrowserWindow.fromWebContents(event.sender);
    if(action==='quit') { app.quit(); return true; }
    if(action==='closeWindow') { mainWindow?.close(); return true; }
    if(action==='toggleFullScreen') { mainWindow?.setFullScreen(!mainWindow.isFullScreen()); return true; }
    if (action === "newWindow") {
      await createWindow();
      return true;
    }
    const guest=Number.isInteger(guestId)?require('electron').webContents.fromId(guestId):null;
    if(!guest || browserGuestOwners.get(guest)!==mainWindow?.webContents) return false;
    if(action==='browserHardReload') guest.reloadIgnoringCache();
    else if(action==='toggleBrowserDeveloperTools') guest.isDevToolsOpened()?guest.closeDevTools():guest.openDevTools({mode:'detach'});
    else if(action==='showBrowserJavaScriptConsole') {
      if(!guest.isDevToolsOpened()) {
        await new Promise(resolve=>{guest.once('devtools-opened',resolve);guest.openDevTools({mode:'detach',activate:true});});
      }
      await guest.devToolsWebContents.executeJavaScript("DevToolsAPI.showPanel('console')");
    }
    else if(action==='hideFind') guest.stopFindInPage('clearSelection');
    else return false;
    return true;
  },false));
  shortcutConfig.watch(publishShortcutSnapshot);
  ipcMain.handle("window:is-maximized", trustedIpcHandler(event => Boolean(BrowserWindow.fromWebContents(event.sender)?.isMaximized()), false));
  ipcMain.on("window:begin-resize", trustedIpcListener((event, edge, point) => beginWindowResize(BrowserWindow.fromWebContents(event.sender), edge, point)));
  ipcMain.on("window:resize", trustedIpcListener((event, point) => continueWindowResize(BrowserWindow.fromWebContents(event.sender), point)));
  ipcMain.on("window:end-resize", trustedIpcListener(() => {
    windowResizeSession = null;
  }));
  ipcMain.handle("open-external", trustedIpcHandler((_event, url, profileId = "system") => openUrlInBrowserProfile(url, profileId), { ok: false, error: "forbidden" }));
  ipcMain.handle("browser:surface", trustedIpcHandler((event, panelId, action, value) =>
    browserSurfaces.rendererAction(event.sender.cmuxWindowId, panelId, action, value), null));
  ipcMain.handle("browser:profiles", trustedIpcHandler(() => publicBrowserProfiles(), []));
  ipcMain.handle("open-path", trustedIpcHandler(async (_event, filePath) => {
    if (typeof filePath !== "string" || !filePath.trim()) return { ok: false, error: "missing path" };
    const targetPath = path.resolve(filePath);
    if (!fs.existsSync(targetPath)) return { ok: false, error: "path not found" };
    const error = await shell.openPath(targetPath);
    return { ok: !error, error };
  }, { ok: false, error: "forbidden" }));
  ipcMain.handle("clipboard:write-text", trustedIpcHandler((_event, text) => {
    clipboard.writeText(String(text || ""));
    return true;
  }, false));
  ipcMain.handle("clipboard:read-text", trustedIpcHandler(() => clipboard.readText(), ""));
  ipcMain.handle("clipboard:read-image-data-url", trustedIpcHandler(() => {
    const image = clipboard.readImage();
    if (!image || image.isEmpty()) return { ok: false, error: "empty" };
    const dataUrl = image.toDataURL();
    if (Buffer.byteLength(dataUrl, "utf8") > clipboardImageDataUrlLimitBytes) {
      return { ok: false, error: "too_large" };
    }
    return { ok: true, dataUrl };
  }, { ok: false, error: "forbidden" }));
  ipcMain.handle("background:pick-image", trustedIpcHandler(async event => {
    const mainWindow = BrowserWindow.fromWebContents(event.sender);
    if (!mainWindow) return "";
    const result = await dialog.showOpenDialog(mainWindow, {
      title: t("dialog.chooseBackground"),
      properties: ["openFile"],
      filters: [
        { name: t("dialog.images"), extensions: ["jpg", "jpeg", "png", "gif", "webp", "bmp", "avif", "svg"] }
      ]
    });
    const filePath = result.canceled ? "" : result.filePaths[0];
    return filePath ? pathToFileURL(filePath).href : "";
  }, ""));
  ipcMain.handle("workspace:pick-folder", trustedIpcHandler(async event => {
    const mainWindow = BrowserWindow.fromWebContents(event.sender);
    if (!mainWindow) return "";
    const result = await dialog.showOpenDialog(mainWindow, {
      title: t("dialog.chooseWorkspaceFolder"),
      properties: ["openDirectory", "createDirectory"]
    });
    return result.canceled ? "" : result.filePaths[0] || "";
  }, ""));

  app.on("second-instance", () => {
    const mainWindow = BrowserWindow.getFocusedWindow() || windows.values().next().value;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on("web-contents-created", (_event, contents) => hardenWebContents(contents));

  app.whenReady().then(async () => {
    await startRuntime();
    Menu.setApplicationMenu(buildMenu());
    for (const owner of inProcessRuntime.state.windows) await createWindow(inProcessRuntime.rendererWindow(owner.id));
  }).catch(error => {
    console.error(error);
    app.quit();
  });
  app.on("before-quit", () => { quitting = true; });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("will-quit", (event) => { shortcutConfig.close(); stopRuntime(event); });
}
