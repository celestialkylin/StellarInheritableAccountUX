import { AssembledTransaction } from "@stellar/stellar-sdk/contract";
import { Api } from "@stellar/stellar-sdk/rpc";
import { getContext } from "./context.js";
import { getSessionKeypair, getSessionPublicKey } from "../session.js";
import { getSessionSigner } from "./signer.js";
import { requestRestoreConfirm } from "./restoreGate.js";

export class RestoreCancelledError extends Error {
  constructor(message = "Restore cancelled") {
    super(message);
    this.name = "RestoreCancelledError";
  }
}

export function isRestoreNeeded(simulation) {
  return Boolean(simulation && Api.isSimulationRestore(simulation));
}

/** Format stroops (string|number|bigint) as XLM for display. */
export function formatStroopsAsXlm(stroops) {
  const n = BigInt(String(stroops ?? "0"));
  const negative = n < 0n;
  const abs = negative ? -n : n;
  const whole = abs / 10_000_000n;
  const frac = abs % 10_000_000n;
  const fracStr = frac.toString().padStart(7, "0").replace(/0+$/, "");
  const body = fracStr ? `${whole}.${fracStr}` : whole.toString();
  return negative ? `-${body}` : body;
}

export function describeRestore(simulation, { feePayer } = {}) {
  const minResourceFee = simulation?.restorePreamble?.minResourceFee ?? "0";
  return {
    feePayer: feePayer || getSessionPublicKey() || "—",
    minResourceFee: String(minResourceFee),
    feeXlm: formatStroopsAsXlm(minResourceFee),
  };
}

/**
 * Build, sign, and submit a restoreFootprint transaction from simulation preamble.
 * @param {object} restorePreamble - simulation.restorePreamble
 * @param {{ publicKey?: string }} [opts]
 */
export async function executeRestore(restorePreamble, { publicKey } = {}) {
  if (!restorePreamble?.transactionData) {
    throw new Error("Missing restore preamble (transactionData)");
  }

  const { config } = getContext();
  const keypair = getSessionKeypair();
  const feePayer = publicKey || keypair.publicKey();
  if (feePayer !== keypair.publicKey()) {
    throw new Error(
      `Restore fee payer ${feePayer} does not match session key ${keypair.publicKey()}`,
    );
  }

  const signer = getSessionSigner(config.networkPassphrase);
  const options = {
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.rpcUrl,
    publicKey: feePayer,
    signTransaction: signer.signTransaction,
    timeoutInSeconds: 120,
  };

  // Account is resolved inside buildFootprintRestoreTransaction via simulate.
  // Pass a placeholder account object only if required; SDK fetches when omitted
  // after we provide publicKey — use getAccount via Server in restoreFootprint path.
  // buildFootprintRestoreTransaction(options, sorobanData, account, fee) requires account.
  const { rpc } = getContext();
  const account = await rpc.getAccount(feePayer);

  const restoreTx = await AssembledTransaction.buildFootprintRestoreTransaction(
    options,
    restorePreamble.transactionData,
    account,
    restorePreamble.minResourceFee,
  );

  const sent = await restoreTx.signAndSend({ force: true });
  const response = sent.getTransactionResponse;
  if (!response) {
    throw new Error(
      `Restore submitted but no confirmation was returned. ${JSON.stringify(sent.sendTransactionResponse || {})}`,
    );
  }
  if (response.status !== Api.GetTransactionStatus.SUCCESS) {
    throw new Error(
      `Restore transaction failed with status ${response.status}` +
        (response.resultXdr ? `: ${response.resultXdr}` : ""),
    );
  }
  return {
    hash: sent.sendTransactionResponse?.hash ?? response.txHash ?? null,
    status: response.status,
  };
}

/**
 * If simulation needs restore: prompt user, execute restore, return true.
 * If not needed: return false.
 * @returns {Promise<boolean>} whether a restore was performed
 */
export async function promptAndRestoreIfNeeded(simulation, { publicKey } = {}) {
  if (!isRestoreNeeded(simulation)) return false;

  const feePayer = publicKey || getSessionPublicKey();
  if (!feePayer) {
    throw new Error("Unlock required to pay the restore fee");
  }

  const desc = describeRestore(simulation, { feePayer });
  const ok = await requestRestoreConfirm({
    ...desc,
    performRestore: () =>
      executeRestore(simulation.restorePreamble, { publicKey: feePayer }),
  });
  if (!ok) {
    throw new RestoreCancelledError();
  }
  return true;
}

/**
 * Run an AssembledTransaction builder; if restore is required, confirm + restore once and rebuild.
 * @param {() => Promise<import("@stellar/stellar-sdk/contract").AssembledTransaction>} buildFn
 * @param {{ publicKey?: string }} [opts]
 */
export async function ensureAssembledSimReady(buildFn, { publicKey } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const tx = await buildFn();
    const sim = tx.simulation;

    if (!sim || Api.isSimulationError(sim)) {
      throw new Error(sim?.error || "simulation missing");
    }

    if (!isRestoreNeeded(sim)) {
      return tx;
    }

    if (attempt === 1) {
      throw new Error(
        "Still needs restore after a successful restore transaction. Try again later.",
      );
    }

    await promptAndRestoreIfNeeded(sim, { publicKey });
  }

  throw new Error("ensureAssembledSimReady: unreachable");
}

/**
 * Simulate a classic Transaction; handle restore once, then return a non-restore simulation.
 * @param {import("@stellar/stellar-sdk").Transaction} tx
 * @param {{ publicKey?: string }} [opts]
 */
export async function ensureRpcSimReady(tx, { publicKey } = {}) {
  const { rpc } = getContext();

  for (let attempt = 0; attempt < 2; attempt++) {
    const simulation = await rpc.simulateTransaction(tx);

    if (Api.isSimulationError(simulation)) {
      throw new Error(simulation.error || "simulation failed");
    }

    if (!isRestoreNeeded(simulation)) {
      return simulation;
    }

    if (attempt === 1) {
      throw new Error(
        "Still needs restore after a successful restore transaction. Try again later.",
      );
    }

    await promptAndRestoreIfNeeded(simulation, { publicKey });
  }

  throw new Error("ensureRpcSimReady: unreachable");
}
