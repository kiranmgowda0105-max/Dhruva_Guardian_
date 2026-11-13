import React, { useState, useEffect } from "react";

interface RiskGaugeProps {
  score: number;
  level: "green" | "yellow" | "red";
}

export const RiskGauge: React.FC<RiskGaugeProps> = ({ score, level }) => {
  const clampedScore = Math.min(Math.max(score, 0), 100);
  const radius = 70;
  const arcLength = 1.5 * Math.PI * radius; // ~329.867 (270-degree arc)
  const strokeOffset = arcLength * (1 - clampedScore / 100);

  // Animated count-up score number in centre
  const [animatedScore, setAnimatedScore] = useState(clampedScore);

  useEffect(() => {
    let startVal = animatedScore;
    const endVal = clampedScore;
    if (startVal === endVal) return;

    const startTime = performance.now();
    const duration = 350;
    let rafId: number;

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      setAnimatedScore(Math.round(startVal + (endVal - startVal) * ease));
      if (progress < 1) {
        rafId = requestAnimationFrame(step);
      }
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [clampedScore]);

  const levelLabel =
    level === "red"
      ? "SCAM LIKELY"
      : level === "yellow"
      ? "SUSPICIOUS"
      : "SAFE";

  return (
    <div className={`cyber-gauge-container ${level === "red" ? "gauge-alert-pulse" : ""}`}>
      <div className="gauge-radial-wrap">
        <svg
          viewBox="0 0 200 175"
          className="cyber-gauge-svg"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="gaugeArcGrad" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="var(--level)" stopOpacity="0.75" />
              <stop offset="100%" stopColor="var(--level)" stopOpacity="1" />
            </linearGradient>
            <filter id="gaugeGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Background track (270-degree arc) */}
          <path
            d="M 50.5 149.5 A 70 70 0 1 1 149.5 149.5"
            fill="none"
            stroke="rgba(255, 255, 255, 0.08)"
            strokeWidth="12"
            strokeLinecap="round"
          />

          {/* Animated fill arc */}
          <path
            d="M 50.5 149.5 A 70 70 0 1 1 149.5 149.5"
            fill="none"
            stroke="url(#gaugeArcGrad)"
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={arcLength}
            strokeDashoffset={strokeOffset}
            filter="url(#gaugeGlow)"
            className="gauge-arc-fill"
          />

          {/* Centre score number */}
          <text
            x="100"
            y="94"
            textAnchor="middle"
            className="gauge-score-number"
          >
            {animatedScore}
          </text>
          <text
            x="100"
            y="114"
            textAnchor="middle"
            className="gauge-score-caption"
          >
            RISK SCORE / 100
          </text>
        </svg>
      </div>

      <div className="gauge-badge-row">
        <span className={`cyber-level-chip chip-${level}`}>
          <span className="chip-glowing-dot" />
          {levelLabel}
        </span>
      </div>
    </div>
  );
};
