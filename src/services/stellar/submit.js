import {
  Address,
  authorizeEntry,
  BASE_FEE,
  buildWithDelegatesEntry,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { AssembledTransaction } from "@stellar/stellar-sdk/contract";
import { Api } from "@stellar/stellar-sdk/rpc";
import { getContext } from "./context.js";
import { getSessionSigner } from "./signer.js";
import { getSessionKeypair } from "../session.js";

export const MAX_AUTH_ROUNDS = 8;
export const DEFAULT_TX_TIMEOUT = 300;

/**
 * stellar-sdk's AssembledTransaction.sign() passes `fee: this.built.fee` into
 * cloneFrom, but built.fee already includes resourceFee from simulate(). build()
 * then adds resourceFee again, which can exceed the protocol uint32 fee cap.
 */
async function signAssembledTransaction(tx, signTransaction, networkPassphrase) {
  if (!tx.built) {
    throw new Error("Transaction has not yet been simulated");
  }

  const timeoutInSeconds = tx.options?.timeoutInSeconds ?? DEFAULT_TX_TIMEOUT;
  const absoluteBounds = tx.options?.timebounds;
  let builder = TransactionBuilder.cloneFrom(tx.built, {
    sorobanData: tx.simulationData.transactionData,
    networkPassphrase,
    // cloneFrom copies existing timebounds; clear so setTimeout/setTimebounds can refresh
    timebounds: undefined,
  });

  if (absoluteBounds && absoluteBounds.maxTime != null) {
    builder = builder.setTimebounds(
      Number(absoluteBounds.minTime ?? 0),
      Number(absoluteBounds.maxTime),
    );
  } else {
    builder = builder.setTimeout(timeoutInSeconds);
  }

  const rebuilt = builder.build();

  const { signedTxXdr: signature, error } = await signTransaction(rebuilt.toXDR(), {
    networkPassphrase,
  });
  if (error) {
    throw new Error(error.message || String(error));
  }

  tx.signed = TransactionBuilder.fromXDR(signature, networkPassphrase);
}

export function assertSimulation(tx) {
  if (!tx.simulation || Api.isSimulationError(tx.simulation)) {
    throw new Error(tx.simulation?.error || "simulation missing");
  }
}

export function isUnsignedSignature(signature) {
  return signature.switch().name === "scvVoid";
}

export function getInvokeHostFunctionAuth(txOrBuilt) {
  const built = txOrBuilt?.built ?? txOrBuilt;
  if (!built || !("operations" in built)) return [];
  const op = built.operations[0];
  return op.auth ?? [];
}

export function getRootAddress(credentials) {
  switch (credentials.switch().name) {
    case "sorobanCredentialsAddress":
      return Address.fromScAddress(credentials.address().address()).toString();
    case "sorobanCredentialsAddressV2":
      return Address.fromScAddress(credentials.addressV2().address()).toString();
    case "sorobanCredentialsAddressWithDelegates":
      return Address.fromScAddress(
        credentials.addressWithDelegates().addressCredentials().address(),
      ).toString();
    default:
      return null;
  }
}

function addAuthNode(subjects, seen, entryIndex, address, signature, { unsignedOnly }) {
  if (unsignedOnly && !isUnsignedSignature(signature)) return;
  const key = `${entryIndex}:${address}`;
  if (seen.has(key)) return;
  seen.add(key);
  subjects.push({
    entryIndex,
    address,
    signed: !isUnsignedSignature(signature),
  });
}

/**
 * Collect auth credential nodes (optionally only unsigned), including CAP-71 delegates.
 * @param {import("@stellar/stellar-sdk/contract").AssembledTransaction|import("@stellar/stellar-sdk").Transaction} txOrBuilt
 */
export function collectAuthSubjects(txOrBuilt, { unsignedOnly = true } = {}) {
  const authEntries = getInvokeHostFunctionAuth(txOrBuilt);
  const subjects = [];
  const seen = new Set();

  const walkDelegates = (entryIndex, delegates) => {
    for (const delegate of delegates) {
      const addr = Address.fromScAddress(delegate.address()).toString();
      addAuthNode(subjects, seen, entryIndex, addr, delegate.signature(), { unsignedOnly });
      walkDelegates(entryIndex, delegate.nestedDelegates());
    }
  };

  for (const [entryIndex, entry] of authEntries.entries()) {
    const credentials = entry.credentials();
    switch (credentials.switch().name) {
      case "sorobanCredentialsAddress": {
        const addrAuth = credentials.address();
        addAuthNode(
          subjects,
          seen,
          entryIndex,
          Address.fromScAddress(addrAuth.address()).toString(),
          addrAuth.signature(),
          { unsignedOnly },
        );
        break;
      }
      case "sorobanCredentialsAddressV2": {
        const addrAuth = credentials.addressV2();
        addAuthNode(
          subjects,
          seen,
          entryIndex,
          Address.fromScAddress(addrAuth.address()).toString(),
          addrAuth.signature(),
          { unsignedOnly },
        );
        break;
      }
      case "sorobanCredentialsAddressWithDelegates": {
        const withDelegates = credentials.addressWithDelegates();
        const root = withDelegates.addressCredentials();
        const rootAddr = Address.fromScAddress(root.address()).toString();
        // CAP-71 pure-delegation custom accounts (InheritableAccount): root
        // signature stays Void — only delegates need signatures.
        if (rootAddr.startsWith("C")) {
          if (!unsignedOnly) {
            const key = `${entryIndex}:${rootAddr}`;
            if (!seen.has(key)) {
              seen.add(key);
              subjects.push({
                entryIndex,
                address: rootAddr,
                signed: true, // Void is the expected final root signature
              });
            }
          }
        } else {
          addAuthNode(
            subjects,
            seen,
            entryIndex,
            rootAddr,
            root.signature(),
            { unsignedOnly },
          );
        }
        walkDelegates(entryIndex, withDelegates.delegates());
        break;
      }
      default:
        break;
    }
  }

  return subjects;
}

/** Collect unsigned credential nodes, including nested CAP-71 delegates. */
export function collectUnsignedAuthSubjects(txOrBuilt) {
  return collectAuthSubjects(txOrBuilt, { unsignedOnly: true });
}

/**
 * Simulation never emits AddressWithDelegates — the client must wrap C-account
 * entries with the admin delegate before signing (CAP-71-01).
 */
export function wrapContractAccountDelegates(txOrBuilt, contractAccountId, adminAddress, expiration) {
  const authEntries = getInvokeHostFunctionAuth(txOrBuilt);

  for (let i = 0; i < authEntries.length; i++) {
    const entry = authEntries[i];
    const credentials = entry.credentials();
    const credType = credentials.switch().name;

    if (
      credType !== "sorobanCredentialsAddress" &&
      credType !== "sorobanCredentialsAddressV2"
    ) {
      continue;
    }

    const rootAddress = getRootAddress(credentials);
    if (rootAddress !== contractAccountId) continue;

    authEntries[i] = buildWithDelegatesEntry({
      entry,
      validUntilLedgerSeq: expiration,
      delegates: [{ address: adminAddress }],
    });
  }
}

/**
 * Sign one auth credential node (admin G-account or other non-pure-delegation address).
 * Pure-delegation C-account roots keep Void and are never signed here.
 */
export async function signAuthNode(
  entry,
  forAddress,
  { keypair, expiration, networkPassphrase },
) {
  if (forAddress.startsWith("C")) {
    throw new Error(
      `Pure-delegation custom account ${forAddress} does not take a root signature; sign the admin delegate only.`,
    );
  }
  return authorizeEntry(entry, keypair, expiration, networkPassphrase, forAddress);
}

/**
 * Multi-round auth signing for AssembledTransaction (mutates tx.built auth, re-simulates).
 * Wraps C-account roots as CAP-71 WithDelegates, then signs admin delegate only
 * (InheritableAccount root signature stays Void).
 */
export async function signAllRequiredAuthEntries(tx, { contractAccountId, adminAddress }) {
  const { config } = getContext();
  const keypair = getSessionKeypair();
  const sessionPublicKey = keypair.publicKey();

  if (adminAddress !== sessionPublicKey) {
    throw new Error(
      `Session key ${sessionPublicKey} does not match admin ${adminAddress}. Unlock the admin account.`,
    );
  }

  let expiration = tx.simulation.latestLedger + 60;
  wrapContractAccountDelegates(tx, contractAccountId, adminAddress, expiration);

  for (let round = 0; round < MAX_AUTH_ROUNDS; round++) {
    const subjects = collectUnsignedAuthSubjects(tx);
    if (subjects.length === 0) break;

    const authEntries = getInvokeHostFunctionAuth(tx);
    const signOpts = {
      keypair,
      expiration,
      networkPassphrase: config.networkPassphrase,
    };

    for (const { entryIndex, address } of subjects) {
      if (address.startsWith("G") && address !== sessionPublicKey) {
        throw new Error(
          `Auth requires ${address} but the session key is ${sessionPublicKey}. Unlock the matching admin account.`,
        );
      }

      authEntries[entryIndex] = await signAuthNode(
        authEntries[entryIndex],
        address,
        signOpts,
      );
    }

    await tx.simulate();

    if (tx.simulation && !Api.isSimulationError(tx.simulation)) {
      expiration = tx.simulation.latestLedger + 60;
    }

    if (collectUnsignedAuthSubjects(tx).length === 0) {
      if (tx.simulation && Api.isSimulationError(tx.simulation)) {
        throw new Error(tx.simulation.error || "simulation failed after auth signing");
      }
      return;
    }
  }

  const remaining = collectUnsignedAuthSubjects(tx);
  if (remaining.length > 0) {
    throw new Error(
      `Missing auth signatures for: ${remaining.map((s) => s.address).join(", ")}`,
    );
  }

  assertSimulation(tx);
}

/**
 * @param {object} opts
 * @param {number} [opts.timeoutInSeconds] relative validity (default DEFAULT_TX_TIMEOUT)
 * @param {{ minTime: number|string, maxTime: number|string }} [opts.timebounds] absolute window (wins over timeout)
 */
export async function buildSimulatedTx({
  contractId,
  method,
  args,
  publicKey,
  parseResultXdr,
  timeoutInSeconds,
  timebounds,
}) {
  const { config } = getContext();
  const relativeTimeout =
    timebounds == null
      ? (timeoutInSeconds ?? DEFAULT_TX_TIMEOUT)
      : Math.max(
          1,
          Number(timebounds.maxTime) - Math.floor(Date.now() / 1000),
        );

  const tx = await AssembledTransaction.build({
    contractId,
    method,
    args,
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.rpcUrl,
    publicKey,
    fee: BASE_FEE,
    parseResultXdr: parseResultXdr ?? ((r) => r),
    timeoutInSeconds: relativeTimeout,
  });
  assertSimulation(tx);

  if (timebounds && tx.built) {
    const minTime = Number(timebounds.minTime ?? 0);
    const maxTime = Number(timebounds.maxTime);
    tx.built = TransactionBuilder.cloneFrom(tx.built, {
      sorobanData: tx.simulationData.transactionData,
      networkPassphrase: config.networkPassphrase,
      timebounds: undefined,
    })
      .setTimebounds(minTime, maxTime)
      .build();
    tx.options.timebounds = { minTime, maxTime };
    // Prefer absolute bounds on later envelope re-sign
    delete tx.options.timeoutInSeconds;
  } else {
    tx.options.timeoutInSeconds = relativeTimeout;
  }

  return tx;
}

/**
 * simulate → wrap CAP-71 delegate tree → sign admin delegate only → send
 */
export async function signAndSubmitTx(tx, { authContractId } = {}) {
  const { config } = getContext();
  const feeSigner = getSessionSigner(config.networkPassphrase);
  const adminAddress = getSessionKeypair().publicKey();

  const unsigned = collectUnsignedAuthSubjects(tx);

  if (authContractId && unsigned.length > 0) {
    await signAllRequiredAuthEntries(tx, {
      contractAccountId: authContractId,
      adminAddress,
    });
  } else if (unsigned.length > 0) {
    throw new Error(
      `Missing auth signatures for: ${unsigned.map((s) => s.address).join(", ")}`,
    );
  }

  const remaining = collectUnsignedAuthSubjects(tx);
  if (remaining.length > 0) {
    throw new Error(`Missing signatures for: ${remaining.map((s) => s.address).join(", ")}`);
  }

  if (tx.isReadCall) {
    throw new Error("This is a read-only call and cannot be submitted.");
  }

  await signAssembledTransaction(tx, feeSigner.signTransaction, config.networkPassphrase);
  const sent = await tx.send();
  if (sent.error) throw new Error(sent.error.message || String(sent.error));
  return sent;
}

export async function submitContractCall({
  contractId,
  method,
  args,
  publicKey,
  parseResultXdr,
  timeoutInSeconds,
  timebounds,
}) {
  const tx = await buildSimulatedTx({
    contractId,
    method,
    args,
    publicKey,
    parseResultXdr,
    timeoutInSeconds,
    timebounds,
  });
  return signAndSubmitTx(tx);
}

export async function submitAsContractAccount({
  targetContractId,
  method,
  args,
  publicKey,
  contractAccountId,
  parseResultXdr,
  timeoutInSeconds,
  timebounds,
}) {
  const tx = await buildSimulatedTx({
    contractId: targetContractId,
    method,
    args,
    publicKey,
    parseResultXdr,
    timeoutInSeconds,
    timebounds,
  });

  if (tx.isReadCall) {
    return { mode: "simulate", result: tx.result };
  }

  const sent = await signAndSubmitTx(tx, { authContractId: contractAccountId });
  return { mode: "submit", ...sent };
}
