//! Notes PRE via [stellar_recrypt](https://github.com/celestialkylin/StellarRecrypt).
//!
//! - Encrypt / decrypt with session `S…` → HKDF `pre_sk` / `pre_pk` (Alice)
//! - Migration: `rekey_gen(admin_S, candidate_G)` then reencrypt + re-wrap under new admin

use crate::keypair_store;
use rand_core::OsRng;
use stellar_recrypt::{
    decrypt, decrypt_reencrypted, encrypt, reencrypt, rekey_gen, Ciphertext, ReencryptionKey,
    StellarPublicKey,
};

const NOTE_BLOB_VERSION: u8 = 1;
const MIGRATION_VERSION: u8 = 1;
const REENCRYPTION_KEY_LEN: usize = 128;

fn map_err(e: impl ToString) -> String {
    e.to_string()
}

fn pack_note_blob(ct: &Ciphertext) -> Vec<u8> {
    let body = ct.to_bytes();
    let mut out = Vec::with_capacity(1 + body.len());
    out.push(NOTE_BLOB_VERSION);
    out.extend_from_slice(&body);
    out
}

fn unpack_note_blob(blob: &[u8]) -> Result<Ciphertext, String> {
    if blob.is_empty() {
        return Err("note blob empty".to_string());
    }
    if blob[0] != NOTE_BLOB_VERSION {
        return Err(format!(
            "unsupported note blob version: {} (expected {})",
            blob[0], NOTE_BLOB_VERSION
        ));
    }
    Ciphertext::from_bytes(&blob[1..]).map_err(map_err)
}

fn pack_migration_data(rk: &ReencryptionKey) -> Vec<u8> {
    let mut out = Vec::with_capacity(1 + REENCRYPTION_KEY_LEN);
    out.push(MIGRATION_VERSION);
    out.extend_from_slice(&rk.to_bytes());
    out
}

fn unpack_migration_data(bytes: &[u8]) -> Result<ReencryptionKey, String> {
    if bytes.is_empty() {
        return Err("migration data empty".to_string());
    }
    if bytes[0] != MIGRATION_VERSION {
        return Err(format!(
            "unsupported migration data version: {} (expected {})",
            bytes[0], MIGRATION_VERSION
        ));
    }
    if bytes.len() != 1 + REENCRYPTION_KEY_LEN {
        return Err(format!(
            "invalid migration data length: {} (expected {})",
            bytes.len(),
            1 + REENCRYPTION_KEY_LEN
        ));
    }
    ReencryptionKey::from_bytes(&bytes[1..]).map_err(map_err)
}

/// Encrypt plaintext to the session admin's `pre_pk`.
pub fn encrypt_note(plaintext: &[u8]) -> Result<Vec<u8>, String> {
    keypair_store::with_stellar_secret(|sk| {
        let ct = encrypt(&mut OsRng, &sk.pre_public_key(), plaintext).map_err(map_err)?;
        Ok(pack_note_blob(&ct))
    })
}

/// Decrypt an original (Alice-form) note blob with the session secret.
pub fn decrypt_note(blob: &[u8]) -> Result<Vec<u8>, String> {
    let ct = unpack_note_blob(blob)?;
    keypair_store::with_stellar_secret(|sk| decrypt(sk, &ct).map_err(map_err))
}

/// Build on-chain migration_data: versioned re-encryption key admin → candidate `G…`.
pub fn generate_migration_data(candidate_address: &str) -> Result<Vec<u8>, String> {
    let bob = StellarPublicKey::from_strkey(candidate_address.trim()).map_err(map_err)?;
    keypair_store::with_stellar_secret(|alice_sk| {
        let rk = rekey_gen(&mut OsRng, alice_sk, &bob).map_err(map_err)?;
        Ok(pack_migration_data(&rk))
    })
}

/// Re-encrypt note under migration rk, decrypt as new admin (Bob), re-wrap under new admin pre_pk.
pub fn migrate_note_blob(blob: &[u8], migration_data: &[u8]) -> Result<Vec<u8>, String> {
    let ct = unpack_note_blob(blob)?;
    let rk = unpack_migration_data(migration_data)?;
    let reenc = reencrypt(&rk, &ct).map_err(map_err)?;

    keypair_store::with_stellar_secret(|bob_sk| {
        let plaintext = decrypt_reencrypted(bob_sk, &reenc).map_err(map_err)?;
        let new_ct = encrypt(&mut OsRng, &bob_sk.pre_public_key(), &plaintext).map_err(map_err)?;
        Ok(pack_note_blob(&new_ct))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use once_cell::sync::Lazy;
    use std::sync::Mutex;
    use stellar_recrypt::StellarKeyPair;
    use stellar_strkey::ed25519::PrivateKey as StellarPrivate;

    /// Global keypair store is process-wide; serialize tests that touch it.
    static SESSION_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

    fn with_exclusive_session<T>(f: impl FnOnce() -> T) -> T {
        let _guard = SESSION_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        keypair_store::clear();
        let result = f();
        keypair_store::clear();
        result
    }

    fn unlock_keypair(kp: &StellarKeyPair) {
        let s = kp.secret.to_strkey();
        let _ = StellarPrivate::from_string(&s).expect("valid S");
        keypair_store::unlock(&s).expect("unlock");
    }

    #[test]
    fn encrypt_decrypt_roundtrip() {
        with_exclusive_session(|| {
            let admin = StellarKeyPair::generate(&mut OsRng);
            unlock_keypair(&admin);
            let plaintext = b"Hello inheritable notes";
            let blob = encrypt_note(plaintext).expect("encrypt");
            let decrypted = decrypt_note(&blob).expect("decrypt");
            assert_eq!(decrypted, plaintext);
        });
    }

    #[test]
    fn pre_migration_roundtrip() {
        with_exclusive_session(|| {
            let admin = StellarKeyPair::generate(&mut OsRng);
            let candidate = StellarKeyPair::generate(&mut OsRng);
            let plaintext = b"Secret note body";

            unlock_keypair(&admin);
            let blob = encrypt_note(plaintext).expect("encrypt");
            let migration =
                generate_migration_data(&candidate.stellar_public.to_strkey()).expect("migration");

            unlock_keypair(&candidate);
            let migrated = migrate_note_blob(&blob, &migration).expect("migrate");
            let decrypted = decrypt_note(&migrated).expect("decrypt as new admin");
            assert_eq!(decrypted, plaintext);
        });
    }

    #[test]
    fn wrong_session_fails_decrypt() {
        with_exclusive_session(|| {
            let admin = StellarKeyPair::generate(&mut OsRng);
            let eve = StellarKeyPair::generate(&mut OsRng);
            unlock_keypair(&admin);
            let blob = encrypt_note(b"secret").expect("encrypt");
            unlock_keypair(&eve);
            assert!(decrypt_note(&blob).is_err());
        });
    }

    #[test]
    fn rejects_unsupported_note_version() {
        with_exclusive_session(|| {
            let admin = StellarKeyPair::generate(&mut OsRng);
            unlock_keypair(&admin);
            let mut blob = encrypt_note(b"x").expect("encrypt");
            blob[0] = 2;
            assert!(decrypt_note(&blob).is_err());
        });
    }

    #[test]
    fn migration_data_layout() {
        with_exclusive_session(|| {
            let admin = StellarKeyPair::generate(&mut OsRng);
            let candidate = StellarKeyPair::generate(&mut OsRng);
            unlock_keypair(&admin);
            let migration =
                generate_migration_data(&candidate.stellar_public.to_strkey()).expect("migration");
            assert_eq!(migration.len(), 1 + REENCRYPTION_KEY_LEN);
            assert_eq!(migration[0], MIGRATION_VERSION);
            let seed = admin.secret.as_seed_bytes();
            assert!(!migration.windows(32).any(|w| w == seed.as_slice()));
        });
    }

    #[test]
    fn encrypt_requires_session() {
        with_exclusive_session(|| {
            assert!(encrypt_note(b"no session").is_err());
        });
    }
}
