import { useCallback, useEffect, useRef, useState } from "react";
import RefreshBar from "../components/RefreshBar.jsx";
import { getCache, getCacheMeta, setCache } from "../services/cache.js";
import { bytesToBuffer } from "../services/crypto/codec.js";
import {
  decryptNoteField,
  encryptNoteText,
  makeSummary,
} from "../services/crypto/notesCrypto.js";
import { getNoteBody, listNoteSummaries, updateNotes } from "../services/stellar/notes.js";

const MAX_BODY_BYTES = 64 * 1024;

async function fetchNotesData() {
  const summaries = await listNoteSummaries();
  const items = await Promise.all(
    summaries.map(async (entry) => {
      try {
        const summaryText = await decryptNoteField(bytesToBuffer(entry.summary));
        return {
          id: Number(entry.id),
          summaryText,
          rawSummary: entry.summary,
        };
      } catch {
        return {
          id: Number(entry.id),
          summaryText: "(unable to decrypt)",
          rawSummary: entry.summary,
        };
      }
    }),
  );
  return { items };
}

export default function NotesTab({ publicKey }) {
  const [data, setData] = useState(() => getCache("notes"));
  const [meta, setMeta] = useState(() => getCacheMeta("notes"));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [newBody, setNewBody] = useState("");
  const [editId, setEditId] = useState("");
  const [editBody, setEditBody] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [selectedBody, setSelectedBody] = useState("");
  const [loadingBody, setLoadingBody] = useState(false);
  const editCardRef = useRef(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const fetched = await fetchNotesData();
      setCache("notes", fetched);
      setData(fetched);
      setMeta(getCacheMeta("notes"));
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

  async function decryptBody(noteId) {
    const raw = await getNoteBody(noteId);
    return decryptNoteField(bytesToBuffer(raw));
  }

  async function loadBody(noteId) {
    setLoadingBody(true);
    setError("");
    setSelectedId(noteId);
    setSelectedBody("");
    try {
      const body = await decryptBody(noteId);
      setSelectedBody(body);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoadingBody(false);
    }
  }

  async function startEdit(noteId) {
    setLoadingBody(true);
    setError("");
    setSuccess("");
    try {
      let body = selectedBody;
      if (selectedId !== noteId || !body) {
        body = await decryptBody(noteId);
        setSelectedId(noteId);
        setSelectedBody(body);
      }
      setEditId(String(noteId));
      setEditBody(body);
      requestAnimationFrame(() => {
        editCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoadingBody(false);
    }
  }

  async function buildEncryptedUpsert(id, bodyText) {
    const body = bodyText.trim();
    if (!body) throw new Error("Note body is required");
    const bodyBytes = new TextEncoder().encode(body);
    if (bodyBytes.length > MAX_BODY_BYTES) {
      throw new Error(`Note body exceeds ${MAX_BODY_BYTES} bytes`);
    }
    const summary = makeSummary(body);
    const encrypted = await encryptNoteText(summary, body);
    return {
      id,
      summary: encrypted.summary,
      body: encrypted.body,
    };
  }

  return (
    <div>
      <RefreshBar onRefresh={refresh} loading={loading} fetchedAt={meta.fetchedAt} />
      {error && <div className="error">{error}</div>}
      {success && <div className="success">{success}</div>}

      <div className="card">
        <h3>Add Note</h3>
        <label>Content</label>
        <textarea
          value={newBody}
          onChange={(e) => setNewBody(e.target.value)}
          rows={5}
          placeholder="Full note content (summary is derived from first line, first 25 characters)"
        />
        <button
          type="button"
          disabled={loading}
          onClick={() => runAction(async () => {
            const upsert = await buildEncryptedUpsert(0, newBody);
            await updateNotes(publicKey, [upsert], []);
            setNewBody("");
          })}
        >
          Add Note
        </button>
      </div>

      <div className="card" ref={editCardRef}>
        <h3>Edit Note</h3>
        <label>Note</label>
        <select value={editId} onChange={(e) => setEditId(e.target.value)}>
          <option value="">— select —</option>
          {data?.items?.map((n) => (
            <option key={n.id} value={String(n.id)}>
              #{n.id} — {n.summaryText}
            </option>
          ))}
        </select>
        <label>New Content</label>
        <textarea
          value={editBody}
          onChange={(e) => setEditBody(e.target.value)}
          rows={5}
        />
        <button
          type="button"
          disabled={loading || !editId}
          onClick={() => runAction(async () => {
            const upsert = await buildEncryptedUpsert(Number(editId), editBody);
            await updateNotes(publicKey, [upsert], []);
            setEditBody("");
          })}
        >
          Update Note
        </button>
      </div>

      <div className="card">
        <h3>Notes</h3>
        {!data?.items?.length ? (
          <p className="meta">No notes stored on chain.</p>
        ) : (
          <ul className="note-list">
            {data.items.map((n) => (
              <li key={n.id} className="note-item">
                <div className="note-summary">
                  <strong>#{n.id}</strong> {n.summaryText}
                </div>
                <div className="note-actions">
                  <button
                    type="button"
                    className="secondary"
                    disabled={loadingBody}
                    onClick={() => loadBody(n.id)}
                  >
                    View Body
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={loadingBody}
                    onClick={() => startEdit(n.id)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={loading}
                    onClick={() => runAction(() => updateNotes(publicKey, [], [n.id]))}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selectedId != null && (
        <div className="card note-detail">
          <h3>Note #{selectedId} — Full Content</h3>
          {loadingBody ? (
            <p className="meta">Decrypting…</p>
          ) : (
            <pre className="note-body">{selectedBody || "(empty)"}</pre>
          )}
        </div>
      )}
    </div>
  );
}
