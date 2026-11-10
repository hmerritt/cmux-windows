const fs = require("node:fs");
const path = require("node:path");
const { stripVTControlCharacters } = require("node:util");

const scrollbackLimit = 96 * 1024;

function plainScrollback(output) {
  return stripVTControlCharacters(String(output || ""))
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "")
    .replace(/\r\n?/g, "\n")
    .slice(-scrollbackLimit);
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, file);
}

function agentSession(agent, sessionId, home) {
  if (!["claude", "codex"].includes(agent) || typeof sessionId !== "string" ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(sessionId)) return null;
  return { agent, sessionId, ...(agent === "codex" && typeof home === "string" && path.isAbsolute(home)
    ? { home: home.slice(0, 2048) } : {}) };
}

function resumeScript(session) {
  if (!session) return "";
  const verb = session.agent === "codex" ? "resume" : "--resume";
  const home = session.home ? `$env:CODEX_HOME = '${session.home.replaceAll("'", "''")}'\n` : "";
  return `
${home}$cmuxResumeAgent = Get-Command '${session.agent}' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if ($cmuxResumeAgent) {
  & $cmuxResumeAgent.Source '${verb}' '${session.sessionId}'
  if ($LASTEXITCODE -ne 0) { Write-Host 'cmux could not resume the agent session.' }
} else { Write-Host 'cmux could not find the agent executable.' }
`;
}

module.exports = { agentSession, atomicJson, plainScrollback, resumeScript };
