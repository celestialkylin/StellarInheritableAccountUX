//! Rekrypt PRE operations for InheritableAccount notes (AGPL-3.0 via recrypt/rekrypt).
//! Uses deterministic key derivation from Stellar Ed25519 public key bytes so admin can
//! compute a candidate's rekrypt public key from their on-chain address.

use hkdf::Hkdf;
use recrypt::api::{
    CryptoOps, DefaultRng, Ed25519, EncryptedValue, KeyGenOps, PrivateKey,
    PublicKey, RandomBytes, Recrypt, Sha256, SigningKeypair,
};
use serde::{Deserialize, Serialize};
use sha2::Sha256 as Sha256Hash;
use stellar_strkey::ed25519::PublicKey as StellarPublicKey;
use zeroize::Zeroize;

const REKRYPT_INFO: &[u8] = b"inheritable-rekrypt-v1";
const SIGNING_INFO: &[u8] = b"inheritable-rekrypt-signing-v1";
const NOTE_BLOB_VERSION: u8 = 2;
const MIGRATION_VERSION: u8 = 2;

#[derive(Serialize, Deserialize, Clone)]
struct Capsule {
    version: u8,
    nonce: Vec<u8>,
    signing_key_pair: Vec<u8>,
    encrypted_data: Vec<u8>,
    data_hash: Vec<u8>,
    #[serde(with = "u64_as_string")]
    sequence: u64,
    request_id: String,
    #[serde(with = "u64_as_string")]
    client_timestamp: u64,
}

mod u64_as_string {
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S>(value: &u64, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&value.to_string())
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<u64, D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        s.parse().map_err(serde::de::Error::custom)
    }
}

#[derive(Serialize, Deserialize, Clone)]
struct SerializableEncryptedValue {
    variant: u8,
    ephemeral_public_key_x: Vec<u8>,
    ephemeral_public_key_y: Vec<u8>,
    encrypted_message: Vec<u8>,
    auth_hash: Vec<u8>,
    public_signing_key: Vec<u8>,
    signature: Vec<u8>,
    transform_blocks: Option<Vec<u8>>,
}

#[derive(Serialize, Deserialize, Clone)]
struct SerializableTransformKey {
    ephemeral_public_key_x: Vec<u8>,
    ephemeral_public_key_y: Vec<u8>,
    to_public_key_x: Vec<u8>,
    to_public_key_y: Vec<u8>,
    encrypted_temp_key: Vec<u8>,
    hashed_temp_key: Vec<u8>,
    public_signing_key: Vec<u8>,
    signature: Vec<u8>,
}

#[derive(Serialize, Deserialize, Clone)]
struct SerializableTransformBlock {
    public_key_x: Vec<u8>,
    public_key_y: Vec<u8>,
    encrypted_temp_key: Vec<u8>,
    random_transform_public_key_x: Vec<u8>,
    random_transform_public_key_y: Vec<u8>,
    encrypted_random_transform_temp_key: Vec<u8>,
}

fn recrypt_api() -> Recrypt<Sha256, Ed25519, RandomBytes<DefaultRng>> {
    Recrypt::new()
}

fn stellar_address_to_ed25519_pub(address: &str) -> Result<[u8; 32], String> {
    let pk = StellarPublicKey::from_string(address).map_err(|e| e.to_string())?;
    Ok(pk.0)
}

fn derive_hkdf(ikm: &[u8], info: &[u8], len: usize) -> Result<Vec<u8>, String> {
    let hk = Hkdf::<Sha256Hash>::new(None, ikm);
    let mut okm = vec![0u8; len];
    hk.expand(info, &mut okm)
        .map_err(|_| "HKDF expand failed".to_string())?;
    Ok(okm)
}

pub fn derive_rekrypt_private_from_address(address: &str) -> Result<Vec<u8>, String> {
    let pub_bytes = stellar_address_to_ed25519_pub(address)?;
    derive_hkdf(&pub_bytes, REKRYPT_INFO, 32)
}

pub fn derive_rekrypt_public_from_address(address: &str) -> Result<Vec<u8>, String> {
    let api = recrypt_api();
    let mut priv_bytes = derive_rekrypt_private_from_address(address)?;
    let private = PrivateKey::new_from_slice(&priv_bytes).map_err(|e| e.to_string())?;
    priv_bytes.zeroize();
    let public = api.compute_public_key(&private).map_err(|e| e.to_string())?;
    let (x, y) = public.bytes_x_y();
    postcard::to_allocvec(&(x, y)).map_err(|e| e.to_string())
}

pub fn derive_signing_keypair_from_address(address: &str) -> Result<Vec<u8>, String> {
    use ed25519_dalek::SigningKey;

    let pub_bytes = stellar_address_to_ed25519_pub(address)?;
    let mut seed_bytes = derive_hkdf(&pub_bytes, SIGNING_INFO, 32)?;
    let mut seed = [0u8; 32];
    seed.copy_from_slice(&seed_bytes);
    seed_bytes.zeroize();

    let signing_key = SigningKey::from_bytes(&seed);
    seed.zeroize();
    let skp = SigningKeypair::from_byte_slice(&signing_key.to_keypair_bytes())
        .map_err(|e| e.to_string())?;
    Ok(skp.bytes().to_vec())
}

fn parse_public_key(pub_bytes: &[u8]) -> Result<PublicKey, String> {
    let key_tuple: ([u8; 32], [u8; 32]) =
        postcard::from_bytes(pub_bytes).map_err(|e| e.to_string())?;
    PublicKey::new(key_tuple).map_err(|e| e.to_string())
}

fn signing_keypair_from_bytes(bytes: &[u8]) -> Result<SigningKeypair, String> {
    SigningKeypair::from_byte_slice(bytes).map_err(|e| e.to_string())
}

fn aes_encrypt(key: &[u8], iv: &[u8], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    use aes_gcm::aead::{Aead, KeyInit};
    use aes_gcm::{Aes256Gcm, Nonce};

    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let nonce = Nonce::from_slice(iv);
    cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| e.to_string())
}

fn aes_decrypt(key: &[u8], iv: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>, String> {
    use aes_gcm::aead::{Aead, KeyInit};
    use aes_gcm::{Aes256Gcm, Nonce};

    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let nonce = Nonce::from_slice(iv);
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| e.to_string())
}

fn sha256(data: &[u8]) -> Vec<u8> {
    use sha2::Digest;
    let mut hasher = Sha256Hash::new();
    hasher.update(data);
    hasher.finalize().to_vec()
}

fn generate_uuid() -> String {
    use rand::Rng;
    let uuid: [u8; 16] = rand::thread_rng().gen();
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        uuid[0],
        uuid[1],
        uuid[2],
        uuid[3],
        uuid[4],
        uuid[5],
        uuid[6],
        uuid[7],
        uuid[8],
        uuid[9],
        uuid[10],
        uuid[11],
        uuid[12],
        uuid[13],
        uuid[14],
        uuid[15]
    )
}

impl SerializableEncryptedValue {
    fn from_encrypted_value(value: &EncryptedValue) -> Result<Self, String> {
        match value {
            EncryptedValue::EncryptedOnceValue {
                ephemeral_public_key,
                encrypted_message,
                auth_hash,
                public_signing_key,
                signature,
            } => {
                let (x, y) = ephemeral_public_key.bytes_x_y();
                Ok(Self {
                    variant: 0,
                    ephemeral_public_key_x: x.to_vec(),
                    ephemeral_public_key_y: y.to_vec(),
                    encrypted_message: encrypted_message.bytes().to_vec(),
                    auth_hash: auth_hash.bytes().to_vec(),
                    public_signing_key: public_signing_key.bytes().to_vec(),
                    signature: signature.bytes().to_vec(),
                    transform_blocks: None,
                })
            }
            EncryptedValue::TransformedValue {
                ephemeral_public_key,
                encrypted_message,
                auth_hash,
                transform_blocks,
                public_signing_key,
                signature,
            } => {
                let (x, y) = ephemeral_public_key.bytes_x_y();
                let blocks: Vec<SerializableTransformBlock> = std::iter::once(transform_blocks.first())
                    .chain(transform_blocks.rest().iter())
                    .map(|tb| {
                        let (pk_x, pk_y) = tb.public_key().bytes_x_y();
                        let (rt_x, rt_y) = tb.random_transform_public_key().bytes_x_y();
                        SerializableTransformBlock {
                            public_key_x: pk_x.to_vec(),
                            public_key_y: pk_y.to_vec(),
                            encrypted_temp_key: tb.encrypted_temp_key().bytes().to_vec(),
                            random_transform_public_key_x: rt_x.to_vec(),
                            random_transform_public_key_y: rt_y.to_vec(),
                            encrypted_random_transform_temp_key: tb
                                .encrypted_random_transform_temp_key()
                                .bytes()
                                .to_vec(),
                        }
                    })
                    .collect();
                let blocks_bytes = postcard::to_allocvec(&blocks).map_err(|e| e.to_string())?;
                Ok(Self {
                    variant: 1,
                    ephemeral_public_key_x: x.to_vec(),
                    ephemeral_public_key_y: y.to_vec(),
                    encrypted_message: encrypted_message.bytes().to_vec(),
                    auth_hash: auth_hash.bytes().to_vec(),
                    public_signing_key: public_signing_key.bytes().to_vec(),
                    signature: signature.bytes().to_vec(),
                    transform_blocks: Some(blocks_bytes),
                })
            }
        }
    }

    fn to_encrypted_value(&self) -> Result<EncryptedValue, String> {
        use recrypt::api::{
            AuthHash, Ed25519Signature, EncryptedMessage, EncryptedTempKey, PublicSigningKey,
            TransformBlock,
        };
        use recrypt::nonemptyvec::NonEmptyVec;

        let mut x = [0u8; 32];
        let mut y = [0u8; 32];
        x.copy_from_slice(&self.ephemeral_public_key_x);
        y.copy_from_slice(&self.ephemeral_public_key_y);
        let ephemeral_public_key = PublicKey::new((x, y)).map_err(|e| e.to_string())?;

        if self.encrypted_message.len() != 384 {
            return Err("invalid encrypted_message length".to_string());
        }
        let encrypted_message =
            EncryptedMessage::new_from_slice(&self.encrypted_message).map_err(|e| e.to_string())?;

        if self.auth_hash.len() != 32 {
            return Err("invalid auth_hash length".to_string());
        }
        let auth_hash = AuthHash::new_from_slice(&self.auth_hash).map_err(|e| e.to_string())?;

        if self.public_signing_key.len() != 32 {
            return Err("invalid public_signing_key length".to_string());
        }
        let public_signing_key =
            PublicSigningKey::new_from_slice(&self.public_signing_key).map_err(|e| e.to_string())?;

        if self.signature.len() != 64 {
            return Err("invalid signature length".to_string());
        }
        let signature =
            Ed25519Signature::new_from_slice(&self.signature).map_err(|e| e.to_string())?;

        if self.variant == 0 {
            return Ok(EncryptedValue::EncryptedOnceValue {
                ephemeral_public_key,
                encrypted_message,
                auth_hash,
                public_signing_key,
                signature,
            });
        }

        if self.variant != 1 {
            return Err(format!("unsupported encrypted value variant: {}", self.variant));
        }

        let blocks_bytes = self
            .transform_blocks
            .as_ref()
            .ok_or_else(|| "missing transform_blocks".to_string())?;
        let blocks: Vec<SerializableTransformBlock> =
            postcard::from_bytes(blocks_bytes).map_err(|e| e.to_string())?;
        if blocks.is_empty() {
            return Err("empty transform_blocks".to_string());
        }

        let mut transform_blocks_vec = Vec::with_capacity(blocks.len());
        for block in blocks {
            let mut pk_x = [0u8; 32];
            let mut pk_y = [0u8; 32];
            pk_x.copy_from_slice(&block.public_key_x);
            pk_y.copy_from_slice(&block.public_key_y);
            let public_key = PublicKey::new((pk_x, pk_y)).map_err(|e| e.to_string())?;

            if block.encrypted_temp_key.len() != 384 {
                return Err("invalid encrypted_temp_key length".to_string());
            }
            let mut etk = [0u8; 384];
            etk.copy_from_slice(&block.encrypted_temp_key);
            let encrypted_temp_key = EncryptedTempKey::new(etk);

            let mut rt_x = [0u8; 32];
            let mut rt_y = [0u8; 32];
            rt_x.copy_from_slice(&block.random_transform_public_key_x);
            rt_y.copy_from_slice(&block.random_transform_public_key_y);
            let random_transform_public_key =
                PublicKey::new((rt_x, rt_y)).map_err(|e| e.to_string())?;

            if block.encrypted_random_transform_temp_key.len() != 384 {
                return Err("invalid encrypted_random_transform_temp_key length".to_string());
            }
            let mut ertk = [0u8; 384];
            ertk.copy_from_slice(&block.encrypted_random_transform_temp_key);
            let encrypted_random_transform_temp_key = EncryptedTempKey::new(ertk);

            transform_blocks_vec.push(
                TransformBlock::new(
                    &public_key,
                    &encrypted_temp_key,
                    &random_transform_public_key,
                    &encrypted_random_transform_temp_key,
                )
                .map_err(|e| e.to_string())?,
            );
        }

        let first = transform_blocks_vec.remove(0);
        let rest = transform_blocks_vec;
        let transform_blocks = NonEmptyVec::new(first, rest);

        Ok(EncryptedValue::TransformedValue {
            ephemeral_public_key,
            encrypted_message,
            auth_hash,
            transform_blocks,
            public_signing_key,
            signature,
        })
    }
}

impl SerializableTransformKey {
    fn from_transform_key(tk: &recrypt::api::TransformKey) -> Result<Self, String> {
        let (ephem_x, ephem_y) = tk.ephemeral_public_key().bytes_x_y();
        let (to_x, to_y) = tk.to_public_key().bytes_x_y();
        Ok(Self {
            ephemeral_public_key_x: ephem_x.to_vec(),
            ephemeral_public_key_y: ephem_y.to_vec(),
            to_public_key_x: to_x.to_vec(),
            to_public_key_y: to_y.to_vec(),
            encrypted_temp_key: tk.encrypted_temp_key().bytes().to_vec(),
            hashed_temp_key: tk.hashed_temp_key().bytes().to_vec(),
            public_signing_key: tk.public_signing_key().bytes().to_vec(),
            signature: tk.signature().bytes().to_vec(),
        })
    }

    fn to_transform_key(&self) -> Result<recrypt::api::TransformKey, String> {
        use recrypt::api::{
            Ed25519Signature, EncryptedTempKey, HashedValue, PublicSigningKey, TransformKey,
        };

        let mut ephem_x = [0u8; 32];
        let mut ephem_y = [0u8; 32];
        ephem_x.copy_from_slice(&self.ephemeral_public_key_x);
        ephem_y.copy_from_slice(&self.ephemeral_public_key_y);
        let ephemeral_public_key = PublicKey::new((ephem_x, ephem_y)).map_err(|e| e.to_string())?;

        let mut to_x = [0u8; 32];
        let mut to_y = [0u8; 32];
        to_x.copy_from_slice(&self.to_public_key_x);
        to_y.copy_from_slice(&self.to_public_key_y);
        let to_public_key = PublicKey::new((to_x, to_y)).map_err(|e| e.to_string())?;

        if self.encrypted_temp_key.len() != 384 {
            return Err("invalid encrypted_temp_key length".to_string());
        }
        let mut etk = [0u8; 384];
        etk.copy_from_slice(&self.encrypted_temp_key);
        let encrypted_temp_key = EncryptedTempKey::new(etk);

        if self.hashed_temp_key.len() != 128 {
            return Err("invalid hashed_temp_key length".to_string());
        }
        let hashed_temp_key =
            HashedValue::new_from_slice(&self.hashed_temp_key).map_err(|e| e.to_string())?;

        let public_signing_key =
            PublicSigningKey::new_from_slice(&self.public_signing_key).map_err(|e| e.to_string())?;

        let signature =
            Ed25519Signature::new_from_slice(&self.signature).map_err(|e| e.to_string())?;

        Ok(TransformKey::new(
            ephemeral_public_key,
            to_public_key,
            encrypted_temp_key,
            hashed_temp_key,
            public_signing_key,
            signature,
        ))
    }
}

fn pack_note_blob(capsule: &Capsule, c_data: &[u8]) -> Result<Vec<u8>, String> {
    let capsule_bytes = postcard::to_allocvec(capsule).map_err(|e| e.to_string())?;
    if capsule_bytes.len() > u16::MAX as usize {
        return Err("capsule too large".to_string());
    }
    if c_data.len() > u32::MAX as usize {
        return Err("c_data too large".to_string());
    }

    let mut out = Vec::with_capacity(1 + 2 + capsule_bytes.len() + 4 + c_data.len());
    out.push(NOTE_BLOB_VERSION);
    out.extend_from_slice(&(capsule_bytes.len() as u16).to_be_bytes());
    out.extend_from_slice(&capsule_bytes);
    out.extend_from_slice(&(c_data.len() as u32).to_be_bytes());
    out.extend_from_slice(c_data);
    Ok(out)
}

fn unpack_note_blob(blob: &[u8]) -> Result<(Capsule, Vec<u8>), String> {
    if blob.is_empty() || blob[0] != NOTE_BLOB_VERSION {
        return Err("unsupported or invalid note blob version".to_string());
    }
    let mut offset = 1;
    if blob.len() < offset + 2 {
        return Err("note blob too short".to_string());
    }
    let capsule_len = u16::from_be_bytes([blob[offset], blob[offset + 1]]) as usize;
    offset += 2;
    if blob.len() < offset + capsule_len + 4 {
        return Err("note blob truncated (capsule)".to_string());
    }
    let capsule: Capsule = postcard::from_bytes(&blob[offset..offset + capsule_len])
        .map_err(|e| e.to_string())?;
    offset += capsule_len;
    let c_data_len = u32::from_be_bytes([
        blob[offset],
        blob[offset + 1],
        blob[offset + 2],
        blob[offset + 3],
    ]) as usize;
    offset += 4;
    if blob.len() < offset + c_data_len {
        return Err("note blob truncated (c_data)".to_string());
    }
    let c_data = blob[offset..offset + c_data_len].to_vec();
    Ok((capsule, c_data))
}

pub fn encrypt_note_field(
    owner_address: &str,
    recipient_address: &str,
    plaintext: &[u8],
) -> Result<Vec<u8>, String> {
    let api = recrypt_api();
    let mut owner_priv_bytes = derive_rekrypt_private_from_address(owner_address)?;
    let owner_private = PrivateKey::new_from_slice(&owner_priv_bytes).map_err(|e| e.to_string())?;
    owner_priv_bytes.zeroize();

    let recipient_pub_bytes = derive_rekrypt_public_from_address(recipient_address)?;
    let recipient_public = parse_public_key(&recipient_pub_bytes)?;
    let signing_keypair_bytes = derive_signing_keypair_from_address(owner_address)?;
    let signing_keypair = signing_keypair_from_bytes(&signing_keypair_bytes)?;

    let plaintext_val = api.gen_plaintext();
    let encrypted_val = api
        .encrypt(&plaintext_val, &recipient_public, &signing_keypair)
        .map_err(|e| e.to_string())?;
    let symmetric_key = api.derive_symmetric_key(&plaintext_val);

    let nonce: [u8; 12] = rand::random();
    let c_data = aes_encrypt(symmetric_key.bytes(), &nonce, plaintext)?;

    let serializable = SerializableEncryptedValue::from_encrypted_value(&encrypted_val)?;
    let encrypted_data = postcard::to_allocvec(&serializable).map_err(|e| e.to_string())?;
    let data_hash = sha256(&c_data);

    let capsule = Capsule {
        version: 1,
        nonce: nonce.to_vec(),
        signing_key_pair: signing_keypair_bytes,
        encrypted_data,
        data_hash,
        sequence: 0,
        request_id: generate_uuid(),
        client_timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
    };

    let _ = owner_private;
    pack_note_blob(&capsule, &c_data)
}

pub fn decrypt_note_field(owner_address: &str, blob: &[u8]) -> Result<Vec<u8>, String> {
    let api = recrypt_api();
    let (capsule, c_data) = unpack_note_blob(blob)?;

    let computed_hash = sha256(&c_data);
    if computed_hash != capsule.data_hash {
        return Err("note blob integrity check failed".to_string());
    }

    let mut priv_bytes = derive_rekrypt_private_from_address(owner_address)?;
    let private = PrivateKey::new_from_slice(&priv_bytes).map_err(|e| e.to_string())?;
    priv_bytes.zeroize();

    let serializable: SerializableEncryptedValue =
        postcard::from_bytes(&capsule.encrypted_data).map_err(|e| e.to_string())?;
    let encrypted_value = serializable.to_encrypted_value()?;

    let pt = api
        .decrypt(encrypted_value, &private)
        .map_err(|e| e.to_string())?;
    let key = api.derive_symmetric_key(&pt);

    if capsule.nonce.len() != 12 {
        return Err("invalid capsule nonce".to_string());
    }
    aes_decrypt(key.bytes(), &capsule.nonce, &c_data)
}

pub fn generate_migration_data(
    admin_address: &str,
    candidate_address: &str,
) -> Result<Vec<u8>, String> {
    let api = recrypt_api();
    let mut admin_priv_bytes = derive_rekrypt_private_from_address(admin_address)?;
    let admin_private = PrivateKey::new_from_slice(&admin_priv_bytes).map_err(|e| e.to_string())?;
    admin_priv_bytes.zeroize();

    let candidate_pub_bytes = derive_rekrypt_public_from_address(candidate_address)?;
    let candidate_public = parse_public_key(&candidate_pub_bytes)?;
    let signing_keypair_bytes = derive_signing_keypair_from_address(admin_address)?;
    let signing_keypair = signing_keypair_from_bytes(&signing_keypair_bytes)?;

    let transform_key = api
        .generate_transform_key(&admin_private, &candidate_public, &signing_keypair)
        .map_err(|e| e.to_string())?;

    let serializable = SerializableTransformKey::from_transform_key(&transform_key)?;
    let tk_bytes = postcard::to_allocvec(&serializable).map_err(|e| e.to_string())?;

    if tk_bytes.len() > u16::MAX as usize {
        return Err("transform key too large".to_string());
    }
    if candidate_pub_bytes.len() != 64 {
        return Err("invalid delegate rekrypt public key length".to_string());
    }

    let mut out = Vec::with_capacity(1 + 64 + 2 + tk_bytes.len());
    out.push(MIGRATION_VERSION);
    out.extend_from_slice(&candidate_pub_bytes);
    out.extend_from_slice(&(tk_bytes.len() as u16).to_be_bytes());
    out.extend_from_slice(&tk_bytes);
    Ok(out)
}

pub fn parse_migration_data(bytes: &[u8]) -> Result<(Vec<u8>, Vec<u8>), String> {
    if bytes.is_empty() || bytes[0] != MIGRATION_VERSION {
        return Err("unsupported migration data version".to_string());
    }
    if bytes.len() < 1 + 64 + 2 {
        return Err("migration data too short".to_string());
    }
    let delegate_pub = bytes[1..65].to_vec();
    let tk_len = u16::from_be_bytes([bytes[65], bytes[66]]) as usize;
    if bytes.len() < 67 + tk_len {
        return Err("migration data truncated".to_string());
    }
    let transform_key = bytes[67..67 + tk_len].to_vec();
    Ok((delegate_pub, transform_key))
}

pub fn migrate_note_blob(
    new_admin_address: &str,
    blob: &[u8],
    transform_key_bytes: &[u8],
) -> Result<Vec<u8>, String> {
    let api = recrypt_api();
    let (capsule, c_data) = unpack_note_blob(blob)?;

    let signing_keypair = signing_keypair_from_bytes(&capsule.signing_key_pair)?;

    let serializable_enc: SerializableEncryptedValue =
        postcard::from_bytes(&capsule.encrypted_data).map_err(|e| e.to_string())?;
    let encrypted_value = serializable_enc.to_encrypted_value()?;

    let serializable_tk: SerializableTransformKey =
        postcard::from_bytes(transform_key_bytes).map_err(|e| e.to_string())?;
    let transform_key = serializable_tk.to_transform_key()?;

    let transformed = api
        .transform(encrypted_value, transform_key, &signing_keypair)
        .map_err(|e| e.to_string())?;

    let mut new_admin_priv = derive_rekrypt_private_from_address(new_admin_address)?;
    let new_admin_private =
        PrivateKey::new_from_slice(&new_admin_priv).map_err(|e| e.to_string())?;
    new_admin_priv.zeroize();

    let pt = api
        .decrypt(transformed, &new_admin_private)
        .map_err(|e| e.to_string())?;
    let symmetric_key = api.derive_symmetric_key(&pt);
    let plaintext = aes_decrypt(symmetric_key.bytes(), &capsule.nonce, &c_data)?;

    encrypt_note_field(new_admin_address, new_admin_address, &plaintext)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::SigningKey;
    use rand::rngs::OsRng;
    use stellar_strkey::ed25519::PublicKey as StellarPublicKey;

    fn random_stellar_address() -> String {
        let signing_key = SigningKey::generate(&mut OsRng);
        let public = StellarPublicKey(signing_key.verifying_key().to_bytes());
        public.to_string()
    }

    #[test]
    fn rekrypt_roundtrip_encrypt_decrypt() {
        let admin = random_stellar_address();
        let plaintext = b"Hello inheritable notes";
        let blob = encrypt_note_field(&admin, &admin, plaintext).expect("encrypt");
        let decrypted = decrypt_note_field(&admin, &blob).expect("decrypt");
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn rekrypt_pre_migration_roundtrip() {
        let admin = random_stellar_address();
        let candidate = random_stellar_address();
        let plaintext = b"Secret note body";

        let blob = encrypt_note_field(&admin, &admin, plaintext).expect("encrypt");
        let migration = generate_migration_data(&admin, &candidate).expect("migration");

        let migrated = migrate_note_blob(&candidate, &blob, &parse_migration_data(&migration).unwrap().1)
            .expect("migrate");

        let decrypted = decrypt_note_field(&candidate, &migrated).expect("decrypt");
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn migration_data_does_not_contain_admin_private_key() {
        let admin = random_stellar_address();
        let candidate = random_stellar_address();
        let admin_priv = derive_rekrypt_private_from_address(&admin).expect("admin priv");
        let migration = generate_migration_data(&admin, &candidate).expect("migration");

        assert!(!migration.windows(32).any(|w| w == admin_priv.as_slice()));
    }
}