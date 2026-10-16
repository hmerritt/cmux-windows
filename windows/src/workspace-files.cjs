const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const run=promisify(execFile);
const revision=data=>crypto.createHash('sha256').update(data).digest('hex');
class WorkspaceFiles {
  constructor(){this.pending=Promise.resolve();}
  mutate(operation){const pending=this.pending.catch(()=>{}).then(operation);this.pending=pending;return pending;}
  validateName(name) {
    if(typeof name!=='string' || !name || name.length>255 || name==='.' || name==='..' || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(name))throw Error('invalid_name');
    return name;
  }
  async create(root,parent,name,kind='file') {
    this.validateName(name);if(!['file','folder'].includes(kind))throw Error('invalid_kind');
    return this.mutate(async()=>{
      const location=await this.resolve(root,parent),target=path.join(location.target,name);
      try {if(kind==='folder')await fs.mkdir(target);else {const handle=await fs.open(target,'wx');await handle.close();}}
      catch(error){if(error.code==='EEXIST')throw Error('entry_exists');throw error;}
      return {path:path.join(location.relative,name)};
    });
  }
  async rename(root,relative,name) {
    this.validateName(name);
    if(typeof relative!=='string' || !relative || path.isAbsolute(relative))throw Error('outside_root');
    return this.mutate(async()=>{
      // Resolve only the parent: renaming a link moves the link itself.
      const base=await fs.realpath(root),lexical=path.resolve(base,relative),within=path.relative(base,lexical);
      if(!within || within==='..' || within.startsWith(`..${path.sep}`) || path.isAbsolute(within))throw Error('outside_root');
      const parent=await this.resolve(base,path.dirname(within)),source=path.join(parent.target,path.basename(within)),target=path.join(parent.target,name);
      await fs.lstat(source);
      if(source===target)return {path:path.join(parent.relative,name)};
      if(process.platform!=='win32')throw Error('unsupported_platform');
      // File.Move/Directory.Move use Windows' no-replace move. fs.rename would
      // overwrite an existing file. Environment values remain data, never code.
      const script="$ErrorActionPreference='Stop';try {if([IO.Directory]::Exists($env:CMUX_FILE_MUTATION_SOURCE)){[IO.Directory]::Move($env:CMUX_FILE_MUTATION_SOURCE,$env:CMUX_FILE_MUTATION_TARGET)}else{[IO.File]::Move($env:CMUX_FILE_MUTATION_SOURCE,$env:CMUX_FILE_MUTATION_TARGET)}}catch{exit 1}";
      try {
        await run(path.join(process.env.SystemRoot || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:10000,env:{...process.env,CMUX_FILE_MUTATION_SOURCE:source,CMUX_FILE_MUTATION_TARGET:target}});
      }catch {
        if(source.toLowerCase()!==target.toLowerCase())try{await fs.lstat(target);throw Error('entry_exists');}catch(error){if(error.message==='entry_exists')throw error;}
        throw Error('mutation_failed');
      }
      return {path:path.join(parent.relative,name)};
    });
  }
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
    return this.mutate(async()=>{
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
  }
  async readImage(root,relative) {
    const {target}=await this.resolve(root,relative);
    const handle=await fs.open(target,'r');
    try {
      const stat=await handle.stat();if(!stat.isFile())throw Error('not_file');
      if(stat.size>10*1024*1024)throw Error('file_too_large');
      const data=Buffer.alloc(10*1024*1024+1);let length=0;
      while(length<data.length){const {bytesRead}=await handle.read(data,length,data.length-length,length);if(!bytesRead)break;length+=bytesRead;}
      if(length>10*1024*1024)throw Error('file_too_large');
      const bytes=data.subarray(0,length);
      const mime=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':bytes[0]===255 && bytes[1]===216 && bytes[2]===255?'image/jpeg':/^GIF8[79]a/.test(bytes.subarray(0,6).toString())?'image/gif':bytes.subarray(0,4).toString()==='RIFF' && bytes.subarray(8,12).toString()==='WEBP'?'image/webp':null;
      if(!mime)throw Error('binary_file');
      return {dataUrl:`data:${mime};base64,${bytes.toString('base64')}`};
    }finally{await handle.close();}
  }
}
module.exports={WorkspaceFiles};
