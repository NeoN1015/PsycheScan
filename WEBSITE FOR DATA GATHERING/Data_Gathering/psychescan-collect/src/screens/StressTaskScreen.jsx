import { useEffect, useRef, useState } from "react";
import TimerBar from "../components/TimerBar.jsx";
import { CONFIG } from "../config.js";
import { usePhaseTimer } from "../hooks/usePhaseTimer.js";
import { applyResult, createTask, fakeAverage, nextProblem } from "../lib/mathTask.js";
import { PHASE_SECONDS } from "../state/initialState.js";
import { phaseElapsedMs } from "../state/sessionReducer.js";
import { useSession } from "../state/SessionContext.jsx";

const FEEDBACK_TEXT = { correct: "Correct", wrong: "Wrong!", timeout: "Too slow!" };

/** Stress task (spec §7): 10 s instructions (phase stressIntro), then the stress phase (CONFIG.phases.stressSeconds) of timed arithmetic. */
export default function StressTaskScreen({ phase }) {
  return phase === "stressIntro" ? <StressIntro /> : <MathTask />;
}

function StressIntro() {
  const { actions } = useSession();
  usePhaseTimer(PHASE_SECONDS.stressIntro, actions.nextPhase);
  return (
    <section className="screen participant-screen">
      <p className="instruction">
        Solve each problem as fast as you can. Type your answer and press Enter. Try to beat the average score.
      </p>
    </section>
  );
}

let audioCtx = null;
/** Short low buzz on a wrong / too-slow answer; same volume for everyone. */
function buzz(cfg) {
  try {
    audioCtx ??= new AudioContext();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "square";
    osc.frequency.value = cfg.buzzHz;
    gain.gain.value = cfg.buzzGain;
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + cfg.buzzMs / 1000);
  } catch {
    // no audio available: the task still works
  }
}

function MathTask() {
  const cfg = CONFIG.stressTask;
  const { state, stateRef, dispatch, actions, refs } = useSession();
  const [problem, setProblem] = useState(null);
  const [input, setInput] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [score, setScore] = useState(0);
  const [average, setAverage] = useState(cfg.averageLead);

  const taskRef = useRef(null);
  const problemRef = useRef(null); // problem on screen, waiting for an answer
  const feedbackPendingRef = useRef(false);
  const endedRef = useRef(false);
  const scoreRef = useRef(0);
  const timersRef = useRef({ answer: null, feedback: null });
  const inputRef = useRef(null);
  const engineRef = useRef(null);

  // The task "engine": plain functions over refs, refreshed after each render so
  // timer callbacks always call the latest version.
  useEffect(() => {
    const stopTimers = () => {
      clearTimeout(timersRef.current.answer);
      clearTimeout(timersRef.current.feedback);
    };

    const showNext = () => {
      const s = stateRef.current;
      if (endedRef.current || s.paused || s.pendingCheckpoint || problemRef.current) return;
      taskRef.current ??= createTask(cfg);
      const task = taskRef.current;
      const p = nextProblem(task);
      const shownPerf = performance.now();
      const elapsedMs = phaseElapsedMs(s, shownPerf);
      problemRef.current = {
        ...p,
        level: task.level,
        limitS: task.limitS,
        shownPerf,
        shownIso: new Date().toISOString(),
        tPhaseS: Math.round(elapsedMs / 1000),
      };
      refs.taskLevelRef.current = task.level;
      setProblem(problemRef.current);
      setInput("");
      setAverage(fakeAverage(scoreRef.current, elapsedMs / 1000, cfg));
      timersRef.current.answer = setTimeout(() => engineRef.current.finish("timeout", ""), task.limitS * 1000);
    };

    const finish = (result, given) => {
      const prob = problemRef.current;
      if (!prob) return;
      clearTimeout(timersRef.current.answer);
      problemRef.current = null;
      dispatch({
        type: "LOG_PROBLEM",
        problem: {
          participant_id: stateRef.current.setup.participantId,
          shown_time_iso: prob.shownIso,
          t_phase_s: prob.tPhaseS,
          level: prob.level,
          time_limit_s: prob.limitS,
          a: prob.a,
          b: prob.b,
          correct_answer: prob.answer,
          given_answer: given === "" ? null : Number(given),
          result,
          response_ms: result === "timeout" ? null : Math.round(performance.now() - prob.shownPerf),
        },
      });
      taskRef.current = applyResult(taskRef.current, prob.key, result, cfg);
      if (result === "correct") {
        scoreRef.current += 1;
        setScore(scoreRef.current);
      } else if (cfg.buzz) {
        buzz(cfg);
      }
      setProblem(null);
      setFeedback(result);
      feedbackPendingRef.current = true;
      timersRef.current.feedback = setTimeout(() => {
        feedbackPendingRef.current = false;
        setFeedback(null);
        engineRef.current.showNext();
      }, cfg.feedbackMs);
    };

    /** Drop the current problem without logging it (pause, or end of the stress phase). */
    const halt = () => {
      stopTimers();
      problemRef.current = null;
      feedbackPendingRef.current = false;
      setProblem(null);
      setFeedback(null);
    };

    engineRef.current = { showNext, finish, halt, stopTimers };
  });

  // Start, pause and resume.
  useEffect(() => {
    const engine = engineRef.current;
    if (state.paused) engine.halt();
    else if (!feedbackPendingRef.current) engine.showNext();
  }, [state.paused]);

  // Unmount (also StrictMode's test unmount): stop timers and forget the problem.
  useEffect(
    () => () => {
      engineRef.current?.stopTimers();
      problemRef.current = null;
      feedbackPendingRef.current = false;
    },
    []
  );

  // End of the phase: end mid-question if needed, then checkpoint 3.
  usePhaseTimer(PHASE_SECONDS.stress, () => {
    endedRef.current = true;
    engineRef.current.halt();
    actions.finishPhase();
  });

  useEffect(() => {
    if (problem) inputRef.current?.focus();
  }, [problem]);

  function onSubmit(e) {
    e.preventDefault();
    if (!problemRef.current || input === "") return;
    engineRef.current.finish(Number(input) === problemRef.current.answer ? "correct" : "wrong", input);
  }

  const scale = Math.max(average, score, 10) * 1.2;
  return (
    <section className="screen participant-screen stress-screen">
      <div className="score-bars">
        <div className="score-bar">
          <span>Score: {score}</span>
          <div className="score-track">
            <div className="score-fill" style={{ width: `${(score / scale) * 100}%` }} />
          </div>
        </div>
        <div className="score-bar">
          <span>Average score: {average}</span>
          <div className="score-track">
            <div className="score-fill average" style={{ width: `${(average / scale) * 100}%` }} />
          </div>
        </div>
      </div>

      <p className="problem">{problem ? `${problem.a} × ${problem.b} = ?` : " "}</p>

      <form onSubmit={onSubmit}>
        <input
          ref={inputRef}
          className="answer-input"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-label="Your answer"
          value={input}
          disabled={!problem}
          onChange={(e) => setInput(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
        />
      </form>

      {problem ? <TimerBar durationS={problem.limitS} runKey={problem.shownPerf} /> : <div className="timer-bar" />}

      {feedback && <div className={"feedback " + feedback}>{FEEDBACK_TEXT[feedback]}</div>}
    </section>
  );
}
