import { useSession } from "../state/SessionContext.jsx";

const ITEMS = [
  ["signed", "Consent form signed"],
  ["canStop", "Participant knows they can stop at any time"],
  ["anonymous", "Participant knows the data is anonymous (ID only, no name)"],
];

/** Consent checklist (spec §6.2): Next only when every box is ticked. */
export default function ConsentScreen() {
  const { state, dispatch, actions } = useSession();
  const all = ITEMS.every(([k]) => state.consent[k]);
  return (
    <section className="screen form-screen">
      <h1>Consent</h1>
      {ITEMS.map(([k, text]) => (
        <label key={k} className="check big-check">
          <input
            type="checkbox"
            checked={state.consent[k]}
            onChange={(e) => dispatch({ type: "SET_CONSENT", consent: { [k]: e.target.checked } })}
          />
          {text}
        </label>
      ))}
      <button type="button" className="btn next" disabled={!all} onClick={actions.nextPhase}>
        Next
      </button>
    </section>
  );
}
