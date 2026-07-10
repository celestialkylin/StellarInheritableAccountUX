import { scValToNative, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { AssembledTransaction } from "@stellar/stellar-sdk/contract";
import { Buffer } from "buffer";
import { bytesToBuffer } from "../crypto/codec.js";
import { getContext } from "./context.js";
import { submitContractCall } from "./submit.js";

function toContractBytes(value) {
  const buf = bytesToBuffer(value);
  return xdr.ScVal.scvBytes(Buffer.from(buf));
}

async function readContract(method, args = []) {
  const { config, contractId } = getContext();
  const tx = await AssembledTransaction.build({
    contractId,
    method,
    args,
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.rpcUrl,
    parseResultXdr: scValToNative,
  });
  return tx.result;
}

export function getAdmin() {
  return readContract("get_admin");
}

export function getLastActivity() {
  return readContract("get_last_activity");
}

export function getInactiveTime() {
  return readContract("get_inactive_time");
}

export function getCandidate(address) {
  return readContract("get_candidate", [nativeToScVal(address, { type: "address" })]);
}

export function listCandidates() {
  return readContract("list_candidates");
}

export function canClaim(address) {
  return readContract("can_claim", [nativeToScVal(address, { type: "address" })]);
}

export function getAdminMigrationStatus() {
  return readContract("get_admin_migration_status");
}

export async function claimAdmin(publicKey) {
  return submitContractCall({
    contractId: getContext().contractId,
    method: "claim_admin",
    args: [nativeToScVal(publicKey, { type: "address" })],
    publicKey,
    parseResultXdr: scValToNative,
  });
}

export function setAdmin(publicKey, newAdmin, migrationData) {
  return submitContractCall({
    contractId: getContext().contractId,
    method: "set_admin",
    args: [
      nativeToScVal(newAdmin, { type: "address" }),
      toContractBytes(migrationData),
    ],
    publicKey,
    parseResultXdr: scValToNative,
  });
}

export function finishAdminMigration(publicKey) {
  return submitContractCall({
    contractId: getContext().contractId,
    method: "finish_admin_migration",
    args: [],
    publicKey,
    parseResultXdr: scValToNative,
  });
}