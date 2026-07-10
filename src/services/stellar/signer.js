import { basicNodeSigner } from "@stellar/stellar-sdk/contract";
import { getSessionKeypair } from "../session.js";

export function getSessionSigner(networkPassphrase) {
  return basicNodeSigner(getSessionKeypair(), networkPassphrase);
}