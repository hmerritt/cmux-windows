import {attachWorkspaceFileEditor} from './file-editor.mjs';
import {parityText} from './parity-messages.mjs';
import {catalog} from './shortcut-engine.mjs';
import {actionLabel} from './shortcut-ui.mjs';

export function createWorkspaceFileExplorer({openMarkdown,prompt,onRename,beforeRename,showMenu}={}) {
  let root='',relative='',host=null,generation=0,selected=null,entries=[],loading=false,pendingFocus=false;
  let canLeave=()=>true;
  let mutating=false,selectionButtons=[];
  const label=actionLabel(catalog.find(action=>action.id==='switchRightSidebarToFiles'));
  function button(text,run) {const node=document.createElement('button');node.type='button';node.textContent=text;node.onclick=run;return node;}
  function message(key) {const node=document.createElement('p');node.setAttribute('role','status');node.textContent=parityText(key);return node;}
  function select(index) {
    if(!entries.length)return;
    selected=Math.max(0,Math.min(entries.length-1,index));
    for(const button of selectionButtons)button.disabled=false;
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
      if(openMarkdown && /\.(md|markdown|mdown)$/i.test(entry.path)) {
        const open=button(parityText('openMarkdown'),()=>openMarkdown(requestedRoot,entry.path));open.dataset.fileAction='markdown';preview.insertBefore(open,text);
      }
      canLeave=attachWorkspaceFileEditor(preview,text,result,requestedRoot,entry.path,{reload:()=>{canLeave=()=>true;openSelection();}}).canLeave;text.focus();
    } else {preview.append(message(['binary_file','file_too_large'].includes(result?.error)?'previewLimit':'pathError'));host.append(preview);}
  }
  function showError(key) {host?.replaceChildren(message(key),button(parityText('refresh'),()=>load(relative)));}
  function mutationStatus(key) {
    host.querySelector('.workspace-file-mutation-status')?.remove();
    const status=message(key);status.className='workspace-file-mutation-status';host.prepend(status);
  }
  async function mutate(kind) {
    if(mutating || !canLeave())return;
    const entry=entries[selected],requestedRoot=root,parent=relative,request=generation;
    if(['rename','duplicate','trash'].includes(kind) && !entry)return;
    let name;
    if(!['duplicate','trash'].includes(kind)) {
      if(!prompt)return;
      const title=parityText(kind==='rename'?'renameEntry':kind==='folder'?'newFolder':'newFile');
      name=await prompt({title,value:kind==='rename'?entry.name:'',confirmLabel:parityText(kind==='rename'?'renameEntry':'createEntry'),cancelLabel:parityText('cancel')});
      if(name===null || requestedRoot!==root || request!==generation)return;
    }
    if(kind==='rename')try{beforeRename?.(requestedRoot,entry.path,entry.path.slice(0,-entry.name.length)+name);}catch{mutationStatus('draftError');return;}
    mutating=true;
    try {
      const neighbor=entries[selected+1]?.path || entries[selected-1]?.path || null;
      const result=kind==='rename'?await window.cmuxNative.renameWorkspaceEntry(root,entry.path,name)
        :kind==='duplicate'?await window.cmuxNative.duplicateWorkspaceEntry(root,entry.path,parityText('duplicateName'))
        :kind==='trash'?await window.cmuxNative.trashWorkspaceEntry(root,entry.path)
        :await window.cmuxNative.createWorkspaceEntry(root,parent,name,kind);
      if(requestedRoot!==root || request!==generation)return;
      if(!result?.ok){mutationStatus(result?.error==='entry_exists'?'entryExists':result?.error==='invalid_name'?'invalidName':'mutationError');return;}
      const preview=kind==='file' || (kind==='rename' && !entry.directory && Boolean(host.querySelector('.workspace-file-preview')));
      let syncError=false;
      if(kind==='rename')try{await onRename?.(requestedRoot,entry.path,result.path);}catch{syncError=true;}
      if(requestedRoot!==root)return;
      await load(parent,{selectPath:kind==='trash'?neighbor:result.path,preview});
      if(syncError)mutationStatus('draftError');
    }catch{if(requestedRoot===root)mutationStatus('mutationError');}
    finally{mutating=false;}
  }
  async function load(next='',{selectPath=null,preview=false}={}) {
    if(!canLeave())return;
    const request=++generation,requestedRoot=root;
    relative=next;selected=null;entries=[];selectionButtons=[];loading=true;host.replaceChildren(message('loading'));
    const result=await window.cmuxNative.listWorkspaceFiles(root,next);
    if(request!==generation || root!==requestedRoot || !host?.isConnected)return;
    loading=false;
    if(!result?.ok){showError('pathError');return;}
    relative=result.path;entries=result.entries;
    const toolbar=document.createElement('div');toolbar.className='workspace-files-toolbar';
    const up=button(parityText('parent'),()=>load(relative.split(/[\\/]/).slice(0,-1).join('/')));up.disabled=!relative;
    up.dataset.fileAction='parent';
    toolbar.append(up,button(parityText('refresh'),()=>load(relative)));
    for(const [kind,key] of [['file','newFile'],['folder','newFolder'],['rename','renameEntry'],['duplicate','duplicateEntry'],['trash','trashEntry']]) {
      const action=button(parityText(key),()=>mutate(kind));action.dataset.fileMutation=kind;
      if(['rename','duplicate','trash'].includes(kind)){selectionButtons.push(action);action.disabled=true;}
      toolbar.append(action);
    }
    const path=document.createElement('div');path.className='workspace-files-path';path.textContent=relative || root;
    const tree=document.createElement('div');tree.className='workspace-file-tree';tree.setAttribute('role','tree');tree.setAttribute('aria-label',label);
    for(const [index,entry] of entries.entries()) {
      const item=button(`${entry.directory?'▸ ':''}${entry.name}`,()=>{select(index);openSelection();});
      item.setAttribute('role','treeitem');item.setAttribute('aria-selected','false');item.tabIndex=index===0?0:-1;item.dataset.filePath=entry.path;
      item.onfocus=()=>{selected=index;for(const button of selectionButtons)button.disabled=false;for(const node of tree.children){node.setAttribute('aria-selected',String(node===item));node.tabIndex=node===item?0:-1;}};
      const contextMenu=event=>{
        if(!showMenu || mutating)return;
        event.preventDefault();event.stopPropagation();select(index);
        showMenu(event,[['rename','renameEntry'],['duplicate','duplicateEntry'],['trash','trashEntry']].map(([kind,key])=>({id:kind,label:parityText(key),run:()=>mutate(kind)})),item);
      };
      item.oncontextmenu=contextMenu;
      item.onkeydown=event=>{
        if(event.key==='ContextMenu' || (event.key==='F10' && event.shiftKey)){contextMenu(event);return;}

        const delta={ArrowDown:1,ArrowUp:-1}[event.key];
        if(delta!==undefined){event.preventDefault();select(index+delta);}
        else if(event.key==='Home' || event.key==='End'){event.preventDefault();select(event.key==='Home'?0:entries.length-1);}
        else if(event.key==='ArrowRight' && entry.directory){event.preventDefault();selected=index;openSelection();}
        else if(event.key==='ArrowLeft' && relative){event.preventDefault();up.click();}
      };
      tree.append(item);
    }
    host.replaceChildren(toolbar,path,tree);if(result.truncated)host.append(message('truncated'));
    if(selectPath!==null){const index=entries.findIndex(entry=>entry.path===selectPath);if(index>=0){select(index);if(preview)await openSelection();}}
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
