// Timed mental arithmetic (spec §7, after MIST). Pure functions, no React.

export const LEVELS = {
  1: { a: [2, 9], b: [2, 9] }, // single digit × single digit
  2: { a: [11, 19], b: [2, 9] }, // two digit (11–19) × single digit
  3: { a: [11, 29], b: [3, 9] }, // two digit (11–29) × single digit (3–9)
};

const randInt = (lo, hi, rng) => lo + Math.floor(rng() * (hi - lo + 1));
const round1 = (v) => Math.round(v * 10) / 10;

/** 7 × 8 and 8 × 7 count as the same problem for the no-repeat rule. */
export const problemKey = (a, b) => `${Math.min(a, b)}x${Math.max(a, b)}`;

export function createTask(cfg) {
  return { level: 1, limitS: cfg.startLimitS, correctStreak: 0, wrongStreak: 0, recent: [], maxLevel: 1 };
}

/** A new problem at the task's level that is not among the last `noRepeat` problems. */
export function nextProblem(task, rng = Math.random) {
  const L = LEVELS[task.level];
  let a = 0;
  let b = 0;
  for (let i = 0; i < 200; i++) {
    a = randInt(L.a[0], L.a[1], rng);
    b = randInt(L.b[0], L.b[1], rng);
    if (!task.recent.includes(problemKey(a, b))) break;
  }
  return { a, b, answer: a * b, key: problemKey(a, b) };
}

/**
 * Adaptive difficulty after one answer. result: "correct" | "wrong" | "timeout".
 * 3 correct in a row → level up (max 3) and limit −0.5 s (min 2.5 s).
 * 2 wrong/too slow in a row → level down (min 1) and limit +0.5 s (max 4.0 s).
 */
export function applyResult(task, key, result, cfg) {
  const recent = [...task.recent, key].slice(-cfg.noRepeat);
  let { level, limitS, correctStreak, wrongStreak } = task;
  if (result === "correct") {
    correctStreak += 1;
    wrongStreak = 0;
    if (correctStreak >= cfg.upAfterCorrect) {
      level = Math.min(3, level + 1);
      limitS = Math.max(cfg.minLimitS, round1(limitS - cfg.stepS));
      correctStreak = 0;
    }
  } else {
    wrongStreak += 1;
    correctStreak = 0;
    if (wrongStreak >= cfg.downAfterWrong) {
      level = Math.max(1, level - 1);
      limitS = Math.min(cfg.maxLimitS, round1(limitS + cfg.stepS));
      wrongStreak = 0;
    }
  }
  return { ...task, level, limitS, correctStreak, wrongStreak, recent, maxLevel: Math.max(task.maxLevel, level) };
}

/** Fake "Average score" (MIST social pressure): grows with time and always stays above the participant. */
export function fakeAverage(score, elapsedS, cfg) {
  return Math.max(Math.ceil(elapsedS * cfg.averagePerSecond), score + cfg.averageLead);
}
