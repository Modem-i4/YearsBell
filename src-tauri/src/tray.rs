use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Manager, Runtime, WebviewWindow, WindowEvent,
};

const MAIN_WINDOW_LABEL: &str = "main";
const SHOW_MENU_ID: &str = "show-main-window";
const QUIT_MENU_ID: &str = "quit-app";

pub fn setup_tray(app: &mut App) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, SHOW_MENU_ID, "Відкрити", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, QUIT_MENU_ID, "Вийти", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    let icon = app.default_window_icon().cloned();
    let mut tray = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Years Bell")
        .on_menu_event(|app, event| match event.id().as_ref() {
            SHOW_MENU_ID => show_main_window(app),
            QUIT_MENU_ID => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = icon {
        tray = tray.icon(icon);
    }

    tray.build(app)?;

    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        hide_on_close(window);
    }

    Ok(())
}

fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn hide_on_close<R: Runtime>(window: WebviewWindow<R>) {
    let window_for_close = window.clone();
    window.on_window_event(move |window_event| {
        if let WindowEvent::CloseRequested { api, .. } = window_event {
            api.prevent_close();
            let _ = window_for_close.hide();
        }
    });
}
