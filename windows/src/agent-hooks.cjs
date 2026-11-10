const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { modify, applyEdits, parse } = require("jsonc-parser");
const { atomicWrite } = require("./session-restore.cjs");

function setupAgentHooks(agent, launcher) {
  if (!["codex", "claude"].includes(agent)) throw new Error("Expected codex or claude");
  if (!launcher || !path.isAbsolute(launcher) || /[\x00-\x1f]/.test(launcher)) {
    throw new Error("Run hook setup from a cmux terminal");
  }
  const directory = agent === "codex"
    ? process.env.CODEX_HOME || path.join(os.homedir(), ".codex")
    : process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  const file = path.join(directory, agent === "codex" ? "hooks.json" : "settings.json");
  let source = fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/^\ufeff/, "") : "{}";
  const errors = [];
  const config = parse(source, errors, { allowTrailingComma: true });
  if (errors.length || !config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("The existing hook configuration could not be parsed");
  }
  if (Object.hasOwn(config, "hooks") && (!config.hooks || typeof config.hooks !== "object" || Array.isArray(config.hooks))) {
    throw new Error("The existing hooks property is invalid");
  }
  for (const [name, event] of [["SessionStart", "start"], ["SessionEnd", "end"]]) {
    const existing = config.hooks?.[name];
    if (existing !== undefined && !Array.isArray(existing)) throw new Error("The existing hook entry is invalid");
    const script = `if ($env:CMUX_WINDOWS_PANEL_TOKEN) {
      $payload = [Console]::In.ReadToEnd()
      $payload | & '${launcher.replaceAll("'", "''")}' agent-hook ${agent} ${event}
      exit $LASTEXITCODE
    }`;
    const command = `powershell.exe -NoLogo -NoProfile -EncodedCommand ${Buffer.from(script, "utf16le").toString("base64")}`;
    if (existing?.some(group => Array.isArray(group?.hooks) && group.hooks.some(hook => hook?.command === command))) continue;
    const entry = { hooks: [{ type: "command", command }] };
    source = applyEdits(source, modify(source, existing ? ["hooks", name, -1] : ["hooks", name], existing ? entry : [entry], {
      formattingOptions: { insertSpaces: true, tabSize: 2 }
    }));
  }
  atomicWrite(file, source);
  return file;
}

module.exports = { setupAgentHooks };
