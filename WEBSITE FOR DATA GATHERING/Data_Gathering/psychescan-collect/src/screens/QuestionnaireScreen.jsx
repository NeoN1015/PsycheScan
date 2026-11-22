import { useEffect, useRef, useState } from "react";
import LikertQuestion from "../components/LikertQuestion.jsx";
import {
  GAD7_ITEMS, GAD7_OPTIONS, GAD7_PROMPT, PSS10_ITEMS, PSS10_OPTIONS, PSS10_PROMPT,
} from "../lib/scoring.js";
import { useSession } from "../state/SessionContext.jsx";

const PAGES = [
  { key: "gad7", title: "GAD-7", prompt: GAD7_PROMPT, items: GAD7_ITEMS, options: GAD7_OPTIONS, action: "SET_GAD7_ITEM" },
  { key: "pss10", title: "PSS-10", prompt: PSS10_PROMPT, items: PSS10_ITEMS, options: PSS10_OPTIONS, action: "SET_PSS10_ITEM" },
];

/** GAD-7, then PSS-10 (spec §8). Every item required before Next. */
export default function QuestionnaireScreen() {
  const { state, dispatch, actions } = useSession();
  const [pageIndex, setPageIndex] = useState(0);
  const topRef = useRef(null);
  const page = PAGES[pageIndex];
  const answers = state[page.key];
  const done = answers.every((a) => a !== null);

  useEffect(() => {
    topRef.current?.scrollIntoView({ block: "start" });
  }, [pageIndex]);

  function next() {
    if (pageIndex === 0) setPageIndex(1);
    else actions.nextPhase();
  }

  return (
    <section className="screen questionnaire" ref={topRef}>
      <h1>
        {page.title} <span className="muted">({pageIndex + 1} of 2)</span>
      </h1>
      <p className="likert-text">
        {page.prompt[0]}
        <strong>{page.prompt[1]}</strong>
        {page.prompt[2]}
      </p>
      {page.items.map((text, i) => (
        <LikertQuestion
          key={page.key + i}
          number={i + 1}
          text={text}
          options={page.options}
          value={answers[i]}
          onChange={(value) => dispatch({ type: page.action, index: i, value })}
        />
      ))}
      <button type="button" className="btn next" disabled={!done} onClick={next}>
        Next
      </button>
    </section>
  );
}
