// The native side of AB Capital Messenger: the tray, closing to the tray, one running copy, start-up, notifications and links from outside.
// The page reaches Windows only through the commands below, and each one checks what it is given.
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Url, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

const TRAY_ID: &str = "main";
const START_HIDDEN: &str = "--minimized";
const MAX_TITLE: usize = 120;
const MAX_BODY: usize = 240;

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

// An incoming call must be seen even when the app sits in the tray.
#[tauri::command]
fn show_window(app: AppHandle) {
    show_main(&app);
}

#[tauri::command]
fn set_unread(app: AppHandle, count: u32) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let text = if count == 0 {
            "AB Capital Messenger".to_string()
        } else {
            format!("AB Capital Messenger: {count} unread")
        };
        let _ = tray.set_tooltip(Some(text));
    }
}

#[tauri::command]
fn notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    let title: String = title.chars().take(MAX_TITLE).collect();
    let body: String = body.chars().take(MAX_BODY).collect();
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|_| "Could not show the notification.".to_string())
}

// Only https, so a message can never start a local program or open a local file.
#[tauri::command]
fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|_| "This link cannot be opened.".to_string())?;
    if parsed.scheme() != "https" {
        return Err("Only https links can be opened.".to_string());
    }
    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|_| "This link cannot be opened.".to_string())
}

#[tauri::command]
fn autostart_get(app: AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|_| "Could not read the start-up setting.".to_string())
}

#[tauri::command]
fn autostart_set(app: AppHandle, on: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    let result = if on { manager.enable() } else { manager.disable() };
    result.map_err(|_| "Could not change the start-up setting.".to_string())
}

#[tauri::command]
fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

// The link that started the app, if any. The page checks it before acting on it.
#[tauri::command]
fn start_links(app: AppHandle) -> Vec<String> {
    app.deep_link()
        .get_current()
        .ok()
        .flatten()
        .unwrap_or_default()
        .iter()
        .map(|url| url.to_string())
        .collect()
}

pub fn run() {
    tauri::Builder::default()
        // Must come first: a second launch passes its link to this one and closes.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![START_HIDDEN])))
        .invoke_handler(tauri::generate_handler![show_window, set_unread, notify, open_url, autostart_get, autostart_set, app_version, start_links])
        .setup(|app| {
            let open = MenuItem::with_id(app, "open", "Open Messenger", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            TrayIconBuilder::with_id(TRAY_ID)
                .icon(app.default_window_icon().cloned().ok_or("The app has no icon")?)
                .tooltip("AB Capital Messenger")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;

            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                show_main(&handle);
                for url in event.urls() {
                    let _ = handle.emit("app-link", url.to_string());
                }
            });
            // An installed copy registers the link type through its installer.
            #[cfg(debug_assertions)]
            app.deep_link().register_all()?;

            if !std::env::args().any(|arg| arg == START_HIDDEN) {
                show_main(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("AB Capital Messenger could not start");
}
