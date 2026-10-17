const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {StringDecoder}=require('node:string_decoder');
const {WorkspaceFiles}=require('./workspace-files.cjs');
class WorkspaceSearch {
  constructor({executable='rg',prefixArguments=[],timeout=10000,maxResults=500}={}){this.executable=executable;this.prefixArguments=prefixArguments;this.timeout=timeout;this.maxResults=maxResults;this.files=new WorkspaceFiles();}
  async search(root,query,{signal}={}) {
    if(typeof query!=='string' || query.length>4096 || query.includes('\0') || /[\r\n]/.test(query))throw Error('invalid_query');
    const base=await fs.realpath(root);
    if(!query)return {results:[],truncated:false};
    if(signal?.aborted)throw Error('cancelled');
    const globs=['.git','node_modules','dist','build','DerivedData'].flatMap(name=>['--glob',`!${name}/**`,'--glob',`!**/${name}/**`]);
    const result=await new Promise((resolve,reject)=>{
      const child=spawn(this.executable,[...this.prefixArguments,'--no-config','--json','--line-number','--column','--smart-case','--fixed-strings','--max-columns','300','--max-columns-preview','--color','never','--hidden',...globs,'--',query,'.'],{cwd:base,windowsHide:true,env:{...process.env,RIPGREP_CONFIG_PATH:''},stdio:['ignore','pipe','pipe']});
      const decoder=new StringDecoder('utf8'),results=[];
      let tail='',bytes=0,truncated=false,error=null;
      const stop=reason=>{error=reason;child.kill();};
      const abort=()=>stop(Error('cancelled'));
      signal?.addEventListener('abort',abort,{once:true});
      const timer=setTimeout(()=>stop(Error('search_timeout')),this.timeout);
      child.on('error',cause=>{error=Error(cause.code==='ENOENT'?'ripgrep_missing':'search_error');});
      child.stderr.resume();
      child.stdout.on('data',chunk=>{
        if(error || truncated)return;
        bytes+=chunk.length;
        if(bytes>8*1024*1024){truncated=true;child.kill();return;}
        tail+=decoder.write(chunk);
        let end;
        while((end=tail.indexOf('\n'))>=0) {
          const line=tail.slice(0,end);tail=tail.slice(end+1);
          try {
            const record=JSON.parse(line);if(record.type!=='match')continue;
            const data=record.data;
            const decode=value=>typeof value?.text==='string'?value.text:typeof value?.bytes==='string'?Buffer.from(value.bytes,'base64').toString('utf8'):'';
            const name=decode(data.path),text=decode(data.lines),start=data.submatches?.[0]?.start || 0;
            // Ripgrep columns are UTF-8 byte offsets; the editor uses UTF-16 offsets.
            const column=Buffer.from(text).subarray(0,start).toString('utf8').length;
            const length=Buffer.from(text).subarray(start,data.submatches?.[0]?.end || start).toString('utf8').length;
            results.push({path:name.replace(/^\.\//,''),lineNumber:data.line_number,columnNumber:column+1,length,preview:text.replace(/[\r\n]+$/,'').slice(0,300)});
            if(results.length>=this.maxResults){truncated=true;child.kill();break;}
          }catch{error=Error('search_error');child.kill();break;}
        }
      });
      child.once('close',code=>{
        clearTimeout(timer);signal?.removeEventListener('abort',abort);
        if(error)reject(error);
        else if(code!==0 && code!==1 && !truncated)reject(Error('search_error'));
        else resolve({results,truncated});
      });
    });
    // Keep results inside the same canonical file boundary used by previews.
    const safe=[];
    for(const entry of result.results) {
      if(signal?.aborted)throw Error('cancelled');
      try {const location=await this.files.resolve(base,entry.path);safe.push({...entry,path:path.relative(base,location.target)});}catch{}
    }
    return {...result,results:safe};
  }
}
module.exports={WorkspaceSearch};
