# cmux for Windows

Windows desktop port with ConPTY terminals, per-split terminal tabs, nested splits,
browser panes, workspaces, notifications, and session restoration. The default
chrome follows the macOS source metrics and repository screenshots. See
[PARITY.md](PARITY.md) for verified behavior and remaining differences, and
[UPSTREAM.md](UPSTREAM.md) for the implementation's provenance.

Keyboard shortcuts are listed in [KEYBINDINGS.md](KEYBINDINGS.md). Use Settings >
Actions > Keyboard Shortcuts to edit bindings, or change
`~/.config/cmux/cmux.json`; changes apply live. The complete registry is visible,
with actions for features absent from the Windows port marked unavailable.

## Run

```powershell
cd windows
npm ci
npm start
```

`npm start` builds the Vite/React settings renderer before launching Electron. Use
`npm run build:renderer` when you only need to refresh the renderer bundle.

## Build the Windows installer

```powershell
cd windows
npm ci
npm run dist:win
```

The installer is written to `windows/release/cmux-0.1.0-setup.exe`.
`npm run pack:win` builds a folder distribution at `release/win-unpacked/`;
run `release/win-unpacked/cmux.exe` with the rest of that folder present.
The app, shortcut, executable, and installer are named `cmux`. This is an
unofficial community Windows build; official upstream cmux releases remain
macOS-focused.

## CLI

With the app running, run these commands from a cmux terminal pane so the
panel-scoped authentication environment is already present. For automation
outside a pane, provide the app launch token through `CMUX_WINDOWS_TOKEN`.

```powershell
npm run cli -- ping
npm run cli -- list-workspaces
npm run cli -- reset-session
npm run cli -- new-workspace "API"
npm run cli -- new-terminal
npm run cli -- restart-terminal
npm run cli -- browser-open https://example.com
npm run cli -- notify "Build finished"
npm run cli -- send "echo hello from cmux"
```

The runtime listens on `\\.\pipe\cmux-windows` on Windows and falls back to a temp Unix socket on other platforms.

## Scope

Implemented in this milestone:

- Workspace file tools create, rename and duplicate files/folders, and move entries to the Windows Recycle Bin. Toolbar and accessible context-menu actions share the same serialized backend.
- Windows desktop shell with workspace sidebar, surface tabs, split panes, and command palette for commands, workspaces, panes, and Settings categories.
- Terminal panes backed by Windows ConPTY, using node-pty's bundled ConPTY DLL. Settings > Terminal offers an optional WebGL renderer; SIXEL and iTerm inline images are supported.
- Browser panes through Electron `webview`, with iframe fallback outside Electron.
- Named-pipe CLI/control protocol.
- Native Windows window controls, draggable split dividers, terminal font-size controls, restart, and close-to-empty workspace home state.
- Settings panel split into Quick, Workspace, Look, Browser, Layout, Terminal, and Data pages, with tokenized cross-page search, one-click setup presets, expanded themes/accent palettes, custom accent/workspace colors, workspace names/colors, terminal background/text/cursor colors, built-in/URL/local-file backgrounds, browser home page, import/export/reset, density, compact/standard/expanded toolbar modes, sidebar width, tabs/status bar visibility, performance mode, terminal font family, text size, line height, padding, cursor style/blink, default shell profile, and terminal scrollback.
- Compact Tools menu for workspace/session actions so the default top bar stays simple.
- Terminal tabs within each split, with keyboard navigation, drag reordering, moving tabs between splits, Shift-dragging whole groups and edge drops to create splits. Hidden processes survive tab switches. Tab groups and nested split layout survive a desktop restart.
- Workspace file browser with keyboard navigation, UTF-8 previews and explicit editing, restricted to files within the workspace. Ctrl+S saves existing files up to 1 MB, detects external changes, and preserves BOM/CRLF. Unsaved drafts are recovered when reopening a file; Discard changes reloads the disk version.
- New file, New folder and Rename actions preserve existing destinations. File/folder renames move drafts and retarget open Markdown panes, including case-only renames. Windows-invalid names and mutations through outside-workspace junctions are rejected.
- Find in Directory (Ctrl+Shift+F) searches workspace content with literal smart-case queries, ignore rules and cancellable ripgrep processes. Results open at the matching line in the shared editor. Requires `rg` on PATH. Save and Word Wrap (Alt+Z) support live shortcut overrides; wrapping persists across editor openings.
- Markdown panes with live Preview/Text modes, shared editing, tables, syntax highlighting, Mermaid, scoped local images, find and zoom. Open them from the file browser.
- Read-only Git diff panes with staged/working changes, file and hunk navigation, search and persistent viewed marks. Open Git diff from the command palette or keyboard shortcut settings.
- Named accessible tabs, focus containment for dialogs and the palette, and terminal screen-reader support that follows the OS accessibility setting.
- Browser panes with address/search normalization, back/forward/reload/home controls, open-external fallback, and configurable home page.
- Workspace right-click menus for focus, rename, color, new terminal/browser, new workspace, and close actions.
- Pane drag/drop docking hints for left, right, top, and bottom terminal placement, active-pane focus mode, percent-based active-pane resizing from Settings/Tools, and optimistic workspace/tab updates so moves, closes, and focus changes feel immediate.
- Large terminal output is flushed incrementally across animation frames so heavy command output does not monopolize the renderer.
- Terminal appearance updates from Settings are coalesced per animation frame so dragging font and layout sliders does not repeatedly refresh every terminal.
- Renderer settings/theme/profile data is split into `renderer/config.js`, with the app loaded as an ES module so the frontend can keep moving away from one monolithic file.
- Settings search and page navigation are rendered through a small Vite/React bundle under `renderer/react`, with the existing vanilla controls kept as a fallback.
- Notification drawer, session tools, active focus rings, workspace colors, and pane attention indicators.
- Session layout persistence under `%APPDATA%\cmux-windows\session.json`.

Not complete yet:

- Full Ghostty renderer parity.
- WebView2-native browser automation.
- Automatic Windows updater.
- Complete macOS shortcut/config parity.
- Full visual and localization parity; see [PARITY.md](PARITY.md).

## Verify

Requires Windows x64 and Node.js 24 (the version used for validation).
Git and directory-search tests also require `git` and `rg` on PATH.

```powershell
npm ci
npm run build:renderer
npm test
npm run test:shortcuts
npm run test:parity
npm run test:documents
npm run test:search
npm run test:files
npm run test:sidebar
npm run smoke
npm run test:desktop
npm run pack:win
npm run test:packaged
```

The desktop test uses disposable profiles and a private pipe. It drives the real
renderer, native terminal and browser, captures screenshots under `test-output/`,
then starts a second desktop process to verify restoration. Run it at 150% scale:

```powershell
$env:CMUX_TEST_DEVICE_SCALE = '1.5'
npm run test:desktop
Remove-Item Env:CMUX_TEST_DEVICE_SCALE
```

`npm run build:locales` exports matching translations from the existing Apple app
catalogs. Windows-specific copy that has no shared translation still uses English.
The catalog export deliberately excludes ambiguous English matches. New renderer
and file-browser copy has its own nine-locale catalog.
