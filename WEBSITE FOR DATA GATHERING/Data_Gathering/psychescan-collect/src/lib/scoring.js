// GAD-7 and PSS-10 items, totals and levels (spec §8). Pure functions.

export const GAD7_PROMPT = ["Over the ", "last 2 weeks", ", how often have you been bothered by the following problems?"];
export const GAD7_ITEMS = [
  "Feeling nervous, anxious, or on edge",
  "Not being able to stop or control worrying",
  "Worrying too much about different things",
  "Trouble relaxing",
  "Being so restless that it is hard to sit still",
  "Becoming easily annoyed or irritable",
  "Feeling afraid, as if something awful might happen",
];
export const GAD7_OPTIONS = ["Not at all", "Several days", "More than half the days", "Nearly every day"];

export const PSS10_PROMPT = ["In the ", "last month", ", how often have you…"];
export const PSS10_ITEMS = [
  "been upset because of something that happened unexpectedly?",
  "felt that you were unable to control the important things in your life?",
  "felt nervous and stressed?",
  "felt confident about your ability to handle your personal problems?",
  "felt that things were going your way?",
  "found that you could not cope with all the things that you had to do?",
  "been able to control irritations in your life?",
  "felt that you were on top of things?",
  "been angered because of things that happened that were outside of your control?",
  "felt difficulties were piling up so high that you could not overcome them?",
];
export const PSS10_OPTIONS = ["Never", "Almost never", "Sometimes", "Fairly often", "Very often"];
export const PSS10_REVERSE = new Set([3, 4, 6, 7]); // items 4, 5, 7, 8 (0-based here)

const complete = (answers) => answers.every((a) => Number.isInteger(a));

/** 0–21, or null until all 7 items are answered. */
export function gad7Total(answers) {
  return complete(answers) ? answers.reduce((s, a) => s + a, 0) : null;
}

export function gad7Level(total) {
  if (total == null) return null;
  if (total <= 4) return "Minimal";
  if (total <= 9) return "Mild";
  if (total <= 14) return "Moderate";
  return "Severe";
}

/** 0–40 with items 4, 5, 7, 8 reversed (4 − answer), or null until all 10 are answered. */
export function pss10Total(answers) {
  if (!complete(answers)) return null;
  return answers.reduce((s, a, i) => s + (PSS10_REVERSE.has(i) ? 4 - a : a), 0);
}

/** Widely used convention, not official cut-offs (spec §8.2 note). */
export function pss10Level(total) {
  if (total == null) return null;
  if (total <= 13) return "Low";
  if (total <= 26) return "Moderate";
  return "High";
}
