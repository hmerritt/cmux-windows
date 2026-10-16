import {parityText} from './parity-messages.mjs';
const editors=new WeakMap();
let recentEditor=null;
const wrapKey='cmux.fileEditor.wordWrap';
export function moveWorkspaceFileDrafts(root,oldPath,newPath,{validateOnly=false}={}) {
  const normalize=value=>value.replaceAll('\\','/');
  const source=normalize(oldPath),destination=normalize(newPath),prefix='cmux.fileDraft:';
  const changes=[];
  for(let i=0;i<localStorage.length;i++) {
    const key=localStorage.key(i);if(!key?.startsWith(prefix))continue;
    let pair;try{pair=JSON.parse(key.slice(prefix.length));}catch{continue;}
    if(!Array.isArray(pair) || pair[0]!==root || typeof pair[1]!=='string')continue;
    const current=normalize(pair[1]);
    if(current!==source && !current.startsWith(source+'/'))continue;
    // Keep native path separators so a reopened editor finds its existing draft.
    const next=(destination+current.slice(source.length)).replaceAll('/',newPath.includes('\\')?'\\':'/');
    changes.push([key,`${prefix}${JSON.stringify([root,next])}`,localStorage.getItem(key)]);
  }
  for(const [oldKey,newKey] of changes) {
    if(oldKey===newKey)continue;
    if(localStorage.getItem(newKey)!==null)throw Error('draft_conflict');
  }
  if(validateOnly)return;
  for(const [oldKey,newKey,value] of changes) {
    if(oldKey===newKey)continue;
    localStorage.removeItem(oldKey);
    try{localStorage.setItem(newKey,value);}catch(error){localStorage.setItem(oldKey,value);throw error;}
  }
}
const wraps=()=>{try{return localStorage.getItem(wrapKey)==='true';}catch{return false;}};
function applyWrap(text){const enabled=wraps();text.wrap=enabled?'soft':'off';text.style.whiteSpace=enabled?'pre-wrap':'pre';}
export function workspaceFileEditorFor(target,{fallback=false}={}) {
  const recent=recentEditor?.deref();
  return editors.get(target) || (fallback && recent?.isConnected?editors.get(recent):undefined);
}
function toggleWordWrap(){try{localStorage.setItem(wrapKey,String(!wraps()));}catch{}for(const text of document.querySelectorAll('.workspace-file-preview textarea'))applyWrap(text);}
window.addEventListener('storage',event=>{if(event.key===wrapKey)for(const text of document.querySelectorAll('.workspace-file-preview textarea'))applyWrap(text);});
function button(text,run){const node=document.createElement('button');node.type='button';node.textContent=text;node.onclick=run;return node;}
function message(key){const node=document.createElement('p');node.setAttribute('role','status');node.textContent=parityText(key);return node;}

export function attachWorkspaceFileEditor(preview,text,file,fileRoot,filePath,{reload=()=>{}}={}) {
    applyWrap(text);
    const draftKey=`cmux.fileDraft:${JSON.stringify([fileRoot,filePath])}`;
    let original=file.text.replaceAll('\r\n','\n'),expectedRevision=file.revision,saving=false,draftStored=true;
    let lineEnding=file.text.includes('\r\n') && !file.text.replaceAll('\r\n','').includes('\n')?'\r\n':'\n';
    const controls=document.createElement('div');controls.className='workspace-files-toolbar';
    const status=message('unsavedChanges');status.hidden=true;
    const edit=button(parityText('editFile'),()=>{text.readOnly=false;edit.hidden=true;save.hidden=false;discard.hidden=false;text.focus();});
    edit.dataset.fileAction='edit';
    const save=button(parityText('saveFile'),saveFile);save.dataset.fileAction='save';save.hidden=true;
    const discard=button(parityText('discardChanges'),()=>{
      if(saving)return;
      try{localStorage.removeItem(draftKey);}catch{}
      reload();
    });discard.dataset.fileAction='discard';discard.hidden=true;
    controls.append(edit,save,discard);preview.insertBefore(controls,text);preview.append(status);
    function showStatus(key){status.textContent=parityText(key);status.hidden=false;}
    function persistDraft() {
      try {
        if(text.value===original)localStorage.removeItem(draftKey);
        else localStorage.setItem(draftKey,JSON.stringify({text:text.value,revision:expectedRevision,lineEnding}));
        draftStored=true;
      } catch {draftStored=false;showStatus('draftError');}
    }
    const canLeave=()=>{
      if(!preview.isConnected || text.value===original || draftStored)return true;
      showStatus('draftError');return false;
    };
    try {
      const draft=JSON.parse(localStorage.getItem(draftKey)||'null');
      if(draft && typeof draft.text==='string' && typeof draft.revision==='string') {
        text.value=draft.text;expectedRevision=draft.revision;
        lineEnding=draft.lineEnding==='\r\n'?'\r\n':'\n';edit.click();
        showStatus(expectedRevision===file.revision?'draftRecovered':'fileConflict');
      }
    } catch {}
    text.oninput=()=>{showStatus('unsavedChanges');persistDraft();};
    editors.set(text,{save:saveFile,toggleWordWrap,get editable(){return !text.readOnly;}});
    text.addEventListener('focus',()=>{recentEditor=new WeakRef(text);});
    if(document.activeElement===text)recentEditor=new WeakRef(text);
    async function saveFile() {
      if(saving || text.readOnly)return;
      saving=true;save.disabled=true;discard.disabled=true;text.readOnly=true;
      const value=text.value;
      try {
        const result=await window.cmuxNative.writeWorkspaceFile(fileRoot,filePath,lineEnding==='\r\n'?value.replaceAll('\n','\r\n'):value,expectedRevision);
        if(result?.ok) {original=value;expectedRevision=result.revision;persistDraft();showStatus(draftStored?'fileSaved':'draftError');}
        else showStatus(result?.error==='file_changed'?'fileConflict':['binary_file','file_too_large'].includes(result?.error)?'previewLimit':'saveError');
      } catch {showStatus('saveError');}
      finally {saving=false;save.disabled=false;discard.disabled=false;text.readOnly=false;}
    }
    return {canLeave,isEditing:()=>!text.readOnly || saving};
  }
