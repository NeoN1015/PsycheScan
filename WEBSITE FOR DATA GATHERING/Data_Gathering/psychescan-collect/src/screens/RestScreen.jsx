import BreathingCircle from "../components/BreathingCircle.jsx";
import { usePhaseTimer } from "../hooks/usePhaseTimer.js";
import { PHASE_SECONDS } from "../state/initialState.js";
import { useSession } from "../state/SessionContext.jsx";

/**
 * Rest and Recovery (spec §6.5, §6.7): calm dark screen with a breathing circle.
 * The instruction fades out after a few seconds; the countdown is shown to
 * the operator only (operator panel). This screen does not re-render while running.
 */
export default function RestScreen({ phase }) {
  const { actions } = useSession();
  usePhaseTimer(PHASE_SECONDS[phase], actions.finishPhase);

  return (
    <section className="screen participant-screen rest-screen">
      <p className="rest-instruction">Relax. Sit still and look at the screen.</p>
      <BreathingCircle />
    </section>
  );
}
