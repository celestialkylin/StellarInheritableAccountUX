import { Keypair } from "@stellar/stellar-sdk";

let keypair = null;

export function unlockSession(secret) {
  keypair = Keypair.fromSecret(secret.trim());
  return keypair.publicKey();
}

export function getSessionKeypair() {
  if (!keypair) throw new Error("Session locked");
  return keypair;
}

export function getSessionPublicKey() {
  return keypair?.publicKey() ?? null;
}

export function clearSession() {
  keypair = null;
}