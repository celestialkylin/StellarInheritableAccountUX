import { useCallback, useEffect, useMemo, useState } from "react";
import RefreshBar from "../components/RefreshBar.jsx";
import MissingMigrationDataBanner from "../components/MissingMigrationDataBanner.jsx";
import { setCache, useCacheState } from "../services/cache.js";
import { getContext } from "../services/stellar/context.js";
import {
  candidatesMissingMigrationData,
  formatMigrationResult,
  migrateNotesAfterAdminChange,
  readAdminMigrationState,
} from "../services/adminSuccession.js";
import { migrationInProgress } from "../services/crypto/migrationStatus.js";
import { fetchCandidatesData } from "../services/stellar/candidatesList.js";
import {
  checkIn,
  getAdmin,
  getInactiveTime,
  getLastActivity,
  setAdmin,
} from "../services/stellar/inheritable.js";
import {
  formatAmount,
  getBalance,
  getDecimals,
  resolveTokenRef,
} from "../services/stellar/sep41.js";
import { formatDuration } from "../utils/formatDuration.js";

function formatTimestamp(ts) {
  return new Date(Number(ts) * 1000).toLocaleString();
}

async function fetchInfoOnlyData() {
  const { config, contractId } = getContext();
  const [admin, lastActivity, inactiveTime, balances] = await Promise.all([
    getAdmin(),
    getLastActivity(),
    getInactiveTime(),
    Promise.all(
      config.assets.map(async (asset) => {
        const tokenRef = resolveTokenRef(asset, config.networkPassphrase);
        const decimals = await getDecimals(tokenRef);
        const raw = await getBalance(tokenRef, contractId);
        return {
          label: tokenRef.label,
          amount: formatAmount(raw, decimals),
          contractId: tokenRef.contractId,
        };
      }),
    ),
  ]);

  return { admin, lastActivity, inactiveTime, balances };
}

export default function InfoTab({ publicKey, onGoToCandidates, isActive = true }) {
  const [data, meta] = useCacheState("info");
  const [candidatesData] = useCacheState("candidates");
  const candidates = candidatesData?.items ?? [];

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [displayInactive, setDisplayInactive] = useState(data?.inactiveTime ?? 0);
  const [transferAddr, setTransferAddr] = useState("");
  const [migrationPhase, setMigrationPhase] = useState("idle");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [fetched, migrationStatus, candidatesFetched] = await Promise.all([
        fetchInfoOnlyData(),
        readAdminMigrationState(),
        fetchCandidatesData(),
      ]);
      setCache("info", fetched);
      setCache("candidates", candidatesFetched);
      setDisplayInactive(fetched.inactiveTime);
      setMigrationPhase(migrationStatus.phase);
      setTransferAddr((prev) =>
        prev && !candidatesFetched.items.some((c) => c.address === prev) ? "" : prev,
      );
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // First open / after invalidateCache("info"): load when active and not loaded.
  // Tab switches while loaded do not re-fetch. Candidates stay in shared cache.
  useEffect(() => {
    if (isActive && !meta.loaded) refresh();
  }, [isActive, meta.loaded, refresh]);

  useEffect(() => {
    if (!data?.lastActivity) return;
    const baseFetchedAt = meta.fetchedAt || Date.now();
    const baseInactive = Number(data.inactiveTime);
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - baseFetchedAt) / 1000);
      setDisplayInactive(baseInactive + elapsed);
    }, 1000);
    return () => clearInterval(timer);
  }, [data, meta.fetchedAt]);

  // Keep transfer select valid if shared candidates list changes (e.g. remove on Candidates tab).
  useEffect(() => {
    setTransferAddr((prev) =>
      prev && !candidates.some((c) => c.address === prev) ? "" : prev,
    );
  }, [candidates]);

  const selectedCandidate = useMemo(() => {
    if (!transferAddr) return null;
    return candidates.find((c) => c.address === transferAddr) ?? null;
  }, [transferAddr, candidates]);

  const transferBlockedNoPre =
    Boolean(selectedCandidate) && !selectedCandidate.hasPreKey;
  const canTransfer =
    Boolean(selectedCandidate?.hasPreKey) && !loading;

  const showMissingMigrationBanner = candidatesMissingMigrationData(candidates);

  return (
    <div>
      <RefreshBar onRefresh={refresh} loading={loading} fetchedAt={meta.fetchedAt} />
      {error && <div className="error">{error}</div>}
      {success && <div className="success">{success}</div>}
      {showMissingMigrationBanner && (
        <MissingMigrationDataBanner
          onGoToCandidates={onGoToCandidates}
          variant="info"
        />
      )}
      {migrationInProgress({ phase: migrationPhase }) && (
        <div className="warning">
          Admin migration in progress: note re-encryption is pending (batched; safe to
          continue after interruption). The migration key is stored on chain.
          <div className="row-actions mt-075">
            <button
              type="button"
              disabled={loading}
              onClick={async () => {
                setLoading(true);
                setError("");
                setSuccess("");
                try {
                  const result = await migrateNotesAfterAdminChange(publicKey);
                  setSuccess(formatMigrationResult(result));
                  await refresh();
                } catch (e) {
                  setError(e.message || String(e));
                } finally {
                  setLoading(false);
                }
              }}
            >
              Continue / Complete Note Migration
            </button>
          </div>
        </div>
      )}
      {data && (
        <>
          <div className="card">
            <h3>Activity</h3>
            <p><strong>Admin:</strong> {data.admin}</p>
            <p><strong>Last activity:</strong> {formatTimestamp(data.lastActivity)}</p>
            <p>
              <strong>Inactive time:</strong> {formatDuration(displayInactive)}{" "}
              <button
                type="button"
                disabled={loading}
                onClick={async () => {
                  setLoading(true);
                  setError("");
                  setSuccess("");
                  try {
                    await checkIn(publicKey);
                    setSuccess("Check-in submitted. Last activity updated.");
                    await refresh();
                  } catch (e) {
                    setError(e.message || String(e));
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                Check In
              </button>
            </p>
          </div>

          <div className="card">
            <h3>Balances (SEP-41)</h3>
            <table>
              <thead>
                <tr><th>Asset</th><th>Balance</th><th>Token Contract</th></tr>
              </thead>
              <tbody>
                {data.balances.map((b) => (
                  <tr key={b.contractId}>
                    <td>{b.label}</td>
                    <td>{b.amount}</td>
                    <td className="meta">{b.contractId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h3>Candidates</h3>
            {candidates.length === 0 ? (
              <p className="meta">No candidates registered.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Address</th>
                    <th>Waiting Time</th>
                    <th>Time to Claim</th>
                    <th>PRE</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((c) => (
                    <tr key={c.address}>
                      <td>{c.address}</td>
                      <td>{formatDuration(c.waitingTime)}</td>
                      <td>
                        {c.remaining <= 0
                          ? <span className="badge admin">Ready</span>
                          : formatDuration(c.remaining)}
                      </td>
                      <td>
                        {c.hasPreKey
                          ? <span className="badge admin">Set</span>
                          : <span className="meta">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card">
            <h3>Transfer Admin</h3>
            <p className="meta">
              Immediately assign a registered candidate as the new admin. The contract
              uses that candidate&apos;s existing <code>migration_data</code> for note
              re-encryption. Remaining candidates keep their places but lose PRE keys
              until you re-sync them on the Candidates tab.
            </p>
            <label>New Admin (must be a candidate)</label>
            <select
              value={transferAddr}
              onChange={(e) => setTransferAddr(e.target.value)}
              disabled={loading || candidates.length === 0}
            >
              <option value="">— select candidate —</option>
              {candidates.map((c) => (
                <option key={c.address} value={c.address}>
                  {c.address}
                  {c.hasPreKey ? " (PRE set)" : " (no PRE)"}
                </option>
              ))}
            </select>
            {transferBlockedNoPre && (
              <div className="warning mt-075">
                This candidate has no migration_data (PRE key). Re-sync PRE keys on the
                Candidates tab (or re-add the candidate) before transferring admin.
                {typeof onGoToCandidates === "function" && (
                  <div className="row-actions mt-075">
                    <button type="button" className="secondary" onClick={onGoToCandidates}>
                      Go to Candidates
                    </button>
                  </div>
                )}
              </div>
            )}
            <button
              type="button"
              disabled={!canTransfer}
              onClick={async () => {
                if (!selectedCandidate?.hasPreKey) {
                  setError(
                    "Cannot transfer admin: selected candidate has no migration_data (PRE key).",
                  );
                  return;
                }
                setLoading(true);
                setError("");
                setSuccess("");
                try {
                  await setAdmin(publicKey, transferAddr);
                  setSuccess(
                    "Admin transfer submitted. New admin should complete note migration after unlock.",
                  );
                  setTransferAddr("");
                  // Admin + PRE status change on-chain; update shared caches for both tabs.
                  const [infoFetched, migrationStatus, candidatesFetched] =
                    await Promise.all([
                      fetchInfoOnlyData(),
                      readAdminMigrationState(),
                      fetchCandidatesData(),
                    ]);
                  setCache("info", infoFetched);
                  setCache("candidates", candidatesFetched);
                  setDisplayInactive(infoFetched.inactiveTime);
                  setMigrationPhase(migrationStatus.phase);
                } catch (e) {
                  setError(e.message || String(e));
                } finally {
                  setLoading(false);
                }
              }}
            >
              Transfer Admin
            </button>
          </div>
        </>
      )}
    </div>
  );
}
