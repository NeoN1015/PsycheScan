import { useEffect } from "react";
import CheckpointModal from "./components/CheckpointModal.jsx";
import OperatorPanel from "./components/OperatorPanel.jsx";
import CalibrationScreen from "./screens/CalibrationScreen.jsx";
import ConnectScreen from "./screens/ConnectScreen.jsx";
import ConsentScreen from "./screens/ConsentScreen.jsx";
import EndScreen from "./screens/EndScreen.jsx";
import QuestionnaireScreen from "./screens/QuestionnaireScreen.jsx";
import RestScreen from "./screens/RestScreen.jsx";
import ScreeningScreen from "./screens/ScreeningScreen.jsx";
import SetupScreen from "./screens/SetupScreen.jsx";
import StressTaskScreen from "./screens/StressTaskScreen.jsx";
import { useSession } from "./state/SessionContext.jsx";

// One screen per phase (spec §3.4, §6).
const SCREENS = {
  setup: SetupScreen,
  screening: ScreeningScreen,
  consent: ConsentScreen,
  connect: ConnectScreen,
  calibration: CalibrationScreen,
  rest: RestScreen,
  stressIntro: StressTaskScreen,
  stress: StressTaskScreen,
  recovery: RestScreen,
  questionnaires: QuestionnaireScreen,
  end: EndScreen,
};

export default function App() {
  const { state } = useSession();
  useBlockSpaceOnButtons();

  const Screen = SCREENS[state.phase];
  return (
    <div className="layout">
      <main className="participant-area">
        {/* key: a phase start or restart always mounts a fresh screen */}
        <Screen key={`${state.phase}-${state.phaseRun}`} phase={state.phase} />
        {state.paused && <div className="paused-overlay">Paused</div>}
        {state.pendingCheckpoint && <CheckpointModal key={state.pendingCheckpoint.checkpoint} />}
      </main>
      <OperatorPanel />
    </div>
  );
}

/** Space never presses a button, so it can't skip a phase (spec §14). */
function useBlockSpaceOnButtons() {
  useEffect(() => {
    const block = (e) => {
      if ((e.key === " " || e.code === "Space") && e.target instanceof HTMLButtonElement) e.preventDefault();
    };
    window.addEventListener("keydown", block, true);
    window.addEventListener("keyup", block, true);
    return () => {
      window.removeEventListener("keydown", block, true);
      window.removeEventListener("keyup", block, true);
    };
  }, []);
}
