const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const path = require("node:path");

const execute = promisify(execFile);
const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const validPid = value => Number.isInteger(value) && value > 0 && value <= 0xffffffff;

async function agentProcess(agent, hookPid, shellPid) {
  if (process.platform !== "win32" || !["codex", "claude"].includes(agent) ||
      !validPid(hookPid) || !validPid(shellPid)) return null;
  const script = `
$procId = ${hookPid}
$candidate = $null
for ($i = 0; $i -lt 16 -and $procId -gt 0; $i++) {
  if ($procId -eq ${shellPid}) {
    if ($candidate) { $candidate | ConvertTo-Json -Compress }
    break
  }
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$procId"
  if (!$proc) { break }
  if (!$candidate -and ($proc.Name -ieq '${agent}.exe' -or
      ('${agent}' -eq 'claude' -and $proc.Name -ieq 'node.exe' -and $proc.CommandLine -match 'claude-code[\\\\/]cli\\.js'))) {
    $candidate = @{ pid = $proc.ProcessId; created = $proc.CreationDate.ToUniversalTime().Ticks.ToString() }
  }
  $procId = $proc.ParentProcessId
}`;
  return run(script);
}

async function agentProcessIsLive({ pid, created } = {}) {
  if (process.platform !== "win32" || !validPid(pid) || !/^\d+$/.test(created || "")) return false;
  const result = await run(`
$proc = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"
if ($proc -and $proc.CreationDate.ToUniversalTime().Ticks.ToString() -eq '${created}') { 'true' }
`);
  return result === true;
}

async function run(script) {
  try {
    const { stdout } = await execute(powershell, ["-NoProfile", "-NonInteractive", "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64")], { windowsHide: true, timeout: 5000, maxBuffer: 16384 });
    return JSON.parse(stdout.trim());
  } catch { return null; }
}

module.exports = { agentProcess, agentProcessIsLive };
