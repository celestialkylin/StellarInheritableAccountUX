# config.json Reference

This document describes every field of the `config.json` file loaded at startup by InheritableAccountUX, including validation rules and examples.

Implementation references: `src/services/config.js` (load / validate), `src/services/stellar/context.js` (network context), `src/services/stellar/sep41.js` (asset resolution), `src/services/invokeTemplates.js` (template directory).

> **Note:** Standard JSON does **not** allow comments. Examples below that use `//` are documentation-only. Real config files must be valid JSON (see the repo root and `public/config.json`).

---

## 1. File location and load order

| Runtime | Load order |
|---------|------------|
| **Tauri desktop** | Project root `config.json` → `public/config.json` |
| **Web / Vite preview** | HTTP `GET /config.json` (usually `public/config.json`) |

The first candidate that parses and passes `validateConfig` wins. If all fail, the app fails to start.

---

## 2. Full annotated example

Documentation-only example showing every top-level field and all `assets` shapes:

```jsonc
{
  // ---------- Network (required) ----------

  // Horizon REST endpoint. A Horizon.Server is created at startup.
  // Balance / transfers primarily use Soroban RPC; keep this consistent with the network.
  "horizonUrl": "https://horizon-testnet.stellar.org",

  // Soroban JSON-RPC endpoint (contract reads, simulation, submit).
  "rpcUrl": "https://soroban-testnet.stellar.org",

  // Network passphrase; must match horizonUrl / rpcUrl.
  // Testnet: "Test SDF Network ; September 2015"
  // Mainnet: "Public Global Stellar Network ; September 2015"
  "networkPassphrase": "Test SDF Network ; September 2015",

  // ---------- Optional: proxy / secret file / templates ----------

  // HTTP proxy. Empty string or omit = direct connection.
  // When non-empty (Tauri): all fetch goes through Rust http_fetch with this proxy.
  // Example: "http://127.0.0.1:7890"
  "proxy": "",

  // Relative path to the encrypted admin secret file (hex text), from project root.
  // "./sc.txt" or "sc.txt". Empty/omit → fall back to sc.txt then app-data sc.enc.
  // Priority: scTxtPath → project sc.txt → app data sc.enc
  "scTxtPath": "./sc.txt",

  // Root directory for contract invoke templates.
  // Empty/omit → <app data dir>/invoke-templates
  "templatesDir": "",

  // ---------- Contract (required) ----------

  // InheritableAccount contract ID (must start with "C").
  "inheritableAccountContractId": "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",

  // Max encrypted summary+body payload bytes per migrate_notes transaction
  // during admin succession. Packing: fill batches until the next note would
  // exceed this budget; a single note larger than the budget is submitted alone.
  // Optional; omit → 20000. Must be a positive integer if set.
  "migrationNotesBatchMaxBytes": 20000,

  // ---------- Assets (required, at least one) ----------
  // Used for Info balances and Operations transfer dropdown.
  // Asset kind is inferred from fields — there is no `type` field.

  "assets": [
    // 1) Native XLM — no issuer, no contract
    //    Optional: label (recommended: "XLM"), code "XLM"
    //    If code is present but not XLM, it is ignored (still native).
    {
      "label": "XLM"
    },

    // 2) Classic-style asset with issuer + optional SAC contract
    //    issuer must start with "G"; contract (if set) must start with "C".
    //    You may set issuer only, contract only, or both.
    //    With issuer but no contract, `code` is required (SAC is derived at runtime).
    //    When both are set, on-chain calls use the explicit `contract`.
    {
      "code": "USDC",
      "issuer": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      "contract": "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      "label": "USDC"
    },

    // 3) Issuer only (SAC derived from code + issuer + networkPassphrase)
    {
      "code": "USDC",
      "issuer": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      "label": "USDC"
    },

    // 4) Contract only (any SEP-41 / SAC token)
    {
      "contract": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      "label": "Custom Token"
    }
  ]
}
```

---

## 3. Copy-paste valid JSON example

```json
{
  "horizonUrl": "https://horizon-testnet.stellar.org",
  "rpcUrl": "https://soroban-testnet.stellar.org",
  "networkPassphrase": "Test SDF Network ; September 2015",
  "proxy": "",
  "scTxtPath": "./sc.txt",
  "templatesDir": "",
  "inheritableAccountContractId": "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "migrationNotesBatchMaxBytes": 20000,
  "assets": [
    { "label": "XLM" },
    {
      "code": "USDC",
      "issuer": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      "label": "USDC"
    },
    {
      "contract": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      "label": "Custom Token"
    }
  ]
}
```

Replace contract IDs and issuers with values for your network. Validation only checks formats (e.g. `C` / `G` prefixes), not on-chain existence.

---

## 4. Top-level fields

| Field | Type | Required | Default if omit/empty | Description |
|-------|------|----------|------------------------|-------------|
| `horizonUrl` | string | **yes** | — | Horizon REST URL (non-empty after trim) |
| `rpcUrl` | string | **yes** | — | Soroban RPC URL (non-empty after trim) |
| `networkPassphrase` | string | **yes** | — | Must match the network of the endpoints |
| `proxy` | string | no | `""` (direct) | Proxy URL for Tauri `http_fetch` (`reqwest::Proxy::all`); non-empty hijacks global `fetch` in Tauri only |
| `scTxtPath` | string | no | `""` | Relative path (project root) to encrypted secret hex; else `sc.txt` / app-data `sc.enc`. Absolute paths and `..` are rejected |
| `templatesDir` | string | no | `<app data>/invoke-templates` | Absolute (or as-is) root for invoke templates + `contract-aliases.json` |
| `inheritableAccountContractId` | string | **yes** | — | InheritableAccount ID; must start with `C` |
| `migrationNotesBatchMaxBytes` | integer | no | `20000` | Max encrypted summary+body bytes per `migrate_notes` batch during admin succession. Positive integer only; a single note larger than the budget is submitted alone |
| `assets` | array | **yes** | — | Non-empty; see next section |

---

## 5. `assets` entries

`assets` must be a **non-empty array**.

### 5.1 Field summary

| Field | Required when | Description |
|-------|---------------|-------------|
| `label` | optional | Display name (recommended for native: `"XLM"`) |
| `code` | required if `issuer` is set and `contract` is not | Asset code (e.g. `"USDC"`) |
| `issuer` | optional | Classic issuer account; must start with `G` |
| `contract` | optional | SEP-41 / SAC contract ID; must start with `C` |

### 5.2 Inference rules

| Condition | Result |
|-----------|--------|
| No `issuer` and no `contract` | **Native XLM**. If `code` is set and is not `XLM` (case-insensitive), `code` is **ignored**. |
| `issuer` only (no `contract`) | Classic asset; **`code` required**. SAC id = `Asset(code, issuer).contractId(networkPassphrase)`. |
| `contract` only | Use that contract on-chain. |
| Both `issuer` and `contract` | Allowed. **On-chain uses `contract`**. No check that SAC(code, issuer) equals `contract`. |

### 5.3 Examples

```json
{ "label": "XLM" }
```

```json
{
  "code": "USDC",
  "issuer": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  "contract": "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "label": "USDC"
}
```

```json
{
  "code": "USDC",
  "issuer": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  "label": "USDC"
}
```

```json
{
  "contract": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  "label": "My Token"
}
```

### 5.4 Display label priority

Used in balances and the transfer asset dropdown (`displayAssetLabel`):

1. `label` if non-empty  
2. else `code` if non-empty  
3. else shortened `contractId`: first 5 chars + `…` + last 5 chars  
4. else `"Unknown"`  

There is **no** default label of `"XLM"`. Set `"label": "XLM"` for native assets if you want that name in the UI.

---

## 6. Common network passphrases and endpoints

| Network | `networkPassphrase` | Public endpoints (examples) |
|---------|---------------------|-----------------------------|
| Testnet | `Test SDF Network ; September 2015` | Horizon: `https://horizon-testnet.stellar.org`<br>RPC: `https://soroban-testnet.stellar.org` |
| Mainnet | `Public Global Stellar Network ; September 2015` | Horizon: `https://horizon.stellar.org`<br>RPC: `https://rpc.lightsail.network` |

Third-party endpoints (e.g. Validation Cloud) are fine. **`horizonUrl`, `rpcUrl`, `networkPassphrase`, and contract IDs must all be for the same network.**

---

## 7. Optional field details

### 7.1 `proxy`

- Empty / omit: browser/default `fetch` (no hijack)
- Non-empty (**Tauri only**): installs a global `fetch` shim that routes requests through the Rust `http_fetch` command with `reqwest::Proxy::all(...)`
- Typical HTTP local proxy: `http://127.0.0.1:7890`
- Other schemes supported by reqwest (e.g. HTTPS or SOCKS) may work if the URL is valid for `Proxy::all`
- Pure web / Vite preview does **not** apply this proxy path; set the system or browser proxy separately if needed

### 7.2 `scTxtPath` and secret resolution (Tauri)

Resolution order when unlocking on desktop:

1. File at `scTxtPath` (leading `./` stripped; path is **relative to the project root**, parent of `src-tauri`)
2. Project root `sc.txt` (always tried after a configured path, or alone if `scTxtPath` is empty)
3. App private data `sc.enc` (written after UI import / replace)

Path rules for project files (`read_project_file`):

- **Relative only** — absolute paths are rejected
- **No `..` segments** — cannot escape the project root
- Content is expected to be **age ciphertext as hex** (normalized: strip whitespace / optional `0x`). Unlock decrypts with the password in the UI

On **web / Vite** (non-Tauri), `resolveScContent` does not load project files or `sc.enc`; secret import is not available the same way as on desktop.

### 7.3 `templatesDir`

Root for Operations → **Contract Method Invoke** parameter templates (Load / Save Template).

- Empty / omit → `<app_data_dir>/invoke-templates` (from Tauri app data dir)
- Non-empty → used **as-is** (typically an absolute path you choose); not resolved under the project root
- Layout under the root:
  - `{root}/{contractDir}/{method}/…json` for templates
  - `{root}/contract-aliases.json` maps `C…` contract ids → friendly directory names (**contract aliases**). Managed at runtime when you save/load under a friendly folder name — **not** a `config.json` field

---

## 8. Validation errors

| Condition | Error |
|-----------|--------|
| Missing/blank `horizonUrl` | `config: horizonUrl is required` |
| Missing/blank `rpcUrl` | `config: rpcUrl is required` |
| Missing/blank `networkPassphrase` | `config: networkPassphrase is required` |
| Contract ID does not start with `C` (including empty string) | `config: inheritableAccountContractId must be a C... address` |
| `assets` not a non-empty array | `config: assets must be a non-empty array` |
| `assets[i]` not an object | `config: assets[i] must be an object` |
| `issuer` not `G...` | `config: assets[i].issuer must be a G... address` |
| `contract` not `C...` | `config: assets[i].contract must be a C... address` |
| `issuer` without `contract` and without `code` | `config: assets[i] with issuer but no contract requires code` |
| `migrationNotesBatchMaxBytes` set but not a positive integer | `config: migrationNotesBatchMaxBytes must be a positive integer` |
| Web load failure | `Failed to load config.json` |

---

## 9. Minimal valid config

```json
{
  "horizonUrl": "https://horizon-testnet.stellar.org",
  "rpcUrl": "https://soroban-testnet.stellar.org",
  "networkPassphrase": "Test SDF Network ; September 2015",
  "inheritableAccountContractId": "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "assets": [
    { "label": "XLM" }
  ]
}
```

Defaults when omitted:

- `proxy` → direct (no fetch hijack)
- `scTxtPath` → try project `sc.txt`, then app-data `sc.enc`
- `templatesDir` → app data `invoke-templates`
- `migrationNotesBatchMaxBytes` → `20000`

> **Note:** The sample `config.json` / `public/config.json` in the repo may ship with an empty `inheritableAccountContractId`. That is intentional as a template only — validation **rejects** an empty or non-`C…` id, so you must set a real contract id before the app will start.

---

## 10. Mainnet skeleton

```json
{
  "horizonUrl": "https://horizon.stellar.org",
  "rpcUrl": "https://rpc.lightsail.network",
  "networkPassphrase": "Public Global Stellar Network ; September 2015",
  "proxy": "",
  "scTxtPath": "./sc.txt",
  "templatesDir": "",
  "inheritableAccountContractId": "C_YOUR_MAINNET_INHERITABLE_ACCOUNT",
  "migrationNotesBatchMaxBytes": 20000,
  "assets": [
    { "label": "XLM" },
    {
      "code": "USDC",
      "issuer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      "label": "Circle USDC"
    }
  ]
}
```

---

## 11. Related files

| Path | Role |
|------|------|
| `config.json` | Project-root config (preferred by Tauri) |
| `public/config.json` | Static / Web and Tauri fallback |
| `sc.txt` | Encrypted admin secret (hex); path overridable via `scTxtPath` |
| `src/services/config.js` | Load, validate, normalize assets |
| `src/services/stellar/context.js` | RPC / Horizon / proxy from config |
| `src/services/stellar/sep41.js` | Asset → token contract + labels |
| `src/services/invokeTemplates.js` | `templatesDir` storage |

---

## 12. Checklist

1. [ ] `networkPassphrase` matches `horizonUrl` / `rpcUrl`  
2. [ ] `inheritableAccountContractId` is a real `C…` id deployed on that network (not empty)  
3. [ ] Asset `issuer` / `contract` values are for the same network  
4. [ ] Proxy (if any) is reachable from the desktop app  
5. [ ] Secret file exists at `scTxtPath` or `sc.txt`, or `sc.enc` was imported (Tauri)  
6. [ ] `scTxtPath` is relative to project root (no absolute path, no `..`)  
7. [ ] JSON is valid (no trailing commas, no comments)  
8. [ ] Restart the app after editing `config.json` (config is loaded only at startup)  

