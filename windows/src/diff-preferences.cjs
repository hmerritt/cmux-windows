const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const booleanKeys=['wordWrap','wordDiffs','lineNumbers','showBackgrounds','expandUnchanged'];
function sanitize(raw) {
  if(!raw || typeof raw!=='object' || Array.isArray(raw))return {};
  const result={};
  if(['split','unified'].includes(raw.layout))result.layout=raw.layout;
  if(['bars','classic','none'].includes(raw.diffIndicators))result.diffIndicators=raw.diffIndicators;
  for(const key of booleanKeys)if(typeof raw[key]==='boolean')result[key]=raw[key];
  return result;
}
class DiffPreferences {
  constructor(file){this.file=file;this.pending=Promise.resolve();}
  async get() {
    try{return sanitize(JSON.parse(await fs.readFile(this.file,'utf8')));}catch{return {};}
  }
  merge(updates) {
    const sanitized=sanitize(updates);
    const operation=this.pending.catch(()=>{}).then(async()=>{
      const preferences={...await this.get(),...sanitized};
      await fs.mkdir(path.dirname(this.file),{recursive:true});
      const temporary=`${this.file}.${crypto.randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary,JSON.stringify(preferences,null,2)+'\n',{flag:'wx'});
        await fs.rename(temporary,this.file);
      }finally{await fs.rm(temporary,{force:true});}
      return preferences;
    });
    this.pending=operation;return operation;
  }
}
module.exports={DiffPreferences,sanitize};
