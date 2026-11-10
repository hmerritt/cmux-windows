const fs = require("node:fs");
const path = require("node:path");
const { stripVTControlCharacters } = require("node:util");
const { randomUUID } = require("node:crypto");

const scrollbackLimit = 96 * 1024;

function plainScrollback(output) {
  return stripVTControlCharacters(String(output || ""))
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "")
    .replace(/\r\n?/g, "\n")
    .slice(-scrollbackLimit);
}

function atomicJson(file, value) {
  atomicWrite(file, JSON.stringify(value, null, 2));
}

function atomicWrite(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, contents, { flag: "wx", flush: true });
    fs.renameSync(temporary, file);
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

function agentSession(agent, sessionId, home) {
  if (!["claude", "codex"].includes(agent) || typeof sessionId !== "string" ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(sessionId)) return null;
  return { agent, sessionId, ...(typeof home === "string" && home.length <= 2048 && !/[\x00-\x1f]/.test(home) && path.isAbsolute(home)
    ? { home } : {}) };
}

function resumeScript(session) {
  if (!session) return "";
  const verb = session.agent === "codex" ? "resume" : "--resume";
  const homeKey = session.agent === "codex" ? "CODEX_HOME" : "CLAUDE_CONFIG_DIR";
  const home = session.home ? `$env:${homeKey} = '${session.home.replaceAll("'", "''")}'\n` : "";
  return `
${home}$cmuxResumeAgent = Get-Command '${session.agent}' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if ($cmuxResumeAgent) {
  & $cmuxResumeAgent.Source '${verb}' '${session.sessionId}'
  if ($LASTEXITCODE -ne 0) { Write-Host 'cmux could not resume the agent session.' }
} else { Write-Host 'cmux could not find the agent executable.' }
`;
}

module.exports = { agentSession, atomicJson, atomicWrite, plainScrollback, resumeScript };
