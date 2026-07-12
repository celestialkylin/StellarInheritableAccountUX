import { invoke } from "@tauri-apps/api/core";
import { Buffer } from "buffer";
import { bytesToBuffer, bufferToContractBytes } from "./codec.js";

/** Matches `notes_crypto` MIGRATION_VERSION + 128-byte ReencryptionKey. */
const MIGRATION_VERSION = 1;
const REENCRYPTION_KEY_LEN = 128;
const MIGRATION_DATA_LEN = 1 + REENCRYPTION_KEY_LEN;

function toBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function fromBase64(b64) {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

export async function encodeMigrationData(candidateAddress) {
  const b64 = await invoke("generate_note_migration_data", {
    candidateAddress,
  });
  return bufferToContractBytes(fromBase64(b64));
}

export function parseMigrationData(migrationBytes) {
  const buf = bytesToBuffer(migrationBytes);
  if (buf.length !== MIGRATION_DATA_LEN) {
    throw new Error(
      `Invalid migration data length: ${buf.length} (expected ${MIGRATION_DATA_LEN})`,
    );
  }
  if (buf[0] !== MIGRATION_VERSION) {
    throw new Error(`Unsupported migration data version: ${buf[0]}`);
  }
  return { reencryptionKey: buf.slice(1) };
}

export function hasMigrationData(migrationBytes) {
  const buf = bytesToBuffer(migrationBytes);
  return buf.length === MIGRATION_DATA_LEN && buf[0] === MIGRATION_VERSION;
}

export async function migrateEncryptedField(ciphertextBytes, migrationBytes) {
  const blobB64 = toBase64(bytesToBuffer(ciphertextBytes));
  const migrationB64 = toBase64(bytesToBuffer(migrationBytes));
  const resultB64 = await invoke("migrate_note_blob", {
    blobBase64: blobB64,
    migrationDataBase64: migrationB64,
  });
  return bufferToContractBytes(fromBase64(resultB64));
}
