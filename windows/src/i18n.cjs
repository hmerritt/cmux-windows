const catalogMessages = require('./catalog-messages.json');
const messages = {
  en: {
    "browser.systemDefault": "System default browser",
    "browser.system": "System",
    "browser.defaultProfile": "Default",
    "browser.profileLabel": "{browser} / {profile}",
    "menu.file": "File",
    "menu.newWorkspace": "New Workspace",
    "menu.renameWorkspace": "Rename Workspace",
    "menu.workspaceBlueprints": "Workspace Blueprints",
    "menu.newTerminal": "New Terminal",
    "menu.runCommand": "Run Command in Active Terminal",
    "menu.reopenClosedPane": "Reopen Closed Pane",
    "menu.copyTerminalSelection": "Copy Terminal Selection",
    "menu.pasteClipboard": "Paste Clipboard to Terminal",
    "menu.restartTerminal": "Restart Active Terminal",
    "menu.closeActivePane": "Close Active Pane",
    "menu.openBrowser": "Open Browser",
    "menu.settings": "Settings",
    "menu.colorSettings": "Color Settings",
    "menu.backgroundSettings": "Background Settings",
    "menu.settingsProfiles": "Settings Profiles",
    "menu.commandSnippets": "Command Snippets",
    "menu.edit": "Edit",
    "menu.findTerminal": "Find in Active Terminal",
    "menu.findNext": "Find Next in Terminal",
    "menu.findPrevious": "Find Previous in Terminal",
    "menu.view": "View",
    "menu.commandPalette": "Command Palette",
    "menu.toggleSidebar": "Toggle Sidebar",
    "menu.nextPane": "Next Pane",
    "menu.previousPane": "Previous Pane",
    "menu.lastPane": "Last Active Pane",
    "menu.nextWorkspace": "Next Workspace",
    "menu.previousWorkspace": "Previous Workspace",
    "menu.lastWorkspace": "Last Workspace",
    "menu.tunePerformance": "Tune Performance Now",
    "menu.performanceSettings": "Performance Settings",
    "dialog.chooseBackground": "Choose background image",
    "dialog.chooseWorkspaceFolder": "Choose workspace folder",
    "dialog.images": "Images",
    "dialog.cancel": "Cancel",
    "window.recoverOlderWindows": "Recover Older Windows",
    "window.noOlderWindows": "No older Windows sessions were found.",
    "window.recoverFailed": "The selected window could not be recovered.",
    "panel.browser": "Browser",
    "panel.terminal": "Terminal"
  }
};

const recoveryKeys = ["window.recoverOlderWindows", "window.noOlderWindows", "window.recoverFailed"];
const recoveryMessages = {
  ar: ["استرداد النوافذ القديمة", "لم يتم العثور على جلسات Windows قديمة.", "تعذر استرداد النافذة المحددة."],
  de: ["Ältere Fenster wiederherstellen", "Es wurden keine älteren Windows-Sitzungen gefunden.", "Das ausgewählte Fenster konnte nicht wiederhergestellt werden."],
  es: ["Recuperar ventanas anteriores", "No se encontraron sesiones anteriores de Windows.", "No se pudo recuperar la ventana seleccionada."],
  fr: ["Récupérer les anciennes fenêtres", "Aucune ancienne session Windows n’a été trouvée.", "Impossible de récupérer la fenêtre sélectionnée."],
  ja: ["以前のウィンドウを復元", "以前の Windows セッションが見つかりませんでした。", "選択したウィンドウを復元できませんでした。"],
  ko: ["이전 창 복구", "이전 Windows 세션을 찾을 수 없습니다.", "선택한 창을 복구할 수 없습니다."],
  "zh-Hans": ["恢复旧窗口", "找不到旧的 Windows 会话。", "无法恢复所选窗口。"],
  "zh-Hant": ["復原舊視窗", "找不到舊的 Windows 工作階段。", "無法復原選取的視窗。"]
};
for (const [locale, labels] of Object.entries(recoveryMessages)) {
  messages[locale] = Object.fromEntries(recoveryKeys.map((key, index) => [key, labels[index]]));
}

function currentLocale() {
  const locale = String(process.env.CMUX_WINDOWS_LOCALE || Intl.DateTimeFormat().resolvedOptions().locale || 'en');
  if (/^zh/i.test(locale)) return /Hant|TW|HK|MO/i.test(locale) ? 'zh-Hant' : 'zh-Hans';
  return locale.split('-')[0];
}

function t(key) {
  const locale = currentLocale();
  const english = messages.en[key] || key;
  return messages[locale]?.[key] || catalogMessages[locale]?.[english] || english;
}

function formatMessage(key, values = {}) {
  return t(key).replace(/\{([a-z0-9_]+)\}/gi, (_, name) => values[name] ?? "");
}

module.exports = { formatMessage, t };
