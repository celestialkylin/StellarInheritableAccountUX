import { useCallback, useEffect, useState } from "react";
import RefreshBar from "../components/RefreshBar.jsx";
import { getCache, getCacheMeta, setCache } from "../services/cache.js";
import {
  addCandidateWithMigration,
  syncCandidateMigrationKeys,
} from "../services/adminSuccession.js";
import { hasMigrationData } from "../services/crypto/rekryptMigration.js";
import { bytesToBuffer } from "../services/crypto/codec.js";
import {
  getCandidate,
  listCandidates,
  removeCandidate,
  updateCandidate,
} from "../services/stellar/candidates.js";
import { getInactiveTime } from "../services/stellar/inheritable.js";

function formatDuration(seconds) {
  const s = Number(seconds);
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

async function fetchCandidatesData() {
  const [addrs, inactiveTime] = await Promise.all([
    listCandidates(),
    getInactiveTime(),
  ]);
  const items = await Promise.all(
    addrs.map(async (addr) => {
      const info = await getCandidate(addr);
      const remaining = Math.max(0, Number(info.waiting_time) - Number(inactiveTime));
      const hasPreKey = hasMigrationData(bytesToBuffer(info.migration_data));
      return {
        address: addr,
        waitingTime: info.waiting_time,
        remaining,
        hasPreKey,
      };
    }),
  );
  return { items, inactiveTime };
}

export default function CandidatesTab({ publicKey }) {
  const [data, setData] = useState(() => getCache("candidates"));
  const [meta, setMeta] = useState(() => getCacheMeta("candidates"));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [newAddr, setNewAddr] = useState("");
  const [newWait, setNewWait] = useState("86400");
  const [editAddr, setEditAddr] = useState("");
  const [editWait, setEditWait] = useState("86400");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const fetched = await fetchCandidatesData();
      setCache("candidates", fetched);
      setData(fetched);
      setMeta(getCacheMeta("candidates"));
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!meta.loaded) refresh();
  }, [meta.loaded, refresh]);

  async function runAction(action) {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      await action();
      setSuccess("Transaction submitted. Click Refresh to update the list.");
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <RefreshBar onRefresh={refresh} loading={loading} fetchedAt={meta.fetchedAt} />
      {error && <div className="error">{error}</div>}
      {success && <div className="success">{success}</div>}

      <div className="card">
        <h3>Add Candidate</h3>
        <label>Candidate Address (G…)</label>
        <input value={newAddr} onChange={(e) => setNewAddr(e.target.value)} placeholder="G…" />
        <label>Waiting Time (seconds)</label>
        <input value={newWait} onChange={(e) => setNewWait(e.target.value)} type="number" min="1" />
        <p className="meta">
          Rekrypt transform key (RK) is generated and stored with the candidate in one transaction.
        </p>
        <button
          type="button"
          disabled={loading || !newAddr.trim()}
          onClick={() => runAction(async () => {
            await addCandidateWithMigration(
              publicKey,
              newAddr.trim(),
              Number(newWait),
            );
            setNewAddr("");
          })}
        >
          Add Candidate
        </button>
      </div>

      <div className="card">
        <h3>Update Candidate</h3>
        <label>Candidate</label>
        <select value={editAddr} onChange={(e) => setEditAddr(e.target.value)}>
          <option value="">— select —</option>
          {data?.items?.map((c) => (
            <option key={c.address} value={c.address}>{c.address}</option>
          ))}
        </select>
        <label>New Waiting Time (seconds)</label>
        <input value={editWait} onChange={(e) => setEditWait(e.target.value)} type="number" min="1" />
        <button
          type="button"
          disabled={loading || !editAddr}
          onClick={() => runAction(() => updateCandidate(publicKey, editAddr, Number(editWait)))}
        >
          Update Waiting Time
        </button>
      </div>

      <div className="card">
        <h3>Re-sync Rekrypt Keys</h3>
        <p className="meta">
          New candidates receive an RK automatically when added. Use this to rewrite RKs for all
          registered candidates (e.g. a corrupted key or legacy entries missing migration data).
          RKs cannot recover the admin decryption key.
        </p>
        <button
          type="button"
          disabled={loading || !data?.items?.length}
          onClick={() => runAction(async () => {
            const result = await syncCandidateMigrationKeys();
            setSuccess(`Rewrote RKs for ${result.updated} candidate(s). Click Refresh.`);
          })}
        >
          Re-sync All RKs
        </button>
      </div>

      <div className="card">
        <h3>Registered Candidates</h3>
        {!data?.items?.length ? (
          <p className="meta">No candidates.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Address</th><th>Waiting</th><th>To Claim</th><th>RK</th><th></th></tr>
            </thead>
            <tbody>
              {data.items.map((c) => (
                <tr key={c.address}>
                  <td>{c.address}</td>
                  <td>{formatDuration(c.waitingTime)}</td>
                  <td>{c.remaining <= 0 ? "Ready" : formatDuration(c.remaining)}</td>
                  <td>{c.hasPreKey ? <span className="badge admin">Set</span> : <span className="meta">—</span>}</td>
                  <td>
                    <button
                      type="button"
                      className="danger"
                      disabled={loading}
                      onClick={() => runAction(() => removeCandidate(publicKey, c.address))}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}