const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const jsonc = require('jsonc-parser');
const {catalog, ShortcutRouter, compileWhen, parseBinding} = require('../renderer/shortcut-engine.mjs');
const ids = new Set(catalog.map(action=>action.id));
class ShortcutConfig {
  constructor(file=process.env.CMUX_WINDOWS_CONFIG || path.join(os.homedir(),'.config','cmux','cmux.json')) {
    this.file=file; this.settings={}; this.error='';
    this.reload();
  }
  read() {
    const raw=fs.existsSync(this.file)?fs.readFileSync(this.file,'utf8'):'{}';
    const errors=[];
    const config=jsonc.parse(raw,errors,{allowTrailingComma:true,disallowComments:false});
    if(errors.length || !config || typeof config!=='object' || Array.isArray(config)) throw new Error('Invalid cmux.json');
    const settings=config.shortcuts || {};
    for(const group of ['bindings','when']) {
      if(settings[group]!==undefined && (!settings[group] || typeof settings[group]!=='object' || Array.isArray(settings[group]))) throw new Error(`shortcuts.${group} must be an object`);
      for(const [id,value] of Object.entries(settings[group]||{})) {
        if(!ids.has(id)) throw new Error(`Unknown shortcut action: ${id}`);
        if(group==='bindings') parseBinding(value,id); else compileWhen(value);
      }
    }
    new ShortcutRouter().configure(settings);
    return {raw,settings};
  }
  reload() {
    try { this.settings=this.read().settings; this.error=''; }
    catch(error) { this.error=error.message; }
    return this.snapshot();
  }
  snapshot() { return {settings:this.settings,error:this.error,path:this.file}; }
  update(id,value,reset=false) {
    if(!ids.has(id)) throw new Error('Unknown shortcut action');
    if(!reset) parseBinding(value,id);
    const {raw}=this.read(); // Never overwrite a malformed or externally changed file.
    const updated=jsonc.applyEdits(raw,jsonc.modify(raw,['shortcuts','bindings',id],reset?undefined:value,{formattingOptions:{insertSpaces:true,tabSize:2,eol:'\n'}}));
    const folder=path.dirname(this.file);
    fs.mkdirSync(folder,{recursive:true});
    const temporary=path.join(folder,`.cmux-shortcuts-${process.pid}-${Date.now()}.tmp`);
    try { fs.writeFileSync(temporary,updated,'utf8'); fs.renameSync(temporary,this.file); }
    finally { if(fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    return this.reload();
  }
  watch(callback) {
    this.timer=setInterval(()=>{
      const before=JSON.stringify(this.snapshot()); this.reload();
      if(before!==JSON.stringify(this.snapshot())) callback(this.snapshot());
    },500);
    this.timer.unref();
  }
  close() { clearInterval(this.timer); }
}
module.exports={ShortcutConfig};
