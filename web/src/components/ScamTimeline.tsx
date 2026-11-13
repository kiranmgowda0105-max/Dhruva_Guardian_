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
    <div className="scam-stepper-container">
      <div className="scam-stepper">
        {STAGES.map((stage, idx) => {
          const isHit = stagesHit.includes(stage.id);
          const isLast = idx === STAGES.length - 1;
          const hitPhrases = stageMatchedMap.get(stage.id) || [];

          return (
            <div
              key={stage.id}
              className={`stepper-step ${isHit ? `step-hit step-hit-${level}` : "step-idle"}`}
            >
              <div className="stepper-rail">
                <div className={`stepper-bubble ${isHit ? "bubble-hit" : "bubble-idle"}`}>
                  {isHit ? (
                    <svg
                      className="stepper-check-svg"
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
                    <span className="stepper-num">{stage.id}</span>
                  )}
                </div>
                {!isLast && <div className={`stepper-connector ${isHit ? "connector-hit" : ""}`} />}
              </div>

              <div className="stepper-body">
                <div className="stepper-row">
                  <span className={`stepper-name ${isHit ? "name-bold" : "name-muted"}`}>
                    {stage.name}
                  </span>
                  <span className="stepper-weight">+{stage.weight}</span>
                </div>

                {isHit && hitPhrases.length > 0 && (
                  <div className="stepper-chips-row">
                    {hitPhrases.map((phrase, pIdx) => (
                      <span key={pIdx} className="stepper-phrase-chip">
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
    </div>
  );
};
