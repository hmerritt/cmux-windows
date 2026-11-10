const views = new Map();
let observer;
let frame;

function refreshBounds() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    for (const view of views.values()) view.syncBounds();
  });
}

export function createNativeBrowserView(panelId, userAgent) {
  const native = window.cmuxNative;
  const view = document.createElement("div");
  view.className = "browser-view";
  let mounted = false;
  let disposed = false;
  let current = {};
  let source = "";
  let geometry = "";
  const action = (name, value) => native.browserSurface(panelId, name, value).catch(() => null);
  view.dispatchBrowserEvent = (name, data) => {
    current = { ...current, ...data };
    if (data.url) source = data.url;
    view.dispatchEvent(Object.assign(new Event(name), data));
    refreshBounds();
  };
  if (!observer) {
    native.onBrowserSurfaceEvent((id, name, data) => views.get(id)?.dispatchBrowserEvent(name, data));
    observer = new ResizeObserver(refreshBounds);
    const overlays = new MutationObserver(refreshBounds);
    overlays.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "aria-hidden", "open"] });
    window.addEventListener("resize", refreshBounds);
    document.addEventListener("scroll", refreshBounds, true);
  }
  views.set(panelId, view);
  observer.observe(view);
  const mount = action("mount", { userAgent }).then(data => {
    if (!data || disposed) return null;
    mounted = true;
    view.dispatchBrowserEvent("did-attach", data);
    if (data.url) {
      view.dispatchBrowserEvent("did-navigate", data);
      view.dispatchBrowserEvent("dom-ready", data);
      if (!data.loading) view.dispatchBrowserEvent("did-stop-loading", data);
    }
    return data;
  });
  let firstNavigation = true;
  Object.defineProperty(view, "src", {
    get: () => source,
    set: url => {
      const initial = firstNavigation;
      firstNavigation = false;
      source = url;
      void mount.then(data => {
        if (!data || disposed || (initial && data.url)) return;
        return action("navigate", url);
      });
    }
  });
  view.syncBounds = () => {
    if (!mounted || disposed) return;
    const rect = view.getBoundingClientRect();
    const x = Math.max(0, Math.round(rect.left));
    const y = Math.max(0, Math.round(rect.top));
    const width = Math.min(innerWidth, Math.round(rect.right)) - x;
    const height = Math.min(innerHeight, Math.round(rect.bottom)) - y;
    const overlay = [...document.querySelectorAll('.context-menu:not([hidden]), #palette[aria-hidden="false"], .dialog-backdrop, dialog[open]')].some(element => {
      const bounds = element.getBoundingClientRect();
      return rect.left < bounds.right && rect.right > bounds.left && rect.top < bounds.bottom && rect.bottom > bounds.top;
    });
    const onTop = !overlay && width > 0 && height > 0 && document.elementFromPoint(x + width / 2, y + height / 2) === view;
    const bounds = onTop ? { x, y, width, height } : null;
    const signature = JSON.stringify(bounds);
    if (signature !== geometry) {
      geometry = signature;
      void action("bounds", bounds);
    }
  };
  view.dispose = () => {
    disposed = true;
    views.delete(panelId);
    observer.unobserve(view);
    void mount.then(() => action("unmount"));
  };
  view.getWebContentsId = () => current.id;
  view.canGoBack = () => current.canGoBack;
  view.canGoForward = () => current.canGoForward;
  view.isLoading = () => current.loading;
  view.isAudioMuted = () => current.muted;
  view.getZoomFactor = () => current.zoom;
  view.setAudioMuted = value => { current.muted = value; return action("mute", value); };
  view.setZoomFactor = value => { current.zoom = value; return action("zoom", value); };
  view.goBack = () => action("back");
  view.goForward = () => action("forward");
  view.reload = () => action("reload");
  view.stop = () => action("stop");
  view.focus = () => action("focus");
  return view;
}
