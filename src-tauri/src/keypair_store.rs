use ed25519_dalek::{Signer, SigningKey};
use once_cell::sync::Lazy;
use stellar_strkey::ed25519::{PrivateKey, PublicKey};
use std::sync::Mutex;
use zeroize::{Zeroize, ZeroizeOnDrop};

#[derive(Zeroize, ZeroizeOnDrop)]
struct StoredKey {
    signing_key: [u8; 32],
}

static KEYPAIR_STORE: Lazy<Mutex<Option<StoredKey>>> = Lazy::new(|| Mutex::new(None));

pub fn unlock(secret: &str) -> Result<String, String> {
    let private = PrivateKey::from_string(secret).map_err(|e| e.to_string())?;
    let signing_key = SigningKey::from_bytes(&private.0);

    let public = PublicKey(signing_key.verifying_key().to_bytes());
    let public_str = public.to_string();

    let mut guard = KEYPAIR_STORE.lock().map_err(|_| "lock poisoned".to_string())?;
    *guard = Some(StoredKey {
        signing_key: signing_key.to_bytes(),
    });

    Ok(public_str)
}

pub fn clear() {
    if let Ok(mut guard) = KEYPAIR_STORE.lock() {
        *guard = None;
    }
}

pub fn public_key() -> Option<String> {
    let guard = KEYPAIR_STORE.lock().ok()?;
    let stored = guard.as_ref()?;
    let signing_key = SigningKey::from_bytes(&stored.signing_key);
    let public = PublicKey(signing_key.verifying_key().to_bytes());
    Some(public.to_string())
}

pub fn signature_hint() -> Result<Vec<u8>, String> {
    let guard = KEYPAIR_STORE.lock().map_err(|_| "lock poisoned".to_string())?;
    let stored = guard.as_ref().ok_or("no active session")?;
    let signing_key = SigningKey::from_bytes(&stored.signing_key);
    let pub_bytes = signing_key.verifying_key().to_bytes();
    let mut hint = pub_bytes[28..32].to_vec();
    hint.reverse();
    Ok(hint)
}

pub fn sign_payload(payload: &[u8]) -> Result<Vec<u8>, String> {
    let guard = KEYPAIR_STORE.lock().map_err(|_| "lock poisoned".to_string())?;
    let stored = guard.as_ref().ok_or("no active session")?;
    let signing_key = SigningKey::from_bytes(&stored.signing_key);
    Ok(signing_key.sign(payload).to_bytes().to_vec())
}