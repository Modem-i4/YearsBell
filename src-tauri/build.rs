fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "load_state",
            "save_state",
            "import_audio_files",
            "rename_audio_file",
            "delete_audio_file",
        ]),
    ))
    .expect("failed to run tauri build script");
}
