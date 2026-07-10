import { nativeToScVal } from "@stellar/stellar-sdk";
import { Buffer } from "buffer";

/** Soroban struct field: symbol key + typed value (see stellar-sdk ScValMapTypeSpec). */
export function structField(valueType) {
  return ["symbol", valueType];
}

export function nativeStructToScVal(record, fieldTypes) {
  return nativeToScVal(record, { type: fieldTypes });
}

export function nativeVecToScVal(items) {
  return nativeToScVal(items);
}

export function nativeU64ToScVal(value) {
  return nativeToScVal(BigInt(value), { type: "u64" });
}

export function bytesToBuffer(value) {
  if (value == null) return Buffer.alloc(0);
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") {
    if (value.startsWith("0x")) return Buffer.from(value.slice(2), "hex");
    return Buffer.from(value, "hex");
  }
  if (Array.isArray(value)) return Buffer.from(value);
  throw new Error("Unsupported byte value type");
}

export function bufferToContractBytes(buf) {
  return Buffer.from(buf);
}

export function concatBytes(...parts) {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function readU16BE(buf, offset) {
  return (buf[offset] << 8) | buf[offset + 1];
}

export function writeU16BE(value) {
  const out = new Uint8Array(2);
  out[0] = (value >> 8) & 0xff;
  out[1] = value & 0xff;
  return out;
}

export function readU32BE(buf, offset) {
  return (
    (buf[offset] << 24)
    | (buf[offset + 1] << 16)
    | (buf[offset + 2] << 8)
    | buf[offset + 3]
  ) >>> 0;
}

export function writeU32BE(value) {
  const out = new Uint8Array(4);
  out[0] = (value >>> 24) & 0xff;
  out[1] = (value >>> 16) & 0xff;
  out[2] = (value >>> 8) & 0xff;
  out[3] = value & 0xff;
  return out;
}

export function utf8Encode(text) {
  return new TextEncoder().encode(text);
}

export function utf8Decode(bytes) {
  return new TextDecoder().decode(bytes);
}