import { Horizon } from "@stellar/stellar-sdk";
import { Server as RpcServer } from "@stellar/stellar-sdk/rpc";
import { configureProxy, installProxyFetch } from "./proxy.js";

let ctx = null;

export function initStellarContext(config) {
  configureProxy(config.proxy);
  installProxyFetch();

  const rpc = new RpcServer(config.rpcUrl, { allowHttp: true });
  const horizon = new Horizon.Server(config.horizonUrl);

  ctx = {
    config,
    rpc,
    horizon,
    contractId: config.inheritableAccountContractId,
  };
  return ctx;
}

export function getContext() {
  if (!ctx) throw new Error("Stellar context not initialized");
  return ctx;
}

export function resetContext() {
  ctx = null;
}