import { BASE_FEE, TransactionBuilder } from "@stellar/stellar-sdk";
import { scValToNative } from "@stellar/stellar-sdk";
import { AssembledTransaction } from "@stellar/stellar-sdk/contract";
import { getContext } from "./context.js";
import { DEFAULT_TX_TIMEOUT, submitAsContractAccount } from "./submit.js";
import { formatMethodResult } from "./contractSpec.js";

export async function invokeAsContractAccount({
  targetContractId,
  method,
  args,
  signerPublicKey,
  feePayerPublicKey,
  spec,
  timeoutInSeconds,
  timebounds,
}) {
  const { contractId } = getContext();
  const outcome = await submitAsContractAccount({
    targetContractId,
    method,
    args,
    publicKey: feePayerPublicKey,
    contractAccountId: contractId,
    parseResultXdr: scValToNative,
    timeoutInSeconds,
    timebounds,
  });

  if (outcome.mode === "simulate") {
    const result = spec
      ? formatMethodResult(spec, method, outcome.result)
      : outcome.result;
    return { mode: "simulate", result };
  }

  return outcome;
}

/**
 * Build a raw (unsimulated) invoke envelope XDR for export.
 * No RPC simulate — no auth entries, no resource footprint.
 */
export async function buildInvokeXdr({
  targetContractId,
  method,
  args,
  publicKey,
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

  const assembled = await AssembledTransaction.build({
    contractId: targetContractId,
    method,
    args,
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.rpcUrl,
    publicKey,
    fee: BASE_FEE,
    parseResultXdr: (r) => r,
    timeoutInSeconds: relativeTimeout,
    simulate: false,
  });

  if (!assembled.raw) {
    throw new Error("Failed to assemble raw transaction");
  }

  let built = assembled.raw.build();

  if (timebounds) {
    const minTime = Number(timebounds.minTime ?? 0);
    const maxTime = Number(timebounds.maxTime);
    built = TransactionBuilder.cloneFrom(built, {
      networkPassphrase: config.networkPassphrase,
      timebounds: undefined,
    })
      .setTimebounds(minTime, maxTime)
      .build();
  }

  return {
    xdr: built.toEnvelope().toXDR("base64"),
  };
}
