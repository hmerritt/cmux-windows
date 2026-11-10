const { WebContentsView, session } = require("electron");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

async function readLegacyLayouts(profile, port) {
  const source = path.join(profile, "Local Storage", "leveldb");
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return {};
  try { await fs.access(source); } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
  const copy = await fs.mkdtemp(path.join(os.tmpdir(), "cmux-legacy-layout-"));
  let guest;
  let storage;
  try {
    await fs.cp(source, path.join(copy, "Local Storage", "leveldb"), { recursive: true });
    storage = session.fromPath(copy, { cache: false });
    storage.protocol.handle("http", () => new Response("<!doctype html><title>cmux session recovery</title>", {
      headers: { "content-type": "text/html" }
    }));
    guest = new WebContentsView({ webPreferences: { session: storage, sandbox: true, contextIsolation: true } }).webContents;
    await guest.loadURL(`http://127.0.0.1:${port}/`);
    return await guest.executeJavaScript(`(() => {
      const read = (key, fallback) => {
        try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; }
        catch { return fallback; }
      };
      const groups = read("cmux.paneTabGroups", []);
      return { trees: read("cmux.paneTreeLayouts", {}), groups: Array.isArray(groups) ? groups : [],
        browserTabs: read("cmux.browserTabs", {}) };
    })()`);
  } finally {
    guest?.close();
    storage?.protocol.unhandle("http");
    if (storage) await storage.clearStorageData({ storages: ["localstorage"] }).catch(() => {});
    // Chromium can retain a LevelDB handle until exit on Windows.
    await fs.rm(copy, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { readLegacyLayouts };
