mod commands;
mod keypair_store;
mod rekrypt_ops;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::unlock_keypair,
            commands::clear_session,
            commands::get_public_key,
            commands::get_signature_hint,
            commands::sign_payload,
            commands::read_text_file,
            commands::read_project_file,
            commands::write_text_file,
            commands::ensure_directory,
            commands::get_app_data_dir,
            commands::get_sc_export_default_path,
            commands::read_app_data_file,
            commands::write_app_data_file,
            commands::app_data_file_exists,
            commands::http_fetch,
            commands::rekrypt_encrypt_note,
            commands::rekrypt_decrypt_note,
            commands::rekrypt_generate_migration_data,
            commands::rekrypt_migrate_note_blob,
            commands::rekrypt_public_key_from_address,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}