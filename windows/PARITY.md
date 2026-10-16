# Windows parity

This port runs as an Electron desktop application with xterm.js and Windows
ConPTY. It reuses the Windows implementation credited in [UPSTREAM.md](UPSTREAM.md).
It does not execute Apple SwiftUI or the macOS GhosttyKit binary.

## Verified in this checkout

| Surface | Evidence |
| --- | --- |
| Window and pane chrome | Live dimensions match the current Swift constants: 28-point titlebar and pane bars, 240-point default sidebar. Tests read the Swift source so subsequent source changes expose drift. |
| Default appearance | Charcoal sidebar, Monokai terminal, blue workspace selection, compact controls, thin split separators and blue attention treatment compared visually against repository screenshots. |
| Terminal | Real PowerShell and Unicode input/output through ConPTY. Optional WebGL rendering; SIXEL and iTerm inline images verified by reading rendered pixels after real shell output. DOM remains the default. |
| Per-split tabs | Create, switch, close, reorder, move a tab, Shift-drag a group and detach into an edge split. Workspace-row drops move tabs or whole groups between workspaces in one runtime operation. Model and desktop HTML5 drag tests verify membership and restored layout; runtime tests verify process identity and rejected batches. Physical pointer dragging still needs manual validation. |
| Nested splits | Right and down splits, all panes visible at 640×480, 1280×800 and 1920×1080; terminal canvas fills the window. |
| Browser | Local fixture page loaded in a real guest, with sandbox enabled and Node integration disabled. |
| Notifications | Runtime notification reaches workspace summary, attention ring and bell count; notification panel opens. |
| Restoration | Full process restart retains workspace, four terminal processes represented by three visible splits, tab membership and nested split tree. Shell processes are recreated on full desktop exit. |
| Display scaling | Desktop integration passes at 100% and 150%. |
| Accessibility | Named tabs and tab panels verified in Chromium's native accessibility tree; Home/End navigation, palette selection, trapped dialog focus, background isolation and live OS screen-reader support verified in the desktop. |
| Workspace files | Keyboard directory navigation, UTF-8 previews and explicit file editing through trusted desktop IPC. Ctrl+S saves with revision checks, BOM/CRLF preservation, draft recovery and discard/reload. Tests reject traversal, outside-workspace junctions, binary content and files over 1 MB. |
| File creation and rename | Toolbar/dialog actions create files and folders, then select/open the result. Renames preserve contents, handle case-only names and refuse existing destinations. Mutations share a serialized backend and canonical parent boundary; invalid Windows names are rejected. Drafts and open Markdown paths follow file/folder renames and survive reload. |
| Duplicate and removal | Files and folders duplicate beside the original using localized copy names and collision numbering. Toolbar and keyboard-accessible context menus share the same actions. Local removal uses the Windows Recycle Bin, with no permanent-delete fallback. Tests cover copied contents, dotfiles, folders, failure preservation, concurrent copies and junction target isolation, including actual desktop recycling. |
| Right sidebar layout | Files and Find reserve pane space with the native 295px default/minimum, 1200px maximum and 360px content allowance. Pointer resizing persists across reloads; shrinking the window constrains the dock without losing the preferred width. Geometry tests cover three window sizes and left-sidebar collapse. |
| Find in Directory | Ctrl+Shift+F and the canonical action open a sidebar content search. Ripgrep uses fixed strings, smart case, hidden files and native excluded directories. Results open the shared editor at the matching line/column. Searches cancel on replacement/closure and have process, output and result bounds. Requires `rg` on PATH; missing-tool copy is translated. |
| File editor actions | Save and Word Wrap use the shared shortcut registry, including live rebinding/unbinding. Word wrap is persisted and reflows open editors. Desktop tests cover default/rebound keys and the canonical menu save action. |
| Markdown panes | File-browser action opens a restored document pane with Preview/Text modes, live disk updates, shared editing, syntax highlighting, tables, local images, Mermaid diagrams, contextual zoom and find across formatted text. Shared upstream parser and sanitizer assets are shipped locally. |
| Git diff panes | Canonical action opens a read-only viewer for staged, working, renamed and untracked changes. File search, file/hunk navigation, scrolling and persistent viewed marks work through contextual shortcuts. Git runs without shell interpolation, external diff drivers or text conversion; literal filenames and binary/large-file limits are tested. |
| Diff display preferences | Unified and split layouts retain real old/new line numbers, unequal replacement blocks and missing-newline markers. Word wrap, word-level highlights, line numbers, change backgrounds, bars/classic/no indicators and expanded unchanged context update live across panes and survive reload. Context reads stay bounded, preserve viewed-file identity and reject concurrent changes; oversized full context shows a visible compact-context notice. A shared JSON preference file uses the native schema and `CMUX_DIFF_VIEWER_PREFS_PATH` override; writes merge serially and replace atomically. |
| Settings search | Rapid native text insertion and Escape-to-clear retain the controlled query without resetting typed text. |
| New UI translations | Rendering-engine and file-browser copy supplied in all nine supported locales; tests check locale selection and missing strings. |
| Distribution | `test:packaged` launches the built executable and checks ConPTY, commands, WebGL, inline image pixels, file IPC, keyboard splits, Markdown/local images/Mermaid, real Git diffs, directory search, file creation/rename/duplicate, Recycle Bin and normal close. Unsigned NSIS installer builds successfully. |

Screenshots are generated by the tests under `test-output/`. They are local
verification artifacts, not pixel-identical macOS golden images.

## Validation commands

Run from `windows/` after `npm ci` and `npm run build:renderer`:

```powershell
npm test
npm run test:shortcuts
npm run test:parity
npm run test:parity -- --force-device-scale-factor=1.5
npm run test:documents
npm run test:documents -- --force-device-scale-factor=1.5
npm run test:search
npm run test:search -- --force-device-scale-factor=1.5
npm run test:files
npm run test:files -- --force-device-scale-factor=1.5
npm run test:sidebar
npm run test:sidebar -- --force-device-scale-factor=1.5
npm run smoke
npm run test:desktop
npm audit
npm run dist:win -- --config.directories.output=release-parity
$env:CMUX_TEST_BINARY = "$PWD/release-parity/win-unpacked/cmux.exe"
npm run test:packaged
```

The original tab-drag regression was committed failing in `8675e3060d`;
cross-workspace drops were committed failing in `1165162f6e`. The same
`npm run test:parity` command passes with both implementations. Unit/model tests
cover 33 behaviors. File-editing regression `3cf324a876` fails with
`node --test tests/workspace-files.test.cjs`; the same command passes with the
editor implementation. Desktop tests use isolated profiles and private pipes.
Markdown regression `8918250cad` and Git-viewer regression `e38392c05f`
fail with `npm run test:documents`; the same command passes with the document
implementations, including renderer reload and persisted viewed marks.
Directory-search regression `60b0fb2206` and editor-action regression
`3faa0ef3c4` fail with `npm run test:search`; the same command passes with
search, line navigation, shared editing and configurable Save/Word Wrap.
File-mutation regression `1d4c5f814b` fails with `npm run test:files`;
the same command passes with creation, rename, collision preservation,
draft migration and open-document folder rename/restoration.
Right-sidebar regression `3c23583302` fails with `npm run test:sidebar`;
the same command passes with docked Files/Find, pointer resizing, constrained
window geometry and saved width restoration.
Duplicate/removal regression `e905e57e8d` fails with
`node --test tests/file-mutations.test.cjs` and `npm run test:files`;
both commands pass with folder copying, collision numbering and recoverable removal.
Diff-layout regression `c9de99c025` fails with `npm run test:documents`;
the same command passes with split/unified display, line-number geometry, shared
preferences and renderer reload. Parser/store tests cover line identity, unequal
changes, missing newlines, file persistence and invalid preferences.
Diff-detail regression `ad56597ab1` fails with `node --test tests/workspace-git.test.cjs`
and `npm run test:documents`; both pass with word highlights, indicator modes and
expanded context. Model checks cover Unicode, bounded word comparisons, output
limits and changes during expanded reads.
They do not replace or stop an already running user build.

## Remaining gaps

- **Paired visual verification:** a matching macOS build with identical content,
  theme, font and scale is still needed. Zero visual regressions has **not** been
  established. Segoe UI/Cascadia and Windows rasterization differ from macOS.
- **Terminal parity:** xterm WebGL is available, but Ghostty's rendering, Kitty
  graphics, ligatures/shaping, selection, copy mode and native IME composition
  need further implementation or verification. Unicode insertion and two image
  protocols passing do not establish full text-input or graphics parity.
- **Bonsplit behavior:** per-split tab dragging works within a workspace and
  between workspaces through sidebar row drops. Cross-window tab dragging and the full Bonsplit interaction model
  remain. The optional global tab bar is a separate inherited surface.
- **Settings and sidebar:** the upstream Windows settings UI remains; the macOS
  settings window is not recreated 1:1. The file editor supports existing UTF-8
  files up to 1 MB. File moves, multiple selection, complete explorer menus and the other
  macOS right-sidebar tools remain. Paired macOS visual comparison of the dock
  remains. Markdown math/Vega and exhaustive rendering parity remain. Git diff
  branch/patch/last-turn sources, review comments, syntax highlighting, generated-file
  handling and the complete macOS diff presentation remain. The audited
  native diff viewer exposes staged/unstaged viewing; no index-mutating stage or
  unstage action was found, so the earlier staging gap was an unsupported assumption.
- **Localization:** 200 unambiguous existing messages are reused from nine
  catalogs/locales, and this batch adds translated renderer/file-browser copy.
  Older Windows-specific and dynamically assembled copy still needs translation.
  The repository localization checker does not establish Windows completeness.
- **CLI, config and shortcuts:** full macOS CLI/config/keymap compatibility is
  incomplete. [KEYBINDINGS.md](KEYBINDINGS.md) tracks all 169 actions: 119 have
  Windows handlers; 50 require missing features. Single bindings, chords,
  numbered families, unbinding, live JSONC overrides and boolean context guards
  work. Advanced macOS predicates and Ghostty copy mode remain.
- **Remote and lifecycle:** remote/Cloud workspaces and automatic Windows
  updating remain unimplemented.
- **Accessibility and automation:** manual NVDA/Narrator, Windows IME and
  exhaustive browser automation coverage remain. Automated accessibility-tree
  and focus checks do not substitute for screen-reader user testing.
- **Code review:** React Doctor's controlled-search-state warning and two
  repeated-lookup warnings were fixed. Five performance warnings remain reviewed:
  one async freshness check, three intentionally ordered mutation loops and one
  substring-search diagnostic where Set membership would change semantics.
  Maintainability analysis did not complete, so this is not a clean whole-repo
  review.

Code signing is **skipped at the user's request**. The installer is unsigned.
Both the full and production npm dependency audits report zero vulnerabilities
in this checkout; the download-toolchain proxy override is pinned in the lockfile.

The macOS/Xcode implementation is unchanged. Windows behavior has its own tests;
passing these checks does not establish macOS app test coverage.

The repository-wide verifier selects every check for the new Windows directory.
Its Unix executable/shebang assumptions prevent the test-wiring-sync tests from
running on Windows, and several unittest receipts fail to recognize Windows
output even when the underlying tests report success. These are not passing
full-preflight results. Portable catalog, policy and schema checks are run
separately with UTF-8 enabled; native macOS build/test coverage remains unrun.
