import { useState } from "react";
import {
  displayAssetLabel,
  getDecimals,
  parseAmount,
  resolveTokenRef,
  transferFromContract,
  transferFromG,
} from "../services/stellar/sep41.js";
import { getContext } from "../services/stellar/context.js";

export default function SendAssetForm({ publicKey, onSent }) {
  const { config } = getContext();
  const [source, setSource] = useState("contract");
  const [assetIndex, setAssetIndex] = useState(0);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResult("");
    try {
      const asset = config.assets[assetIndex];
      const tokenRef = resolveTokenRef(asset, config.networkPassphrase);
      const decimals = await getDecimals(tokenRef);
      const amountRaw = parseAmount(amount, decimals);

      let sent;
      if (source === "g") {
        sent = await transferFromG(publicKey, tokenRef, recipient.trim(), amountRaw);
      } else {
        sent = await transferFromContract(publicKey, tokenRef, recipient.trim(), amountRaw);
      }
      setResult(`Sent: ${sent.hash || "ok"}`);
      onSent?.();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h3>Send Asset (SEP-41)</h3>
      <form onSubmit={handleSubmit}>
        <label>Source</label>
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="contract">C-account (InheritableAccount)</option>
          <option value="g">G-account (Admin)</option>
        </select>

        <label>Asset</label>
        <select value={assetIndex} onChange={(e) => setAssetIndex(Number(e.target.value))}>
          {config.assets.map((a, i) => (
            <option key={i} value={i}>{displayAssetLabel(a)}</option>
          ))}
        </select>

        <label>Recipient (G or C)</label>
        <input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="G… or C…" required />

        <label>Amount</label>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0" required />

        <button type="submit" disabled={loading}>
          {loading ? "Sending…" : "Send"}
        </button>
      </form>
      {error && <div className="error">{error}</div>}
      {result && <div className="success">{result}</div>}
    </div>
  );
}