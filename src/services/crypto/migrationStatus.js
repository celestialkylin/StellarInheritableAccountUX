import { bytesToBuffer } from "./codec.js";

/** @typedef {"idle" | "notes_pending"} MigrationPhase */

/**
 * Normalize `get_admin_migration_status` result from scValToNative.
 * @returns {{ phase: MigrationPhase, migrationData: Buffer }}
 */
export function parseAdminMigrationStatus(raw) {
  if (raw == null || raw === "Idle") {
    return { phase: "idle", migrationData: Buffer.alloc(0) };
  }

  if (typeof raw === "string") {
    if (raw === "NotesPending") {
      return { phase: "notes_pending", migrationData: Buffer.alloc(0) };
    }
    // Legacy CandidateRkPending (or unknown) → idle; notes migration is the only active phase.
    return { phase: "idle", migrationData: Buffer.alloc(0) };
  }

  if (Array.isArray(raw)) {
    const [tag, value] = raw;
    if (tag === "NotesPending" || tag === 0) {
      return {
        phase: "notes_pending",
        migrationData: bytesToBuffer(value ?? []),
      };
    }
    return { phase: "idle", migrationData: Buffer.alloc(0) };
  }

  if (typeof raw === "object") {
    if ("NotesPending" in raw) {
      const value = raw.NotesPending ?? raw.values?.[0];
      return {
        phase: "notes_pending",
        migrationData: bytesToBuffer(value ?? []),
      };
    }
    if (raw.tag === "NotesPending") {
      return {
        phase: "notes_pending",
        migrationData: bytesToBuffer(raw.values?.[0] ?? []),
      };
    }
    if (raw.tag === "Idle" || "Idle" in raw) {
      return { phase: "idle", migrationData: Buffer.alloc(0) };
    }
  }

  return { phase: "idle", migrationData: Buffer.alloc(0) };
}

export function migrationInProgress(status) {
  return status.phase !== "idle";
}

export function migrationNeedsNotes(status) {
  return status.phase === "notes_pending";
}
