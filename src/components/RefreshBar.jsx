function formatTime(ts) {
  if (!ts) return "never";
  return new Date(ts).toLocaleString();
}

export default function RefreshBar({ onRefresh, loading, fetchedAt }) {
  return (
    <div className="refresh-bar">
      <span className="meta">Last updated: {formatTime(fetchedAt)}</span>
      <button type="button" onClick={onRefresh} disabled={loading}>
        {loading ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );
}