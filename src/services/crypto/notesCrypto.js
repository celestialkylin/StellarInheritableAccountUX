import { invoke } from "@tauri-apps/api/core";
import { Buffer } from "buffer";
import { bytesToBuffer, bufferToContractBytes, utf8Decode, utf8Encode } from "./codec.js";

const SUMMARY_CHARS = 25;

function toBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function fromBase64(b64) {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

/** First line of body, first SUMMARY_CHARS Unicode code points (or whole line if shorter). */
export function makeSummary(body) {
  const firstLine = String(body ?? "").split(/\r?\n/, 1)[0] ?? "";
  return Array.from(firstLine).slice(0, SUMMARY_CHARS).join("");
}

export async function encryptField(plaintextBytes) {
  const b64 = await invoke("encrypt_note", {
    plaintextBase64: toBase64(plaintextBytes),
  });
  return bufferToContractBytes(fromBase64(b64));
}

export async function decryptField(ciphertextBytes) {
  const buf = bytesToBuffer(ciphertextBytes);
  const b64 = await invoke("decrypt_note", {
    blobBase64: toBase64(buf),
  });
  return fromBase64(b64);
}

export async function encryptNoteText(summary, body) {
  const encSummary = await encryptField(utf8Encode(summary));
  const encBody = await encryptField(utf8Encode(body));
  return { summary: encSummary, body: encBody };
}

export async function decryptNoteField(ciphertextBytes) {
  const plaintext = await decryptField(ciphertextBytes);
  return utf8Decode(plaintext);
}
