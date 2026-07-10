import { useState } from "react";
import { persistScContent } from "../services/config.js";
import {
  encryptScSimple,
  isStellarSecretKey,
  normalizeScHex,
} from "../services/decrypt.js";

export default function ScTxtImporter({ onImported, mode = "initial" }) {
  const [content, setContent] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const isSecretKey = isStellarSecretKey(content);

  async function handleSave() {
    const trimmed = content.trim();
    if (!trimmed) {
      setError("Please paste or import content");
      return;
    }

    setSaving(true);
    setError("");
    try {
      let toPersist;
      if (isSecretKey) {
        if (!password) {
          setError("Encryption password is required for secret key");
          return;
        }
        toPersist = await encryptScSimple(trimmed, password);
      } else {
        toPersist = normalizeScHex(trimmed);
        if (!toPersist || toPersist.length % 2 !== 0) {
          setError("Encrypted content must be valid hex");
          return;
        }
      }
      await persistScContent(toPersist);
      onImported(toPersist);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  const isReplace = mode === "replace";

  return (
    <div className="card">
      <h3>{isReplace ? "Replace sc.enc" : "Import sc.enc"}</h3>
      <p className="meta">
        {isReplace
          ? "Paste a Stellar secret key (S...) or encrypted hex. Secret keys are encrypted with your password before saving."
          : "No sc.enc found. Paste a Stellar secret key (S...) or encrypted hex content."}
      </p>
      <textarea
        rows={4}
        placeholder="Paste Stellar secret key (S...) or encrypted hex…"
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      {isSecretKey && (
        <>
          <label>Encryption password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password to encrypt the secret key"
            autoComplete="new-password"
          />
          <p className="meta">The secret key will be encrypted with this password and saved as sc.enc.</p>
        </>
      )}
      <div className="row-actions">
        <button type="button" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : isReplace ? "Replace & Continue" : "Save & Continue"}
        </button>
        <label className="file-picker-btn">
          <input
            type="file"
            accept=".txt,.enc"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setContent(await file.text());
            }}
          />
          Choose file
        </label>
      </div>
      {error && <div className="error">{error}</div>}
    </div>
  );
}