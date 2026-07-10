import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

const TEMPLATE_VERSION = 1;
const ALIAS_CONFIG_VERSION = 1;
const DEFAULT_SUBDIR = "invoke-templates";
const ALIASES_FILENAME = "contract-aliases.json";
const JSON_FILTER = [{ name: "JSON Template", extensions: ["json"] }];

let templatesRootCache = null;
let aliasConfigCache = new Map();

export function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function joinPath(...parts) {
  const cleaned = parts
    .filter(Boolean)
    .map((p) => String(p).replace(/[/\\]+$/, ""));
  if (cleaned.length === 0) return "";
  const isAbsolute = cleaned[0].startsWith("/");
  const joined = cleaned.join("/").replace(/\/+/g, "/");
  return isAbsolute ? joined : joined.replace(/^\//, "");
}

export function normalizePath(path) {
  return String(path).replace(/\\/g, "/").replace(/\/+$/, "");
}

function aliasesConfigPath(root) {
  return joinPath(root, ALIASES_FILENAME);
}

function isValidAlias(alias) {
  if (!alias || typeof alias !== "string") return false;
  const trimmed = alias.trim();
  if (!trimmed || trimmed === "." || trimmed === "..") return false;
  if (trimmed.includes("/") || trimmed.includes("\\")) return false;
  if (trimmed.startsWith("..")) return false;
  return true;
}

function emptyAliasConfig() {
  return { version: ALIAS_CONFIG_VERSION, aliases: {} };
}

function parseAliasConfig(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`${ALIASES_FILENAME} is not valid JSON`);
  }

  if (raw?.version !== ALIAS_CONFIG_VERSION) {
    throw new Error(`Unsupported alias config version: ${raw?.version ?? "missing"}`);
  }

  const aliases = {};
  if (raw?.aliases && typeof raw.aliases === "object") {
    for (const [contractId, alias] of Object.entries(raw.aliases)) {
      if (!contractId?.startsWith("C")) continue;
      if (!isValidAlias(alias)) continue;
      aliases[contractId.trim()] = alias.trim();
    }
  }

  return { version: ALIAS_CONFIG_VERSION, aliases };
}

export async function loadAliasConfig(root) {
  const normRoot = normalizePath(root);
  if (aliasConfigCache.has(normRoot)) {
    return aliasConfigCache.get(normRoot);
  }

  const path = aliasesConfigPath(normRoot);
  let config = emptyAliasConfig();

  if (isTauriRuntime()) {
    try {
      const text = await invoke("read_text_file", { path });
      config = parseAliasConfig(text);
    } catch {
      /* file missing or unreadable — use empty config */
    }
  }

  aliasConfigCache.set(normRoot, config);
  return config;
}

export async function saveAliasConfig(root, config) {
  const normRoot = normalizePath(root);
  const payload = {
    version: ALIAS_CONFIG_VERSION,
    aliases: config?.aliases && typeof config.aliases === "object" ? config.aliases : {},
  };
  const content = JSON.stringify(payload, null, 2);
  await invoke("write_text_file", { path: aliasesConfigPath(normRoot), content });
  aliasConfigCache.set(normRoot, payload);
}

export async function resolveContractDir(root, contractId) {
  const trimmed = contractId?.trim() ?? "";
  if (!trimmed) return trimmed;

  const config = await loadAliasConfig(root);
  return config.aliases[trimmed] ?? trimmed;
}

export function extractContractDirFromTemplatePath(root, templatePath) {
  const normRoot = normalizePath(root);
  const normPath = normalizePath(templatePath);
  if (!normPath.startsWith(normRoot + "/")) return null;

  const rel = normPath.slice(normRoot.length + 1);
  const segment = rel.split("/")[0];
  return segment || null;
}

export async function registerAliasFromTemplatePath(root, templatePath, contractId) {
  const trimmedId = contractId?.trim() ?? "";
  const dirName = extractContractDirFromTemplatePath(root, templatePath);
  if (!dirName || !trimmedId) return null;

  // Under raw C… dir: drop any friendly alias so defaults go back to the contract id path
  if (dirName === trimmedId) {
    const config = await loadAliasConfig(root);
    if (config.aliases[trimmedId]) {
      delete config.aliases[trimmedId];
      await saveAliasConfig(root, config);
    }
    return null;
  }

  if (!isValidAlias(dirName)) return null;

  const config = await loadAliasConfig(root);
  if (config.aliases[trimmedId] === dirName) return dirName;

  config.aliases[trimmedId] = dirName;
  await saveAliasConfig(root, config);
  return dirName;
}

export async function resolveTemplatesRoot(config) {
  if (templatesRootCache) return templatesRootCache;

  const configured = config?.templatesDir?.trim();
  if (configured) {
    templatesRootCache = configured;
    return templatesRootCache;
  }

  const appData = await invoke("get_app_data_dir");
  templatesRootCache = joinPath(appData, DEFAULT_SUBDIR);
  return templatesRootCache;
}

export function methodTemplateRelPath(contractDir, method) {
  return joinPath(contractDir.trim(), method);
}

export async function ensureMethodTemplateDir(root, contractId, method) {
  const contractDir = await resolveContractDir(root, contractId);
  const dir = joinPath(root, methodTemplateRelPath(contractDir, method));
  return invoke("ensure_directory", { path: dir });
}

export function buildTemplatePayload({ contractId, method, useJson, values, jsonArgs }) {
  return {
    version: TEMPLATE_VERSION,
    contractId: contractId.trim(),
    method,
    useJson: Boolean(useJson),
    values: values && typeof values === "object" ? { ...values } : {},
    jsonArgs: typeof jsonArgs === "string" ? jsonArgs : JSON.stringify(jsonArgs ?? {}, null, 2),
  };
}

export function parseTemplateFile(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Template file is not valid JSON");
  }

  if (raw?.version !== TEMPLATE_VERSION) {
    throw new Error(`Unsupported template version: ${raw?.version ?? "missing"}`);
  }
  if (!raw?.contractId?.startsWith("C")) {
    throw new Error("Template missing valid contractId (C...)");
  }
  if (!raw?.method || typeof raw.method !== "string") {
    throw new Error("Template missing method name");
  }
  if (typeof raw.useJson !== "boolean") {
    throw new Error("Template missing useJson flag");
  }

  return {
    version: raw.version,
    contractId: raw.contractId.trim(),
    method: raw.method,
    useJson: raw.useJson,
    values: raw.values && typeof raw.values === "object" ? raw.values : {},
    jsonArgs: typeof raw.jsonArgs === "string" ? raw.jsonArgs : JSON.stringify(raw.jsonArgs ?? {}, null, 2),
  };
}

function basename(path) {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

export async function saveTemplateDialog({ root, contractId, method, payload }) {
  if (!isTauriRuntime()) {
    throw new Error("Save Template requires the Tauri desktop app");
  }

  const contractDir = await resolveContractDir(root, contractId);
  const dir = await ensureMethodTemplateDir(root, contractId, method);
  const defaultPath = joinPath(dir, "template.json");

  const selected = await save({
    defaultPath,
    filters: JSON_FILTER,
  });

  if (!selected) return null;

  const content = JSON.stringify(payload, null, 2);
  await invoke("write_text_file", { path: selected, content });

  // Same as Load: if the user saved under a friendly dir under root, register/update alias
  const registeredAlias = await registerAliasFromTemplatePath(
    root,
    selected,
    contractId,
  );
  const actualContractDir =
    registeredAlias ??
    extractContractDirFromTemplatePath(root, selected) ??
    contractDir;

  return { path: selected, name: basename(selected), contractDir: actualContractDir };
}

export async function loadTemplateDialog({ root, contractId, method }) {
  if (!isTauriRuntime()) {
    throw new Error("Load Template requires the Tauri desktop app");
  }

  const trimmedContractId = contractId?.trim() ?? "";
  const hasValidContract =
    trimmedContractId.startsWith("C") && trimmedContractId.length >= 56;
  const dir = hasValidContract
    ? await ensureMethodTemplateDir(root, trimmedContractId, method)
    : root;

  const selected = await open({
    defaultPath: dir,
    multiple: false,
    filters: JSON_FILTER,
  });

  if (!selected) return null;

  const path = Array.isArray(selected) ? selected[0] : selected;
  const text = await invoke("read_text_file", { path });
  const template = parseTemplateFile(text);

  const registeredAlias = await registerAliasFromTemplatePath(root, path, template.contractId);
  const contractDir =
    registeredAlias ??
    extractContractDirFromTemplatePath(root, path) ??
    (await resolveContractDir(root, template.contractId));

  return { path, name: basename(path), template, contractDir };
}

export function resetTemplatesRootCache() {
  templatesRootCache = null;
  aliasConfigCache.clear();
}