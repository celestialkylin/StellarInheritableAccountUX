/**
 * Prominent reminder when remaining candidates lack PRE migration_data
 * (typical after claim/set_admin clears heir keys).
 */
export default function MissingMigrationDataBanner({
  onGoToCandidates,
  variant = "info",
}) {
  return (
    <div className="warning warning--prominent" role="status">
      <strong>Candidates need migration data</strong>
      <p className="mb-0 mt-05">
        One or more candidates have empty or invalid PRE keys (
        <code>migration_data</code>). After admin succession the contract clears remaining
        heirs&apos; keys so the new admin can review who should stay eligible.
      </p>
      <p className="mb-0 mt-05">
        {variant === "candidates" ? (
          <>
            Review the list below (remove or adjust waiting times as needed), then use{" "}
            <strong>Re-sync All PRE Keys</strong> to publish new migration data for the
            remaining candidates.
          </>
        ) : (
          <>
            Open <strong>Candidates</strong> to prune or edit heirs, then re-sync migration
            data so they can decrypt notes again.
          </>
        )}
      </p>
      {typeof onGoToCandidates === "function" && (
        <div className="row-actions mt-075">
          <button type="button" onClick={onGoToCandidates}>
            Go to Candidates
          </button>
        </div>
      )}
    </div>
  );
}
