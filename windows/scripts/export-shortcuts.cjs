// Extract the macOS registry rather than maintaining another action-ID list.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'Sources/KeyboardShortcutSettings.swift'), 'utf8');
const extensions = ['KeyboardShortcutSettings+DiffViewerNavigation.swift', 'SimulatorCommandPaletteIntegration.swift'].map(file=>fs.readFileSync(path.join(root,'Sources',file),'utf8')).join('\n');
const localized = JSON.parse(fs.readFileSync(path.join(root,'Resources/Localizable.xcstrings'),'utf8')).strings;
const enumSource = source.split('enum Action:')[1].split('var id:')[0];
const actions = [];
for (const line of enumSource.split('\n')) {
  const match = line.match(/^\s*case (.*)/);
  if (!match) continue;
  for (const item of match[1].split(',')) {
    const value = item.trim().match(/^(\w+)(?:\s*=\s*"([^"]+)")?$/);
    if (value) actions.push({name:value[1], id:value[2] || value[1]});
  }
}
const defaults = source.split('var defaultShortcut: StoredShortcut {')[1].split('func ' )[0];
const cases = [...defaults.matchAll(/case\s+((?:\.\w+[\s,]*)+):([\s\S]*?)(?=\n\s*case |\n\s*}\n)/g)];
const specialKeys = {'\r':'enter','\t':'tab','←':'left','→':'right','↑':'up','↓':'down',' ':'space'};
const entries = actions.map(action => {
  const labelBlock = source.split('var label: String {')[1].split('var defaultsKey:')[0] + extensions;
  const label = labelBlock.match(new RegExp(`case \\.${action.name}:\\s*(?:return )?String\\(\\s*localized: "([^"]+)",\\s*defaultValue: "([^"]+)"\\s*\\)`));
  let block = cases.find(match => [...match[1].matchAll(/\.(\w+)/g)].some(value=>value[1]===action.name))?.[2] || '';
  if (block.includes('return simulatorDefaultShortcut') || block.includes('return diffViewerNavigationDefaultShortcut')) {
    const extraDefaults = extensions.split(/var (?:simulatorDefaultShortcut|diffViewerNavigationDefaultShortcut): StoredShortcut \{/).slice(1).join('\n');
    block = extraDefaults.match(new RegExp(`case \\.${action.name}:([\\s\\S]*?)(?=case |default:)`))?.[1] || '';
  }
  const strokes = [...block.matchAll(/(?:StoredShortcut|ShortcutStroke)\(key: "((?:\\.|[^"\\])*)", command: (true|false), shift: (true|false), option: (true|false), control: (true|false)\)/g)];
  let mac = strokes.map(stroke => {
    const key = JSON.parse(`"${stroke[1]}"`);
    return [stroke[5]==='true'?'ctrl':null, stroke[4]==='true'?'alt':null, stroke[3]==='true'?'shift':null, stroke[2]==='true'?'cmd':null, specialKeys[key] || key.toLowerCase()].filter(Boolean).join('+');
  });
  if (action.name==='diffViewerScrollToTop') mac=['g','g'];
  const windows = mac.map(stroke => {
    const parts = stroke.split('+');
    // Cmd becomes Ctrl. A separate prefix preserves the distinct Cmd+Control
    // family without swallowing Windows-reserved Win-key combinations.
    if (parts.includes('cmd') && parts.includes('ctrl')) return ['ctrl+shift+space', parts.filter(p=>p!=='ctrl').map(p=>p==='cmd'?'ctrl':p).join('+')];
    return parts.map(p=>p==='cmd'?'ctrl':p).join('+');
  }).flat();
  if (action.name==='selectSurfaceByNumber') windows.splice(0, windows.length, 'alt+1');
  if (action.name.startsWith('resizePane')) windows.splice(0,windows.length,`ctrl+alt+shift+${mac[0].at(-1)}`);
  const labelKey = label?.[1] || `shortcut.${action.name}.label`;
  const translations = Object.fromEntries(Object.entries(localized[labelKey]?.localizations || {}).map(([locale,value])=>[locale,value.stringUnit?.value]).filter(([,value])=>value));
  const aliases = {nextSurface:['ctrl+tab'],prevSurface:['ctrl+shift+tab'],nextSidebarTab:['ctrl+pagedown'],prevSidebarTab:['ctrl+pageup'],findNext:['f3'],findPrevious:['shift+f3'],toggleFullScreen:['f11'],browserZoomIn:['ctrl+shift+=']}[action.id] || [];
  return {id:action.id, labelKey, label:label?.[2] || translations.en || '', translations, aliases, mac:mac.length>1?mac:mac[0]||null, defaultBinding:windows.length>1?windows:windows[0]||null};
});
if (entries.length < 140 || entries.some(entry=>!entry.label)) throw new Error('Shortcut registry extraction incomplete: '+entries.filter(entry=>!entry.label).map(entry=>entry.id).join(', '));
const output = '// Generated from Sources/KeyboardShortcutSettings.swift by npm run build:shortcuts.\nexport default '+JSON.stringify(entries,null,2)+';\n';
fs.writeFileSync(path.join(root,'windows/renderer/shortcut-catalog.mjs'), output);
const {scopes}=require('../renderer/shortcut-scopes.mjs');
const format=binding=>Array.isArray(binding)?binding.join(', '):binding||'Unbound';
const table=['| Action | Windows default | Additional defaults | Availability |','| --- | --- | --- | --- |',...entries.map(action=>`| ${action.label} (\`${action.id}\`) | \`${format(action.defaultBinding)}\` | ${action.aliases.map(alias=>'`'+alias+'`').join(' / ')} | ${scopes[action.id]?'Available':'Requires a feature not yet ported'} |`)].join('\n');
const document=path.join(root,'windows/KEYBINDINGS.md');
if(fs.existsSync(document)) {
  const text=fs.readFileSync(document,'utf8');
  fs.writeFileSync(document,text.replace(/<!-- shortcut-table -->[\s\S]*?<!-- \/shortcut-table -->/,'<!-- shortcut-table -->\n'+table+'\n<!-- /shortcut-table -->'));
}
console.log(`Exported ${entries.length} cmux shortcut actions.`);
