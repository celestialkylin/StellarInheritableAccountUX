use crate::keypair_store;
use crate::notes_crypto;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

#[tauri::command]
pub fn unlock_keypair(secret: String) -> Result<String, String> {
    keypair_store::unlock(secret.trim())
}

#[tauri::command]
pub fn clear_session() {
    keypair_store::clear();
}

#[tauri::command]
pub fn get_public_key() -> Option<String> {
    keypair_store::public_key()
}

#[tauri::command]
pub fn get_signature_hint() -> Result<String, String> {
    let hint = keypair_store::signature_hint()?;
    Ok(STANDARD.encode(hint))
}

#[tauri::command]
pub fn sign_payload(payload_base64: String) -> Result<String, String> {
    let payload = STANDARD
        .decode(payload_base64.trim())
        .map_err(|e| e.to_string())?;
    let signature = keypair_store::sign_payload(&payload)?;
    Ok(STANDARD.encode(signature))
}

fn project_root() -> Result<PathBuf, String> {
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    if cwd.ends_with("src-tauri") {
        cwd.parent()
            .map(|p| p.to_path_buf())
            .ok_or_else(|| "project root not found (parent of src-tauri)".to_string())
    } else {
        Ok(cwd)
    }
}

fn resolve_under_project_root(relative: &str) -> Result<PathBuf, String> {
    use std::path::Component;

    let relative = relative.trim();
    if relative.is_empty() {
        return Err("path is empty".to_string());
    }

    let rel = PathBuf::from(relative);
    if rel.is_absolute() {
        return Err(format!("absolute paths are not allowed: {relative}"));
    }

    for component in rel.components() {
        if matches!(component, Component::ParentDir) {
            return Err(format!("path escapes project root: {relative}"));
        }
    }

    Ok(project_root()?.join(rel))
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

/// Read a file relative to the project root (parent of src-tauri), regardless of process CWD.
#[tauri::command]
pub fn read_project_file(relative_path: String) -> Result<String, String> {
    let path = resolve_under_project_root(relative_path.trim())?;
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ensure_directory(path: String) -> Result<String, String> {
    let path = PathBuf::from(path);
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path
        .canonicalize()
        .unwrap_or(path)
        .to_string_lossy()
        .into_owned())
}

#[tauri::command]
pub fn get_app_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    app_data_dir(&app).map(|p| p.to_string_lossy().into_owned())
}

/// Default save path for exporting sc.enc ciphertext.
/// Desktop: working directory + sc.txt; mobile: Downloads + sc.txt.
#[tauri::command]
pub fn get_sc_export_default_path(app: tauri::AppHandle) -> Result<String, String> {
    let dir = if cfg!(mobile) {
        app.path()
            .download_dir()
            .map_err(|e| e.to_string())?
    } else {
        let _ = &app;
        std::env::current_dir().map_err(|e| e.to_string())?
    };
    Ok(dir.join("sc.txt").to_string_lossy().into_owned())
}

fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_app_data_file(app: tauri::AppHandle, filename: String) -> Result<String, String> {
    let path = app_data_dir(&app)?.join(&filename);
    if !path.exists() {
        return Err(format!("file not found: {}", filename));
    }
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_app_data_file(
    app: tauri::AppHandle,
    filename: String,
    content: String,
) -> Result<(), String> {
    let dir = app_data_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(filename);
    fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn app_data_file_exists(app: tauri::AppHandle, filename: String) -> bool {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(filename).exists())
        .unwrap_or(false)
}

#[tauri::command]
pub async fn http_fetch(
    url: String,
    method: String,
    headers: Option<std::collections::HashMap<String, String>>,
    body: Option<String>,
    proxy: Option<String>,
) -> Result<HttpFetchResponse, String> {
    let mut builder = match method.to_uppercase().as_str() {
        "GET" => reqwest::Client::builder(),
        "POST" => reqwest::Client::builder(),
        "PUT" => reqwest::Client::builder(),
        _ => return Err(format!("unsupported method: {method}")),
    };

    if let Some(proxy_url) = proxy.filter(|p| !p.trim().is_empty()) {
        builder = builder.proxy(
            reqwest::Proxy::all(proxy_url.trim()).map_err(|e| e.to_string())?,
        );
    }

    let client = builder.build().map_err(|e| e.to_string())?;
    let mut req = match method.to_uppercase().as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        _ => unreachable!(),
    };

    if let Some(hdrs) = headers {
        for (k, v) in hdrs {
            req = req.header(k, v);
        }
    }
    if let Some(b) = body {
        req = req.body(b);
    }

    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let resp_headers: std::collections::HashMap<String, String> = resp
        .headers()
        .iter()
        .filter_map(|(k, v)| v.to_str().ok().map(|s| (k.to_string(), s.to_string())))
        .collect();
    let text = resp.text().await.map_err(|e| e.to_string())?;

    Ok(HttpFetchResponse {
        status,
        headers: resp_headers,
        body: text,
    })
}

#[tauri::command]
pub fn encrypt_note(plaintext_base64: String) -> Result<String, String> {
    let plaintext = STANDARD
        .decode(plaintext_base64.trim())
        .map_err(|e| e.to_string())?;
    let blob = notes_crypto::encrypt_note(&plaintext)?;
    Ok(STANDARD.encode(blob))
}

#[tauri::command]
pub fn decrypt_note(blob_base64: String) -> Result<String, String> {
    let blob = STANDARD
        .decode(blob_base64.trim())
        .map_err(|e| e.to_string())?;
    let plaintext = notes_crypto::decrypt_note(&blob)?;
    Ok(STANDARD.encode(plaintext))
}

#[tauri::command]
pub fn generate_note_migration_data(candidate_address: String) -> Result<String, String> {
    let migration = notes_crypto::generate_migration_data(candidate_address.trim())?;
    Ok(STANDARD.encode(migration))
}

#[tauri::command]
pub fn migrate_note_blob(blob_base64: String, migration_data_base64: String) -> Result<String, String> {
    let blob = STANDARD.decode(blob_base64.trim()).map_err(|e| e.to_string())?;
    let migration = STANDARD
        .decode(migration_data_base64.trim())
        .map_err(|e| e.to_string())?;
    let new_blob = notes_crypto::migrate_note_blob(&blob, &migration)?;
    Ok(STANDARD.encode(new_blob))
}

#[derive(serde::Serialize)]
pub struct HttpFetchResponse {
    pub status: u16,
    pub headers: std::collections::HashMap<String, String>,
    pub body: String,
}