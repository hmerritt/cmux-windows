const os = require('node:os');
const {fileURLToPath} = require('node:url');

// Shell output can split an OSC report across any pair of PTY chunks.
class TerminalDirectoryReports {
  constructor() { this.pending = ''; }
  read(data) {
    const input = this.pending + data;
    const directories = [];
    const reports = /\x1b\]([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
    let match;
    let completedEnd = 0;
    while ((match = reports.exec(input))) {
      completedEnd = reports.lastIndex;
      const report = match[1];
      if (report.length > 8192) continue;
      try {
        if (report.startsWith('7;')) {
          const location = report.slice(2);
          // CMD's $P is a native path, so # and % are literal directory characters.
          if (/^file:\/\/\/[a-z]:\\/i.test(location)) {
            directories.push(location.slice(8));
            continue;
          }
          const url = new URL(location);
          if (url.protocol === 'file:' && ['', 'localhost', os.hostname().toLowerCase()].includes(url.hostname.toLowerCase())) {
            directories.push(fileURLToPath(url));
          }
        } else if (report.startsWith('9;9;')) {
          directories.push(report.slice(4).replace(/^"(.*)"$/, '$1'));
        }
      } catch { /* Ignore invalid directory reports from terminal applications. */ }
    }
    const start = input.lastIndexOf('\x1b]');
    this.pending = start >= completedEnd && start >= 0 && input.length - start <= 8192 && !/[\x07]|\x1b\\/.test(input.slice(start + 2))
      ? input.slice(start) : input.endsWith('\x1b') ? '\x1b' : '';
    return directories.filter(directory => directory && !/[\x00-\x1f]/.test(directory));
  }
}

function directoryReportingShellArgs(shellPath) {
  const base = require('node:path').basename(shellPath).toLowerCase();
  if (base === 'pwsh.exe' || base === 'powershell.exe') {
    const script = `$global:__cmuxOriginalPrompt = (Get-Command prompt -CommandType Function).ScriptBlock
function global:prompt {
  if ($PWD.Provider.Name -eq 'FileSystem') {
    [Console]::Write(([char]27) + ']7;' + ([uri]::new($PWD.ProviderPath)).AbsoluteUri + [char]7)
  }
  & $global:__cmuxOriginalPrompt
}`;
    return ['-NoLogo', '-NoExit', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
  }
  if (base === 'cmd.exe') return ['/K', 'prompt $E]7;file:///$P$E\\$P$G'];
  return [];
}

module.exports = {TerminalDirectoryReports, directoryReportingShellArgs};
