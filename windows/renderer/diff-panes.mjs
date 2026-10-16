import {parityText} from './parity-messages.mjs';
import {parseDiffLines,splitDiffRows} from './diff-lines.mjs';
import {wordDiffRows} from './diff-words.mjs';

function element(tag,className,text){const node=document.createElement(tag);node.className=className;if(text!==undefined)node.textContent=text;return node;}
export function createDiffPanes() {
  const sessions=new Map();
  let preferences={layout:'unified',wordWrap:false,lineNumbers:true,showBackgrounds:true,wordDiffs:false,expandUnchanged:false,diffIndicators:'bars'},savingPreferences=false;
  function applyPreferences(updates) {
    preferences={...preferences,...updates};
    for(const session of sessions.values()) {
      for(const key of ['layout','wordWrap','lineNumbers','showBackgrounds','wordDiffs','expandUnchanged','diffIndicators'])session.host.dataset[key==='layout'?'diffLayout':key]=String(preferences[key]);
      for(const button of session.toolbar.querySelectorAll('[data-diff-layout],[data-diff-option]')) {
        button.setAttribute('aria-pressed',String(button.dataset.diffLayout?preferences.layout===button.dataset.diffLayout:Boolean(preferences[button.dataset.diffOption])));
        button.disabled=savingPreferences;
      }
      session.indicators.value=preferences.diffIndicators;session.indicators.disabled=savingPreferences;
      if(session.selected && session.requestedExpanded!==preferences.expandUnchanged)selectFile(session,session.selected);
      else if(session.current && (session.renderedLayout!==preferences.layout || session.renderedWordDiffs!==preferences.wordDiffs))renderPatch(session,session.current);
    }
  }
  async function updatePreferences(updates) {
    if(savingPreferences)return;
    savingPreferences=true;applyPreferences({});
    try {
      const result=await window.cmuxNative.setDiffPreferences(updates);
      if(result?.ok){applyPreferences(result.preferences);for(const session of sessions.values())session.preferenceNotice.hidden=true;}
      else for(const session of sessions.values()){session.preferenceNotice.textContent=parityText('diffPreferenceError');session.preferenceNotice.hidden=false;}
    }catch{for(const session of sessions.values()){session.preferenceNotice.textContent=parityText('diffPreferenceError');session.preferenceNotice.hidden=false;}}
    finally{savingPreferences=false;applyPreferences({});}
  }
  window.cmuxNative?.onDiffPreferencesChanged?.(applyPreferences);
  window.cmuxNative?.getDiffPreferences?.().then(result=>{if(result?.ok)applyPreferences(result.preferences);}).catch(()=>{});

  function visibleFiles(session){const query=session.search.value.toLocaleLowerCase();return session.entries.filter(entry=>entry.path.toLocaleLowerCase().includes(query));}
  function updateViewed(session) {
    for(const row of session.list.children)row.dataset.viewed=String(Boolean(session.revisions.get(row.dataset.gitPath) && session.viewed[row.dataset.gitPath]===session.revisions.get(row.dataset.gitPath)));
  }
  function renderFiles(session) {
    const focusedPath=session.list.contains(document.activeElement)?document.activeElement.dataset.gitPath:null;
    const entries=visibleFiles(session);
    session.list.replaceChildren(...entries.map(entry=>{
      const row=element('button','diff-file',`${entry.status}  ${entry.path}`);row.type='button';row.dataset.gitPath=entry.path;
      row.setAttribute('role','option');row.setAttribute('aria-selected',String(entry.path===session.selected));
      row.tabIndex=entry.path===session.selected || (!session.selected && entry===entries[0])?0:-1;
      row.onclick=()=>{selectFile(session,entry.path);session.host.focus();};
      row.onkeydown=event=>{
        if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
        event.preventDefault();event.stopPropagation();
        const index=entries.findIndex(item=>item.path===entry.path);
        const next=event.key==='Home'?0:event.key==='End'?entries.length-1:Math.max(0,Math.min(entries.length-1,index+(event.key==='ArrowDown'?1:-1)));
        selectFile(session,entries[next].path);session.list.children[next]?.focus();
      };
      return row;
    }));
    updateViewed(session);
    if(focusedPath)[...session.list.children].find(row=>row.dataset.gitPath===focusedPath)?.focus();
  }
  function renderPatch(session,result) {
    const scrollTop=session.patch.scrollTop;
    const previousHunk=session.renderedRevision===result.revision?session.hunk:-1;
    session.patch.replaceChildren();session.hunk=-1;session.renderedLayout=preferences.layout;session.renderedWordDiffs=preferences.wordDiffs;session.renderedRevision=result.revision;
    session.contextNotice.hidden=!result.contextLimited;
    const wordBudget={remaining:2000000};
    if(result.binary)session.patch.append(element('p','',parityText('binaryDiff')));
    if(result.limited)session.patch.append(element('p','',parityText('previewLimit')));
    for(const [label,text] of [['stagedChanges',result.staged],['workingChanges',result.unstaged]]) {
      if(!text)continue;
      session.patch.append(element('h3','diff-section-title',parityText(label)));
      for(const block of parseDiffLines(text)) {
        if(block.type==='header') {
          const header=element('div','diff-header');
          for(const line of block.lines)header.append(element('pre','diff-line diff-context',line));
          session.patch.append(header);continue;
        }
        const hunk=element('section','diff-hunk');hunk.dataset.diffLayout=preferences.layout;hunk.dataset.hunkIndex=String(session.patch.querySelectorAll('.diff-hunk').length);
        hunk.append(element('pre','diff-line diff-range',block.header));
        const lineNumber=(value,side)=>{const number=element('span',`diff-line-number diff-${side}-line`,value??'');number.setAttribute('aria-hidden','true');return number;};
        const wordSegments=preferences.wordDiffs?wordDiffRows(block.rows,wordBudget):new Map();
        const code=row=>{
          const text=element('pre',`diff-line diff-${row?.kind||'empty'}`);
          if(row) {
            const sign=element('span','diff-sign',row.text[0]);sign.setAttribute('aria-hidden','true');text.append(sign);
            for(const part of wordSegments.get(row)||[{text:row.text.slice(1),changed:false}])text.append(element('span',part.changed?'diff-word-change':'',part.text));
          }else text.textContent=' ';
          if(row?.note)text.append(element('span','diff-line-note','\n'+row.note));return text;
        };
        if(preferences.layout==='split') {
          for(const pair of splitDiffRows(block.rows)) {
            const row=element('div','diff-split-row');
            for(const [side,line] of [['old',pair.left],['new',pair.right]]) {
              const cell=element('div','diff-cell');cell.append(lineNumber(line?.[side+'Line'],side),code(line));row.append(cell);
            }
            hunk.append(row);
          }
        }else for(const line of block.rows) {
          const row=element('div','diff-unified-row');row.append(lineNumber(line.oldLine,'old'),lineNumber(line.newLine,'new'),code(line));hunk.append(row);
        }
        session.patch.append(hunk);
      }
    }
    const hunks=[...session.patch.querySelectorAll('.diff-hunk')];
    if(previousHunk>=0 && hunks.length){session.hunk=Math.min(previousHunk,hunks.length-1);hunks[session.hunk].classList.add('is-current');}
    session.patch.scrollTop=scrollTop;
  }
  async function selectFile(session,filePath) {
    const request=++session.request,changed=session.selected!==filePath;
    session.selected=filePath;renderFiles(session);
    if(changed){session.patch.replaceChildren(element('p','',parityText('loading')));session.revision=null;session.current=null;}
    try {
      session.requestedExpanded=preferences.expandUnchanged;
      const result=await window.cmuxNative.workspaceGitDiff(session.panel.cwd,filePath,{expandUnchanged:session.requestedExpanded});
      if(session.disposed || request!==session.request)return;
      if(!result?.ok){session.current=null;session.revision=null;session.patch.replaceChildren(element('p','',parityText(result?.error==='diff_too_large'?'diffLimit':'gitError')));return;}
      session.revisions.set(filePath,result.revision);session.current=result;updateViewed(session);
      const signature=JSON.stringify([result.revision,result.expanded,result.contextLimited]);
      if(session.revision!==result.revision || session.contentSignature!==signature){session.revision=result.revision;session.contentSignature=signature;renderPatch(session,result);if(changed)session.patch.scrollTop=0;}
    }catch{if(!session.disposed && request===session.request)session.patch.replaceChildren(element('p','',parityText('gitError')));}
  }
  async function refresh(session) {
    if(session.disposed || session.loading || !session.host.isConnected)return;
    session.loading=true;
    try {
      const result=await window.cmuxNative.workspaceGitStatus(session.panel.cwd);
      if(session.disposed)return;
      if(!result?.ok){session.patch.replaceChildren(element('p','',parityText('gitError')));return;}
      session.root=result.root;session.entries=result.entries;session.notice.hidden=!result.truncated;
      if(!session.viewedLoaded){try{const viewed=JSON.parse(localStorage.getItem(`cmux.diffViewed:${result.root}`)||'{}');if(viewed && typeof viewed==='object' && !Array.isArray(viewed))session.viewed=viewed;}catch{}session.viewedLoaded=true;}
      const selected=result.entries.find(entry=>entry.path===session.selected)?.path || result.entries[0]?.path;
      renderFiles(session);
      if(selected)await selectFile(session,selected);
      else {session.request++;session.selected=null;session.revision=null;session.current=null;session.patch.replaceChildren(element('p','',parityText('noChanges')));}
    }catch{if(!session.disposed)session.patch.replaceChildren(element('p','',parityText('gitError')));}
    finally{session.loading=false;}
  }
  return {
    render(panel,body) {
      let session=sessions.get(panel.id);
      if(!session) {
        const host=element('div','document-pane diff-pane');host.tabIndex=0;
        const toolbar=element('div','document-toolbar workspace-files-toolbar');
        const search=element('input','diff-file-search');search.type='search';search.placeholder=parityText('searchFiles');search.setAttribute('aria-label',parityText('searchFiles'));
        const reload=element('button','',parityText('refresh'));reload.type='button';
        for(const layout of ['unified','split']) {
          const button=element('button','',parityText(layout==='split'?'diffSplit':'diffUnified'));button.type='button';button.dataset.diffLayout=layout;
          button.onclick=()=>updatePreferences({layout});toolbar.append(button);
        }
        for(const [key,label] of [['wordWrap','diffWordWrap'],['lineNumbers','diffLineNumbers'],['showBackgrounds','diffBackgrounds'],['wordDiffs','diffWordDiffs'],['expandUnchanged','diffExpandContext']]) {
          const button=element('button','',parityText(label));button.type='button';button.dataset.diffOption=key;
          button.onclick=()=>updatePreferences({[key]:!preferences[key]});toolbar.append(button);
        }
        const indicators=element('select','diff-indicator-mode');indicators.dataset.diffIndicators='';indicators.setAttribute('aria-label',parityText('diffIndicators'));
        for(const [value,key] of [['bars','diffIndicatorBars'],['classic','diffIndicatorClassic'],['none','diffIndicatorNone']]){const option=element('option','',parityText(key));option.value=value;indicators.append(option);}
        indicators.onchange=()=>updatePreferences({diffIndicators:indicators.value});toolbar.append(indicators);
        const contextNotice=element('p','diff-notice',parityText('diffContextLimit'));contextNotice.setAttribute('role','status');contextNotice.hidden=true;
        const preferenceNotice=element('p','diff-notice');preferenceNotice.setAttribute('role','status');preferenceNotice.hidden=true;
        const notice=element('p','diff-notice',parityText('truncated'));notice.hidden=true;
        const split=element('div','diff-layout');
        const list=element('div','diff-file-list');list.setAttribute('role','listbox');list.setAttribute('aria-label',parityText('changedFiles'));
        const patch=element('div','diff-patch');patch.tabIndex=0;patch.setAttribute('role','region');patch.setAttribute('aria-label',parityText('diffPane'));
        session={panel,host,toolbar,indicators,contextNotice,preferenceNotice,search,list,patch,notice,entries:[],selected:null,request:0,revision:null,current:null,revisions:new Map(),viewed:{},viewedLoaded:false,hunk:-1,disposed:false,loading:false};
        search.oninput=()=>renderFiles(session);
        search.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();search.value='';renderFiles(session);host.focus();}};
        reload.onclick=()=>refresh(session);
        toolbar.prepend(search,reload);split.append(list,patch);host.append(toolbar,notice,preferenceNotice,contextNotice,split);
        sessions.set(panel.id,session);applyPreferences({});session.timer=setInterval(()=>refresh(session),3000);
      }
      if(session.host.parentElement!==body){body.replaceChildren(session.host);requestAnimationFrame(()=>refresh(session));}
    },
    focus(id){const session=sessions.get(id);if(session?.host.isConnected)session.host.focus();},
    action(id,action) {
      const session=sessions.get(id);if(!session)return;
      const files=visibleFiles(session),index=files.findIndex(file=>file.path===session.selected);
      if(action==='diffViewerOpenFileSearch'){session.search.focus();session.search.select();return;}
      if(action==='diffViewerNextFile' || action==='diffViewerPreviousFile') {
        const next=files[Math.max(0,Math.min(files.length-1,index+(action==='diffViewerNextFile'?1:-1)))];
        if(next)selectFile(session,next.path);return;
      }
      if(action==='diffViewerToggleViewed' && session.current) {
        const {path,revision}=session.current;
        if(session.viewed[path]===revision)delete session.viewed[path];else session.viewed[path]=revision;
        try{localStorage.setItem(`cmux.diffViewed:${session.root}`,JSON.stringify(session.viewed));}catch{}
        updateViewed(session);return;
      }
      if(action==='diffViewerNextHunk' || action==='diffViewerPreviousHunk') {
        const hunks=[...session.patch.querySelectorAll('.diff-hunk')];if(!hunks.length)return;
        session.hunk=Math.max(0,Math.min(hunks.length-1,session.hunk+(action==='diffViewerNextHunk'?1:-1)));
        for(const [index,hunk] of hunks.entries())hunk.classList.toggle('is-current',index===session.hunk);
        hunks[session.hunk].scrollIntoView({block:'nearest'});return;
      }
      const scroll={diffViewerScrollDown:48,diffViewerScrollUp:-48,diffViewerScrollDownEmacs:48,diffViewerScrollUpEmacs:-48,diffViewerScrollHalfPageDown:session.patch.clientHeight/2,diffViewerScrollHalfPageUp:-session.patch.clientHeight/2};
      if(action==='diffViewerScrollToTop')session.patch.scrollTop=0;
      else if(action==='diffViewerScrollToBottom')session.patch.scrollTop=session.patch.scrollHeight;
      else if(action in scroll)session.patch.scrollBy(0,scroll[action]);
    },
    dispose(id){const session=sessions.get(id);if(!session)return;session.disposed=true;clearInterval(session.timer);sessions.delete(id);}
  };
}
