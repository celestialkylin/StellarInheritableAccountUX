import { bytesToBuffer } from "./crypto/codec.js";
import {
  migrationInProgress,
  migrationNeedsCandidateRk,
  migrationNeedsNotes,
  parseAdminMigrationStatus,
} from "./crypto/migrationStatus.js";
import {
  encodeMigrationData,
  migrateEncryptedField,
} from "./crypto/rekryptMigration.js";
import { decryptField } from "./crypto/rekryptNotes.js";
import { getSessionKeypair } from "./session.js";
import { addCandidate, updateCandidatesMigrationData } from "./stellar/candidates.js";
import {
  finishAdminMigration,
  getAdminMigrationStatus,
  listCandidates,
} from "./stellar/inheritable.js";
import {
  completeNotesMigration,
  getNoteBody,
  listNoteSummaries,
  migrateNotes,
} from "./stellar/notes.js";
import { getContext } from "./stellar/context.js";

export async function buildMigrationDataForAddress(targetAddress) {
  return encodeMigrationData(targetAddress);
}

export async function addCandidateWithMigration(publicKey, candidateAddress, waitingTime) {
  const migration_data = await encodeMigrationData(candidateAddress);
  return addCandidate(publicKey, candidateAddress, waitingTime, migration_data);
}

export async function readAdminMigrationState() {
  const raw = await getAdminMigrationStatus();
  return parseAdminMigrationStatus(raw);
}

/**
 * Summary + body are always written together in one migrate_notes upsert.
 * If the current admin can decrypt the summary, the note is already migrated.
 */
async function summaryAlreadyMigrated(summaryBytes) {
  try {
    await decryptField(bytesToBuffer(summaryBytes));
    return true;
  } catch {
    return false;
  }
}

async function buildNoteMigrationUpserts(migrationData) {
  const summaries = await listNoteSummaries();
  const upserts = [];

  for (const entry of summaries) {
    if (await summaryAlreadyMigrated(entry.summary)) {
      continue;
    }
    const body = await getNoteBody(entry.id);
    const newSummary = await migrateEncryptedField(
      bytesToBuffer(entry.summary),
      bytesToBuffer(migrationData),
    );
    const newBody = await migrateEncryptedField(bytesToBuffer(body), bytesToBuffer(migrationData));
    upserts.push({
      id: Number(entry.id),
      summary: newSummary,
      body: newBody,
    });
  }

  return upserts;
}

function noteUpsertPayloadSize(entry) {
  return bytesToBuffer(entry.summary).length + bytesToBuffer(entry.body).length;
}

/**
 * Pack upserts into batches whose summary+body payload sum is ≤ maxBytes.
 * A single note larger than maxBytes is submitted as its own batch.
 */
export function packNoteMigrationBatches(upserts, maxBytes) {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("migration batch maxBytes must be a positive integer");
  }

  const batches = [];
  let current = [];
  let currentSize = 0;

  for (const entry of upserts) {
    const size = noteUpsertPayloadSize(entry);
    if (size > maxBytes) {
      if (current.length > 0) {
        batches.push(current);
        current = [];
        currentSize = 0;
      }
      batches.push([entry]);
      continue;
    }
    if (current.length > 0 && currentSize + size > maxBytes) {
      batches.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(entry);
    currentSize += size;
  }

  if (current.length > 0) {
    batches.push(current);
  }
  return batches;
}

async function syncRemainingCandidateRks(publicKey) {
  const candidates = await listCandidates();
  if (candidates.length === 0) {
    return 0;
  }

  const updates = await Promise.all(
    candidates.map(async (candidate) => ({
      candidate,
      migration_data: await encodeMigrationData(candidate),
    })),
  );

  await updateCandidatesMigrationData(publicKey, updates);
  return updates.length;
}

export async function syncCandidateMigrationKeys() {
  const adminKeypair = getSessionKeypair();
  const updated = await syncRemainingCandidateRks(adminKeypair.publicKey());
  return { updated };
}

export async function migrateNotesAfterAdminChange(publicKey) {
  const newAdminKeypair = getSessionKeypair();
  if (newAdminKeypair.publicKey() !== publicKey) {
    throw new Error("Session key does not match the active admin public key");
  }

  let status = await readAdminMigrationState();
  if (!migrationInProgress(status)) {
    return { migrated: 0, batches: 0, skipped: true, phase: "idle" };
  }

  let notesMigrated = 0;
  let batches = 0;
  let candidateRksSynced = false;

  if (migrationNeedsNotes(status)) {
    const upserts = await buildNoteMigrationUpserts(status.migrationData);
    const maxBytes = getContext().config.migrationNotesBatchMaxBytes;
    const packed = packNoteMigrationBatches(upserts, maxBytes);

    for (const batch of packed) {
      await migrateNotes(publicKey, batch);
      notesMigrated += batch.length;
      batches += 1;
    }

    await completeNotesMigration(publicKey);
    status = await readAdminMigrationState();
  }

  if (migrationNeedsCandidateRk(status)) {
    await syncRemainingCandidateRks(publicKey);
    await finishAdminMigration(publicKey);
    candidateRksSynced = true;
    status = await readAdminMigrationState();
  }

  if (migrationInProgress(status)) {
    throw new Error(`Admin migration incomplete (phase: ${status.phase})`);
  }

  return {
    migrated: notesMigrated,
    batches,
    skipped: false,
    phase: "idle",
    candidateRksSynced,
  };
}

export function formatMigrationResult(result) {
  if (result.skipped) {
    return "No pending migration data found.";
  }
  const parts = [];
  if (result.migrated > 0) {
    const batchPart =
      result.batches > 1 ? ` in ${result.batches} batch(es)` : "";
    parts.push(`Migrated ${result.migrated} note(s)${batchPart}`);
  } else if (result.batches === 0 && result.candidateRksSynced) {
    // zero notes still completed notes phase
  }
  if (result.candidateRksSynced) {
    parts.push("refreshed candidate PRE keys");
  }
  if (parts.length === 0) {
    return "Migration completed.";
  }
  return `${parts.join(" and ")}.`;
}
