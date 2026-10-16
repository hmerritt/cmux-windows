const fs=require('node:fs/promises');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const crypto=require('node:crypto');
const {WorkspaceFiles}=require('./workspace-files.cjs');
const run=promisify(execFile);
const changeIdentity=patch=>patch.split('\n').filter(line=>!line.startsWith(' ') && !line.startsWith('@@') && !line.startsWith('\\')).join('\n');
class WorkspaceGit {
  constructor(){this.files=new WorkspaceFiles();}
  async git(root,args) {
    try {
      const {stdout}=await run('git',['--no-optional-locks','--literal-pathspecs','-c','core.fsmonitor=false','-c','core.untrackedCache=false','-c','core.quotepath=false','-C',root,...args],{windowsHide:true,timeout:10000,maxBuffer:4*1024*1024,encoding:'utf8',env:{...process.env,GIT_TERMINAL_PROMPT:'0',GIT_PAGER:'cat'}});
      return stdout;
    }catch(error){throw Error(error.code==='ERR_CHILD_PROCESS_STDIO_MAXBUFFER'?'diff_too_large':'git_error');}
  }
  async status(directory) {
    if(typeof directory!=='string')throw Error('git_error');
    const base=await fs.realpath(directory);
    const root=await fs.realpath((await this.git(base,['rev-parse','--show-toplevel'])).replace(/\r?\n$/,''));
    const output=await this.git(root,['status','--porcelain=v1','-z','--untracked-files=all']);
    const records=output.split('\0'),entries=[];
    for(let i=0;i<records.length;i++) {
      const record=records[i];if(!record)continue;
      const entry={status:record.slice(0,2),path:record.slice(3)};
      if(/[RC]/.test(entry.status))entry.originalPath=records[++i];
      entries.push(entry);
    }
    return {root,entries:entries.slice(0,2000),truncated:entries.length>2000};
  }
  async diff(directory,filePath,options={}) {
    const status=await this.status(directory),entry=status.entries.find(item=>item.path===filePath);
    if(!entry)throw Error('unknown_file');
    let staged='',unstaged='',binary=false,limited=false,stamp='',contextLimited=false;
    const expanded=options?.expandUnchanged===true;
    if(entry.status==='??') {
      try {
        const file=await this.files.read(status.root,entry.path);
        const lines=file.text.split('\n');if(lines.at(-1)==='')lines.pop();
        unstaged=`--- /dev/null\n+++ b/${entry.path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(line=>'+'+line).join('\n')}\n`;
      }catch(error){
        if(error.message==='binary_file')binary=true;else if(error.message==='file_too_large')limited=true;else throw error;
        const {target}=await this.files.resolve(status.root,entry.path),stat=await fs.stat(target);stamp=`${stat.size}:${stat.mtimeMs}`;
      }
    } else {
      const paths=entry.originalPath?[entry.originalPath,entry.path]:[entry.path];
      [staged,unstaged]=await Promise.all([
        this.git(status.root,['diff','--cached','--unified=3','--no-ext-diff','--no-textconv','--no-color','--find-renames','--',...paths]),
        this.git(status.root,['diff','--unified=3','--no-ext-diff','--no-textconv','--no-color','--find-renames','--',...paths])
      ]);
      binary=/^Binary files .+ differ$/m.test(staged+'\n'+unstaged);
    }
    const revision=crypto.createHash('sha256').update(staged+'\0'+unstaged+'\0'+stamp).digest('hex');
    if(expanded && entry.status!=='??') {
      const paths=entry.originalPath?[entry.originalPath,entry.path]:[entry.path];
      const identity=[changeIdentity(staged),changeIdentity(unstaged)];
      try {
        const expandedDiffs=await Promise.all([
          this.git(status.root,['diff','--cached','--unified=2147483647','--no-ext-diff','--no-textconv','--no-color','--find-renames','--',...paths]),
          this.git(status.root,['diff','--unified=2147483647','--no-ext-diff','--no-textconv','--no-color','--find-renames','--',...paths])
        ]);
        if(expandedDiffs.some((patch,index)=>changeIdentity(patch)!==identity[index]))throw Error('file_changed');
        [staged,unstaged]=expandedDiffs;
      }catch(error){if(error.message==='diff_too_large')contextLimited=true;else throw error;}
    }
    return {root:status.root,path:entry.path,status:entry.status,staged,unstaged,binary,limited,expanded,contextLimited,revision};
  }
}
module.exports={WorkspaceGit};
