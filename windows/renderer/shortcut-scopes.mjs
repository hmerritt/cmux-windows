// Availability is separate from binding registration. Features absent from the
// Windows port remain discoverable but never consume terminal or browser input.
const application = `openSettings reloadConfiguration newWindow closeWindow toggleFullScreen quit toggleSidebar focusSidebar newTab newLocalWorkspace newBrowserWorkspace saveLayoutTemplate openFolder goToWorkspace commandPalette showNotifications jumpToUnread triggerFlash nextSidebarTab prevSidebarTab moveWorkspaceUp moveWorkspaceDown selectWorkspaceByNumber selectSurfaceByNumber renameWorkspace closeTab closeWorkspace reopenClosedBrowserPanel newSurface focusLeft focusRight focusUp focusDown focusPreviousPane focusNextPane focusPaneByNumber splitRight splitDown toggleSplitZoom newPaneAutoLayout equalizeSplits focusHistoryBack focusHistoryForward focusHistoryLast closeOtherTabsInPane nextSurface prevSurface moveSurfaceLeft moveSurfaceRight moveSurfaceToPreviousPane moveSurfaceToNextPane moveSurfaceToPaneLeft moveSurfaceToPaneRight moveSurfaceToPaneUp moveSurfaceToPaneDown focusRightSidebar toggleFileExplorer openBrowser splitBrowserRight splitBrowserDown resize-pane-left resize-pane-right resize-pane-up resize-pane-down`;
const terminal = `toggleTerminalCopyMode sendCtrlFToTerminal sizeTerminalToMyWindow clearScreenKeepScrollback increaseWorkspaceTerminalFontSize decreaseWorkspaceTerminalFontSize resetWorkspaceTerminalFontSize useSelectionForFind`;
const browser = `focusBrowserAddressBar browserBack browserForward browserReload browserHardReload browserZoomIn browserZoomOut browserZoomReset toggleBrowserDeveloperTools showBrowserJavaScriptConsole toggleBrowserFocusMode toggleBrowserDesignMode`;
export const scopes = Object.fromEntries([
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
    case 'surface': return (context.browserFocus || context.terminalFocus) && !context.commandPaletteVisible;
    case 'nonBrowser': return context.terminalFocus && !context.commandPaletteVisible;
    case 'palette': return context.commandPaletteVisible;
    default: return false;
  }
}
// Browser Back/Forward take precedence over focus history on the same binding.
export const actionPriority = id => ['browserBack','browserForward','browserReload','browserHardReload'].includes(id) ? -1 : 0;
