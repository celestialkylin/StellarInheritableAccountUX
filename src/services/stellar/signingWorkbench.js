import { Address, Operation, scValToNative, TransactionBuilder } from "@stellar/stellar-sdk";
import { Api, assembleTransaction } from "@stellar/stellar-sdk/rpc";
import { getContext } from "./context.js";
import { getSessionKeypair } from "../session.js";
import {
  collectAuthSubjects,
  collectUnsignedAuthSubjects,
  getInvokeHostFunctionAuth,
  getRootAddress,
  signAuthNode,
  wrapContractAccountDelegates,
} from "./submit.js";

function hintToHex(hint) {
  try {
    const buf = Buffer.isBuffer(hint) ? hint : Buffer.from(hint);
    return buf.toString("hex");
  } catch {
    return String(hint);
  }
}

function hintsEqual(a, b) {
  if (!a || !b) return false;
  const ba = Buffer.isBuffer(a) ? a : Buffer.from(a);
  const bb = Buffer.isBuffer(b) ? b : Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return ba.equals(bb);
}

export function parseTxXdr(xdrBase64) {
  const trimmed = String(xdrBase64 ?? "").trim();
  if (!trimmed) throw new Error("XDR is empty");
  const { config } = getContext();
  return TransactionBuilder.fromXDR(trimmed, config.networkPassphrase);
}

export function txToXdr(tx) {
  return tx.toEnvelope().toXDR("base64");
}

/**
 * Transaction.toXDR/toEnvelope use the immutable underlying XDR (`this.tx`),
 * while auth mutations live on the high-level `operations[0].auth` array.
 * Rebuild so envelope XDR includes current auth.
 */
function bakeInvokeAuth(tx, networkPassphrase) {
  const op = tx.operations?.[0];
  if (!op || op.type !== "invokeHostFunction") return tx;
  return TransactionBuilder.cloneFrom(tx, {
    networkPassphrase,
    fee: tx.fee,
  })
    .clearOperations()
    .addOperation(
      Operation.invokeHostFunction({
        source: op.source,
        func: op.func,
        auth: op.auth ?? [],
      }),
    )
    .build();
}

function extractInvokeInfo(tx) {
  if (!tx.operations?.length) {
    return { isContractInvoke: false, opType: null, authCount: 0 };
  }
  const op = tx.operations[0];
  if (op.type !== "invokeHostFunction") {
    return { isContractInvoke: false, opType: op.type, authCount: 0 };
  }

  let contractId = null;
  let method = null;
  try {
    const func = op.func;
    if (func?.switch?.().name === "hostFunctionTypeInvokeContract") {
      const args = func.value();
      contractId = Address.fromScAddress(args.contractAddress()).toString();
      method = args.functionName().toString("utf-8");
    }
  } catch {
    // leave nulls
  }

  return {
    isContractInvoke: true,
    opType: op.type,
    contractId,
    method,
    authCount: op.auth?.length ?? 0,
  };
}

/** True when envelope carries Soroban resource/footprint data (post-simulate). */
export function hasSorobanResources(tx) {
  try {
    const env = tx.toEnvelope();
    if (env.switch().name !== "envelopeTypeTx") return false;
    const ext = env.v1().tx().ext();
    // Important: ext.value is a method. Calling it returns null/undefined when
    // there is no SorobanTransactionData. Do NOT fall back to the function object
    // (that made raw unsimulated XDR look "simulated").
    const val = typeof ext.value === "function" ? ext.value() : null;
    return val != null;
  } catch {
    return false;
  }
}

function roleForAddress(address, contractAccountId, adminAddress) {
  if (address === contractAccountId) return "InheritableAccount";
  if (address === adminAddress) return "Admin";
  return null;
}

/** Whether any auth root for InheritableAccount is already AddressWithDelegates. */
function detectDelegateWrap(tx, contractAccountId, adminAddress) {
  const authEntries = getInvokeHostFunctionAuth(tx);
  let cRootFound = false;
  let cRootWithDelegates = false;
  let adminDelegatePresent = false;

  for (const entry of authEntries) {
    const credentials = entry.credentials();
    const credType = credentials.switch().name;
    const root = getRootAddress(credentials);
    if (root !== contractAccountId) continue;
    cRootFound = true;
    if (credType === "sorobanCredentialsAddressWithDelegates") {
      cRootWithDelegates = true;
      const walk = (delegates) => {
        for (const d of delegates) {
          const addr = Address.fromScAddress(d.address()).toString();
          if (addr === adminAddress) adminDelegatePresent = true;
          walk(d.nestedDelegates());
        }
      };
      walk(credentials.addressWithDelegates().delegates());
    }
  }

  return { cRootFound, cRootWithDelegates, adminDelegatePresent };
}

const PHASE_LABELS = {
  invalid: "Fix XDR",
  needs_simulate: "Simulate",
  needs_sign_auth: "Sign Auth",
  needs_sign_envelope: "Sign Envelope",
  ready_submit: "Submit to Network",
};

/**
 * Inspect transaction XDR for UI status panel and button phase machine.
 */
export function inspectTxXdr(xdrBase64) {
  const { contractId: inheritableAccountId } = getContext();
  let adminAddress = null;
  let adminHint = null;
  try {
    const kp = getSessionKeypair();
    adminAddress = kp.publicKey();
    adminHint = kp.signatureHint();
  } catch {
    // session locked
  }

  try {
    const tx = parseTxXdr(xdrBase64);
    const invoke = extractInvokeInfo(tx);
    // Post-sim: soroban resources and/or auth entries present (raw Copy XDR has neither)
    const simulated =
      invoke.isContractInvoke &&
      (hasSorobanResources(tx) || invoke.authCount > 0);

    const authSubjects = invoke.isContractInvoke
      ? collectAuthSubjects(tx, { unsignedOnly: false }).map((s) => ({
          ...s,
          role: roleForAddress(s.address, inheritableAccountId, adminAddress),
        }))
      : [];

    const unsignedAuth = authSubjects.filter((s) => !s.signed);
    // Raw (unsimulated) must NOT count as "auth complete"
    const fullyAuthSigned =
      !invoke.isContractInvoke || (simulated && unsignedAuth.length === 0);

    const envelopeSigners = (tx.signatures ?? []).map((sig) => {
      const hint = sig.hint();
      return {
        hint: hintToHex(hint),
        matchesAdmin: adminHint ? hintsEqual(hint, adminHint) : false,
      };
    });
    const hasAdminEnvelopeSig = envelopeSigners.some((s) => s.matchesAdmin);

    const wrapInfo = invoke.isContractInvoke
      ? detectDelegateWrap(tx, inheritableAccountId, adminAddress)
      : { cRootFound: false, cRootWithDelegates: false, adminDelegatePresent: false };

    // Needs wrap if C root exists as plain Address (sim output) or unsigned subjects remain
    const needsWrap =
      wrapInfo.cRootFound && !wrapInfo.cRootWithDelegates;
    const needsSignAuth =
      invoke.isContractInvoke &&
      simulated &&
      (unsignedAuth.length > 0 || needsWrap);

    /** @type {'invalid'|'needs_simulate'|'needs_sign_auth'|'needs_sign_envelope'|'ready_submit'} */
    let phase;
    if (invoke.isContractInvoke && !simulated) {
      phase = "needs_simulate";
    } else if (needsSignAuth) {
      phase = "needs_sign_auth";
    } else if (!hasAdminEnvelopeSig) {
      phase = "needs_sign_envelope";
    } else {
      phase = "ready_submit";
    }

    // Classic non-contract: skip sim/auth
    if (!invoke.isContractInvoke) {
      phase = hasAdminEnvelopeSig ? "ready_submit" : "needs_sign_envelope";
    }

    const involvesCOrAdmin = authSubjects.some(
      (s) =>
        s.address === inheritableAccountId ||
        s.address === adminAddress ||
        s.role === "InheritableAccount" ||
        s.role === "Admin",
    ) || needsWrap;

    const timebounds = tx.timeBounds
      ? {
          minTime: String(tx.timeBounds.minTime ?? "0"),
          maxTime: String(tx.timeBounds.maxTime ?? "0"),
        }
      : null;

    return {
      ok: true,
      error: null,
      phase,
      nextStepLabel: PHASE_LABELS[phase],
      source: tx.source,
      fee: String(tx.fee),
      sequence: String(tx.sequence),
      timebounds,
      isContractInvoke: invoke.isContractInvoke,
      opType: invoke.opType,
      contractId: invoke.contractId ?? null,
      method: invoke.method ?? null,
      authCount: invoke.authCount,
      authSubjects,
      fullyAuthSigned,
      simulated,
      hasSorobanResources: simulated,
      wrapInfo,
      envelopeSigners,
      hasAdminEnvelopeSig,
      // Primary actions by phase.
    // Raw (unsimulated) contract invoke: Simulate (primary) + Sign Envelope (also useful).
    // Re-simulate only after a real simulation (has resources or auth).
      showSimulate: phase === "needs_simulate",
      showReSimulate: Boolean(simulated) && phase !== "needs_simulate",
      showSignAuth: phase === "needs_sign_auth",
      signAuthLabel: involvesCOrAdmin
        ? "Sign Auth (Admin delegate)"
        : "Sign Auth",
      showSignEnvelope:
        phase === "needs_sign_envelope" ||
        (phase === "needs_simulate" && !hasAdminEnvelopeSig),
      showSubmit: phase === "ready_submit",
      adminAddress,
      inheritableAccountId,
    };
  } catch (e) {
    return {
      ok: false,
      error: e.message || String(e),
      phase: "invalid",
      nextStepLabel: PHASE_LABELS.invalid,
      source: null,
      fee: null,
      sequence: null,
      timebounds: null,
      isContractInvoke: false,
      opType: null,
      contractId: null,
      method: null,
      authCount: 0,
      authSubjects: [],
      fullyAuthSigned: false,
      simulated: false,
      hasSorobanResources: false,
      wrapInfo: {
        cRootFound: false,
        cRootWithDelegates: false,
        adminDelegatePresent: false,
      },
      envelopeSigners: [],
      hasAdminEnvelopeSig: false,
      showSimulate: false,
      showReSimulate: false,
      showSignAuth: false,
      signAuthLabel: "Sign Auth",
      showSignEnvelope: false,
      showSubmit: false,
      adminAddress,
      inheritableAccountId,
    };
  }
}

/**
 * Format simulation / host function return value for display.
 * @returns {{ text: string, native: unknown }}
 */
export function formatSimReturnValue(simulation) {
  const retval =
    simulation?.result?.retval ??
    simulation?.returnValue ??
    null;

  if (retval == null) {
    return { text: "(no return value)", native: null };
  }

  try {
    const native = scValToNative(retval);
    if (native === null || native === undefined) {
      return { text: "null", native };
    }
    if (typeof native === "string" || typeof native === "number" || typeof native === "boolean") {
      return { text: String(native), native };
    }
    if (typeof native === "bigint") {
      return { text: native.toString(), native };
    }
    // Buffer / Uint8Array
    if (native instanceof Uint8Array || Buffer.isBuffer?.(native)) {
      const buf = Buffer.from(native);
      return { text: `0x${buf.toString("hex")}`, native };
    }
    return {
      text: JSON.stringify(
        native,
        (_k, v) => (typeof v === "bigint" ? v.toString() : v),
        2,
      ),
      native,
    };
  } catch {
    try {
      return { text: retval.toXDR?.("base64") ?? String(retval), native: null };
    } catch {
      return { text: String(retval), native: null };
    }
  }
}

/**
 * Simulate and assemble. Returns updated XDR plus formatted call return value.
 * @returns {Promise<{ xdr: string, returnValueText: string, returnValue: unknown }>}
 */
export async function simulateTxXdr(xdrBase64) {
  const { rpc } = getContext();
  const tx = parseTxXdr(xdrBase64);
  if (!extractInvokeInfo(tx).isContractInvoke) {
    throw new Error("Simulation requires a Soroban invokeHostFunction transaction");
  }

  const simulation = await rpc.simulateTransaction(tx);
  if (Api.isSimulationError(simulation)) {
    throw new Error(simulation.error || "simulation failed");
  }
  if (Api.isSimulationRestore(simulation)) {
    throw new Error(
      "Contract state needs restore before this transaction can be simulated successfully",
    );
  }

  const { text: returnValueText, native: returnValue } = formatSimReturnValue(simulation);
  const assembled = assembleTransaction(tx, simulation).build();
  return {
    xdr: txToXdr(assembled),
    returnValueText,
    returnValue,
  };
}

/**
 * CAP-71 wrap + sign admin delegate only (InheritableAccount root stays Void).
 * Does NOT call simulate — user runs Simulate separately.
 */
export async function signAuthTxXdr(xdrBase64) {
  const { rpc, config, contractId: contractAccountId } = getContext();
  const keypair = getSessionKeypair();
  const adminAddress = keypair.publicKey();

  let tx = parseTxXdr(xdrBase64);
  if (!extractInvokeInfo(tx).isContractInvoke) {
    throw new Error("Sign Auth requires a Soroban invokeHostFunction transaction");
  }

  const authBefore = getInvokeHostFunctionAuth(tx);
  if (!authBefore.length) {
    throw new Error("No auth entries on this XDR. Run Simulate first.");
  }
  if (!hasSorobanResources(tx)) {
    throw new Error("Transaction has no Soroban resources. Run Simulate first.");
  }

  const latest = await rpc.getLatestLedger();
  const expiration = latest.sequence + 60;

  wrapContractAccountDelegates(tx, contractAccountId, adminAddress, expiration);
  tx = bakeInvokeAuth(tx, config.networkPassphrase);

  const subjects = collectUnsignedAuthSubjects(tx);
  if (subjects.length === 0) {
    // Already fully signed after wrap bake (unlikely) — return baked XDR
    return txToXdr(tx);
  }

  const authEntries = getInvokeHostFunctionAuth(tx);
  const signOpts = {
    keypair,
    expiration,
    networkPassphrase: config.networkPassphrase,
  };

  for (const { entryIndex, address } of subjects) {
    if (address.startsWith("G") && address !== adminAddress) {
      throw new Error(
        `Auth requires ${address} but the session key is ${adminAddress}. Unlock the matching admin account.`,
      );
    }
    if (address.startsWith("C")) {
      throw new Error(
        `Auth still requires contract account ${address}; pure-delegation expects only the admin delegate after CAP-71 wrap.`,
      );
    }

    authEntries[entryIndex] = await signAuthNode(
      authEntries[entryIndex],
      address,
      signOpts,
    );
  }

  tx = bakeInvokeAuth(tx, config.networkPassphrase);

  const remaining = collectUnsignedAuthSubjects(tx);
  if (remaining.length > 0) {
    throw new Error(
      `Missing auth signatures for: ${remaining.map((s) => s.address).join(", ")}`,
    );
  }

  return txToXdr(tx);
}

export function signEnvelopeTxXdr(xdrBase64) {
  const keypair = getSessionKeypair();
  const adminHint = keypair.signatureHint();

  const tx = parseTxXdr(xdrBase64);
  const already = (tx.signatures ?? []).some((sig) => hintsEqual(sig.hint(), adminHint));
  if (already) {
    throw new Error("Envelope already includes the admin signature");
  }

  tx.sign(keypair);
  return txToXdr(tx);
}

/**
 * Submit a fully signed transaction envelope and poll for completion.
 */
export async function submitTxXdr(xdrBase64) {
  const { rpc, config } = getContext();
  const tx = parseTxXdr(xdrBase64);

  const sendResp = await rpc.sendTransaction(tx);
  if (sendResp.status === "ERROR" || sendResp.status === "DUPLICATE") {
    const errXdr = sendResp.errorResult?.result?.()
      ? String(sendResp.errorResult.result())
      : sendResp.errorResultXdr || "";
    throw new Error(
      `Submit failed with status ${sendResp.status}${errXdr ? `: ${errXdr}` : ""}`,
    );
  }

  const hash = sendResp.hash;
  const deadline = Date.now() + 60_000;
  let last = null;

  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 1500));
    // eslint-disable-next-line no-await-in-loop
    last = await rpc.getTransaction(hash);
    if (last.status === Api.GetTransactionStatus.SUCCESS) {
      const { text: returnValueText, native: returnValue } = formatSimReturnValue({
        returnValue: last.returnValue ?? null,
      });
      return {
        hash,
        status: "SUCCESS",
        resultXdr: last.resultXdr ?? null,
        returnValue,
        returnValueText,
        networkPassphrase: config.networkPassphrase,
      };
    }
    if (last.status === Api.GetTransactionStatus.FAILED) {
      throw new Error(
        `Transaction failed on network (hash ${hash}). resultXdr=${last.resultXdr || "n/a"}`,
      );
    }
  }

  return {
    hash,
    status: last?.status || "PENDING",
    message: "Submitted; confirmation still pending after timeout. Check explorer with hash.",
    networkPassphrase: config.networkPassphrase,
  };
}

export async function copyTextToClipboard(text) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.style.position = "fixed";
  el.style.left = "-9999px";
  document.body.appendChild(el);
  el.select();
  document.execCommand("copy");
  document.body.removeChild(el);
}
