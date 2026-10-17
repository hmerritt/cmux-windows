const {test} = require('node:test');
const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const path = require('node:path');
const {TerminalDirectoryReports} = require('../src/terminal-directory.cjs');

test('directory reports tolerate every PTY chunk boundary and both OSC terminators', () => {
  const cwd = path.resolve('directory with spaces Ω');
  for (const end of ['\x07', '\x1b\\']) {
    const report = '\x1b]7;' + pathToFileURL(cwd).href + end;
    for (let split = 1; split < report.length; split++) {
      const reader = new TerminalDirectoryReports();
      assert.deepEqual([...reader.read(report.slice(0, split)), ...reader.read(report.slice(split))], [cwd]);
    }
    const reader = new TerminalDirectoryReports();
    assert.deepEqual([...report].flatMap(character => reader.read(character)), [cwd]);
  }
});
test('CMD directory reports coexist with titles and reject malformed or remote reports', () => {
  const reader = new TerminalDirectoryReports();
  const cwd = path.resolve('another directory');
  assert.deepEqual(reader.read('\x1b]0;Terminal\x07\x1b]9;9;"'+cwd+'"\x1b\\'), [cwd]);
  assert.deepEqual(reader.read('\x1b]7;https://example.com/path\x07\x1b]7;file://other-machine/c$/test\x07\x1b]7;broken%\x07'), []);
  assert.deepEqual(reader.read('\x1b]7;file:///C:\\directory # 50% Ω\x07'), ['C:\\directory # 50% Ω']);
  reader.read('\x1b]7;'+'x'.repeat(9000));
  assert.deepEqual(reader.read('\x07\x1b]7;'+pathToFileURL(cwd).href+'\x07'), [cwd]);
});
