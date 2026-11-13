import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useSpeechListener, SpeechLanguage } from "./hooks/useSpeechListener";
import { score } from "./engine/score";
import { sendEvent } from "./lib/api";
import { RedAlert } from "./components/RedAlert";
import { speakWarning, stopWarning } from "./lib/voice";
import { buildEvidencePdf, EvidenceData } from "./lib/evidence";

const LEVEL_RANK = {
  green: 0,
  yellow: 1,
  red: 2,
} as const;

export default function App() {
  const [language, setLanguage] = useState<SpeechLanguage>("en-IN");
  const { transcript, interim, listening, supported, error, start, stop } =
    useSpeechListener({ language });

  // Track call start time for evidence generation
  const startedAtRef = useRef<number>(Date.now());

  useEffect(() => {
    if (listening) {
      startedAtRef.current = Date.now();
    }
  }, [listening]);

  // Voice warning checkbox (on by default)
  const [voiceWarningEnabled, setVoiceWarningEnabled] = useState<boolean>(true);

  // Compute live score from transcript
  const scored = useMemo(() => score(transcript), [transcript]);

  const highestStage = useMemo(() => {
    return scored.stagesHit.length > 0 ? Math.max(...scored.stagesHit) : 0;
  }, [scored.stagesHit]);

  // Dismissed state: hides the overlay when dismissed
  const [dismissed, setDismissed] = useState<boolean>(false);

  // Highest stage seen at the moment of dismissal
  const lastDismissedStageRef = useRef<number>(0);

  // Track if we have already triggered speech for the current red session
  const wasRedRef = useRef<boolean>(false);

  // Active refs for callbacks/effects
  const languageRef = useRef<SpeechLanguage>(language);
  languageRef.current = language;

  const voiceWarningRef = useRef<boolean>(voiceWarningEnabled);
  voiceWarningRef.current = voiceWarningEnabled;

  // Fake RED trigger flag
  const [fakeRedActive, setFakeRedActive] = useState<boolean>(false);

  // Backend transmission status: null | 'sent' | 'failed'
  const [backendStatus, setBackendStatus] = useState<"sent" | "failed" | null>(null);

  // Track the last sent metrics for sendEvent
  const lastSentLevelRef = useRef<"green" | "yellow" | "red">("green");
  const lastSentScoreRef = useRef<number>(0);
  const lastSentStageRef = useRef<number>(0);

  // Throttling: send at most once per 2 seconds
  const lastSentTimeRef = useRef<number>(0);
  const pendingTimerRef = useRef<number | null>(null);
  const pendingPayloadRef = useRef<{
    level: "yellow" | "red";
    score: number;
    stage: number;
    matched: string[];
  } | null>(null);

  // Manage overlay dismissal lifecycle and voice warnings:
  // 1. Initial transition to red -> speak warning once
  // 2. Reset state when the score drops below red
  // 3. Re-show overlay if a NEW stage is hit (highest stage increases) while level is red -> speak warning
  useEffect(() => {
    if (scored.level !== "red") {
      setDismissed(false);
      setFakeRedActive(false);
      lastDismissedStageRef.current = 0;
      wasRedRef.current = false;
    } else {
      // Currently in red
      if (!wasRedRef.current) {
        wasRedRef.current = true;
        if (voiceWarningRef.current) {
          speakWarning(languageRef.current);
        }
      } else if (dismissed && highestStage > lastDismissedStageRef.current) {
        // Highest stage increased while in red -> re-show the overlay
        setDismissed(false);
        lastDismissedStageRef.current = highestStage;
        if (voiceWarningRef.current) {
          speakWarning(languageRef.current);
        }
      }
    }
  }, [scored.level, highestStage, dismissed]);

  // Actual dispatch function
  const dispatchEvent = useCallback(
    async (payload: {
      level: "yellow" | "red";
      score: number;
      stage: number;
      matched: string[];
    }) => {
      lastSentTimeRef.current = Date.now();
      lastSentLevelRef.current = payload.level;
      lastSentScoreRef.current = payload.score;
      lastSentStageRef.current = payload.stage;

      const success = await sendEvent(payload);
      setBackendStatus(success ? "sent" : "failed");
    },
    []
  );

  // Evaluates whether an event should be sent (throttled at 1 per 2 seconds)
  useEffect(() => {
    // Never send for green
    if (scored.level === "green") {
      if (pendingTimerRef.current !== null) {
        window.clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
      pendingPayloadRef.current = null;
      lastSentLevelRef.current = "green";
      lastSentScoreRef.current = 0;
      lastSentStageRef.current = 0;
      return;
    }

    const currentRank = LEVEL_RANK[scored.level];
    const prevRank = LEVEL_RANK[lastSentLevelRef.current];

    // Trigger conditions:
    // a) Level changes upward (e.g. green -> yellow, yellow -> red, green -> red)
    const levelIncreased = currentRank > prevRank;

    // b) Score or highest stage increases while level stays yellow or red
    const scoreIncreased = scored.total > lastSentScoreRef.current;
    const stageIncreased = highestStage > lastSentStageRef.current;
    const shouldSend = levelIncreased || scoreIncreased || stageIncreased;

    if (!shouldSend) {
      return;
    }

    const payload = {
      level: scored.level,
      score: scored.total,
      stage: highestStage,
      matched: scored.matched,
    };

    const now = Date.now();
    const elapsed = now - lastSentTimeRef.current;
    const COOLDOWN_MS = 2000;

    if (elapsed >= COOLDOWN_MS) {
      if (pendingTimerRef.current !== null) {
        window.clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
      pendingPayloadRef.current = null;
      dispatchEvent(payload);
    } else {
      pendingPayloadRef.current = payload;
      if (pendingTimerRef.current === null) {
        pendingTimerRef.current = window.setTimeout(() => {
          pendingTimerRef.current = null;
          if (pendingPayloadRef.current) {
            dispatchEvent(pendingPayloadRef.current);
            pendingPayloadRef.current = null;
          }
        }, COOLDOWN_MS - elapsed);
      }
    }
  }, [scored, highestStage, dispatchEvent]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (pendingTimerRef.current !== null) {
        window.clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
      stopWarning();
    };
  }, []);

  const handleToggle = () => {
    if (listening) {
      stop();
    } else {
      startedAtRef.current = Date.now();
      start();
    }
  };

  const handleFakeRed = async () => {
    setDismissed(false);
    setFakeRedActive(true);
    wasRedRef.current = true;
    lastDismissedStageRef.current = 0;

    if (voiceWarningRef.current) {
      speakWarning(languageRef.current);
    }

    if (pendingTimerRef.current !== null) {
      window.clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
    pendingPayloadRef.current = null;

    const payload = {
      level: "red" as const,
      score: 55,
      stage: 4,
      matched: ["safe account", "tell no one"],
    };

    lastSentTimeRef.current = Date.now();
    lastSentLevelRef.current = "red";
    lastSentScoreRef.current = 55;
    lastSentStageRef.current = 4;

    const success = await sendEvent(payload);
    setBackendStatus(success ? "sent" : "failed");
  };

  const handleDismiss = () => {
    stopWarning();
    lastDismissedStageRef.current = fakeRedActive ? 4 : highestStage;
    setDismissed(true);
    setFakeRedActive(false);
  };

  // Build evidence pack data from current state
  const getEvidenceData = (): EvidenceData => {
    const isFake = fakeRedActive;
    return {
      startedAt: startedAtRef.current || Date.now() - 30000,
      endedAt: Date.now(),
      level: isFake ? "red" : scored.level,
      score: isFake ? 55 : scored.total,
      stagesHit: isFake ? [3, 4] : scored.stagesHit,
      matched: isFake ? ["safe account", "tell no one"] : scored.matched,
      language,
    };
  };

  const handleDownloadPdf = () => {
    buildEvidencePdf(getEvidenceData());
  };

  // Red alert is visible if level is red (or fake RED triggered) and not dismissed
  const isRed = scored.level === "red" || fakeRedActive;
  const showRedAlert = isRed && !dismissed;

  // Determine meter fill percentage and color
  const meterPercentage = Math.min(Math.max(scored.total, 0), 100);
  const meterColorClass =
    scored.level === "red"
      ? "meter-red"
      : scored.level === "yellow"
      ? "meter-yellow"
      : "meter-green";

  return (
    <div className="container">
      {showRedAlert && (
        <RedAlert onDismiss={handleDismiss} onDownloadPdf={handleDownloadPdf} />
      )}

      <header className="header">
        <h1>Dhruva Web Listener & Detector</h1>
        <p className="chrome-note">
          <strong>Note:</strong> Use Chrome on localhost
        </p>
      </header>

      {!supported && (
        <div className="banner error-banner">
          Web Speech API is not supported in this browser. Please open this page in Google Chrome.
        </div>
      )}

      {error && (
        <div className="banner error-banner">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Emergency Actions Bar available on main screen */}
      <div className="emergency-actions-bar">
        <a href="tel:1930" className="btn-call-1930-inline" title="Directly dial Cyber Crime Helpline 1930">
          📞 Call 1930
        </a>
        <button
          type="button"
          className="btn-download-pdf-inline"
          onClick={handleDownloadPdf}
          title="Download 1930 Cyber Fraud Evidence PDF"
        >
          📄 Download Evidence PDF
        </button>
      </div>

      <div className="controls">
        <label htmlFor="language-select" className="label">
          Language:
        </label>
        <select
          id="language-select"
          value={language}
          onChange={(e) => setLanguage(e.target.value as SpeechLanguage)}
          className="select"
          disabled={!supported}
        >
          <option value="kn-IN">Kannada (kn-IN)</option>
          <option value="hi-IN">Hindi (hi-IN)</option>
          <option value="en-IN">English (en-IN)</option>
        </select>

        <label className="checkbox-label" title="Play audible spoken warning on Red Alert">
          <input
            type="checkbox"
            checked={voiceWarningEnabled}
            onChange={(e) => setVoiceWarningEnabled(e.target.checked)}
          />
          Voice warning
        </label>

        <button
          onClick={handleToggle}
          disabled={!supported}
          className={`btn ${listening ? "btn-stop" : "btn-start"}`}
        >
          {listening ? "Stop Listening" : "Start Listening"}
        </button>

        <button
          onClick={handleFakeRed}
          className="btn btn-fake-red"
          title="Simulate Red Alert without microphone"
        >
          🚨 Fake RED
        </button>

        <span className={`status-indicator ${listening ? "active" : "idle"}`}>
          {listening ? "● Listening..." : "○ Inactive"}
        </span>
      </div>

      {backendStatus && (
        <div className="backend-status-line">
          Backend: <span className={`backend-badge ${backendStatus}`}>{backendStatus}</span>
        </div>
      )}

      {/* Risk Meter Section */}
      <section className="risk-meter-section">
        <div className="risk-header">
          <h2>Scam Risk Score: {scored.total} / 100</h2>
          <span className={`level-pill level-${scored.level}`}>
            {scored.level.toUpperCase()}
          </span>
        </div>

        <div className="meter-track">
          <div
            className={`meter-bar ${meterColorClass}`}
            style={{ width: `${meterPercentage}%` }}
          />
        </div>

        <div className="risk-details">
          <div>
            <strong>Stages Hit: </strong>
            {scored.stagesHit.length > 0 ? (
              scored.stagesHit.map((s) => (
                <span key={s} className="tag stage-tag">
                  Stage {s}
                </span>
              ))
            ) : (
              <span className="text-muted">None</span>
            )}
          </div>
          <div style={{ marginTop: "0.5rem" }}>
            <strong>Matched Phrases: </strong>
            {scored.matched.length > 0 ? (
              scored.matched.map((m, idx) => (
                <span key={idx} className="tag match-tag">
                  "{m}"
                </span>
              ))
            ) : (
              <span className="text-muted">None</span>
            )}
          </div>
        </div>
      </section>

      {/* Live Transcript Section */}
      <section className="transcript-section">
        <h2>Live Rolling Transcript (60s window)</h2>
        <div className="transcript-box">
          {transcript && <span className="final-text">{transcript} </span>}
          {interim && <span className="interim-text">{interim}</span>}
          {!transcript && !interim && (
            <span className="placeholder-text">
              {listening
                ? "Listening... Speak into your microphone."
                : 'Click "Start Listening" to begin, or test with "Fake RED".'}
            </span>
          )}
        </div>
      </section>
    </div>
  );
}
