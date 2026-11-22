/** Yes/No confirmation on top of everything else (spec §10, §11). */
export default function ConfirmDialog({ title, message, yesLabel = "Yes", noLabel = "No", danger = false, onYes, onNo, children }) {
  return (
    <div className="overlay confirm" role="alertdialog" aria-modal="true" aria-label={title || message}>
      <div className="modal">
        {title && <h2>{title}</h2>}
        {message && <p>{message}</p>}
        {children}
        <div className="button-row">
          <button type="button" className={"btn" + (danger ? " danger" : "")} onClick={onYes}>
            {yesLabel}
          </button>
          <button type="button" className="btn secondary" onClick={onNo} autoFocus>
            {noLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
