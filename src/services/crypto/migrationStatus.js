import { bytesToBuffer } from "./codec.js";

/** @typedef {"idle" | "notes_pending" | "candidate_rk_pending"} MigrationPhase */

/**
 * Normalize `get_admin_migration_status` result from scValToNative.
 * @returns {{ phase: MigrationPhase, migrationData: Buffer }}
 */
export function parseAdminMigrationStatus(raw) {
  if (raw == null || raw === "Idle") {
    return { phase: "idle", migrationData: Buffer.alloc(0) };
  }

  if (typeof raw === "string") {
    if (raw === "CandidateRkPending") {
      return { phase: "candidate_rk_pending", migrationData: Buffer.alloc(0) };
    }
    if (raw === "NotesPending") {
      return { phase: "notes_pending", migrationData: Buffer.alloc(0) };
    }
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
    if (tag === "CandidateRkPending" || tag === 1) {
      return { phase: "candidate_rk_pending", migrationData: Buffer.alloc(0) };
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
    if ("CandidateRkPending" in raw || raw.tag === "CandidateRkPending") {
      return { phase: "candidate_rk_pending", migrationData: Buffer.alloc(0) };
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

export function migrationNeedsCandidateRk(status) {
  return status.phase === "candidate_rk_pending";
}