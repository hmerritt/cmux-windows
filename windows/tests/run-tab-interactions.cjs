const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const electron=require('electron');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'cmux-tab-restart-'));
const env={...process.env,CMUX_TAB_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
for(const flags of [[],['--restore-names']]){
  const result=spawnSync(electron,[path.join(__dirname,'tab-interactions-desktop.cjs'),...process.argv.slice(2),...flags],{env,stdio:'inherit',timeout:95000,windowsHide:true});
  if(result.error || result.status!==0){console.error(result.error || `Tab tests failed; profile: ${profile}`);process.exit(1);}
}
fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});
