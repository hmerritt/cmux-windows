const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const revision=data=>crypto.createHash('sha256').update(data).digest('hex');
class WorkspaceFiles {
  constructor(){this.writes=new Map();}
  async resolve(root,relative='') {
    if(typeof root!=='string' || typeof relative!=='string' || path.isAbsolute(relative))throw Error('outside_root');
    const base=await fs.realpath(root),target=await fs.realpath(path.resolve(base,relative));
    const resolved=path.relative(base,target);
    if(resolved==='..' || resolved.startsWith(`..${path.sep}`) || path.isAbsolute(resolved))throw Error('outside_root');
    return {base,target,relative:resolved};
  }
  async list(root,relative='') {
    const location=await this.resolve(root,relative);
    const entries=await fs.readdir(location.target,{withFileTypes:true});
    const sorted=entries.sort((a,b)=>Number(b.isDirectory())-Number(a.isDirectory()) || a.name.localeCompare(b.name));
    return {path:location.relative,entries:sorted.slice(0,2000).map(entry=>({name:entry.name,directory:entry.isDirectory(),link:entry.isSymbolicLink(),path:path.join(location.relative,entry.name)})),truncated:entries.length>2000};
  }
  async read(root,relative) {
    const location=await this.resolve(root,relative);
    const handle=await fs.open(location.target,'r');
    try {
      const stat=await handle.stat();
      if(!stat.isFile())throw Error('not_file');
      if(stat.size>1024*1024)throw Error('file_too_large');
      // Bound the read even if a writer grows the file after stat().
      const buffer=Buffer.alloc(1024*1024+1);
      let length=0;
      while(length<buffer.length) {
        const {bytesRead}=await handle.read(buffer,length,buffer.length-length,length);
        if(!bytesRead)break;
        length+=bytesRead;
      }
      if(length>1024*1024)throw Error('file_too_large');
      const data=buffer.subarray(0,length);
      if(data.includes(0))throw Error('binary_file');
      try{return {path:location.relative,text:new TextDecoder('utf-8',{fatal:true}).decode(data),revision:revision(data),bom:data.subarray(0,3).equals(Buffer.from([239,187,191]))};}
      catch {throw Error('binary_file');}
    } finally {await handle.close();}
  }
  async write(root,relative,text,expectedRevision) {
    if(typeof expectedRevision!=='string' || !/^[a-f0-9]{64}$/.test(expectedRevision))throw Error('invalid_revision');
    if(typeof text!=='string' || text.includes('\0'))throw Error('binary_file');
    if(Buffer.byteLength(text,'utf8')>1024*1024)throw Error('file_too_large');
    const location=await this.resolve(root,relative);
    const previous=this.writes.get(location.target) || Promise.resolve();
    const operation=previous.catch(()=>{}).then(async()=>{
      const current=await this.read(root,relative);
      if(current.revision!==expectedRevision)throw Error('file_changed');
      const data=Buffer.from((current.bom?'\ufeff':'')+text,'utf8');
      if(data.length>1024*1024)throw Error('file_too_large');
      const stat=await fs.stat(location.target);
      if(!(stat.mode & 0o222))throw Error('read_only');
      const temporary=path.join(path.dirname(location.target),`.cmux-save-${crypto.randomUUID()}.tmp`);
      try {
        await fs.writeFile(temporary,data,{flag:'wx',mode:stat.mode & 0o777});
        const latest=await this.read(root,relative),resolved=await this.resolve(root,relative);
        if(latest.revision!==expectedRevision || resolved.target!==location.target)throw Error('file_changed');
        await fs.rename(temporary,location.target);
        return {path:location.relative,text,revision:revision(data),bom:current.bom};
      } finally {await fs.rm(temporary,{force:true});}
    });
    this.writes.set(location.target,operation);
    try{return await operation;}finally{if(this.writes.get(location.target)===operation)this.writes.delete(location.target);}
  }
}
module.exports={WorkspaceFiles};
