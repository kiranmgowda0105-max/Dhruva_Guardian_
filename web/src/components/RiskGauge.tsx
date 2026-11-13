import React from "react";

interface RiskGaugeProps {
  score: number;
  level: "green" | "yellow" | "red";
}

export const RiskGauge: React.FC<RiskGaugeProps> = ({ score, level }) => {
  const clampedScore = Math.min(Math.max(score, 0), 100);
  const radius = 75;
  const arcLength = Math.PI * radius; // ~235.619
  const strokeOffset = arcLength * (1 - clampedScore / 100);

  const levelColor =
    level === "red"
      ? "var(--danger)"
      : level === "yellow"
      ? "var(--warn)"
      : "var(--safe)";

  const levelLabel =
    level === "red"
      ? "SCAM LIKELY"
      : level === "yellow"
      ? "SUSPICIOUS"
      : "SAFE";

  const levelExplanation =
    level === "red"
      ? "Digital-arrest script detected - hang up now"
      : level === "yellow"
      ? "Parts of a scam script heard - stay alert"
      : "No scam pattern detected";

  return (
    <div className="risk-gauge-card-content">
      <div className="gauge-svg-wrapper">
        <svg
          viewBox="0 0 200 120"
          className="gauge-svg"
          aria-hidden="true"
        >
          {/* Background track */}
          <path
            d="M 25 105 A 75 75 0 0 1 175 105"
            fill="none"
            stroke="var(--border)"
            strokeWidth="14"
            strokeLinecap="round"
          />

          {/* Animated fill arc */}
          <path
            d="M 25 105 A 75 75 0 0 1 175 105"
            fill="none"
            stroke={levelColor}
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray={arcLength}
            strokeDashoffset={strokeOffset}
            className="gauge-fill-arc"
          />

          {/* Centre score number */}
          <text
            x="100"
            y="82"
            textAnchor="middle"
            className="gauge-score-value"
          >
            {clampedScore}
          </text>
          <text
            x="100"
            y="100"
            textAnchor="middle"
            className="gauge-score-sub"
          >
            OUT OF 100
          </text>
        </svg>
      </div>

      <div className="gauge-chip-row">
        <span className={`gauge-level-chip gauge-chip-${level}`}>
          <span className="gauge-chip-dot" />
          {levelLabel}
        </span>
      </div>

      <p className="gauge-explanation-text">
        {levelExplanation}
      </p>
    </div>
  );
};
