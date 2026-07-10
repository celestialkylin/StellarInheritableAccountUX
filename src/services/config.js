import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { normalizeScHex } from "./decrypt.js";

const SC_ENC_FILENAME = "sc.enc";
const SC_TXT_FILTER = [{ name: "Text", extensions: ["txt"] }];

function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function readProjectFile(relativePath) {
  return invoke("read_project_file", { relativePath });
}

/**
 * Normalize one assets[] entry by field inference (no `type`).
 *
 * - No issuer & no contract → native XLM (non-XLM `code` is ignored)
 * - issuer without contract → requires code (SAC derived at resolve time)
 * - contract alone or with issuer → use explicit contract on-chain
 *
 * @param {object} raw
 * @param {number} index
 */
export function normalizeAsset(raw, index = 0) {
  if (!raw || typeof raw !== "object") {
    throw new Error(`config: assets[${index}] must be an object`);
  }

  const issuer = typeof raw.issuer === "string" ? raw.issuer.trim() : "";
  const contract = typeof raw.contract === "string" ? raw.contract.trim() : "";
  const codeRaw = typeof raw.code === "string" ? raw.code.trim() : "";
  const label = typeof raw.label === "string" ? raw.label.trim() : "";

  if (issuer && !issuer.startsWith("G")) {
    throw new Error(`config: assets[${index}].issuer must be a G... address`);
  }
  if (contract && !contract.startsWith("C")) {
    throw new Error(`config: assets[${index}].contract must be a C... address`);
  }

  const out = {};
  if (label) out.label = label;

  // Native: neither issuer nor contract
  if (!issuer && !contract) {
    // Keep code only when it is XLM; otherwise ignore non-XLM code
    if (codeRaw && codeRaw.toUpperCase() === "XLM") {
      out.code = codeRaw;
    }
    return out;
  }

  // Explicit contract wins for on-chain identity
  if (contract) {
    out.contractId = contract;
    if (codeRaw) out.code = codeRaw;
    if (issuer) out.issuer = issuer;
    return out;
  }

  // issuer only: need code to derive SAC contract id later
  if (!codeRaw) {
    throw new Error(
      `config: assets[${index}] with issuer but no contract requires code`,
    );
  }
  out.code = codeRaw;
  out.issuer = issuer;
  return out;
}

const DEFAULT_MIGRATION_NOTES_BATCH_MAX_BYTES = 20_000;

/**
 * Optional positive integer: max summary+body payload bytes per migrate_notes tx.
 * Omitted / null → 20000. ≤0 or non-integer → error.
 */
export function normalizeMigrationNotesBatchMaxBytes(raw) {
  if (raw == null || raw === "") {
    return DEFAULT_MIGRATION_NOTES_BATCH_MAX_BYTES;
  }
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) {
    throw new Error(
      "config: migrationNotesBatchMaxBytes must be a positive integer",
    );
  }
  return raw;
}

export function validateConfig(raw) {
  if (!raw.horizonUrl?.trim()) throw new Error("config: horizonUrl is required");
  if (!raw.rpcUrl?.trim()) throw new Error("config: rpcUrl is required");
  if (!raw.networkPassphrase?.trim()) throw new Error("config: networkPassphrase is required");
  if (!raw.inheritableAccountContractId?.startsWith("C")) {
    throw new Error("config: inheritableAccountContractId must be a C... address");
  }
  if (!Array.isArray(raw.assets) || raw.assets.length === 0) {
    throw new Error("config: assets must be a non-empty array");
  }
  const assets = raw.assets.map((asset, i) => normalizeAsset(asset, i));
  return {
    horizonUrl: raw.horizonUrl.trim(),
    rpcUrl: raw.rpcUrl.trim(),
    networkPassphrase: raw.networkPassphrase.trim(),
    proxy: raw.proxy?.trim() || "",
    scTxtPath: raw.scTxtPath?.trim() || "",
    inheritableAccountContractId: raw.inheritableAccountContractId.trim(),
    templatesDir: raw.templatesDir?.trim() || "",
    migrationNotesBatchMaxBytes: normalizeMigrationNotesBatchMaxBytes(
      raw.migrationNotesBatchMaxBytes,
    ),
    assets,
  };
}

const CONFIG_CANDIDATES = ["config.json", "public/config.json"];

export async function loadConfig() {
  if (isTauri()) {
    for (const path of CONFIG_CANDIDATES) {
      try {
        const text = await readProjectFile(path);
        if (text?.trim()) {
          return validateConfig(JSON.parse(text));
        }
      } catch {
        /* try next */
      }
    }
  }

  const res = await fetch("/config.json");
  if (!res.ok) throw new Error("Failed to load config.json");
  return validateConfig(JSON.parse(await res.text()));
}

function normalizeScPath(path) {
  return path
    .replace(/^\.\//, "")
    .replace(/\\/g, "/");
}

/** @typedef {'config_file' | 'fallback_file' | 'sc_enc'} ScContentSource */

/**
 * Prefer project sc.txt (config scTxtPath or sc.txt), then persisted sc.enc.
 * @returns {Promise<{ content: string | null, source: ScContentSource | null }>}
 */
export async function resolveScContent(config) {
  if (!isTauri()) {
    return { content: null, source: null };
  }

  const scCandidates = [];
  if (config.scTxtPath) {
    scCandidates.push(normalizeScPath(config.scTxtPath));
  }
  scCandidates.push("sc.txt");

  for (const path of scCandidates) {
    try {
      const content = await readProjectFile(path);
      if (content?.trim()) {
        return {
          content: normalizeScHex(content),
          source: config.scTxtPath && normalizeScPath(config.scTxtPath) === path
            ? "config_file"
            : "fallback_file",
        };
      }
    } catch {
      /* try next */
    }
  }

  try {
    const persisted = await invoke("read_app_data_file", { filename: SC_ENC_FILENAME });
    if (persisted?.trim()) {
      return { content: normalizeScHex(persisted), source: "sc_enc" };
    }
  } catch {
    /* not persisted yet */
  }

  return { content: null, source: null };
}

export async function persistScContent(content) {
  await invoke("write_app_data_file", {
    filename: SC_ENC_FILENAME,
    content: normalizeScHex(content),
  });
}

/**
 * Export sc.enc ciphertext to a user-chosen path via save dialog.
 * Desktop default dir: process CWD; mobile: Downloads. Filename: sc.txt.
 * @param {string} content normalized hex ciphertext
 * @returns {Promise<string | null>} selected path, or null if cancelled
 */
export async function exportScContent(content) {
  let defaultPath = "sc.txt";
  try {
    defaultPath = await invoke("get_sc_export_default_path");
  } catch {
    /* keep filename-only fallback */
  }
  const selected = await save({
    defaultPath,
    filters: SC_TXT_FILTER,
  });
  if (!selected) return null;
  await invoke("write_text_file", {
    path: selected,
    content: normalizeScHex(content),
  });
  return selected;
}

export { SC_ENC_FILENAME };