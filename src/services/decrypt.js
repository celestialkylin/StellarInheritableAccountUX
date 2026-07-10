import { Buffer } from "buffer";
import { Keypair } from "@stellar/stellar-sdk";
import { Encrypter, Decrypter } from "age-encryption";

/** Strip whitespace and optional 0x prefix from hex ciphertext. */
export function normalizeScHex(encStr) {
  if (typeof encStr === "object" && encStr?.byteLength != null) {
    encStr = encStr.toString();
  }
  let text = String(encStr).trim();
  if (text.startsWith("0x") || text.startsWith("0X")) {
    text = text.slice(2);
  }
  return text.replace(/\s+/g, "");
}

export function isStellarSecretKey(input) {
  const trimmed = String(input).trim();
  if (!/^S[A-Z2-7]{55}$/.test(trimmed)) return false;
  try {
    Keypair.fromSecret(trimmed);
    return true;
  } catch {
    return false;
  }
}

function randomHexPad() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("hex");
}

export async function encryptScSimple(str, password) {
  if (typeof str === "object" && str?.byteLength != null) {
    str = str.toString();
  }
  const padded = randomHexPad() + str + randomHexPad();
  const cipher = new Encrypter();
  cipher.setPassphrase(password);
  const encrypted = await cipher.encrypt(padded);
  return Buffer.from([0, 0, 0]).toString("hex") + Buffer.from(encrypted).toString("hex");
}

function formatDecryptError(err) {
  const msg = err?.message || String(err);
  if (/no identity matched/i.test(msg)) {
    return "Decryption failed. Check password.";
  }
  if (/invalid version line|invalid non-ASCII/i.test(msg)) {
    return "Decryption failed. The sc file may be corrupted.";
  }
  return msg || "Decryption failed. Check password.";
}

export async function decryptSc(encStr, saltStr) {
  const normalized = normalizeScHex(encStr);
  if (!normalized || normalized.length % 2 !== 0) {
    throw new Error("Encrypted content is not valid hex");
  }

  try {
    const buf = Buffer.from(normalized, "hex");
    if (buf.length < 3) {
      throw new Error("Encrypted content is too short");
    }
    const payload = buf.slice(3);
    const decipher = new Decrypter();
    decipher.addPassphrase(saltStr);
    const decrypted = await decipher.decrypt(payload, "text");
    return decrypted.slice(32, decrypted.length - 32);
  } catch (err) {
    throw new Error(formatDecryptError(err));
  }
}