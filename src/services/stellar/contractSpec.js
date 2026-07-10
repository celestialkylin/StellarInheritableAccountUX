import { Buffer } from "buffer";
import { Contract } from "@stellar/stellar-sdk";
import { Spec } from "@stellar/stellar-sdk/contract";
import { SAC_SPEC } from "../../../node_modules/@stellar/stellar-sdk/lib/esm/bindings/sac-spec.js";
import { getContext } from "./context.js";

const specCache = new Map();

async function specFromContractId(rpc, contractId) {
  const response = await rpc.getLedgerEntries(new Contract(contractId).getFootprint());
  if (!response.entries?.length) {
    throw new Error(`Contract instance not found: ${contractId}`);
  }

  const instance = response.entries[0].val.contractData().val().instance();
  const executable = instance.executable();
  const execKind = executable.switch().name;

  if (execKind === "contractExecutableStellarAsset") {
    return new Spec(SAC_SPEC);
  }

  if (execKind === "contractExecutableWasm") {
    const wasmHash = executable.wasmHash();
    const wasm = await rpc.getContractWasmByHash(wasmHash);
    const wasmBuf = Buffer.isBuffer(wasm) ? wasm : Buffer.from(wasm);
    return Spec.fromWasm(wasmBuf);
  }

  throw new Error(`Unsupported contract executable type: ${execKind}`);
}

/** SEP-41 / SAC 常见方法（spec 解析失败时的后备） */
const SEP41_METHOD_ARGS = {
  transfer: [
    { name: "from", required: true, typeHint: "Address" },
    { name: "to", required: true, typeHint: "Address" },
    { name: "amount", required: true, typeHint: "I128" },
  ],
  balance: [
    { name: "id", required: true, typeHint: "Address" },
  ],
  decimals: [],
  name: [],
  symbol: [],
  allowance: [
    { name: "owner", required: true, typeHint: "Address" },
    { name: "spender", required: true, typeHint: "Address" },
  ],
  approve: [
    { name: "owner", required: true, typeHint: "Address" },
    { name: "spender", required: true, typeHint: "Address" },
    { name: "amount", required: true, typeHint: "I128" },
    { name: "live_until_ledger", required: true, typeHint: "U32" },
  ],
  burn: [
    { name: "from", required: true, typeHint: "Address" },
    { name: "amount", required: true, typeHint: "I128" },
  ],
  mint: [
    { name: "to", required: true, typeHint: "Address" },
    { name: "amount", required: true, typeHint: "I128" },
  ],
};

export async function loadContractSpec(contractId) {
  if (specCache.has(contractId)) return specCache.get(contractId);
  const { rpc } = getContext();
  const spec = await specFromContractId(rpc, contractId);
  specCache.set(contractId, spec);
  return spec;
}

export function listPublicMethods(spec) {
  return spec
    .funcs()
    .map((f) => f.name().toString())
    .filter((name) => !name.startsWith("__"));
}

function scSpecTypeHint(typeDef) {
  if (!typeDef) return "unknown";
  const kind = typeDef.switch().name;
  switch (kind) {
    case "scSpecTypeBool":
      return "bool";
    case "scSpecTypeU32":
      return "U32";
    case "scSpecTypeI32":
      return "I32";
    case "scSpecTypeU64":
      return "U64";
    case "scSpecTypeI64":
      return "I64";
    case "scSpecTypeU128":
      return "U128";
    case "scSpecTypeI128":
      return "I128";
    case "scSpecTypeU256":
      return "U256";
    case "scSpecTypeI256":
      return "I256";
    case "scSpecTypeAddress":
      return "Address";
    case "scSpecTypeMuxedAddress":
      return "MuxedAddress";
    case "scSpecTypeString":
      return "string";
    case "scSpecTypeSymbol":
      return "symbol";
    case "scSpecTypeBytes":
      return "bytes";
    case "scSpecTypeBytesN":
      return `bytesN(${typeDef.bytesN().n()})`;
    case "scSpecTypeTimepoint":
      return "Timepoint";
    case "scSpecTypeDuration":
      return "Duration";
    case "scSpecTypeOption":
      return `Option<${scSpecTypeHint(typeDef.option().valueType())}>`;
    case "scSpecTypeVec":
      return `Vec<${scSpecTypeHint(typeDef.vec().elementType())}>`;
    case "scSpecTypeMap":
      return "Map";
    case "scSpecTypeTuple":
      return "Tuple";
    case "scSpecTypeUdt":
      return typeDef.udt().name().toString();
    case "scSpecTypeResult":
      return "Result";
    case "scSpecTypeVoid":
      return "void";
    default:
      return kind.replace(/^scSpecType/, "") || "unknown";
  }
}

function inputIsRequired(typeDef) {
  return typeDef?.switch?.().name !== "scSpecTypeOption";
}

function fieldsFromFuncInputs(spec, methodName) {
  const func = spec.getFunc(methodName);
  const inputs = func.inputs() ?? [];
  return inputs.map((input) => {
    const typeDef = input.type();
    const name = input.name().toString();
    const typeHint = scSpecTypeHint(typeDef);
    return {
      name,
      required: inputIsRequired(typeDef),
      type: typeHint === "bool" ? "boolean" : "string",
      typeHint,
      enum: null,
      description: input.doc?.()?.toString?.() || "",
    };
  });
}

function fieldsFromSep41Fallback(methodName) {
  const defs = SEP41_METHOD_ARGS[methodName];
  if (!defs) return null;
  return defs.map((d) => ({
    name: d.name,
    required: d.required,
    type: d.typeHint === "bool" ? "boolean" : "string",
    typeHint: d.typeHint,
    enum: null,
    description: "",
  }));
}

/**
 * 从函数 inputs 直接解析参数，避免 spec.jsonSchema() 对部分 SAC/SEP-41 WASM 崩溃。
 */
export function getMethodArgFields(spec, methodName) {
  try {
    const fields = fieldsFromFuncInputs(spec, methodName);
    if (fields.length > 0 || !SEP41_METHOD_ARGS[methodName]) {
      return fields;
    }
  } catch {
    /* fall through to SEP-41 fallback */
  }

  return fieldsFromSep41Fallback(methodName) ?? [];
}

const BYTES_N_HINT = /^bytesN\((\d+)\)$/;

export function parseBytesArg(raw, expectedLength) {
  if (raw instanceof Uint8Array) {
    const buf = Buffer.from(raw);
    if (expectedLength != null && buf.length !== expectedLength) {
      throw new Error(`Expected ${expectedLength} bytes, got ${buf.length}`);
    }
    return buf;
  }
  if (Buffer.isBuffer(raw)) {
    if (expectedLength != null && raw.length !== expectedLength) {
      throw new Error(`Expected ${expectedLength} bytes, got ${raw.length}`);
    }
    return raw;
  }
  if (typeof raw !== "string") {
    throw new Error(`Expected hex string or bytes buffer, got ${typeof raw}`);
  }

  let str = raw.trim();
  if (str.startsWith("base64:")) {
    const buf = Buffer.from(str.slice(7), "base64");
    if (expectedLength != null && buf.length !== expectedLength) {
      throw new Error(`Expected ${expectedLength} bytes, got ${buf.length}`);
    }
    return buf;
  }

  if (str.startsWith("0x") || str.startsWith("0X")) {
    str = str.slice(2);
  }
  str = str.replace(/\s+/g, "");
  if (!/^[0-9a-fA-F]*$/.test(str)) {
    throw new Error("Invalid hex string for bytes argument");
  }
  if (str.length % 2 !== 0) {
    throw new Error("Hex string must have an even number of characters");
  }

  const buf = Buffer.from(str, "hex");
  if (expectedLength != null && buf.length !== expectedLength) {
    throw new Error(`Expected ${expectedLength} bytes (${expectedLength * 2} hex chars), got ${buf.length}`);
  }
  return buf;
}

function bytesLengthFromHint(typeHint) {
  if (typeHint === "bytes") return undefined;
  const match = BYTES_N_HINT.exec(typeHint || "");
  return match ? Number(match[1]) : null;
}

function coerceRawArg(raw, typeHint) {
  if (raw === "" || raw === undefined || raw === null) return undefined;

  if (typeHint === "bool") {
    return raw === true || raw === "true";
  }
  if (typeHint === "U32" || typeHint === "I32") {
    return Number(raw);
  }
  if (typeHint?.startsWith("Option<")) {
    return raw;
  }
  if (typeHint?.startsWith("Vec") || typeHint === "Tuple" || typeHint === "Map") {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  }

  const bytesLen = bytesLengthFromHint(typeHint);
  if (bytesLen !== null) {
    return parseBytesArg(raw, bytesLen ?? undefined);
  }

  return raw;
}

export function coerceMethodArgs(fields, values) {
  const result = {};
  for (const f of fields) {
    const coerced = coerceRawArg(values[f.name], f.typeHint || "");
    if (coerced !== undefined) {
      result[f.name] = coerced;
    }
  }
  return result;
}

/** JSON 模式：按 spec inputs 规范化 bytes/bytesN 等参数 */
export function normalizeMethodArgs(spec, methodName, argsObject) {
  const func = spec.getFunc(methodName);
  const inputs = func.inputs() ?? [];
  const result = { ...argsObject };

  for (const input of inputs) {
    const name = input.name().toString();
    if (!(name in result)) continue;
    const typeHint = scSpecTypeHint(input.type());
    const coerced = coerceRawArg(result[name], typeHint);
    if (coerced !== undefined) {
      result[name] = coerced;
    }
  }
  return result;
}

export function buildMethodArgs(spec, methodName, argsObject) {
  const normalized = normalizeMethodArgs(spec, methodName, argsObject);
  return spec.funcArgsToScVals(methodName, normalized);
}

export function isLikelyReadOnlyMethod(spec, methodName) {
  try {
    if (/^(get_|list_|can_)/.test(methodName)) return true;
    if (["version", "decimals", "balance", "name", "symbol", "allowance", "authorized"].includes(methodName)) {
      return true;
    }
    const outputs = spec.getFunc(methodName).outputs() ?? [];
    return outputs.length > 0 && /^(get|list|can|read)/i.test(methodName);
  } catch {
    return false;
  }
}

export function formatMethodResult(spec, methodName, result) {
  if (result === null || result === undefined) return null;
  try {
    return spec.funcResToNative(methodName, result);
  } catch {
    return result;
  }
}