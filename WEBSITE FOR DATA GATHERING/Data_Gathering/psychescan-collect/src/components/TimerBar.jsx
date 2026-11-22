/**
 * Shrinking per-question timer bar, green → red (spec §7). Pure CSS animation;
 * a new `runKey` restarts it.
 */
export default function TimerBar({ durationS, runKey }) {
  return (
    <div className="timer-bar" aria-hidden="true">
      <div key={runKey} className="timer-fill" style={{ animationDuration: `${durationS}s` }} />
    </div>
  );
}
