/** One questionnaire item with its answer buttons (spec §8). value = selected score or null. */
export default function LikertQuestion({ number, text, options, value, onChange }) {
  return (
    <div className="likert">
      <p className="likert-text">
        <span className="likert-num">{number}.</span> {text}
      </p>
      {/* --n: one equal-width column per answer, so the options never wrap unevenly */}
      <div
        className="likert-options"
        role="radiogroup"
        aria-label={`Question ${number}`}
        style={{ "--n": options.length }}
      >
        {options.map((label, score) => (
          <button
            key={label}
            type="button"
            role="radio"
            aria-checked={value === score}
            className={"choice" + (value === score ? " selected" : "")}
            onClick={() => onChange(score)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
