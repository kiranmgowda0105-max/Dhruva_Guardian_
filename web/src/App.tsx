import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useSpeechListener, SpeechLanguage } from "./hooks/useSpeechListener";
import { score } from "./engine/score";
import { sendEvent } from "./lib/api";
import { RedAlert } from "./components/RedAlert";
import { RiskGauge } from "./components/RiskGauge";
import { ScamTimeline } from "./components/ScamTimeline";
import { speakWarning, stopWarning } from "./lib/voice";
import { buildEvidencePdf, EvidenceData } from "./lib/evidence";

const LEVEL_RANK = {
  green: 0,
  yellow: 1,
  red: 2,
} as const;

function renderHighlightedTranscript(text: string, phrases: string[]) {
  if (!text) return null;
  const validPhrases = phrases
    .filter((p) => p && p.trim().length > 0)
    .sort((a, b) => b.length - a.length);

  if (validPhrases.length === 0) {
    return <span className="transcript-final-text">{text}</span>;
  }

  // Safe escape for regex special characters (handles Devanagari/Kannada properly)
  const escaped = validPhrases
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");

  try {
    const regex = new RegExp(`(${escaped})`, "gi");
    const tokens = text.split(regex);
    return (
      <span className="transcript-final-text">
        {tokens.map((token, i) => {
          const isHit = validPhrases.some(
            (vp) => vp.toLowerCase() === token.toLowerCase()
          );
          if (isHit) {
            return (
              <mark key={i} className="transcript-danger-highlight">
                {token}
              </mark>
            );
          }
          return token;
        })}
      </span>
    );
  } catch {
    return <span className="transcript-final-text">{text}</span>;
  }
}

export default function App() {
  const [language, setLanguage] = useState<SpeechLanguage>("en-IN");
  const listener = useSpeechListener({ language });
  const { transcript, interim, listening, supported, error, start, stop } = listener;

  // Track start time for call evidence
  const startedAtRef = useRef<number>(Date.now());

  // Call timer state (seconds)
  const [callSeconds, setCallSeconds] = useState<number>(0);

  useEffect(() => {
    let interval: number | null = null;
    if (listening) {
      startedAtRef.current = Date.now();
      interval = window.setInterval(() => {
        setCallSeconds((s) => s + 1);
      }, 1000);
    }
    return () => {
      if (interval !== null) clearInterval(interval);
    };
  }, [listening]);

  const formatTimer = (totalSecs: number) => {
    const m = Math.floor(totalSecs / 60)
      .toString()
      .padStart(2, "0");
    const s = (totalSecs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  // Reset tracking snapshot
  const [lastResetTranscript, setLastResetTranscript] = useState<string>("");

  // Scoring input: use scoringText if provided by listener, else transcript
  const rawScoringText =
    ("scoringText" in listener && (listener as any).scoringText) || transcript;

  // Effective text (cleared if Reset was pressed and no new speech has arrived)
  const activeTranscript =
    transcript === lastResetTranscript ? "" : transcript;
  const activeScoringInput =
    rawScoringText === lastResetTranscript ? "" : rawScoringText;

  // Voice warning toggle (on by default)
  const [voiceWarningEnabled, setVoiceWarningEnabled] = useState<boolean>(true);

  // Compute live score from scoring input
  const scored = useMemo(() => score(activeScoringInput), [activeScoringInput]);

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

  // Polled server states
  const [backendConnected, setBackendConnected] = useState<boolean | null>(null);
  const [telegramBotActive, setTelegramBotActive] = useState<boolean | null>(null);

  // Transcript auto-scroll ref
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll transcript container on new text
  useEffect(() => {
    if (transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [activeTranscript, interim]);

  // Poll backend health every 5s
  useEffect(() => {
    let isMounted = true;
    const checkHealth = async () => {
      try {
        const res = await fetch("/api/health");
        if (isMounted) {
          setBackendConnected(res.ok);
        }
      } catch {
        if (isMounted) {
          setBackendConnected(false);
        }
      }
    };

    checkHealth();
    const interval = window.setInterval(checkHealth, 5000);
    return () => {
      isMounted = false;
      window.clearInterval(interval);
    };
  }, []);

  // Poll telegram bot status every 15s
  useEffect(() => {
    let isMounted = true;
    const checkTelegram = async () => {
      try {
        const res = await fetch("/api/tg/status");
        if (res.ok) {
          const data = await res.json();
          if (isMounted) {
            setTelegramBotActive(Boolean(data && data.bot));
          }
        } else {
          if (isMounted) {
            setTelegramBotActive(null);
          }
        }
      } catch {
        if (isMounted) {
          setTelegramBotActive(null);
        }
      }
    };

    checkTelegram();
    const interval = window.setInterval(checkTelegram, 15000);
    return () => {
      isMounted = false;
      window.clearInterval(interval);
    };
  }, []);

  // Track last sent metrics for sendEvent
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
  // 2. Reset state when score drops below red
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

  const handleReset = () => {
    stop();
    stopWarning();
    setCallSeconds(0);
    setDismissed(false);
    setFakeRedActive(false);
    setLastResetTranscript(transcript);
    wasRedRef.current = false;
    lastDismissedStageRef.current = 0;
    lastSentScoreRef.current = 0;
    lastSentStageRef.current = 0;
    lastSentLevelRef.current = "green";
    startedAtRef.current = Date.now();
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

  // Effective values taking simulated fake red into account
  const isRed = scored.level === "red" || fakeRedActive;
  const showRedAlert = isRed && !dismissed;

  const displayLevel = fakeRedActive ? "red" : scored.level;
  const displayScore = fakeRedActive ? 55 : scored.total;
  const displayStagesHit = fakeRedActive ? [3, 4] : scored.stagesHit;
  const displayMatched = fakeRedActive
    ? ["safe account", "tell no one"]
    : scored.matched;

  return (
    <div className="product-layout">
      {/* Red Alert Overlay */}
      {showRedAlert && (
        <RedAlert
          onDismiss={handleDismiss}
          onDownloadPdf={handleDownloadPdf}
          matched={displayMatched}
        />
      )}

      {/* 1. Sticky Top Bar */}
      <header className="top-bar">
        <div className="top-bar-container">
          <div className="brand-group">
            <div className="brand-shield" aria-hidden="true">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
            </div>
            <div className="brand-titles">
              <span className="brand-name">Dhruva</span>
              <span className="brand-subtitle">Digital-Arrest Call Guardian</span>
            </div>
          </div>

          {/* Right Status Pills */}
          <div className="status-pills-row">
            {/* Listening Pill */}
            <div
              className={`status-pill ${
                listening ? "pill-live" : "pill-idle"
              }`}
              title={listening ? "Speech analysis is live" : "Microphone is idle"}
            >
              <span
                className={`status-dot ${
                  listening ? "dot-pulsing-green" : "dot-grey"
                }`}
                aria-hidden="true"
              />
              <span className="pill-text">{listening ? "Live" : "Idle"}</span>
            </div>

            {/* Backend Pill */}
            <div
              className={`status-pill ${
                backendConnected === true
                  ? "pill-backend-online"
                  : backendConnected === false
                  ? "pill-backend-offline"
                  : "pill-backend-checking"
              }`}
              title="Backend API connectivity status"
            >
              <span
                className={`status-dot ${
                  backendConnected === true
                    ? "dot-green"
                    : backendConnected === false
                    ? "dot-red"
                    : "dot-amber"
                }`}
                aria-hidden="true"
              />
              <span className="pill-text">
                {backendConnected === true
                  ? "Backend online"
                  : backendConnected === false
                  ? "Backend offline"
                  : "Backend checking..."}
                {backendStatus === "sent"
                  ? " · Alert sent"
                  : backendStatus === "failed"
                  ? " · Send failed"
                  : ""}
              </span>
            </div>

            {/* Telegram Family Alerts Pill */}
            {telegramBotActive !== null && (
              <div
                className={`status-pill ${
                  telegramBotActive ? "pill-telegram-on" : "pill-telegram-off"
                }`}
                title="Family Guardian Telegram Bot"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ marginRight: 5 }}
                  aria-hidden="true"
                >
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
                <span className="pill-text">
                  {telegramBotActive ? "Telegram on" : "Telegram off"}
                </span>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* 2. Hero Strip */}
      <aside className="hero-strip" aria-label="Legal Fact Reminder">
        <div className="hero-strip-container">
          <svg
            className="hero-info-icon"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <span className="hero-strip-text">
            Real police, CBI, ED or courts never arrest anyone on a video call or ask for money.
          </span>
        </div>
      </aside>

      {/* 3. Main 12-Column Grid */}
      <main className="main-content-wrapper">
        <div className="grid-container">
          {/* LEFT COLUMN (5 of 12) */}
          <div className="left-column">
            {/* Card a: Call Monitor */}
            <section className="product-card card-call-monitor">
              <div className="card-header">
                <h2 className="card-title">Call monitor</h2>
                {listening && (
                  <div className="call-live-indicator">
                    <span className="timer-badge">{formatTimer(callSeconds)}</span>
                    <div className="mic-audio-level" aria-hidden="true">
                      <span className="bar bar-1" />
                      <span className="bar bar-2" />
                      <span className="bar bar-3" />
                    </div>
                  </div>
                )}
              </div>

              {/* Inline Browser Support / Error Alerts */}
              {!supported && (
                <div className="inline-alert alert-danger" role="alert">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span>Web Speech API is unsupported. Please open this page in Google Chrome.</span>
                </div>
              )}

              {error && (
                <div className="inline-alert alert-danger" role="alert">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <span>{error}</span>
                </div>
              )}

              {/* Language Segmented Control */}
              <div className="control-field">
                <span className="field-label">Speech language</span>
                <div className="segmented-control" role="group" aria-label="Speech Recognition Language">
                  <button
                    type="button"
                    className={`segment-btn ${language === "kn-IN" ? "active" : ""}`}
                    onClick={() => setLanguage("kn-IN")}
                    disabled={!supported}
                  >
                    Kannada
                  </button>
                  <button
                    type="button"
                    className={`segment-btn ${language === "hi-IN" ? "active" : ""}`}
                    onClick={() => setLanguage("hi-IN")}
                    disabled={!supported}
                  >
                    Hindi
                  </button>
                  <button
                    type="button"
                    className={`segment-btn ${language === "en-IN" ? "active" : ""}`}
                    onClick={() => setLanguage("en-IN")}
                    disabled={!supported}
                  >
                    English
                  </button>
                </div>
              </div>

              {/* Voice Warning Switch */}
              <div className="switch-row">
                <div className="switch-label-group">
                  <span className="switch-title">Voice warning</span>
                  <span className="switch-desc">Speaks warning alert to victim on Red scam detection</span>
                </div>
                <label className="switch-control" aria-label="Toggle audible voice warning">
                  <input
                    type="checkbox"
                    checked={voiceWarningEnabled}
                    onChange={(e) => setVoiceWarningEnabled(e.target.checked)}
                  />
                  <span className="switch-slider" />
                </label>
              </div>

              {/* Actions Button Group */}
              <div className="monitor-actions">
                <button
                  type="button"
                  onClick={handleToggle}
                  disabled={!supported}
                  className={`btn ${listening ? "btn-danger" : "btn-primary"} btn-monitor-toggle`}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    {listening ? (
                      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
                    ) : (
                      <>
                        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        <line x1="12" y1="19" x2="12" y2="22" />
                      </>
                    )}
                  </svg>
                  {listening ? "Stop monitoring" : "Start monitoring"}
                </button>

                <div className="monitor-secondary-row">
                  <button
                    type="button"
                    onClick={handleReset}
                    className="btn btn-ghost btn-reset"
                    title="Reset monitoring session and score"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                      <path d="M3 3v5h5" />
                    </svg>
                    Reset
                  </button>

                  <button
                    type="button"
                    onClick={handleFakeRed}
                    className="btn btn-outline btn-fake-red"
                    title="Simulate Red Alert for demo testing"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    Simulate scam alert
                  </button>
                </div>
              </div>
            </section>

            {/* Card b: Risk Level */}
            <section className="product-card card-risk-level">
              <div className="card-header">
                <h2 className="card-title">Risk level</h2>
              </div>
              <RiskGauge score={displayScore} level={displayLevel} />
            </section>

            {/* Card c: Scam Script */}
            <section className="product-card card-scam-script">
              <div className="card-header">
                <h2 className="card-title">Scam script</h2>
                <span className="card-header-badge">5 Stages</span>
              </div>
              <ScamTimeline
                stagesHit={displayStagesHit}
                level={displayLevel}
                matched={displayMatched}
              />
            </section>
          </div>

          {/* RIGHT COLUMN (7 of 12) */}
          <div className="right-column">
            {/* Card d: Live Transcript */}
            <section className="product-card card-transcript">
              <div className="card-header">
                <div className="transcript-head-info">
                  <h2 className="card-title">Live transcript</h2>
                  <span className="card-subtitle-tag">Rolling 60s window</span>
                </div>
                <div className="transcript-status-dot-wrap">
                  <span
                    className={`status-dot ${listening ? "dot-pulsing-green" : "dot-grey"}`}
                    aria-hidden="true"
                  />
                  <span className="transcript-live-label">
                    {listening ? "Actively capturing speech" : "Standby"}
                  </span>
                </div>
              </div>

              <div className="transcript-scroll-area" tabIndex={0} aria-label="Speech transcript">
                {activeTranscript && renderHighlightedTranscript(activeTranscript, displayMatched)}
                {interim && <span className="transcript-interim-text"> {interim}</span>}

                {!activeTranscript && !interim && (
                  <div className="transcript-empty-state">
                    <div className="empty-mic-icon-wrap" aria-hidden="true">
                      <svg
                        width="44"
                        height="44"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="var(--muted)"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        <line x1="12" y1="19" x2="12" y2="22" />
                      </svg>
                    </div>
                    <p className="empty-state-title">
                      Start monitoring and put the call on speaker near this device.
                    </p>
                    <p className="empty-state-sub">
                      Speech will be analyzed in real time. Identified scam tactics will appear highlighted in red.
                    </p>
                  </div>
                )}
                <div ref={transcriptEndRef} />
              </div>
            </section>

            {/* Card e: If this is a scam */}
            <section className="product-card card-emergency-actions">
              <div className="card-header">
                <h2 className="card-title">If this is a scam</h2>
              </div>
              <div className="emergency-actions-body">
                <div className="emergency-buttons-row">
                  <a
                    href="tel:1930"
                    className="btn btn-danger btn-large-action"
                    title="Directly dial Cyber Crime Helpline 1930"
                  >
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                    </svg>
                    Call 1930
                  </a>

                  <button
                    type="button"
                    onClick={handleDownloadPdf}
                    className="btn btn-outline btn-large-action"
                    title="Generate and download 1930 Evidence PDF"
                  >
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                      <polyline points="10 9 9 9 8 9" />
                    </svg>
                    Download evidence PDF
                  </button>
                </div>

                <div className="emergency-footer-note">
                  <span className="report-link-text">
                    Report at <a href="https://cybercrime.gov.in" target="_blank" rel="noopener noreferrer">cybercrime.gov.in</a>
                  </span>
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>

      {/* 4. Footer */}
      <footer className="product-footer">
        <p className="footer-note">
          Dhruva · No audio is stored · Built at hackathon by Team Stellar
        </p>
      </footer>
    </div>
  );
}
