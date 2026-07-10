import { nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";
import { Buffer } from "buffer";
import {
  bytesToBuffer,
  nativeStructToScVal,
  nativeVecToScVal,
  structField,
} from "../crypto/codec.js";
import { getCandidate, listCandidates } from "./inheritable.js";
import { getContext } from "./context.js";
import { submitContractCall } from "./submit.js";

export { getCandidate, listCandidates };

async function adminWrite(method, args, publicKey) {
  return submitContractCall({
    contractId: getContext().contractId,
    method,
    args,
    publicKey,
    parseResultXdr: scValToNative,
  });
}

function toContractBytes(value) {
  const buf = bytesToBuffer(value);
  return xdr.ScVal.scvBytes(Buffer.from(buf));
}

export function addCandidate(publicKey, candidateAddress, waitingTime, migrationData = Buffer.alloc(0)) {
  return adminWrite(
    "add_candidate",
    [
      nativeToScVal(candidateAddress, { type: "address" }),
      nativeToScVal(waitingTime, { type: "u64" }),
      toContractBytes(migrationData),
    ],
    publicKey,
  );
}

const CANDIDATE_MIGRATION_UPDATE_FIELDS = {
  candidate: structField("address"),
  migration_data: structField("bytes"),
};

function encodeCandidateMigrationUpdate(entry) {
  return nativeStructToScVal(
    {
      candidate: entry.candidate,
      migration_data: Buffer.from(bytesToBuffer(entry.migration_data)),
    },
    CANDIDATE_MIGRATION_UPDATE_FIELDS,
  );
}

export function updateCandidatesMigrationData(publicKey, updates) {
  const updateScVals = updates.map(encodeCandidateMigrationUpdate);

  return adminWrite(
    "update_candidates_migration_data",
    [nativeVecToScVal(updateScVals)],
    publicKey,
  );
}

export function updateCandidate(publicKey, candidateAddress, waitingTime) {
  return adminWrite(
    "update_candidate",
    [
      nativeToScVal(candidateAddress, { type: "address" }),
      nativeToScVal(waitingTime, { type: "u64" }),
    ],
    publicKey,
  );
}

export function removeCandidate(publicKey, candidateAddress) {
  return adminWrite(
    "remove_candidate",
    [nativeToScVal(candidateAddress, { type: "address" })],
    publicKey,
  );
}