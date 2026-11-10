const { WebContentsView, session } = require("electron");
const { createSshProxy } = require("./ssh-proxy.cjs");

function browserUrl(url) {
  const parsed = new URL(url);
  if (parsed.href !== "about:blank" && !["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Unsupported browser URL");
  }
  return parsed.href;
}

class BrowserSurfaces {
  constructor({ runtime, windows, configure }) {
    this.runtime = runtime;
    this.windows = windows;
    this.configure = configure;
    this.surfaces = new Map();
  }

  remoteBrowser(workspaceId) {
    const remote = this.runtime.remoteWorkspaces.get(workspaceId);
    if (!remote) return null;
    const partition = session.fromPartition(`persist:cmux-ssh-${workspaceId}`);
    if (!remote.proxy) {
      partition.webRequest.onBeforeRequest((details, reply) => {
        reply({ cancel: remote.state !== "connected" && /^(https?|wss?):/i.test(details.url) });
      });
      remote.proxy = createSshProxy(remote);
      remote.browserReady = remote.proxy.then(async proxy => {
        await partition.setProxy({
          mode: "fixed_servers", proxyRules: `http://127.0.0.1:${proxy.port}`, proxyBypassRules: "<-loopback>"
        });
        return proxy;
      });
      remote.browserReady.catch(() => {});
    }
    return { partition, ready: remote.browserReady };
  }

  authenticateProxy(contents, info, callback) {
    if (!info.isProxy || info.host !== "127.0.0.1") return false;
    const surface = [...this.surfaces.values()].find(item => item.contents === contents && item.remote);
    if (!surface) return false;
    surface.remote.ready.then(proxy => {
      if (info.port === proxy.port && info.realm === proxy.realm) callback(proxy.username, proxy.password);
      else callback();
    }).catch(() => callback());
    return true;
  }

  find(panelId) {
    const found = this.runtime.findPanel(panelId);
    return found?.panel.type === "browser" ? found : null;
  }

  get(panelId, userAgent) {
    if (this.surfaces.has(panelId)) return this.surfaces.get(panelId);
    const found = this.find(panelId);
    if (!found) throw new Error("Browser surface not found");
    const remote = this.remoteBrowser(found.workspace.id);
    const view = new WebContentsView({
      webPreferences: {
        ...(remote ? { session: remote.partition } : { partition: "persist:cmux-browser" }),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    });
    const contents = view.webContents;
    if (userAgent) contents.setUserAgent(userAgent);
    const surface = { view, contents, panelId, owner: null, remote };
    this.surfaces.set(panelId, surface);
    this.configure(contents);
    this.restrictRemote(surface);
    const emit = (event, details = {}) => {
      const current = this.find(panelId);
      if (!current || surface.owner?.isDestroyed() || !surface.owner) return;
      surface.owner.webContents.send("browser:surface-event", panelId, event, { ...this.state(surface), ...details });
    };
    const navigate = (_event, url, _status, _text) => {
      const panel = this.find(panelId)?.panel;
      if (panel) {
        panel.url = url;
        const history = contents.navigationHistory;
        const index = history.getActiveIndex();
        const entries = history.getAllEntries().map(entry => ({ url: entry.url, title: entry.title }));
        const start = Math.max(0, index - 50);
        panel.browserHistory = { index: index - start, entries: entries.slice(start, start + 100) };
        this.runtime.schedulePersistSession();
      }
      emit("did-navigate", { url });
    };
    contents.on("did-navigate", navigate);
    contents.on("did-start-navigation", event => {
      if (event.isMainFrame !== false) surface.generation = (surface.generation || 0) + 1;
    });
    contents.on("did-navigate-in-page", (event, url, isMainFrame) => {
      if (isMainFrame) navigate(event, url);
    });
    for (const event of ["dom-ready", "did-start-loading", "did-stop-loading", "did-finish-load", "focus", "blur"]) {
      contents.on(event, () => emit(event));
    }
    contents.on("page-title-updated", (_event, title) => emit("page-title-updated", { title }));
    contents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) =>
      emit("did-fail-load", { errorCode, errorDescription, validatedURL, isMainFrame }));
    contents.once("destroyed", () => this.surfaces.delete(panelId));
    return surface;
  }

  state({ contents }) {
    return {
      id: contents.id,
      url: contents.getURL(),
      title: contents.getTitle(),
      loading: contents.isLoading(),
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
      muted: contents.isAudioMuted(),
      zoom: contents.getZoomFactor()
    };
  }

  navigate(surface, url) {
    const target = browserUrl(url);
    if (surface.navigation?.url === target) return surface.navigation.promise;
    if (surface.contents.getURL() === target && !surface.navigation) return Promise.resolve();
    const navigation = { url: target };
    surface.navigation = navigation;
    navigation.promise = surface.contents.loadURL(target).finally(() => {
      if (surface.navigation === navigation) surface.navigation = null;
    });
    return navigation.promise;
  }

  detach(surface) {
    if (surface.owner && !surface.owner.isDestroyed()) surface.owner.contentView.removeChildView(surface.view);
    surface.view.setVisible(false);
    surface.owner = null;
    this.configure(surface.contents);
    this.restrictRemote(surface);
  }

  restrictRemote({ contents, remote }) {
    if (!remote || contents.isDestroyed()) return;
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.setWebRTCIPHandlingPolicy?.("disable_non_proxied_udp");
  }

  reconcile() {
    for (const [panelId, surface] of this.surfaces) {
      const found = this.find(panelId);
      if (!found) {
        this.detach(surface);
        surface.contents.close();
      } else if (surface.owner && surface.owner !== this.windows.get(found.workspace.windowId)) {
        this.detach(surface);
      }
    }
  }

  close() {
    for (const surface of this.surfaces.values()) {
      this.detach(surface);
      if (!surface.contents.isDestroyed()) surface.contents.close();
    }
  }

  async rendererAction(windowId, panelId, action, value) {
    if (this.find(panelId)?.workspace.windowId !== windowId) return null;
    const window = this.windows.get(windowId);
    if (!window || window.isDestroyed()) return null;
    if (action === "mount") {
      const surface = this.get(panelId, value?.userAgent);
      if (surface.owner !== window) {
        this.detach(surface);
        surface.owner = window;
        window.contentView.addChildView(surface.view);
        this.configure(surface.contents, window.webContents);
        this.restrictRemote(surface);
      }
      if (surface.remote) await surface.remote.ready;
      if (this.find(panelId)?.workspace.windowId !== windowId || surface.owner !== window) return null;
      const history = this.find(panelId)?.panel.browserHistory;
      if (!surface.restoring && !surface.navigation && !surface.contents.getURL() && Array.isArray(history?.entries) &&
          history.entries.length <= 100 && history.entries.every(entry => {
            try { return browserUrl(entry.url) === entry.url; } catch { return false; }
          }) && Number.isInteger(history.index) && history.index >= 0 && history.index < history.entries.length) {
        surface.restoring = surface.contents.navigationHistory.restore({
          index: history.index,
          entries: history.entries.map(({ url, title }) => ({ url, title }))
        }).catch(() => {}).finally(() => { surface.restoring = null; });
        await surface.restoring;
      }
      return this.state(surface);
    }
    const surface = this.surfaces.get(panelId);
    if (!surface || surface.owner !== window) return null;
    const { view, contents } = surface;
    switch (action) {
      case "bounds": {
        if (!value) {
          view.setVisible(false);
          return true;
        }
        const { x, y, width, height } = value;
        const size = window.getContentBounds();
        if (![x, y, width, height].every(Number.isInteger) || x < 0 || y < 0 || width <= 0 || height <= 0
            || x + width > size.width + 1 || y + height > size.height + 1) return false;
        view.setBounds({ x, y, width, height });
        view.setVisible(true);
        return true;
      }
      case "unmount": this.detach(surface); return true;
      case "navigate":
        if (surface.remote) await surface.remote.ready;
        if (this.find(panelId)?.workspace.windowId !== windowId || surface.owner !== window) return null;
        void this.navigate(surface, value).catch(() => {});
        return true;
      case "back": contents.navigationHistory.goBack(); return true;
      case "forward": contents.navigationHistory.goForward(); return true;
      case "reload": contents.reload(); return true;
      case "stop": contents.stop(); return true;
      case "focus": contents.focus(); return true;
      case "mute": contents.setAudioMuted(Boolean(value)); return true;
      case "zoom": contents.setZoomFactor(Math.max(0.5, Math.min(3, Number(value) || 1))); return true;
      default: return null;
    }
  }
}

module.exports = { BrowserSurfaces, browserUrl };
