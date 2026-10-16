const fs=require('node:fs/promises');
const path=require('node:path');
class WorkspaceFiles {
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
      try{return {path:location.relative,text:new TextDecoder('utf-8',{fatal:true}).decode(data)};}
      catch {throw Error('binary_file');}
    } finally {await handle.close();}
  }
}
module.exports={WorkspaceFiles};
