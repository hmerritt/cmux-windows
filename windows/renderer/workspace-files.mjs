import {parityText} from './parity-messages.mjs';
import {catalog} from './shortcut-engine.mjs';
import {actionLabel} from './shortcut-ui.mjs';

export function createWorkspaceFileExplorer() {
  let root='',relative='',host=null,generation=0,selected=null,entries=[],loading=false,pendingFocus=false;
  let canLeave=()=>true;
  const label=actionLabel(catalog.find(action=>action.id==='switchRightSidebarToFiles'));
  function button(text,run) {const node=document.createElement('button');node.type='button';node.textContent=text;node.onclick=run;return node;}
  function message(key) {const node=document.createElement('p');node.setAttribute('role','status');node.textContent=parityText(key);return node;}
  function select(index) {
    if(!entries.length)return;
    selected=Math.max(0,Math.min(entries.length-1,index));
    for(const [i,node] of [...host.querySelectorAll('[role=treeitem]')].entries()) {
      node.setAttribute('aria-selected',String(i===selected));node.tabIndex=i===selected?0:-1;
      if(i===selected)node.focus();
    }
  }
  async function openSelection() {
    if(!canLeave())return;
    const entry=entries[selected];if(!entry)return;
    const selectionGeneration=generation,selectionRoot=root;
    if(entry.directory || entry.link) {
      const listing=await window.cmuxNative.listWorkspaceFiles(root,entry.path);
      if(selectionGeneration!==generation || selectionRoot!==root)return;
      if(listing?.ok)return load(entry.path);
      if(entry.directory)return showError('pathError');
    }
    const request=++generation,requestedRoot=root;
    const result=await window.cmuxNative.readWorkspaceFile(root,entry.path);
    if(request!==generation || root!==requestedRoot || !host?.isConnected)return;
    host.querySelector('.workspace-file-preview')?.remove();
    const preview=document.createElement('section');preview.className='workspace-file-preview';
    preview.setAttribute('aria-label',parityText('preview'));
    preview.append(button(parityText('closePreview'),()=>{if(canLeave()){preview.remove();select(selected);}}));
    if(result?.ok) {
      const title=document.createElement('div');title.textContent=result.path;
      const text=document.createElement('textarea');text.readOnly=true;text.value=result.text;text.spellcheck=false;
      text.setAttribute('aria-label',`${parityText('preview')}: ${entry.name}`);
      preview.append(title,text);host.append(preview);
      attachEditor(preview,text,result,requestedRoot,entry.path);text.focus();
    } else {preview.append(message(['binary_file','file_too_large'].includes(result?.error)?'previewLimit':'pathError'));host.append(preview);}
  }
  function attachEditor(preview,text,file,fileRoot,filePath) {
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
      canLeave=()=>true;openSelection();
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
    canLeave=()=>{
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
    text.addEventListener('keydown',event=>{
      if((event.ctrlKey || event.metaKey) && event.key.toLowerCase()==='s' && !text.readOnly) {
        event.preventDefault();event.stopPropagation();saveFile();
      }
    });
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
  }
  function showError(key) {host?.replaceChildren(message(key),button(parityText('refresh'),()=>load(relative)));}
  async function load(next='') {
    if(!canLeave())return;
    const request=++generation,requestedRoot=root;
    relative=next;selected=null;entries=[];loading=true;host.replaceChildren(message('loading'));
    const result=await window.cmuxNative.listWorkspaceFiles(root,next);
    if(request!==generation || root!==requestedRoot || !host?.isConnected)return;
    loading=false;
    if(!result?.ok){showError('pathError');return;}
    relative=result.path;entries=result.entries;
    const toolbar=document.createElement('div');toolbar.className='workspace-files-toolbar';
    const up=button(parityText('parent'),()=>load(relative.split(/[\\/]/).slice(0,-1).join('/')));up.disabled=!relative;
    toolbar.append(up,button(parityText('refresh'),()=>load(relative)));
    const path=document.createElement('div');path.className='workspace-files-path';path.textContent=relative || root;
    const tree=document.createElement('div');tree.className='workspace-file-tree';tree.setAttribute('role','tree');tree.setAttribute('aria-label',label);
    for(const [index,entry] of entries.entries()) {
      const item=button(`${entry.directory?'▸ ':''}${entry.name}`,()=>{selected=index;openSelection();});
      item.setAttribute('role','treeitem');item.setAttribute('aria-selected','false');item.tabIndex=index===0?0:-1;item.dataset.filePath=entry.path;
      item.onfocus=()=>{selected=index;for(const node of tree.children){node.setAttribute('aria-selected',String(node===item));node.tabIndex=node===item?0:-1;}};
      item.onkeydown=event=>{
        const delta={ArrowDown:1,ArrowUp:-1}[event.key];
        if(delta!==undefined){event.preventDefault();select(index+delta);}
        else if(event.key==='Home' || event.key==='End'){event.preventDefault();select(event.key==='Home'?0:entries.length-1);}
        else if(event.key==='ArrowRight' && entry.directory){event.preventDefault();selected=index;openSelection();}
        else if(event.key==='ArrowLeft' && relative){event.preventDefault();up.click();}
      };
      tree.append(item);
    }
    host.replaceChildren(toolbar,path,tree);if(result.truncated)host.append(message('truncated'));
    if(pendingFocus){pendingFocus=false;select(0);}
  }
  return {
    label,
    render(nextRoot,container) {
      if(root===nextRoot && host===container && (loading || container.querySelector('.workspace-file-tree')))return;
      root=nextRoot;host=container;load('');
    },
    openSelection,
    focus(){const item=host?.querySelector('[role=treeitem]');if(item)item.focus();else pendingFocus=true;},
    invalidate(){generation++;root='';loading=false;pendingFocus=false;}
  };
}
