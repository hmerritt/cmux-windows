const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { modify, applyEdits, parse } = require("jsonc-parser");

function setupAgentHooks(agent, launcher) {
  if (!["codex", "claude"].includes(agent)) throw new Error("Expected codex or claude");
  if (!launcher || !path.isAbsolute(launcher) || /["%\r\n]/.test(launcher)) {
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
  for (const [name, event] of [["SessionStart", "start"], ["SessionEnd", "end"]]) {
    const existing = config.hooks?.[name] || [];
    if (!Array.isArray(existing)) throw new Error("The existing hook entry is invalid");
    const command = `cmd.exe /d /s /c '""${launcher}" agent-hook ${agent} ${event}"'`;
    if (existing.some(group => group?.hooks?.some(hook => hook.command === command))) continue;
    const entries = [...existing, { hooks: [{ type: "command", command }] }];
    source = applyEdits(source, modify(source, ["hooks", name], entries, {
      formattingOptions: { insertSpaces: true, tabSize: 2 }
    }));
  }
  fs.mkdirSync(directory, { recursive: true });
  const temp = file + ".cmux.tmp";
  fs.writeFileSync(temp, source);
  fs.renameSync(temp, file);
  return file;
}

module.exports = { setupAgentHooks };
