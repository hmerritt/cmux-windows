const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("cmuxNative", {
  electron: true,
  platform: process.platform,
  getAccessibilitySupport:()=>ipcRenderer.invoke('accessibility:get'),
  listWorkspaceFiles:(root,relative='')=>ipcRenderer.invoke('files:list',root,relative),
  createWorkspaceEntry:(root,parent,name,kind)=>ipcRenderer.invoke('files:create',root,parent,name,kind),
  renameWorkspaceEntry:(root,relative,name)=>ipcRenderer.invoke('files:rename',root,relative,name),
  duplicateWorkspaceEntry:(root,relative,format)=>ipcRenderer.invoke('files:duplicate',root,relative,format),
  trashWorkspaceEntry:(root,relative)=>ipcRenderer.invoke('files:trash',root,relative),
  searchWorkspaceFiles:(root,query)=>ipcRenderer.invoke('files:search',root,query),
  readWorkspaceFile:(root,relative)=>ipcRenderer.invoke('files:read',root,relative),
  readWorkspaceImage:(root,relative)=>ipcRenderer.invoke('files:image',root,relative),
  getDiffPreferences:()=>ipcRenderer.invoke('diff:preferences:get'),
  setDiffPreferences:updates=>ipcRenderer.invoke('diff:preferences:set',updates),
  onDiffPreferencesChanged(callback){ipcRenderer.on('diff:preferences-changed',(_event,preferences)=>callback(preferences));},
  workspaceGitStatus:(root,options)=>ipcRenderer.invoke('git:status',root,options),
  workspaceGitDiff:(root,filePath,options)=>ipcRenderer.invoke('git:diff',root,filePath,options),
  writeWorkspaceFile:(root,relative,text,revision)=>ipcRenderer.invoke('files:write',root,relative,text,revision),
  onAccessibilitySupport(callback){ipcRenderer.on('cmux-accessibility',(_event,enabled)=>callback(enabled));},
  getShortcuts: () => ipcRenderer.invoke('shortcuts:get'),
  updateShortcut: (id,value,reset=false) => ipcRenderer.invoke('shortcuts:update',id,value,reset),
  reloadShortcuts: () => ipcRenderer.invoke('shortcuts:reload'),
  nativeShortcut: (action,guestId) => ipcRenderer.invoke('shortcut:native',action,guestId),
  onShortcut(callback) { ipcRenderer.on('cmux-shortcut',(_event,value)=>callback(value)); },
  onShortcutsChanged(callback) { ipcRenderer.on('cmux-shortcuts-changed',(_event,value)=>callback(value)); },
  onCommand(callback) {
    ipcRenderer.on("cmux-command", (_event, command) => callback(command));
  },
  minimizeWindow() {
    return ipcRenderer.invoke("window:minimize");
  },
  toggleMaximizeWindow() {
    return ipcRenderer.invoke("window:toggle-maximize");
  },
  closeWindow() {
    return ipcRenderer.invoke("window:close");
  },
  isWindowMaximized() {
    return ipcRenderer.invoke("window:is-maximized");
  },
  onWindowState(callback) {
    ipcRenderer.on("window-state", (_event, state) => callback(state));
  },
  beginWindowResize(edge, point) {
    ipcRenderer.send("window:begin-resize", edge, point);
  },
  resizeWindow(point) {
    ipcRenderer.send("window:resize", point);
  },
  endWindowResize() {
    ipcRenderer.send("window:end-resize");
  },
  openExternal(url, profileId = "system") {
    return ipcRenderer.invoke("open-external", url, profileId);
  },
  listBrowserProfiles() {
    return ipcRenderer.invoke("browser:profiles");
  },
  openPath(filePath) {
    return ipcRenderer.invoke("open-path", filePath);
  },
  writeClipboard(text) {
    return ipcRenderer.invoke("clipboard:write-text", text);
  },
  readClipboard() {
    return ipcRenderer.invoke("clipboard:read-text");
  },
  readClipboardImage() {
    return ipcRenderer.invoke("clipboard:read-image-data-url");
  },
  pickBackgroundImage() {
    return ipcRenderer.invoke("background:pick-image");
  },
  filePath(file) {
    return webUtils?.getPathForFile?.(file) || file?.path || "";
  },
  pickWorkspaceFolder() {
    return ipcRenderer.invoke("workspace:pick-folder");
  }
});
