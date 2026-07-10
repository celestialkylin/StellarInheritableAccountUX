import { useCallback, useEffect, useState } from "react";
import RefreshBar from "../components/RefreshBar.jsx";
import { getCache, getCacheMeta, setCache } from "../services/cache.js";
import { getContext } from "../services/stellar/context.js";
import {
  buildMigrationDataForAddress,
  formatMigrationResult,
  migrateNotesAfterAdminChange,
  readAdminMigrationState,
} from "../services/adminSuccession.js";
import {
  migrationInProgress,
  migrationNeedsNotes,
} from "../services/crypto/migrationStatus.js";
import {
  getAdmin,
  getCandidate,
  getInactiveTime,
  getLastActivity,
  listCandidates,
  setAdmin,
} from "../services/stellar/inheritable.js";
import {
  formatAmount,
  getBalance,
  getDecimals,
  resolveTokenRef,
} from "../services/stellar/sep41.js";

function formatDuration(seconds) {
  const s = Number(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

function formatTimestamp(ts) {
  return new Date(Number(ts) * 1000).toLocaleString();
}

async function fetchInfoData() {
  const { config, contractId } = getContext();
  const [admin, lastActivity, inactiveTime, candidateAddrs] = await Promise.all([
    getAdmin(),
    getLastActivity(),
    getInactiveTime(),
    listCandidates(),
  ]);

  const candidates = await Promise.all(
    candidateAddrs.map(async (addr) => {
      const info = await getCandidate(addr);
      const remaining = Math.max(0, Number(info.waiting_time) - Number(inactiveTime));
      return { address: addr, waitingTime: info.waiting_time, remaining };
    }),
  );

  const balances = await Promise.all(
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
  );

  return { admin, lastActivity, inactiveTime, candidates, balances };
}

export default function InfoTab({ publicKey }) {
  const [data, setData] = useState(() => getCache("info"));
  const [meta, setMeta] = useState(() => getCacheMeta("info"));
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
      const [fetched, migrationStatus] = await Promise.all([
        fetchInfoData(),
        readAdminMigrationState(),
      ]);
      setCache("info", fetched);
      setData(fetched);
      setMeta(getCacheMeta("info"));
      setDisplayInactive(fetched.inactiveTime);
      setMigrationPhase(migrationStatus.phase);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!meta.loaded) refresh();
  }, [meta.loaded, refresh]);

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

  return (
    <div>
      <RefreshBar onRefresh={refresh} loading={loading} fetchedAt={meta.fetchedAt} />
      {error && <div className="error">{error}</div>}
      {success && <div className="success">{success}</div>}
      {migrationInProgress({ phase: migrationPhase }) && (
        <div className="warning">
          {migrationNeedsNotes({ phase: migrationPhase })
            ? "Admin migration in progress: note re-encryption is pending (batched; safe to continue after interruption). The migration key is stored on chain."
            : "Admin migration in progress: candidate PRE key sync is pending."}
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
              {migrationNeedsNotes({ phase: migrationPhase })
                ? "Continue / Complete Note Migration"
                : "Complete Candidate RK Sync"}
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
            <p><strong>Inactive time:</strong> {formatDuration(displayInactive)}</p>
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
            {data.candidates.length === 0 ? (
              <p className="meta">No candidates registered.</p>
            ) : (
              <table>
                <thead>
                  <tr><th>Address</th><th>Waiting Time</th><th>Time to Claim</th></tr>
                </thead>
                <tbody>
                  {data.candidates.map((c) => (
                    <tr key={c.address}>
                      <td>{c.address}</td>
                      <td>{formatDuration(c.waitingTime)}</td>
                      <td>
                        {c.remaining <= 0
                          ? <span className="badge admin">Ready</span>
                          : formatDuration(c.remaining)}
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
              Immediately assign a new admin and store migration data for note re-encryption.
            </p>
            <label>New Admin Address (G…)</label>
            <input
              value={transferAddr}
              onChange={(e) => setTransferAddr(e.target.value)}
              placeholder="G…"
            />
            <button
              type="button"
              disabled={loading || !transferAddr.trim()}
              onClick={async () => {
                setLoading(true);
                setError("");
                setSuccess("");
                try {
                  const migrationData = await buildMigrationDataForAddress(transferAddr.trim());
                  await setAdmin(publicKey, transferAddr.trim(), migrationData);
                  setSuccess("Admin transfer submitted. New admin should complete note migration after unlock.");
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