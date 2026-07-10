import { invoke } from "@tauri-apps/api/core";

let proxyUrl = "";
let originalFetch = null;

export function configureProxy(url) {
  proxyUrl = url?.trim() || "";
}

export function getProxyUrl() {
  return proxyUrl;
}

async function tauriFetch(url, init = {}) {
  const method = init.method || "GET";
  const headers = {};
  if (init.headers) {
    const h = init.headers;
    if (h instanceof Headers) {
      h.forEach((v, k) => { headers[k] = v; });
    } else if (Array.isArray(h)) {
      for (const [k, v] of h) headers[k] = v;
    } else {
      Object.assign(headers, h);
    }
  }
  let body;
  if (init.body) {
    body = typeof init.body === "string" ? init.body : await new Response(init.body).text();
  }

  const resp = await invoke("http_fetch", {
    url: String(url),
    method,
    headers,
    body: body ?? null,
    proxy: proxyUrl || null,
  });

  return new Response(resp.body, {
    status: resp.status,
    headers: resp.headers,
  });
}

export function installProxyFetch() {
  if (!proxyUrl) return;
  if (!originalFetch) {
    originalFetch = globalThis.fetch.bind(globalThis);
  }
  globalThis.fetch = (url, init) => {
    if (proxyUrl) return tauriFetch(url, init);
    return originalFetch(url, init);
  };
}