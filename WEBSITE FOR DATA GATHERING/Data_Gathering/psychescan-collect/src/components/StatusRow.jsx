/** One green/red check row (spec §6.3). */
export default function StatusRow({ label, ok, detail, children }) {
  return (
    <div className={"status-row " + (ok ? "ok" : "bad")}>
      <span className="dot" aria-hidden="true" />
      <span className="status-label">{label}</span>
      <span className="status-detail">{detail}</span>
      {children}
    </div>
  );
}
