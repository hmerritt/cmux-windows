// Availability is separate from binding registration. Features absent from the
// Windows port remain discoverable but never consume terminal or browser input.
const application = `openSettings reloadConfiguration newWindow closeWindow toggleFullScreen quit toggleSidebar focusSidebar newTab newLocalWorkspace newBrowserWorkspace saveLayoutTemplate openFolder goToWorkspace commandPalette showNotifications jumpToUnread triggerFlash nextSidebarTab prevSidebarTab moveWorkspaceUp moveWorkspaceDown selectWorkspaceByNumber selectSurfaceByNumber renameWorkspace closeTab closeWorkspace reopenClosedBrowserPanel newSurface focusLeft focusRight focusUp focusDown focusPreviousPane focusNextPane focusPaneByNumber splitRight splitDown toggleSplitZoom newPaneAutoLayout equalizeSplits focusHistoryBack focusHistoryForward focusHistoryLast closeOtherTabsInPane nextSurface prevSurface moveSurfaceLeft moveSurfaceRight moveSurfaceToPreviousPane moveSurfaceToNextPane moveSurfaceToPaneLeft moveSurfaceToPaneRight moveSurfaceToPaneUp moveSurfaceToPaneDown focusRightSidebar toggleFileExplorer openBrowser splitBrowserRight splitBrowserDown resize-pane-left resize-pane-right resize-pane-up resize-pane-down`;
const terminal = `toggleTerminalCopyMode sendCtrlFToTerminal sizeTerminalToMyWindow clearScreenKeepScrollback increaseWorkspaceTerminalFontSize decreaseWorkspaceTerminalFontSize resetWorkspaceTerminalFontSize useSelectionForFind`;
const browser = `focusBrowserAddressBar browserBack browserForward browserReload browserHardReload browserZoomIn browserZoomOut browserZoomReset toggleBrowserDeveloperTools showBrowserJavaScriptConsole toggleBrowserFocusMode toggleBrowserDesignMode`;
const diff=`diffViewerScrollDown diffViewerScrollUp diffViewerScrollHalfPageDown diffViewerScrollHalfPageUp diffViewerScrollDownEmacs diffViewerScrollUpEmacs diffViewerScrollToBottom diffViewerScrollToTop diffViewerOpenFileSearch diffViewerNextFile diffViewerPreviousFile diffViewerNextHunk diffViewerPreviousHunk diffViewerToggleViewed`;
export const scopes = Object.fromEntries([
  ['findInDirectory','application'],
  ['saveFilePreview','editorSave'],['toggleFileEditorWordWrap','editor'],
  ['openDiffViewer','application'],...diff.split(' ').map(id=>[id,'diff']),
  ...['markdownZoomIn','markdownZoomOut','markdownZoomReset'].map(id=>[id,'markdown']),
  ['switchRightSidebarToFiles','application'],['fileExplorerOpenSelection','files'],['fileExplorerOpenSelectionFinderAlias','files'],
  ...application.split(' ').map(id=>[id,'application']),
  ...terminal.split(' ').map(id=>[id,'terminal']),
  ...browser.split(' ').map(id=>[id,'browser']),
  ['toggleUnread','application'],['markOldestUnreadAndJumpNext','application'],['markAllNotificationsRead','application'],['clearAllNotifications','application'],
  ['renameTab','nonBrowser'],['renameWorkspace','nonBrowser'],['find','surface'],['findNext','surface'],['findPrevious','surface'],['hideFind','surface'],
  ['commandPaletteNext','palette'],['commandPalettePrevious','palette']
]);
export function actionAvailable(id, context) {
  if (context.dialogOpen) return false;
  switch(scopes[id]) {
    case 'application': return !context.commandPaletteVisible || ['commandPalette','openSettings','closeWindow','quit'].includes(id);
    case 'terminal': return context.terminalFocus && !context.commandPaletteVisible;
    case 'browser': return context.browserFocus && !context.commandPaletteVisible;
    case 'markdown': return context.markdownFocus && !context.commandPaletteVisible;
    case 'diff': return context.diffFocus && !context.textInputFocus && !context.commandPaletteVisible;
    case 'surface': return (context.browserFocus || context.terminalFocus || context.markdownFocus) && !context.commandPaletteVisible;
    case 'nonBrowser': return (context.terminalFocus || context.markdownFocus || context.diffFocus) && !context.commandPaletteVisible;
    case 'palette': return context.commandPaletteVisible;
    case 'files': return context.fileExplorerFocus && !context.commandPaletteVisible;
    case 'editorSave': return context.fileEditorEditable && !context.commandPaletteVisible;
    case 'editor': return context.fileEditorFocus && !context.commandPaletteVisible;
    default: return false;
  }
}
// Browser Back/Forward take precedence over focus history on the same binding.
export const actionPriority = id => scopes[id]==='diff'?-2:['browserBack','browserForward','browserReload','browserHardReload'].includes(id) ? -1 : 0;
