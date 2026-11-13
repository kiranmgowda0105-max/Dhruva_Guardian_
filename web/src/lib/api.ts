export const FAMILY_CODE = "DEMO01";

export interface SendEventParams {
  level: "green" | "yellow" | "red";
  score: number;
  stage: number;
  matched: string[];
}

/**
 * Sends a scam alert event to the backend API.
 * Returns true if successful, false otherwise.
 * Catches any network or response errors to ensure UI stability.
 */
export async function sendEvent(e: SendEventParams): Promise<boolean> {
  const payload = {
    code: FAMILY_CODE,
    level: e.level,
    score: e.score,
    stage: e.stage,
    matched: e.matched,
    ts: Math.floor(Date.now() / 1000),
  };

  try {
    const res = await fetch("/api/event", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      return false;
    }

    const data = await res.json();
    return data && data.ok === true;
  } catch (err) {
    console.error("sendEvent failed:", err);
    return false;
  }
}

