# Inheritable Account UX

**Inheritable Account UX** is a desktop app for managing an [Inheritable Account](https://github.com/celestialkylin/StellarInheritableAccount) on [Stellar](https://stellar.org/).

It is the day-to-day client for the smart-account contract: unlock your key, watch inactivity, name heirs, keep encrypted notes, send assets, and invoke other contracts **as the account**—without building transactions by hand.

**Build status:** Desktop builds have been built and tested. Mobile builds have **not** been built or tested.

| | |
|---|---|
| License | [AGPL-3.0-or-later](LICENSE) |
| Companion contract | [StellarInheritableAccount](https://github.com/celestialkylin/StellarInheritableAccount) |

## Who it is for

| Role | What you do in this app |
|------|-------------------------|
| **Admin** | Full workspace: account info, operations, signing tools, candidates, and encrypted notes. |
| **Candidate (heir)** | Unlock with your key, see waiting time and inactivity, and **claim admin** when eligible. |

This build is **admin-oriented**. Candidate mode focuses on succession status and claiming. It does **not** include a notes viewer for heirs (see [Encrypted notes](#encrypted-notes) below).

You might use this if you want:

- A practical UI for an account that can pass to people you choose after a waiting period of inactivity.
- Private notes that stay encrypted on the public ledger.

## How the pieces fit together

| Piece | Role |
|-------|------|
| **[StellarInheritableAccount](https://github.com/celestialkylin/StellarInheritableAccount)** (contract) | On-chain rules: admin, candidates, waiting times, claim/transfer, note ciphertext storage. |
| **This app ([StellarInheritableAccountUX](https://github.com/celestialkylin/StellarInheritableAccountUX))** | Desktop client: unlock, manage heirs and notes, send assets, invoke contracts, claim when ready. |

## Account private key (import and export)

The app does **not** ship your Stellar secret in plaintext. Signing material is kept as **password-encrypted** ciphertext (`sc.txt` in the project, or `sc.enc` in app data).

You can:

1. **Import** a Stellar secret key (`S…`) or an existing encrypted hex blob. Secrets you paste are encrypted with a password before they are saved.
2. **Export** the encrypted file (for example **Export sc.enc** on the unlock screen when using app-data storage).
3. **Distribute** that encrypted file **with the app** to a designated heir so they can keep a backup offline—or let a candidate **provide their own** key, import it, and register that public key on chain as a candidate.

Treat the encrypted file **and** the password as high-value secrets. Anyone with both can unlock the key. Sharing only the encrypted file without the password is safer than sharing a raw `S…` secret, but it is still sensitive.

## Encrypted notes

Notes (short summaries and longer bodies) are stored on chain as **ciphertext only**. Encryption and decryption use **[StellarRecrypt](https://github.com/celestialkylin/StellarRecrypt)** (proxy re-encryption) in the Tauri client.

**Key model**

- Notes are encrypted to the admin’s **PRE public key** (`pre_pk`), derived via HKDF from their Stellar **`S…` seed**—not from the public `G…` address.
- Only the holder of that secret can decrypt original note ciphertext.
- When you add a candidate, the app stores a **re-encryption key** (`migration_data`) on chain: admin `pre_sk` + candidate **`G…`**. A proxy (or the heir’s client) can re-encrypt notes for that heir without learning plaintext; the heir decrypts re-encrypted data with their **`S…`**.
- After admin **claim** or **transfer**, the new admin migrates **notes only** (re-encrypt → decrypt as heir → re-wrap under the new admin’s `pre_pk`). The contract also **clears remaining candidates’** `migration_data` so the new admin can review who should stay eligible, then re-publish PRE keys via **Candidates → Re-sync All PRE Keys**.
- **Transfer admin** requires the target to already be a registered candidate **with** valid `migration_data`; the app blocks transfer when PRE keys are missing.

- **Admin** can create and read notes in the **Notes** tab while controlling the account.
- Provisioned candidates can **in principle** decrypt notes (with `migration_data` + their secret) without claiming—this UI has no notes viewer in candidate mode.
- Raw note bytes on the public ledger are not human-readable; privacy depends on encryption, not on hiding data from the network.

**Who can decrypt**

| Party | Can decrypt notes? | In this app |
|-------|--------------------|-------------|
| **Admin** | Yes (with their `S…`) | **Notes** tab: view and edit |
| **Provisioned candidates** | Yes, in principle (`migration_data` + their `S…`) | **No notes UI** in candidate mode—only succession info and claim |

**Collusion note:** This is single-hop PRE. A candidate who holds both the on-chain re-encryption key and their own `S…` can recover the admin’s **note** PRE key (`pre_sk`), not the admin’s signing seed / funds. Treat provisioning an heir as granting note access for that admin epoch.

Anyone can fetch the ciphertext from the network; plaintext is meant for the admin and for **heirs you have already provisioned**.

## What’s in the app

After unlock as **admin**, the main sections are:

| Section | Purpose |
|---------|---------|
| **Info** | Current admin, inactivity, candidates, and balances for assets listed in config. |
| **Operations** | Send assets, and **Contract Method Invoke** (load a contract’s methods, fill arguments, simulate or submit as the inheritable account). |
| **Signing** | Paste transaction XDR to inspect, sign, simulate, or submit. |
| **Candidates** | Add, update, or remove heirs; set each waiting time; provision / re-sync PRE re-encryption keys. |
| **Notes** | List, open, create, and update encrypted notes. |

As a **candidate**, unlock shows your waiting time, current inactivity, time remaining until claim, and a **Claim Admin** action when the threshold is met.

### Operations → Contract Method Invoke → contract aliases

Under **Operations**, **Contract Method Invoke** lets you target any Soroban contract (`C…`), load its public methods, fill parameters (form or JSON), and simulate or invoke **as the inheritable account**.

You can **Save Template** / **Load Template** (desktop app) so common argument sets are reusable. Templates are stored under a templates root directory (`templatesDir` in config, or the app data folder `invoke-templates` by default).

**Contract aliases** keep those folders readable:

- By default, templates for a contract live under a directory named with the full contract id (`C…`).
- If you save or load a template under a **friendly directory name** (for example `my-token` instead of the long `C…` id), the app records that name in `contract-aliases.json` as a **contract alias** for that id.
- Later template operations for the same contract prefer the alias directory, so your invoke templates stay organized by human-readable names.

## Typical flows

**Admin**

1. Point `config.json` at your network and Inheritable Account contract id (see [CONFIG.md](CONFIG.md)).
2. Open the app and unlock with the password for your encrypted key file.
3. Add candidates and waiting times; write any notes you want heirs to be able to decrypt.
4. Keep using the account when you are active so the succession clock does not run out by accident.
5. Optionally export the encrypted key for offline safekeeping or for an heir who should hold a copy.

**Candidate (heir)**

1. Unlock with **your** key (you should already be registered as a candidate).
2. Check inactivity and whether you can claim yet.
3. When the waiting time is met, **Claim Admin**—no action required from the previous admin.
4. After a successful claim you become admin; the app completes any pending **note** migration. Remaining candidates keep their places but lose PRE keys—review the list and re-sync migration data before treating them as provisioned again.

## Things to keep in mind

- **Experimental software.** Do not rely on it alone for critical estate planning or large sums without your own review and backups.
- **Not a legal will.** On-chain succession is a technical mechanism; laws and family agreements are separate.
- **Naming an heir is meaningful.** A provisioned candidate is meant to be able to decrypt notes even before they claim—even if this app’s candidate screen does not show notes.
- **Stay active if you want to remain admin.** Successful admin use resets the inactivity timer on the contract.
- **Back up carefully.** Keep copies of your encrypted key file and a way to recover the password; losing both means losing control of the key material you entrusted to this app.

## Getting started

**Requirements (typical):** recent Node.js, [pnpm](https://pnpm.io/), Rust toolchain, and [Tauri 2](https://v2.tauri.app/) platform dependencies for your OS.

```bash
pnpm install
# Edit config.json / public/config.json — see CONFIG.md
pnpm tauri dev
```

Network endpoints, contract id, assets, proxy, and template directory are described in **[CONFIG.md](CONFIG.md)**.

Build a release package with `pnpm tauri build` when you are ready to distribute the app (together with config and, if appropriate, an encrypted key file for the intended operator—never a plaintext secret).

## License

Copyright (C) 2026 InheritableAccountUX contributors

This project is licensed under the **GNU Affero General Public License v3.0 or later** ([AGPL-3.0-or-later](https://spdx.org/licenses/AGPL-3.0-or-later.html)).

You may use, share, and modify it under those terms. If you run a modified version as a network service that users interact with remotely, AGPL requires you to offer them the corresponding source (see the license text for the exact conditions).

See the [`LICENSE`](LICENSE) file, or <https://www.gnu.org/licenses/>.

## Third-party software

This application incorporates open-source components, including **[StellarRecrypt](https://github.com/celestialkylin/StellarRecrypt)** (MIT OR Apache-2.0; proxy re-encryption), the **Stellar** JavaScript SDK (Apache-2.0), **age-encryption** (BSD-3-Clause), **Tauri** (Apache-2.0 OR MIT), and **React** (MIT).

Attribution and compliance notes are collected in [`NOTICE`](NOTICE). Full license texts for individual packages are available from their upstream projects and, when installed, from package metadata and `src-tauri/Cargo.lock`.
