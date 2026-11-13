import React, { useMemo } from "react";
import { STAGES } from "../engine/rules";

interface ScamTimelineProps {
  stagesHit: number[];
  level: "green" | "yellow" | "red";
  matched?: string[];
}

export const ScamTimeline: React.FC<ScamTimelineProps> = ({
  stagesHit,
  level,
  matched = [],
}) => {
  // Map matched phrases to their corresponding stages
  const stageMatchedMap = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const stage of STAGES) {
      const stagePhrases = matched.filter((m) => {
        const lowerM = m.toLowerCase().trim();
        return stage.phrases.some((p) => {
          const lowerP = p.toLowerCase().trim();
          return lowerM === lowerP || lowerM.includes(lowerP) || lowerP.includes(lowerM);
        });
      });
      if (stagePhrases.length > 0) {
        map.set(stage.id, Array.from(new Set(stagePhrases)));
      }
    }
    return map;
  }, [matched]);

  return (
    <div className="cyber-stepper-list">
      {STAGES.map((stage) => {
        const isHit = stagesHit.includes(stage.id);
        const hitPhrases = stageMatchedMap.get(stage.id) || [];

        return (
          <div
            key={stage.id}
            className={`cyber-stepper-row ${isHit ? "row-hit" : "row-dim"}`}
          >
            <div className="stepper-node-wrapper">
              <div className={`stepper-node-circle ${isHit ? "node-active" : "node-idle"}`}>
                {isHit ? (
                  <svg
                    className="node-check-icon"
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
                  <span className="node-id-text">{stage.id}</span>
                )}
              </div>
            </div>

            <div className="stepper-info-col">
              <div className="stepper-main-line">
                <span className="stepper-stage-title">{stage.name}</span>
                <span className="stepper-weight-pill">+{stage.weight}</span>
              </div>

              {isHit && hitPhrases.length > 0 && (
                <div className="stepper-micro-chips">
                  {hitPhrases.map((phrase, pIdx) => (
                    <span key={pIdx} className="stepper-micro-chip">
                      &ldquo;{phrase}&rdquo;
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
