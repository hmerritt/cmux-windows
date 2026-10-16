import {catalog,ShortcutRouter,parseBinding} from './shortcut-engine.mjs';
import {actionAvailable,actionPriority,scopes} from './shortcut-scopes.mjs';
import {shortcutDialog,createShortcutSettings,shortcutText,actionLabel} from './shortcut-ui.mjs';
export const menuActions = {
  'workspace.new':'newTab','workspace.rename':'renameWorkspace','terminal.new':'newSurface',
  'terminal.reopenClosed':'reopenClosedBrowserPanel','terminal.close':'closeTab','browser.new':'openBrowser',
  'settings.open':'openSettings','terminal.find':'find','terminal.findNext':'findNext','terminal.findPrevious':'findPrevious',
  'palette.toggle':'commandPalette','sidebar.toggle':'toggleSidebar','terminal.nextPane':'focusNextPane',
  'terminal.previousPane':'focusPreviousPane','terminal.lastPane':'focusHistoryLast','workspace.next':'nextSidebarTab',
  'workspace.previous':'prevSidebarTab',
  'terminal.splitRight':'splitRight','terminal.splitDown':'splitDown',
  'workspace.close':'closeWorkspace','layout.equalPanes':'equalizeSplits',
  'terminal.focusPane':'toggleSplitZoom','notifications.open':'showNotifications'
};
function commandAction(command) {
  const workspace=command.match(/^workspace\.focus([1-9])$/),pane=command.match(/^terminal\.focusPane([1-9])$/);
  if(workspace)return {id:'selectWorkspaceByNumber',digit:Number(workspace[1])};
  if(pane)return {id:'focusPaneByNumber',digit:Number(pane[1])};
  if(command.startsWith('shortcut.')) {const [,id,digit]=command.split('.');return {id,digit:Number(digit)||undefined};}
  return menuActions[command]?{id:menuActions[command]}:null;
}
export function installWindowsShortcuts(e) {
  const {state,elements}=e;
  const router=new ShortcutRouter([...catalog].sort((a,b)=>actionPriority(a.id)-actionPriority(b.id)));
  let snapshot={settings:{},error:'',path:''};
  let copyMode=null;
  const browserFind=new Map();
  const history=[]; let historyIndex=-1, navigating=false,previousFocusId=null;
  const panel=()=>e.focusedPanel() || e.activePanel();
  const terminal=()=>state.terminals.get(panel()?.id);
  const browser=()=>state.browserViews.get(panel()?.id)?.view;
  const guestId=()=>{try{return browser()?.getWebContentsId();}catch{return undefined;}};
  function context(target=document.activeElement) {
    const input=e.isFormEditableTarget(target);
    const current=panel();
    const sidebarFocus=Boolean(target?.closest?.('.sidebar,.inspector'));
    const terminalFocus=!sidebarFocus && current?.type==='terminal' && (!input || Boolean(target?.closest?.('.terminal-search')));
    const browserFocus=!sidebarFocus && current?.type==='browser' && (!input || Boolean(target?.closest?.('.browser-bar')));
    return {terminalFocus,browserFocus,textInputFocus:input,sidebarFocus:Boolean(target?.closest?.('.sidebar,.inspector')),commandPaletteVisible:state.paletteOpen,terminalAlternateScreen:terminal()?.term.buffer.active.type==='alternate',terminalCopyMode:Boolean(copyMode),dialogOpen:Boolean(state.activeDialog)||settings.isOpen(),appFocus:true};
  }
  function focus(id) { if(id) return e.focusPanel(id); }
  function visiblePanels() {
    const panels=e.paneTabGroups.visiblePanels(e.activeWorkspace()).filter(p=>!e.isPanelMinimized(p));
    const order=[...elements.paneGrid.querySelectorAll('.pane')].map(node=>node.dataset.panelId);
    return [...panels].sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id));
  }
  function cyclePane(delta,digit) {
    const panels=visiblePanels(); if(!panels.length)return;
    const current=panels.findIndex(p=>p.id===panel()?.id);
    focus(panels[digit ? digit===9?panels.length-1:digit-1 : (current+delta+panels.length)%panels.length]?.id);
  }
  function cycleTab(delta,digit) {
    const tabs=e.paneTabGroups.members(e.activeWorkspace(),panel()?.id); if(!tabs.length)return;
    const current=tabs.findIndex(p=>p.id===panel()?.id);
    focus(tabs[digit ? digit===9?tabs.length-1:digit-1 : (current+delta+tabs.length)%tabs.length]?.id);
  }
  function neighbor(direction) {
    const panes=[...elements.paneGrid.querySelectorAll('.pane')];
    const current=panes.find(node=>node.dataset.panelId===panel()?.id); if(!current)return;
    const from=current.getBoundingClientRect(), x=from.x+from.width/2,y=from.y+from.height/2;
    const candidates=panes.filter(node=>node!==current).map(node=>{
      const rect=node.getBoundingClientRect(),dx=rect.x+rect.width/2-x,dy=rect.y+rect.height/2-y;
      const axis=direction==='left'?-dx:direction==='right'?dx:direction==='up'?-dy:dy;
      const cross=['left','right'].includes(direction)?Math.abs(dy):Math.abs(dx);
      return {id:node.dataset.panelId,axis,score:axis+cross*3};
    }).filter(value=>value.axis>1).sort((a,b)=>a.score-b.score);
    return candidates[0]?.id;
  }
  function resize(direction) {
    const axis=['left','right'].includes(direction)?'right':'down';
    let node=[...elements.paneGrid.querySelectorAll('.pane')].find(node=>node.dataset.panelId===panel()?.id);
    while(node && node!==elements.paneGrid) {
      const parent=node.parentElement;
      const splitter=parent?.querySelector(':scope > .pane-splitter');
      if(splitter?.dataset.orientation===axis) {
        e.setPaneSplitterPercent(splitter,Number(splitter.dataset.resizePercent||50)+(['right','down'].includes(direction)?5:-5));return;
      }
      node=parent;
    }
  }
  function equalize() {
    for(const splitter of elements.paneGrid.querySelectorAll('.pane-splitter')) e.setPaneSplitterPercent(splitter,50);
  }
  function reorderTab(delta) {
    const group=e.paneTabGroups.groupFor(panel()?.id); if(!group)return;
    const index=group.members.indexOf(panel().id),next=index+delta;
    if(next<0 || next>=group.members.length)return;
    [group.members[index],group.members[next]]=[group.members[next],group.members[index]];
    e.paneTabGroups.save();e.render();
  }
  function moveTab(direction) {
    const panels=visiblePanels(),current=panel();
    const index=panels.findIndex(p=>p.id===current?.id);
    const target=['next','previous'].includes(direction)?panels[(index+(direction==='next'?1:-1)+panels.length)%panels.length]?.id:neighbor(direction);
    if(!target || target===current?.id)return;
    let tree=e.paneTreeForWorkspace(e.activeWorkspace());
    const replacement=e.paneTabGroups.replacementForRemoval(current.id);
    tree=replacement?e.replacePaneTreePanelId(tree,current.id,replacement):e.removePanelFromPaneTree(tree,current.id);
    e.paneTabGroups.add(e.activeWorkspace().id,target,current.id);
    e.state.paneTrees.set(e.activeWorkspace().id,e.paneTabGroups.remapTree(tree));
    e.savePaneTreeLayouts(state.paneTrees);e.render();focus(current.id);
  }
  function moveWorkspace(delta) {
    const workspaces=state.data?.workspaces||[],index=workspaces.findIndex(w=>w.id===e.activeWorkspace()?.id);
    const target=workspaces[index+delta]; if(target)e.moveWorkspaceRelative(workspaces[index].id,target.id,delta<0?'before':'after');
  }
  function rememberFocus() {
    if(navigating)return;
    const id=panel()?.id; if(!id || history[historyIndex]===id)return;
    previousFocusId=history[historyIndex] || previousFocusId;
    history.splice(historyIndex+1);history.push(id);if(history.length>100)history.shift();historyIndex=history.length-1;
  }
  function historyMove(delta) {
    let index=historyIndex+delta;
    while(index>=0 && index<history.length) {
      const id=history[index]; if(e.findPanelState(id)) {
        previousFocusId=panel()?.id;
        historyIndex=index;navigating=true;
        Promise.resolve(focus(id)).finally(()=>{setTimeout(()=>{navigating=false;},100);});return;
      }
      index+=delta;
    }
  }
  function zoomBrowser(delta,reset=false) {
    const options=e.browserZoomOptions.map(([value])=>Number(value)).sort((a,b)=>a-b);
    const current=Number(state.settings.browserZoom),next=reset?100:delta>0?options.find(value=>value>current):[...options].reverse().find(value=>value<current);
    if(next)e.updateSettings({browserZoom:String(next)});
  }
  async function findBrowser(next=false,forward=true) {
    const view=browser(),id=panel()?.id;if(!view)return;
    let text=browserFind.get(id)||'';
    if(!next) {
      const title=actionLabel(catalog.find(action=>action.id==='find'));
      text=await e.showTextDialog({title,value:text,confirmLabel:title});
      if(text===null)return;
      browserFind.set(id,text);
    }
    if(text)view.findInPage(text,{forward,findNext:next});
  }
  function toggleCopyMode() {
    const session=terminal();if(!session)return;
    if(copyMode) {session.term.clearSelection();copyMode=null;return;}
    const buffer=session.term.buffer.active;
    copyMode={id:panel().id,anchor:buffer.viewportY+buffer.cursorY,line:buffer.viewportY+buffer.cursorY};
    session.term.selectLines(copyMode.line,copyMode.line);
  }
  function copyKey(event) {
    if(!copyMode)return false;
    if(copyMode.id!==panel()?.id){copyMode=null;return false;}
    const term=terminal()?.term;if(!term)return false;
    const key=event.key.toLowerCase();
    if(event.altKey || event.metaKey || event.ctrlKey)return false;
    if(['escape','enter','y'].includes(key)) {
      if(key==='y')e.copyActiveTerminalSelection(panel());
      term.clearSelection();copyMode=null;
    } else {
      let delta={arrowup:-1,k:-1,arrowdown:1,j:1,pageup:-term.rows,pagedown:term.rows}[key];
      if(delta===undefined && key!=='g')return false;
      copyMode.line=key==='g'?(event.shiftKey?term.buffer.active.length-1:0):Math.max(0,Math.min(term.buffer.active.length-1,copyMode.line+delta));
      if(!event.shiftKey)copyMode.anchor=copyMode.line;
      term.selectLines(Math.min(copyMode.anchor,copyMode.line),Math.max(copyMode.anchor,copyMode.line));term.scrollToLine(copyMode.line);
    }
    event.preventDefault();event.stopPropagation();return true;
  }
  const handlers={
    openSettings:()=>e.openSettingsCategory('actions'),
    reloadConfiguration:async()=>accept(await window.cmuxNative.reloadShortcuts()),
    newWindow:()=>window.cmuxNative.nativeShortcut('newWindow'),
    closeWindow:()=>window.cmuxNative.nativeShortcut('closeWindow'),
    toggleFullScreen:()=>window.cmuxNative.nativeShortcut('toggleFullScreen'),
    quit:()=>window.cmuxNative.nativeShortcut('quit'),
    toggleSidebar:e.toggleSidebar,
    focusSidebar:()=>{if(state.sidebarCollapsed)e.toggleSidebar();elements.workspaceList.querySelector('.workspace-row.is-active,.workspace-row')?.focus();},
    newTab:e.createWorkspace,newLocalWorkspace:e.createWorkspace,
    newBrowserWorkspace:async()=>{const workspace=await e.createWorkspace();await e.splitActivePanel('right','browser');await e.closePanelsById(workspace.panels.filter(p=>p.type==='terminal').map(p=>p.id));},
    saveLayoutTemplate:e.saveCurrentWorkspaceBlueprint,
    openFolder:e.createWorkspaceFromFolder,
    goToWorkspace:()=>{state.paletteWorkspaceOnly=true;e.openPalette();elements.paletteInput.value='';elements.paletteInput.dispatchEvent(new Event('input'));},
    commandPalette:()=>state.paletteOpen?e.closePalette():e.openPalette(),
    commandPaletteNext:()=>e.movePaletteSelection(1),commandPalettePrevious:()=>e.movePaletteSelection(-1),
    showNotifications:()=>e.openInspector('notifications'),
    jumpToUnread:()=>{const target=[...e.allAttentionPanels()].sort((a,b)=>(a.panel.notificationOrder||0)-(b.panel.notificationOrder||0)).at(-1);if(target)focus(target.panel.id);},
    toggleUnread:()=>{const current=panel();if(current)return e.updatePanel(current.id,{needsAttention:!current.needsAttention});},
    markOldestUnreadAndJumpNext:async()=>{
      const current=panel();if(!current)return;
      const next=[...e.allAttentionPanels()].filter(item=>item.panel.id!==current.id).sort((a,b)=>(a.panel.notificationOrder||0)-(b.panel.notificationOrder||0)).at(-1);
      await e.updatePanel(current.id,{needsAttention:true,notificationOrder:0});if(next)focus(next.panel.id);
    },
    markAllNotificationsRead:()=>e.updatePanels(e.allAttentionPanels().map(({panel})=>({panelId:panel.id,updates:{needsAttention:false}}))),
    clearAllNotifications:()=>e.updatePanels(e.allAttentionPanels().map(({panel})=>({panelId:panel.id,updates:{needsAttention:false}}))),
    triggerFlash:()=>{const node=[...elements.paneGrid.querySelectorAll('.pane')].find(node=>node.dataset.panelId===panel()?.id);node?.animate([{outline:'3px solid #0a84ff'},{outline:'3px solid transparent'}],{duration:700});},
    nextSidebarTab:()=>e.cycleWorkspace(1),prevSidebarTab:()=>e.cycleWorkspace(-1),
    moveWorkspaceUp:()=>moveWorkspace(-1),moveWorkspaceDown:()=>moveWorkspace(1),
    selectWorkspaceByNumber:digit=>{const items=state.data?.workspaces||[];const target=items[digit===9?items.length-1:digit-1];if(target)e.focusWorkspace(target.id);},
    renameTab:()=>e.renameActivePanel(panel()),renameWorkspace:e.renameActiveWorkspace,
    closeTab:()=>e.closePanel(panel()?.id),closeWorkspace:e.closeActiveWorkspace,
    closeOtherTabsInPane:()=>e.closePanelsById(e.paneTabGroups.members(e.activeWorkspace(),panel()?.id).filter(p=>p.id!==panel()?.id).map(p=>p.id)),
    reopenClosedBrowserPanel:()=>{const index=state.closedPanels.findIndex(p=>p.type==='browser');if(index<0)return;const [closed]=state.closedPanels.splice(index,1);state.closedPanels.unshift(closed);return e.reopenClosedPanel();},
    newSurface:e.createTerminalPanel,
    nextSurface:()=>cycleTab(1),prevSurface:()=>cycleTab(-1),selectSurfaceByNumber:digit=>cycleTab(0,digit),
    moveSurfaceLeft:()=>reorderTab(-1),moveSurfaceRight:()=>reorderTab(1),
    focusNextPane:()=>cyclePane(1),focusPreviousPane:()=>cyclePane(-1),focusPaneByNumber:digit=>cyclePane(0,digit),
    focusHistoryBack:()=>historyMove(-1),focusHistoryForward:()=>historyMove(1),focusHistoryLast:()=>{const target=previousFocusId;if(target && e.findPanelState(target)){previousFocusId=panel()?.id;focus(target);}},
    focusLeft:()=>focus(neighbor('left')),focusRight:()=>focus(neighbor('right')),focusUp:()=>focus(neighbor('up')),focusDown:()=>focus(neighbor('down')),
    splitRight:()=>e.splitActivePanel('right'),splitDown:()=>e.splitActivePanel('down'),
    splitBrowserRight:()=>e.splitActivePanel('right','browser'),splitBrowserDown:()=>e.splitActivePanel('down','browser'),
    newPaneAutoLayout:()=>{const rect=elements.paneGrid.getBoundingClientRect();return e.splitActivePanel(rect.width>rect.height?'right':'down');},
    toggleSplitZoom:()=>e.togglePaneZoom(panel()?.id),equalizeSplits:equalize,
    toggleTerminalCopyMode:toggleCopyMode,
    sendCtrlFToTerminal:()=>e.sendTerminalInput(panel()?.id,'\x06'),
    sizeTerminalToMyWindow:()=>e.scheduleFitTerminal(terminal(),true),
    clearScreenKeepScrollback:()=>terminal()?.term.write('\x1b[2J\x1b[H'),
    increaseWorkspaceTerminalFontSize:()=>e.activeWorkspace()?.panels.filter(p=>p.type==='terminal').forEach(p=>e.changePaneTerminalFontSize(p.id,1,{toast:false})),
    decreaseWorkspaceTerminalFontSize:()=>e.activeWorkspace()?.panels.filter(p=>p.type==='terminal').forEach(p=>e.changePaneTerminalFontSize(p.id,-1,{toast:false})),
    resetWorkspaceTerminalFontSize:()=>e.activeWorkspace()?.panels.filter(p=>p.type==='terminal').forEach(p=>e.resetPaneTerminalFontSize(p.id,{toast:false})),
    focusRightSidebar:()=>{if(!state.inspectorMode)e.openInspector('notifications');elements.inspector.querySelector('button,input')?.focus();},
    toggleFileExplorer:()=>e.openInspector(state.inspectorMode || 'notifications'),
    openBrowser:e.openBrowserHome,
    focusBrowserAddressBar:()=>e.focusBrowserAddress(panel()),
    browserBack:()=>e.navigateBrowserHistory(-1,panel()),browserForward:()=>e.navigateBrowserHistory(1,panel()),
    browserReload:()=>e.reloadBrowserPanel(panel()),
    browserHardReload:()=>window.cmuxNative.nativeShortcut('browserHardReload',guestId()),
    browserZoomIn:()=>zoomBrowser(1),browserZoomOut:()=>zoomBrowser(-1),browserZoomReset:()=>zoomBrowser(0,true),
    toggleBrowserDeveloperTools:()=>window.cmuxNative.nativeShortcut('toggleBrowserDeveloperTools',guestId()),
    showBrowserJavaScriptConsole:()=>window.cmuxNative.nativeShortcut('showBrowserJavaScriptConsole',guestId()),
    toggleBrowserFocusMode:()=>e.togglePaneZoom(panel()?.id),
    toggleBrowserDesignMode:()=>browser()?.executeJavaScript("document.designMode = document.designMode === 'on' ? 'off' : 'on'"),
    find:()=>panel()?.type==='browser'?findBrowser():e.openTerminalSearch(panel()),
    findNext:()=>panel()?.type==='browser'?findBrowser(true):e.findNextInTerminal(panel()),
    findPrevious:()=>panel()?.type==='browser'?findBrowser(true,false):e.findPreviousInTerminal(panel()),
    hideFind:()=>panel()?.type==='browser'?window.cmuxNative.nativeShortcut('hideFind',guestId()):e.closeTerminalSearch(panel()),
    useSelectionForFind:()=>{const session=terminal(),text=session?.term.getSelection();if(text){e.openTerminalSearch(panel());const input=e.terminalSearchInput(session);input.value=text;input.dispatchEvent(new Event('input'));}}
  };
  for(const direction of ['Left','Right','Up','Down','PreviousPane','NextPane']) {
    const id='moveSurfaceTo'+(direction.endsWith('Pane')?direction:'Pane'+direction);
    handlers[id]=()=>moveTab(direction.replace('Pane','').toLowerCase());
  }
  for(const direction of ['left','right','up','down'])handlers[`resize-pane-${direction}`]=()=>resize(direction);
  for(const id of Object.keys(scopes))if(!handlers[id])throw new Error(`Missing Windows shortcut handler: ${id}`);
  function run(id,digit,repeat=false) {
    const action=handlers[id];if(!action)return false;
    if(repeat && !/^(focus|next|prev|resize-|browserZoom|increase|decrease)/.test(id))return true;
    try {Promise.resolve(action(digit)).catch(error=>{console.error(`Shortcut ${id}: ${error.message}`);});}
    catch(error) {console.error(`Shortcut ${id}: ${error.message}`);}
    return true;
  }
  function accept(value) {
    if(!value)return;
    snapshot=value;
    if(!snapshot.error)router.configure(snapshot.settings);
    settings.refresh();
    for(const command of e.commands) {
      const metadata=commandAction(command.id);if(!metadata)continue;
      command.shortcut=shortcutForAction(metadata.id,metadata.digit);
    }
  }
  const settings=shortcutDialog({getSnapshot:()=>snapshot,parseBinding,save:async(id,value,reset)=>accept(await window.cmuxNative.updateShortcut(id,value,reset))});
  window.cmuxNative?.getShortcuts?.().then(accept);
  window.cmuxNative?.onShortcutsChanged?.(accept);
  window.cmuxNative?.onShortcut?.(result=>{
    // The guest matcher cannot inspect host dialogs; discard stale guest keys.
    if(context().dialogOpen || state.paletteOpen)return;
    const session=[...state.browserViews.entries()].find(([,session])=>{try{return session.view?.getWebContentsId()===result.guestId;}catch{return false;}});
    if(!session)return;
    focus(session[0]);
    run(result.id,result.digit,result.repeat);
  });
  document.addEventListener('focusin',()=>{router.pending=null;queueMicrotask(rememberFocus);});
  document.addEventListener('compositionstart',()=>{router.pending=null;});
  const observer=new MutationObserver(()=>rememberFocus());observer.observe(elements.paneGrid,{childList:true,subtree:true});
  window.addEventListener('blur',()=>{router.pending=null;});
  window.addEventListener('keydown',event=>{
    rememberFocus();
    if(copyKey(event))return;
    const result=router.handle(event,context(event.target),actionAvailable);
    if(!result)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(result.id)run(result.id,result.digit,result.repeat);
  },true);
  for(const command of e.commands) {
    const metadata=commandAction(command.id);
    if(metadata)command.run=()=>run(metadata.id,metadata.digit);
    else if(!['terminal.copySelection','terminal.pasteClipboard','terminal.clear'].includes(command.id))command.shortcut='';
  }
  const numbered=new Set(['selectSurfaceByNumber','selectWorkspaceByNumber','focusPaneByNumber']);
  function shortcutForAction(id,digit) {
    const entry=router.entries.find(entry=>entry.id===id);
    return entry?.strokes.map((stroke,index)=>digit && index===entry.strokes.length-1?stroke.slice(0,-1)+digit:stroke).join(', ')||'';
  }
  function actionEntries() {
    return catalog.filter(action=>scopes[action.id]).flatMap(action=>{
      const digits=numbered.has(action.id)?[1,2,3,4,5,6,7,8,9]:[undefined];
      return digits.map(digit=>({
        id:`shortcut.${action.id}${digit?'.'+digit:''}`,
        label:actionLabel(action).replace(/1…9/g,digit?String(digit):'1…9'),
        shortcut:shortcutForAction(action.id,digit),
        run:()=>run(action.id,digit)
      }));
    });
  }
  function runMenu(command) {
    const metadata=commandAction(command);
    return metadata?run(metadata.id,metadata.digit):false;
  }
  return {open:()=>settings.open(),settingsButton:()=>createShortcutSettings(settings),run,runMenu,actionEntries};
}
