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
  async branchBase(root,rawBase) {
    if(rawBase!==undefined && (typeof rawBase!=='string' || rawBase.length>1024 || rawBase.includes('\0')))throw Error('invalid_base');
    const explicit=rawBase?.trim();
    const resolve=async ref=>{
      try{return (await this.git(root,['rev-parse','--verify','--end-of-options',`${ref}^{commit}`])).trim();}catch{return null;}
    };
    if(explicit){const commit=await resolve(explicit);if(!commit)throw Error('invalid_base');return {baseRef:explicit,commit};}
    const optional=async args=>{try{return (await this.git(root,args)).trim();}catch{return '';}};
    const branch=await optional(['symbolic-ref','--quiet','--short','HEAD']);
    const recorded=branch?await optional(['config','--get',`branch.${branch}.cmuxBase`]):'';
    const upstream=await optional(['rev-parse','--abbrev-ref','--symbolic-full-name','@{upstream}']);
    const originHead=await optional(['symbolic-ref','--quiet','--short','refs/remotes/origin/HEAD']);
    const integration=upstream && upstream.slice(upstream.indexOf('/')+1)!==branch?upstream:'';
    for(const ref of [recorded,integration,originHead,'origin/main','origin/master','upstream/main','upstream/master','main','master']) {
      if(!ref)continue;const commit=await resolve(ref);if(commit)return {baseRef:ref,commit};
    }
    throw Error('base_required');
  }
  async status(directory,options={}) {
    if(typeof directory!=='string')throw Error('git_error');
    const base=await fs.realpath(directory);
    const root=await fs.realpath((await this.git(base,['rev-parse','--show-toplevel'])).replace(/\r?\n$/,''));
    const source=options?.source || 'combined';
    if(!['combined','staged','unstaged','branch'].includes(source))throw Error('invalid_source');
    if(source==='branch') {
      const {baseRef,commit}=await this.branchBase(root,options?.base);
      let mergeBase;try{mergeBase=(await this.git(root,['merge-base','HEAD',commit])).trim();}catch{throw Error('unrelated_base');}
      const records=(await this.git(root,['diff','--name-status','-z','--no-ext-diff','--no-textconv','--find-renames',mergeBase,'--'])).split('\0'),entries=[];
      for(let i=0;i<records.length && records[i];i++) {
        const code=records[i],oldPath=records[++i];
        entries.push(/[RC]/.test(code[0])?{status:code[0]+' ',originalPath:oldPath,path:records[++i]}:{status:code[0]+' ',path:oldPath});
      }
      return {root,source,baseRef,mergeBase,entries:entries.slice(0,2000),truncated:entries.length>2000};
    }
    const output=await this.git(root,['status','--porcelain=v1','-z','--untracked-files=all']);
    const records=output.split('\0'),entries=[];
    for(let i=0;i<records.length;i++) {
      const record=records[i];if(!record)continue;
      const entry={status:record.slice(0,2),path:record.slice(3)};
      if(/[RC]/.test(entry.status))entry.originalPath=records[++i];
      if(source==='staged' && (entry.status[0]===' ' || entry.status[0]==='?'))continue;
      if(source==='unstaged' && entry.status[1]===' ')continue;
      entries.push(entry);
    }
    return {root,source,entries:entries.slice(0,2000),truncated:entries.length>2000};
  }
  async diff(directory,filePath,options={}) {
    const status=await this.status(directory,options),entry=status.entries.find(item=>item.path===filePath);
    if(!entry)throw Error('unknown_file');
    let staged='',unstaged='',branch='',binary=false,limited=false,stamp='',contextLimited=false;
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
      [staged,unstaged,branch]=await this.patches(status,entry,3);
      binary=/^Binary files .+ differ$/m.test(staged+'\n'+unstaged+'\n'+branch);
    }
    const revision=crypto.createHash('sha256').update([status.source,status.mergeBase||'',staged,unstaged,branch,stamp].join('\0')).digest('hex');
    if(expanded && entry.status!=='??') {
      const identity=[staged,unstaged,branch].map(changeIdentity);
      try {
        const expandedDiffs=await this.patches(status,entry,2147483647);
        if(expandedDiffs.some((patch,index)=>changeIdentity(patch)!==identity[index]))throw Error('file_changed');
        [staged,unstaged,branch]=expandedDiffs;
      }catch(error){if(error.message==='diff_too_large')contextLimited=true;else throw error;}
    }
    return {root:status.root,path:entry.path,status:entry.status,source:status.source,baseRef:status.baseRef,mergeBase:status.mergeBase,staged,unstaged,branch,binary,limited,expanded,contextLimited,revision};
  }
  async patches(status,entry,context) {
    const paths=entry.originalPath?[entry.originalPath,entry.path]:[entry.path];
    const patch=args=>this.git(status.root,['diff',`--unified=${context}`,'--no-ext-diff','--no-textconv','--no-color','--find-renames',...args,'--',...paths]);
    return Promise.all([
      ['combined','staged'].includes(status.source)?patch(['--cached']):'',
      ['combined','unstaged'].includes(status.source)?patch([]):'',
      status.source==='branch'?patch([status.mergeBase]):''
    ]);
  }
}
module.exports={WorkspaceGit};
