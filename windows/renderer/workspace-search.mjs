import {attachWorkspaceFileEditor} from './file-editor.mjs';
import {parityText} from './parity-messages.mjs';
import {catalog} from './shortcut-engine.mjs';
import {actionLabel} from './shortcut-ui.mjs';
export function createWorkspaceSearch() {
  const label=actionLabel(catalog.find(action=>action.id==='findInDirectory'));
  let root='',host=null,input=null,status=null,list=null,generation=0,timer=null,canLeave=()=>true;
  function setStatus(text,state='ready'){status.textContent=text;status.dataset.state=state;}
  async function preview(entry) {
    if(!canLeave())return;
    const request=++generation,requestedRoot=root;
    const result=await window.cmuxNative.readWorkspaceFile(root,entry.path);
    if(request!==generation || requestedRoot!==root || !host?.isConnected)return;
    host.querySelector('.workspace-file-preview')?.remove();
    const section=document.createElement('section');section.className='workspace-file-preview';
    const title=document.createElement('div');title.textContent=`${entry.path}:${entry.lineNumber}`;
    section.append(title);host.append(section);
    if(!result?.ok){const error=document.createElement('p');error.textContent=parityText('previewLimit');section.append(error);return;}
    const text=document.createElement('textarea');text.value=result.text;text.readOnly=true;text.spellcheck=false;text.setAttribute('aria-label',entry.path);section.append(text);
    canLeave=attachWorkspaceFileEditor(section,text,result,root,entry.path,{reload:()=>{canLeave=()=>true;preview(entry);}}).canLeave;
    const lines=text.value.split('\n'),offset=lines.slice(0,entry.lineNumber-1).reduce((sum,line)=>sum+line.length+1,0)+entry.columnNumber-1;
    text.focus();text.setSelectionRange(offset,offset+entry.length);text.scrollTop=Math.max(0,(entry.lineNumber-3)*parseFloat(getComputedStyle(text).lineHeight || 18));
  }
  async function search() {
    const request=++generation,requestedRoot=root,query=input.value;
    list.replaceChildren();setStatus(query?parityText('loading'):'',query?'loading':'ready');
    const result=await window.cmuxNative.searchWorkspaceFiles(root,query);
    if(request!==generation || requestedRoot!==root || !host?.isConnected)return;
    if(!result?.ok){setStatus(parityText(result?.error==='ripgrep_missing'?'ripgrepMissing':'searchError'),'error');return;}
    setStatus(result.truncated?parityText('searchLimited'):String(result.results.length));
    for(const entry of result.results) {
      const row=document.createElement('button');row.type='button';row.className='workspace-search-result';
      const location=document.createElement('strong');location.textContent=`${entry.path}:${entry.lineNumber}:${entry.columnNumber}`;
      const snippet=document.createElement('span');snippet.textContent=entry.preview;row.append(location,snippet);
      row.onclick=()=>preview(entry);
      row.onkeydown=event=>{
        const rows=[...list.children],index=rows.indexOf(row);
        if(event.key==='Enter' || event.key===' '){event.preventDefault();preview(entry);}
        else if(event.key==='ArrowDown' || event.key==='ArrowUp'){event.preventDefault();rows[Math.max(0,Math.min(rows.length-1,index+(event.key==='ArrowDown'?1:-1)))]?.focus();}
        else if(event.key==='Escape'){event.preventDefault();input.focus();}
      };
      list.append(row);
    }
  }
  return {
    label,
    render(nextRoot,container) {
      if(root===nextRoot && host===container && input?.isConnected)return;
      generation++;clearTimeout(timer);root=nextRoot;host=container;canLeave=()=>true;
      input=document.createElement('input');input.type='search';input.className='workspace-search-input';input.placeholder=label;input.setAttribute('aria-label',label);
      status=document.createElement('p');status.className='workspace-search-status';status.setAttribute('role','status');status.dataset.state='ready';
      list=document.createElement('div');list.className='workspace-search-results';list.setAttribute('aria-label',label);
      input.oninput=()=>{generation++;clearTimeout(timer);timer=setTimeout(()=>search(),180);};
      input.onkeydown=event=>{if(event.key==='ArrowDown' || event.key==='Enter'){event.preventDefault();list.firstElementChild?.focus();}else if(event.key==='Escape'){event.preventDefault();input.value='';clearTimeout(timer);search();}};
      host.replaceChildren(input,status,list);
    },
    focus(){input?.focus();input?.select();},
    invalidate(){if(!root)return;generation++;clearTimeout(timer);window.cmuxNative.searchWorkspaceFiles(root,'').catch(()=>{});root='';}
  };
}
