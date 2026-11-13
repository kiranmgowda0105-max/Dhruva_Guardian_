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
      ? "#dc2626"
      : level === "yellow"
      ? "#d97706"
      : "#16a34a";

  const levelLabel =
    level === "red"
      ? "SCAM LIKELY"
      : level === "yellow"
      ? "SUSPICIOUS"
      : "SAFE";

  return (
    <div className="risk-gauge-container">
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
            stroke="#e2e8f0"
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
            style={{
              transition: "stroke-dashoffset 0.6s cubic-bezier(0.4, 0, 0.2, 1), stroke 0.3s ease",
            }}
          />

          {/* Center score */}
          <text
            x="100"
            y="82"
            textAnchor="middle"
            className="gauge-score-text"
          >
            {clampedScore}
          </text>
          <text
            x="100"
            y="102"
            textAnchor="middle"
            className="gauge-sub-text"
          >
            OUT OF 100
          </text>
        </svg>
      </div>

      <div className="gauge-status-row">
        <span className={`gauge-status-pill gauge-status-${level}`}>
          <span className="gauge-status-dot" />
          {levelLabel}
        </span>
      </div>
    </div>
  );
};

