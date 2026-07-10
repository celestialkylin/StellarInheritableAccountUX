import { invoke } from "@tauri-apps/api/core";
import { Buffer } from "buffer";
import { bytesToBuffer, bufferToContractBytes } from "./codec.js";

const MIGRATION_VERSION = 2;

function toBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function fromBase64(b64) {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

export async function encodeMigrationData(candidateAddress) {
  const b64 = await invoke("rekrypt_generate_migration_data", {
    candidateAddress,
  });
  return bufferToContractBytes(fromBase64(b64));
}

export function parseMigrationData(migrationBytes) {
  const buf = bytesToBuffer(migrationBytes);
  if (buf.length < 1 + 64 + 2) {
    throw new Error("Invalid migration data: too short");
  }
  if (buf[0] !== MIGRATION_VERSION) {
    throw new Error(`Unsupported migration data version: ${buf[0]}`);
  }

  let offset = 1;
  const delegatePub = buf.slice(offset, offset + 64);
  offset += 64;
  const tkLen = (buf[offset] << 8) | buf[offset + 1];
  offset += 2;
  const transformKey = buf.slice(offset, offset + tkLen);

  return { delegatePub, transformKey };
}

export function hasMigrationData(migrationBytes) {
  const buf = bytesToBuffer(migrationBytes);
  return buf.length > 0 && buf[0] === MIGRATION_VERSION;
}

export async function migrateEncryptedField(ciphertextBytes, migrationBytes) {
  const blobB64 = toBase64(bytesToBuffer(ciphertextBytes));
  const migrationB64 = toBase64(bytesToBuffer(migrationBytes));
  const resultB64 = await invoke("rekrypt_migrate_note_blob", {
    blobBase64: blobB64,
    migrationDataBase64: migrationB64,
  });
  return bufferToContractBytes(fromBase64(resultB64));
}