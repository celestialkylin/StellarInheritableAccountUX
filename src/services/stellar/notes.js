import { scValToNative } from "@stellar/stellar-sdk";
import { AssembledTransaction } from "@stellar/stellar-sdk/contract";
import { Buffer } from "buffer";
import {
  bytesToBuffer,
  nativeStructToScVal,
  nativeU64ToScVal,
  nativeVecToScVal,
  structField,
} from "../crypto/codec.js";
import { getContext } from "./context.js";
import { submitContractCall } from "./submit.js";

const NOTE_UPSERT_FIELDS = {
  id: structField("u64"),
  summary: structField("bytes"),
  body: structField("bytes"),
};

function encodeNoteUpsert(entry) {
  return nativeStructToScVal(
    {
      id: BigInt(entry.id),
      summary: Buffer.from(bytesToBuffer(entry.summary)),
      body: Buffer.from(bytesToBuffer(entry.body)),
    },
    NOTE_UPSERT_FIELDS,
  );
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

export function listNoteSummaries() {
  return readContract("list_note_summaries");
}

export function getNoteBody(id) {
  return readContract("get_note_body", [nativeU64ToScVal(id)]);
}

export async function updateNotes(publicKey, upserts, deletes = []) {
  const upsertScVals = upserts.map(encodeNoteUpsert);
  const deleteScVals = deletes.map((id) => nativeU64ToScVal(id));

  return submitContractCall({
    contractId: getContext().contractId,
    method: "update_notes",
    args: [
      nativeVecToScVal(upsertScVals),
      nativeVecToScVal(deleteScVals),
    ],
    publicKey,
    parseResultXdr: scValToNative,
  });
}

/** Apply one batch of re-encrypted notes while phase is NotesPending. */
export async function migrateNotes(publicKey, upserts) {
  const upsertScVals = upserts.map(encodeNoteUpsert);

  return submitContractCall({
    contractId: getContext().contractId,
    method: "migrate_notes",
    args: [nativeVecToScVal(upsertScVals)],
    publicKey,
    parseResultXdr: scValToNative,
  });
}

/** Advance NotesPending → CandidateRkPending after all note batches are done. */
export async function completeNotesMigration(publicKey) {
  return submitContractCall({
    contractId: getContext().contractId,
    method: "complete_notes_migration",
    args: [],
    publicKey,
    parseResultXdr: scValToNative,
  });
}
