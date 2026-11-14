import React, { useMemo } from "react";
import { STAGES } from "../engine/rules";

interface MatchedPhrasesProps {
  matched: string[];
}

export const MatchedPhrases: React.FC<MatchedPhrasesProps> = ({ matched }) => {
  const grouped = useMemo(() => {
    const groups: { stageLabel: string; phrases: string[] }[] = [];
    const assigned = new Set<string>();

    STAGES.forEach((stage) => {
      const stagePhrases = matched.filter((phrase) => {
        const lower = phrase.toLowerCase().trim();
        return stage.phrases.some((sp) => {
          const spLower = sp.toLowerCase().trim();
          return lower === spLower || lower.includes(spLower) || spLower.includes(lower);
        });
      });

      if (stagePhrases.length > 0) {
        stagePhrases.forEach((p) => assigned.add(p));
        groups.push({
          stageLabel: `Stage ${stage.id}: ${stage.name}`,
          phrases: Array.from(new Set(stagePhrases)),
        });
      }
    });

    const unassigned = matched.filter((p) => !assigned.has(p));
    if (unassigned.length > 0) {
      groups.push({
        stageLabel: "Detected scam signals",
        phrases: Array.from(new Set(unassigned)),
      });
    }

    return groups;
  }, [matched]);

  if (matched.length === 0) {
    return (
      <div className="matched-empty-state">
        <p className="matched-empty-text">No scam keywords detected yet.</p>
        <span className="matched-empty-sub">Dhruva Guardian checks speech as you talk.</span>
      </div>
    );
  }

  return (
    <div className="matched-phrases-container">
      {grouped.map((group, idx) => (
        <div key={idx} className="matched-group">
          <div className="matched-group-title">{group.stageLabel}</div>
          <div className="matched-chips-list">
            {group.phrases.map((phrase, pIdx) => (
              <span key={pIdx} className="matched-chip">
                "{phrase}"
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

