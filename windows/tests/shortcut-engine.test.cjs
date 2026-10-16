const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const engine=require('../renderer/shortcut-engine.mjs');
const {scopes,actionAvailable,actionPriority}=require('../renderer/shortcut-scopes.mjs');
const {ShortcutConfig}=require('../src/shortcut-config.cjs');
const terminal={terminalFocus:true}, browser={browserFocus:true};
const event=(key,extra={})=>({key,ctrlKey:true,...extra});
function router(settings={}) {const result=new engine.ShortcutRouter([...engine.catalog].sort((a,b)=>actionPriority(a.id)-actionPriority(b.id)));result.configure(settings);return result;}
test('default shortcuts route supported actions and preserve shell controls',()=>{
  const r=router();
  assert.equal(r.handle(event('d'),terminal,actionAvailable).id,'splitRight');
  assert.equal(r.handle(event('D',{shiftKey:true}),terminal,actionAvailable).id,'splitDown');
  assert.equal(r.handle(event('c'),terminal,actionAvailable),null);
  assert.equal(r.handle(event('x'),terminal,actionAvailable),null);
  assert.equal(r.handle(event('['),browser,actionAvailable).id,'browserBack');
  assert.equal(r.handle(event('['),terminal,actionAvailable).id,'focusHistoryBack');
  assert.equal(r.handle(event('r'),browser,actionAvailable).id,'browserReload');
  assert.equal(r.handle(event('r'),terminal,actionAvailable).id,'renameTab');
});
test('all numbered families, shifted punctuation, distinct Control+Command prefix',()=>{
  const r=router();
  for(let digit=1;digit<=9;digit++) {
    assert.deepEqual(r.handle(event(String(digit)),terminal,actionAvailable).digit,digit);
    const surface=r.handle(event(String(digit),{ctrlKey:false,altKey:true}),terminal,actionAvailable);
    assert.equal(surface.id,'selectSurfaceByNumber'); assert.equal(surface.digit,digit);
    assert.equal(r.handle(event(' ',{shiftKey:true}),terminal,actionAvailable).prefix,true);
    const pane=r.handle(event(String(digit)),terminal,actionAvailable);
    assert.equal(pane.id,'focusPaneByNumber'); assert.equal(pane.digit,digit);
  }
  assert.equal(r.handle(event('}',{shiftKey:true}),terminal,actionAvailable).id,'nextSurface');
});
test('rebind, unbind, chord mismatch, timeout and cancellation have observable routing behavior',()=>{
  const prefixed=router({bindings:{newSurface:['ctrl+b','c']}});
  assert.equal(prefixed.handle(event('b'),terminal,actionAvailable).prefix,true,'Configured chord prefix overrides the factory single stroke');
  assert.equal(prefixed.handle(event('c',{ctrlKey:false}),terminal,actionAvailable).id,'newSurface');
  const numbers=router({bindings:{selectSurfaceByNumber:['ctrl+b','1']}});
  assert.equal(numbers.handle(event('b'),terminal,actionAvailable).prefix,true);
  const selected=numbers.handle(event('7',{ctrlKey:false}),terminal,actionAvailable);
  assert.equal(selected.id,'selectSurfaceByNumber');assert.equal(selected.digit,7);
  const r=router({bindings:{newSurface:'ctrl+d',splitRight:null,toggleSidebar:['ctrl+b','b']}});
  assert.equal(r.handle(event('d'),terminal,actionAvailable).id,'newSurface');
  assert.equal(r.handle(event('t'),terminal,actionAvailable),null);
  assert.equal(r.handle(event('b'),terminal,actionAvailable,1).prefix,true);
  assert.equal(r.handle(event('b',{ctrlKey:false}),terminal,actionAvailable,500).id,'toggleSidebar');
  r.handle(event('b'),terminal,actionAvailable,1000);
  assert.equal(r.handle(event('x',{ctrlKey:false}),terminal,actionAvailable,1001),null,'Unmatched suffix reaches focused content');
  r.handle(event('b'),terminal,actionAvailable,2000);
  assert.equal(r.handle(event('b',{ctrlKey:false}),terminal,actionAvailable,4000),null);
  r.handle(event('b'),terminal,actionAvailable,5000);
  assert.equal(r.handle(event('Escape',{ctrlKey:false}),terminal,actionAvailable,5001).consume,true);
  assert.equal(r.pending,null);
});
test('palette context, when clauses, IME and AltGr do not steal terminal input',()=>{
  const r=router({when:{closeTab:'terminalFocus && !terminalAlternateScreen'}});
  assert.equal(r.handle(event('w'),{terminalFocus:true,terminalAlternateScreen:true},actionAvailable),null);
  assert.equal(r.handle(event('w'),terminal,actionAvailable).id,'closeTab');
  assert.equal(r.handle(event('n'),{commandPaletteVisible:true},actionAvailable).id,'commandPaletteNext');
  assert.equal(r.handle(event('d',{isComposing:true}),terminal,actionAvailable),null);
  assert.equal(r.handle(event('d',{getModifierState:key=>key==='AltGraph'}),terminal,actionAvailable),null);
  for(const extra of [{isComposing:true},{getModifierState:key=>key==='AltGraph'}]) {
    r.handle(event(' ',{shiftKey:true}),terminal,actionAvailable);
    r.handle(event('d',extra),terminal,actionAvailable);
    assert.equal(r.pending,null,'Composition and AltGr cancel a pending chord');
  }
  assert.equal(r.handle(event('d'),{dialogOpen:true},actionAvailable),null);
  assert.throws(()=>engine.compileWhen('terminalFocus || alert(1)'));
});
test('unavailable features never consume keys and every registered default can load',()=>{
  assert.equal(engine.catalog.length,169);
  for(const action of engine.catalog)assert.doesNotThrow(()=>engine.parseBinding(action.defaultBinding,action.id),action.id);
  assert.equal(actionAvailable('newCloudWorkspace',terminal),false);
  assert.equal(router().handle(event('y'),terminal,actionAvailable),null);
  assert.throws(()=>engine.parseBinding('ctrl+f1','selectWorkspaceByNumber'));
  assert.throws(()=>engine.parseBinding('ctrl+not-a-key','splitRight'));
  const groups=new Map();
  for(const entry of router().entries.filter(entry=>scopes[entry.id] && entry.strokes.length)) {
    const signature=JSON.stringify(entry.strokes);if(!groups.has(signature))groups.set(signature,[]);groups.get(signature).push(entry.id);
  }
  for(const ids of groups.values())if(ids.length>1) {
    assert(ids.every(id=>['browserBack','browserForward','browserReload','browserHardReload','focusHistoryBack','focusHistoryForward','renameTab','renameWorkspace','commandPaletteNext','commandPalettePrevious','newTab','goToWorkspace','splitRight','diffViewerScrollDownEmacs','diffViewerScrollUpEmacs','diffViewerScrollHalfPageDown','browserZoomIn','browserZoomOut','browserZoomReset','markdownZoomIn','markdownZoomOut','markdownZoomReset'].includes(id)),`Unexpected default collision: ${ids}`);
  }
});
test('document shortcuts preserve contextual zoom, diff scrolling and text input',()=>{
  const r=router(),diff={diffFocus:true},markdown={markdownFocus:true};
  assert.equal(r.handle(event('n'),diff,actionAvailable).id,'diffViewerScrollDownEmacs');
  assert.equal(r.handle(event('p'),diff,actionAvailable).id,'diffViewerScrollUpEmacs');
  assert.equal(r.handle(event('d'),diff,actionAvailable).id,'diffViewerScrollHalfPageDown');
  assert.equal(r.handle(event('d'),terminal,actionAvailable).id,'splitRight');
  assert.equal(r.handle(event('n'),{commandPaletteVisible:true},actionAvailable).id,'commandPaletteNext');
  assert.equal(r.handle(event('='),markdown,actionAvailable).id,'markdownZoomIn');
  assert.equal(r.handle(event('='),browser,actionAvailable).id,'browserZoomIn');
  assert.equal(r.handle(event('f'),markdown,actionAvailable).id,'find');
  assert.equal(r.handle(event('v',{ctrlKey:false}),{diffFocus:true,textInputFocus:true},actionAvailable),null);
  assert.equal(r.handle(event('v',{ctrlKey:false}),diff,actionAvailable).id,'diffViewerToggleViewed');
});
test('file-editor actions stay scoped and save honors rebinds and unbinding',()=>{
  const r=router(),editor={fileEditorFocus:true,fileEditorEditable:true,textInputFocus:true};
  assert.equal(r.handle(event('s'),editor,actionAvailable).id,'saveFilePreview');
  assert.equal(r.handle(event('z',{ctrlKey:false,altKey:true}),editor,actionAvailable).id,'toggleFileEditorWordWrap');
  assert.equal(r.handle(event('s'),terminal,actionAvailable),null);
  assert.equal(r.handle(event('s'),{fileEditorFocus:true,fileEditorEditable:false},actionAvailable),null);
  r.configure({bindings:{saveFilePreview:'ctrl+alt+s'}});
  assert.equal(r.handle(event('s'),editor,actionAvailable),null);
  assert.equal(r.handle(event('s',{altKey:true}),editor,actionAvailable).id,'saveFilePreview');
  r.configure({bindings:{saveFilePreview:null}});
  assert.equal(r.handle(event('s'),editor,actionAvailable),null);
});
test('JSONC updates preserve unrelated settings/comments, reload edits and retain last good bindings on invalid input',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'cmux-shortcut-config-')),file=path.join(folder,'cmux.json');
  try {
    fs.writeFileSync(file,'{\n // keep this comment\n "terminal":{"scrollback":1234},\n "shortcuts":{"bindings":{"newSurface":["ctrl+b","c"]}},\n}\n');
    const config=new ShortcutConfig(file);
    assert.equal(config.error,'');
    config.update('splitRight','ctrl+alt+d');
    let text=fs.readFileSync(file,'utf8'); assert(text.includes('// keep this comment'));assert(text.includes('1234'));
    assert.deepEqual(config.settings.bindings.newSurface,['ctrl+b','c']);
    config.update('splitRight',null);assert.equal(config.settings.bindings.splitRight,null);
    config.update('splitRight',null,true);assert(!Object.hasOwn(config.settings.bindings,'splitRight'));
    fs.writeFileSync(file,'{ invalid json');config.reload();
    assert(config.error);assert.deepEqual(config.settings.bindings.newSurface,['ctrl+b','c']);
    assert.throws(()=>config.update('newSurface','ctrl+t'));assert.equal(fs.readFileSync(file,'utf8'),'{ invalid json');
    fs.writeFileSync(file,'{"shortcuts":{"bindings":{"newSurface":"ctrl+alt+t"}}}');config.reload();assert.equal(config.settings.bindings.newSurface,'ctrl+alt+t');
    assert.throws(()=>config.update('madeUpAction','ctrl+t'));
  } finally {fs.rmSync(folder,{recursive:true,force:true});}
});
