# AB Capital Messenger for Windows

A Tauri 2 app. The page is the CRM's login and Messenger page, built from `Main Module/desktop.html`, so screen code lives in one place. It talks to the same Supabase project as the CRM.

## Needs, to build

- Node, already used by the CRM.
- Rust (rustup). Set `RUSTUP_HOME` and `CARGO_HOME` to a folder on `D:` to keep `C:` free.
- Microsoft C++ Build Tools with the Windows SDK. On this PC they are at `D:\BuildTools`; the Windows SDK stays on `C:`.
- WebView2, which Windows 11 already has.

## Build

From this folder, in order:

```bash
npm.cmd install
```

```bash
npm.cmd run tauri icon "../../Main Module/public/icons/app-512.png"
```

```bash
npm.cmd run tauri build
```

The installer lands in `src-tauri/target/release/bundle/nsis/`. It installs for the current person and does not need an administrator. A first build takes many minutes and a lot of memory, so close dev servers first.

To choose the install folder, pass it last and without quotes: `setup.exe /S /D=D:\Apps\AB Capital Messenger`.

## Rules

- The window can only reach Supabase and R2 (`security.csp` in `tauri.conf.json`). No remote page is ever loaded.
- `src/lib.rs` is the only native surface. Links open only if https. Incoming `abmessenger://` links are checked in `logic/desktop.js`, as any program can send them.
- Message text appears in notifications unless the person turns that off in Settings.
- Closing the window keeps the app in the tray; Quit in the tray menu stops it.

## Before giving it to staff

- **Signing.** Without a paid code-signing certificate, Windows SmartScreen warns on install.
- **Updates.** There is no auto-update yet. It needs a signing key kept outside this public repository and a place to host updates. Until then, staff install each new version by hand.
- **Files.** The R2 CORS rule must also allow `http://tauri.localhost`, the app's own address on Windows.
- **Deployment.** The Supabase project ID is in `tauri.conf.json`. It must change if the project ever does.
