import React from "react";
import { STAGES } from "../engine/rules";

interface ScamTimelineProps {
  stagesHit: number[];
  level: "green" | "yellow" | "red";
}

export const ScamTimeline: React.FC<ScamTimelineProps> = ({
  stagesHit,
  level,
}) => {
  return (
    <div className="scam-timeline-container">
      <div className="scam-stepper">
        {STAGES.map((stage, idx) => {
          const isHit = stagesHit.includes(stage.id);
          const isLast = idx === STAGES.length - 1;

          return (
            <div
              key={stage.id}
              className={`stepper-item ${isHit ? `is-hit hit-${level}` : "is-pending"}`}
            >
              <div className="stepper-track-col">
                <div className={`stepper-node ${isHit ? "node-hit" : "node-pending"}`}>
                  {isHit ? (
                    <svg
                      className="stepper-check-icon"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  ) : (
                    <span className="stepper-number">{stage.id}</span>
                  )}
                </div>
                {!isLast && <div className={`stepper-line ${isHit ? "line-hit" : ""}`} />}
              </div>

              <div className="stepper-content">
                <div className="stepper-header">
                  <span className="stepper-title">
                    Stage {stage.id}: {stage.name}
                  </span>
                  <span className="stepper-weight">+{stage.weight} pts</span>
                </div>
                <div className="stepper-status-note">
                  {isHit ? (
                    <span className="stepper-detected-badge">Triggered</span>
                  ) : (
                    <span className="stepper-inactive-badge">Not triggered</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

