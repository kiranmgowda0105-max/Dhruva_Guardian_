import { STAGES } from "./rules";

export const YELLOW_AT = 25;
export const RED_AT = 50;

export interface ScoreResult {
  total: number;
  level: "green" | "yellow" | "red";
  stagesHit: number[];
  matched: string[];
}

/**
 * Normalise text:
 * - lowercase
 * - strip apostrophes and quotes
 * - replace other punctuation with space while preserving letters, marks (matras/vowel signs), numbers and whitespace
 * - collapse whitespace and trim
 */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/['"’‘`]/g, "")
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function score(text: string): ScoreResult {
  const normText = normalise(text);
  const matched: string[] = [];
  const stagesHit: number[] = [];
  let total = 0;

  if (!normText) {
    return {
      total: 0,
      level: "green",
      stagesHit: [],
      matched: [],
    };
  }

  for (const stage of STAGES) {
    let stageTriggered = false;

    for (const phrase of stage.phrases) {
      const normPhrase = normalise(phrase);
      if (normPhrase && normText.includes(normPhrase)) {
        matched.push(phrase);
        stageTriggered = true;
      }
    }

    if (stageTriggered) {
      stagesHit.push(stage.id);
      total += stage.weight;
    }
  }

  let level: "green" | "yellow" | "red" = "green";
  if (total >= RED_AT) {
    level = "red";
  } else if (total >= YELLOW_AT) {
    level = "yellow";
  }

  return {
    total,
    level,
    stagesHit,
    matched,
  };
}
