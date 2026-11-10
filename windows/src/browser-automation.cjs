const { browserUrl } = require("./browser-surfaces.cjs");

const world = 31337;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function describePage(selector, generation) {
  const root = selector ? document.querySelector(selector) : document.body;
  if (!root) throw new Error("Browser snapshot selector was not found");
  const controls = Array.from(root.querySelectorAll("a[href],button,input,textarea,select,[role],[contenteditable]"))
    .filter(node => node.getClientRects().length).slice(0, 200);
  globalThis.cmuxSnapshotElements = { generation, controls };
  return [
    document.title, location.href, (root.innerText || "").slice(0, 16000),
    ...controls.map((node, index) => {
      const label = node.getAttribute("aria-label") || node.labels?.[0]?.innerText || node.innerText ||
        node.getAttribute("placeholder") || node.getAttribute("name") || "";
      return `- ${node.getAttribute("role") || node.localName} ${label.trim().slice(0, 200)} [ref=e${generation}-${index + 1}]`;
    })
  ].join("\n");
}

function prepareInput(selector, kind, text) {
  const ref = /^@?e(\d+)-(\d+)$/.exec(selector);
  const snapshot = globalThis.cmuxSnapshotElements;
  const element = ref
    ? String(snapshot?.generation) === ref[1] && snapshot.controls[Number(ref[2]) - 1]
    : document.querySelector(selector);
  if (!element?.isConnected || !element.getClientRects().length) throw new Error("Browser element was not found");
  if (kind === "fill") {
    element.focus();
    if (element.matches("input,textarea")) {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value").set.call(element, text);
    } else if (element.isContentEditable) element.textContent = text;
    else throw new Error("Target is not editable");
    element.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  if (kind === "type") {
    element.focus();
    return true;
  }
  element.scrollIntoView({ block: "center", inline: "center" });
  const rect = element.getBoundingClientRect();
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function inPage(contents, fn, ...args) {
  return contents.executeJavaScriptInIsolatedWorld(world, [{ code: `(${fn})(...${JSON.stringify(args)})` }]);
}

async function sendInput(contents, run) {
  const debuggerSession = contents.debugger;
  if (debuggerSession.isAttached() || contents.isDevToolsOpened()) throw new Error("Close DevTools before automating input");
  debuggerSession.attach("1.3");
  try {
    await run((method, params) => debuggerSession.sendCommand(method, params));
  } finally {
    if (debuggerSession.isAttached()) debuggerSession.detach();
  }
}

async function perform(surfaces, panel, params, authorized, deadline) {
  const surface = surfaces.get(panel.id);
  const { contents } = surface;
  const snapshot = () => inPage(contents, describePage, params.selector || "", surface.generation = (surface.generation || 0) + 1);
  const command = params.command;
  const state = () => ({ surface_id: panel.id, ...surfaces.state(surface) });
  if (!authorized()) throw new Error("Browser automation permission was revoked");
  if (["navigate", "open", "open-split"].includes(command)) {
    const url = browserUrl(params.url || panel.url);
    if (contents.getURL() !== url) await contents.loadURL(url);
  } else if (command === "back" || command === "forward") {
    if (command === "back") contents.navigationHistory.goBack();
    else contents.navigationHistory.goForward();
  } else if (command === "reload") {
    contents.reload();
  } else if (command === "identify") {
    return state();
  } else if (command === "url") {
    return contents.getURL() || panel.url;
  } else if (command === "wait") {
    while (Date.now() < deadline) {
      if (!authorized()) throw new Error("Browser automation permission was revoked");
      const loaded = params.loadState !== "complete" || !contents.isLoading();
      const url = !params.urlContains || contents.getURL().includes(params.urlContains);
      const matches = await inPage(contents, (selector, text) =>
        (!selector || Boolean(document.querySelector(selector))) && (!text || document.body?.innerText.includes(text)),
      params.selector || "", params.text || "");
      if (loaded && url && matches) return state();
      await pause(100);
    }
    throw new Error("Browser wait timed out");
  } else if (command === "snapshot") {
    return snapshot();
  } else if (command === "eval") {
    if (typeof params.script !== "string" || !params.script.trim()) throw new Error("Missing JavaScript expression");
    return (await contents.executeJavaScript(params.script)) ?? null;
  } else if (command === "screenshot") {
    return { png: (await contents.capturePage()).toPNG().toString("base64") };
  } else if (["click", "type", "fill"].includes(command)) {
    if (typeof params.selector !== "string" || !params.selector) throw new Error("Missing element selector");
    if (command !== "click" && typeof params.text !== "string") throw new Error("Missing text");
    const target = await inPage(contents, prepareInput, params.selector, command, params.text || "");
    if (!authorized()) throw new Error("Browser automation permission was revoked");
    if (command === "click") {
      await sendInput(contents, async send => {
        for (const type of ["mousePressed", "mouseReleased"]) {
          await send("Input.dispatchMouseEvent", { type, ...target, button: "left", clickCount: 1 });
        }
      });
    } else if (command === "type") {
      await sendInput(contents, send => send("Input.insertText", { text: params.text }));
    }
  } else if (command === "press") {
    const key = params.key === "Esc" ? "Escape" : params.key;
    const codes = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };
    if (!codes[key] && (typeof key !== "string" || key.length !== 1)) throw new Error("Unsupported key");
    const code = codes[key] || key.toUpperCase().charCodeAt(0);
    await sendInput(contents, async send => {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key, windowsVirtualKeyCode: code,
        ...(key.length === 1 ? { text: key } : key === "Enter" ? { text: "\r" } : {}) });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key, windowsVirtualKeyCode: code });
    });
  }
  return params.snapshotAfter ? snapshot() : state();
}

async function runBrowserCommand(surfaces, panel, params, authorized) {
  const timeout = Math.max(100, Math.min(15000, Number(params.timeout) || 10000));
  let timer;
  try {
    const result = await Promise.race([
      perform(surfaces, panel, params, authorized, Date.now() + timeout),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Browser command timed out")), timeout); })
    ]);
    if (!authorized()) throw new Error("Browser automation permission was revoked");
    if (Buffer.byteLength(JSON.stringify(result)) > 8 * 1024 * 1024) throw new Error("Browser response is too large");
    return result;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { runBrowserCommand };
