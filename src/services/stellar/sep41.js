import { Asset, nativeToScVal, scValToNative } from "@stellar/stellar-sdk";
import { AssembledTransaction } from "@stellar/stellar-sdk/contract";
import { getContext } from "./context.js";
import { ensureAssembledSimReady } from "./restore.js";
import { getSessionPublicKey } from "../session.js";
import { submitAsContractAccount, submitContractCall } from "./submit.js";

const decimalsCache = new Map();

/** Shorten a C... contract id: first 5 + ellipsis + last 5. */
export function formatContractLabel(contractId) {
  if (!contractId || contractId.length < 12) return contractId || "";
  return `${contractId.slice(0, 5)}…${contractId.slice(-5)}`;
}

/**
 * Display label for an asset or tokenRef.
 * Priority: label → code → shortened contractId → "Unknown"
 */
export function displayAssetLabel(asset) {
  const label = typeof asset?.label === "string" ? asset.label.trim() : "";
  if (label) return label;
  const code = typeof asset?.code === "string" ? asset.code.trim() : "";
  if (code) return code;
  const contractId = typeof asset?.contractId === "string" ? asset.contractId.trim() : "";
  if (contractId) return formatContractLabel(contractId);
  return "Unknown";
}

/**
 * Resolve config asset → SEP-41 contract id + display label.
 * Uses explicit contractId when set; else code+issuer SAC; else native XLM.
 */
export function resolveTokenRef(asset, networkPassphrase) {
  let contractId;
  if (asset.contractId) {
    contractId = asset.contractId;
  } else if (asset.issuer && asset.code) {
    contractId = new Asset(asset.code, asset.issuer).contractId(networkPassphrase);
  } else {
    contractId = Asset.native().contractId(networkPassphrase);
  }

  return {
    contractId,
    label: displayAssetLabel({ ...asset, contractId }),
  };
}

async function simulateRead(contractId, method, args) {
  const { config } = getContext();
  const publicKey = getSessionPublicKey() ?? undefined;
  try {
    const tx = await ensureAssembledSimReady(
      () =>
        AssembledTransaction.build({
          contractId,
          method,
          args,
          networkPassphrase: config.networkPassphrase,
          rpcUrl: config.rpcUrl,
          publicKey,
          parseResultXdr: scValToNative,
        }),
      { publicKey },
    );
    return tx.result;
  } catch (e) {
    const err = e?.message || String(e);
    throw new Error(`SEP-41 ${method} failed for ${contractId}: ${err}`);
  }
}

export async function getDecimals(tokenRef) {
  if (decimalsCache.has(tokenRef.contractId)) {
    return decimalsCache.get(tokenRef.contractId);
  }
  const decimals = await simulateRead(tokenRef.contractId, "decimals", []);
  decimalsCache.set(tokenRef.contractId, decimals);
  return decimals;
}

export async function getBalance(tokenRef, holderAddress) {
  const raw = await simulateRead(tokenRef.contractId, "balance", [
    nativeToScVal(holderAddress, { type: "address" }),
  ]);
  return BigInt(raw);
}

export function formatAmount(rawAmount, decimals) {
  const base = 10n ** BigInt(decimals);
  const whole = rawAmount / base;
  const frac = rawAmount % base;
  const fracStr = frac.toString().padStart(Number(decimals), "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

export function parseAmount(amountStr, decimals) {
  const trimmed = amountStr.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid amount: ${amountStr}`);
  }
  const [whole, fraction = ""] = trimmed.split(".");
  const padded = fraction.padEnd(decimals, "0").slice(0, decimals);
  const base = 10n ** BigInt(decimals);
  return BigInt(whole) * base + BigInt(padded || "0");
}

export async function transferFromG(publicKey, tokenRef, toAddress, amountRaw) {
  return submitContractCall({
    contractId: tokenRef.contractId,
    method: "transfer",
    args: [
      nativeToScVal(publicKey, { type: "address" }),
      nativeToScVal(toAddress, { type: "address" }),
      nativeToScVal(amountRaw, { type: "i128" }),
    ],
    publicKey,
    parseResultXdr: scValToNative,
  });
}

export async function transferFromContract(publicKey, tokenRef, toAddress, amountRaw) {
  const { contractId } = getContext();
  return submitAsContractAccount({
    targetContractId: tokenRef.contractId,
    method: "transfer",
    args: [
      nativeToScVal(contractId, { type: "address" }),
      nativeToScVal(toAddress, { type: "address" }),
      nativeToScVal(amountRaw, { type: "i128" }),
    ],
    publicKey,
    contractAccountId: contractId,
  });
}

export function clearDecimalsCache() {
  decimalsCache.clear();
}