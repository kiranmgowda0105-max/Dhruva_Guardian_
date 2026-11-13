import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useSpeechListener, SpeechLanguage } from "./hooks/useSpeechListener";
import { score } from "./engine/score";
import { sendEvent } from "./lib/api";
import { RedAlert } from "./components/RedAlert";
import { RiskGauge } from "./components/RiskGauge";
import { ScamTimeline } from "./components/ScamTimeline";
import { MatchedPhrases } from "./components/MatchedPhrases";
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
    return <span className="transcript-final">{text}</span>;
  }

  const escaped = validPhrases
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");

  try {
    const regex = new RegExp(`(${escaped})`, "gi");
    const tokens = text.split(regex);
    return (
      <span className="transcript-final">
        {tokens.map((token, i) => {
          const isHit = validPhrases.some(
            (vp) => vp.toLowerCase() === token.toLowerCase()
          );
          if (isHit) {
            return (
              <mark key={i} className="transcript-highlight">
                {token}
              </mark>
            );
          }
          return token;
        })}
      </span>
    );
  } catch {
    return <span className="transcript-final">{text}</span>;
  }
}

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

  // Voice warning toggle (on by default)
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

  // Polled server states
  const [backendConnected, setBackendConnected] = useState<boolean | null>(null);
  const [telegramBotActive, setTelegramBotActive] = useState<boolean | null>(null);

  // Transcript auto-scroll ref
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll transcript container
  useEffect(() => {
    if (transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [transcript, interim]);

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
    const interval = setInterval(checkHealth, 5000);
    return () => {
      isMounted = false;
      clearInterval(interval);
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
    const interval = setInterval(checkTelegram, 15000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

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
    <div className="app-root">
      {/* Full-Screen Red Alert Overlay */}
      {showRedAlert && (
        <RedAlert
          onDismiss={handleDismiss}
          onDownloadPdf={handleDownloadPdf}
          matched={displayMatched}
        />
      )}

      {/* Header Bar */}
      <header className="app-header">
        <div className="header-brand">
          <div className="brand-logo-wrapper">
            <svg
              className="brand-shield-svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          </div>
          <div className="brand-text">
            <h1 className="brand-name">Dhruva</h1>
            <span className="brand-subtitle">Digital-Arrest Call Guardian</span>
          </div>
        </div>

        {/* Status Pills */}
        <div className="header-status-pills">
          {/* 1. Listening Pill */}
          <div
            className={`status-pill ${
              listening ? "pill-listening" : "pill-idle"
            }`}
            title={listening ? "Microphone listening in real-time" : "Microphone inactive"}
          >
            <span
              className={`pill-dot ${
                listening ? "dot-pulsing-green" : "dot-grey"
              }`}
            />
            <span className="pill-text">
              {listening ? "Listening" : "Idle"}
            </span>
          </div>

          {/* 2. Backend Health & Transmission Pill */}
          <div
            className={`status-pill ${
              backendConnected === true
                ? "pill-connected"
                : backendConnected === false
                ? "pill-offline"
                : "pill-checking"
            }`}
            title="Backend server connectivity status"
          >
            <span
              className={`pill-dot ${
                backendConnected === true
                  ? "dot-green"
                  : backendConnected === false
                  ? "dot-red"
                  : "dot-yellow"
              }`}
            />
            <span className="pill-text">
              {backendConnected === true
                ? "Backend Connected"
                : backendConnected === false
                ? "Backend Offline"
                : "Backend Checking..."}
              {backendStatus ? ` (${backendStatus})` : ""}
            </span>
          </div>

          {/* 3. Telegram Family Alerts Pill (hidden if endpoint fails) */}
          {telegramBotActive !== null && (
            <div
              className={`status-pill ${
                telegramBotActive ? "pill-telegram-on" : "pill-telegram-off"
              }`}
              title="Telegram Guardian Bot status"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                style={{ marginRight: 6 }}
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
      </header>

      {/* Main 2-Column Responsive Dashboard */}
      <main className="dashboard-grid">
        {/* LEFT COLUMN */}
        <div className="dashboard-column left-column">
          {/* 1. Controls Card */}
          <section className="dashboard-card controls-card">
            <div className="card-header">
              <h2 className="card-title">Live Call Monitoring</h2>
              <span className="card-tag">Control Center</span>
            </div>

            {/* Error or browser support warnings */}
            {!supported && (
              <div className="card-inline-banner banner-danger">
                <strong>Browser Not Supported:</strong> Web Speech API is required. Please open this demo in Google Chrome.
              </div>
            )}

            {error && (
              <div className="card-inline-banner banner-warning">
                <strong>Audio Warning:</strong> {error}
              </div>
            )}

            <div className="controls-body">
              <div className="control-group">
                <label htmlFor="language-select" className="control-label">
                  Call Audio Language
                </label>
                <select
                  id="language-select"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as SpeechLanguage)}
                  className="control-select"
                  disabled={!supported}
                >
                  <option value="kn-IN">Kannada (kn-IN)</option>
                  <option value="hi-IN">Hindi (hi-IN)</option>
                  <option value="en-IN">English (en-IN)</option>
                </select>
              </div>

              <div className="control-switch-row">
                <div className="switch-info">
                  <span className="switch-title">Spoken Voice Warning</span>
                  <span className="switch-desc">
                    Audibly warns senior victim on Red Scam Alert
                  </span>
                </div>
                <label className="switch-toggle" title="Toggle audio spoken alert">
                  <input
                    type="checkbox"
                    checked={voiceWarningEnabled}
                    onChange={(e) => setVoiceWarningEnabled(e.target.checked)}
                  />
                  <span className="switch-slider" />
                </label>
              </div>

              <div className="action-buttons-group">
                <button
                  type="button"
                  onClick={handleToggle}
                  disabled={!supported}
                  className={`btn-primary-action ${
                    listening ? "btn-listening-stop" : "btn-listening-start"
                  }`}
                >
                  {listening ? (
                    <>
                      <span className="btn-icon">⏹</span>
                      Stop Listening
                    </>
                  ) : (
                    <>
                      <span className="btn-icon">▶</span>
                      Start Listening
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleFakeRed}
                  className="btn-fake-red-trigger"
                  title="Simulate Red Alert for live demo presentation"
                >
                  <span className="btn-icon">🚨</span>
                  Simulate scam (Fake RED)
                </button>
              </div>
            </div>
          </section>

          {/* 2. Risk Gauge Card */}
          <section className="dashboard-card gauge-card">
            <div className="card-header">
              <h2 className="card-title">Real-Time Risk Gauge</h2>
              <span className="card-tag">Scam Assessment</span>
            </div>
            <div className="card-body">
              <RiskGauge score={displayScore} level={displayLevel} />
            </div>
          </section>

          {/* 3. Scam Script Timeline Card */}
          <section className="dashboard-card timeline-card">
            <div className="card-header">
              <h2 className="card-title">Scam Script Progression</h2>
              <span className="card-tag">5-Stage Analysis</span>
            </div>
            <div className="card-body">
              <ScamTimeline
                stagesHit={displayStagesHit}
                level={displayLevel}
              />
            </div>
          </section>
        </div>

        {/* RIGHT COLUMN */}
        <div className="dashboard-column right-column">
          {/* 4. Live Transcript Card */}
          <section className="dashboard-card transcript-card">
            <div className="card-header">
              <div className="transcript-title-box">
                <h2 className="card-title">Live Rolling Transcript</h2>
                <span className="card-tag">60s Sliding Window</span>
              </div>
              <div className="transcript-live-pill">
                <span className={`pill-dot ${listening ? "dot-pulsing-green" : "dot-grey"}`} />
                {listening ? "Transcribing live" : "Standby"}
              </div>
            </div>

            <div className="transcript-card-body">
              <div className="transcript-scroll-box" tabIndex={0} aria-label="Speech Transcript">
                {transcript && renderHighlightedTranscript(transcript, displayMatched)}
                {interim && (
                  <span className="transcript-interim"> {interim}</span>
                )}
                {!transcript && !interim && (
                  <div className="transcript-placeholder-state">
                    <p className="placeholder-primary">
                      {listening
                        ? "Listening... Audio from the phone speaker will appear here."
                        : 'Microphone idle. Click "Start Listening" or "Simulate scam (Fake RED)" to begin.'}
                    </p>
                    <span className="placeholder-secondary">
                      Highlighted words in red represent identified scam tactics.
                    </span>
                  </div>
                )}
                <div ref={transcriptEndRef} />
              </div>
            </div>
          </section>

          {/* 5. Matched Phrases Card */}
          <section className="dashboard-card matched-card">
            <div className="card-header">
              <h2 className="card-title">Detected Scam Signals</h2>
              <span className="card-tag">Identified Triggers</span>
            </div>
            <div className="card-body">
              <MatchedPhrases matched={displayMatched} />
            </div>
          </section>

          {/* 6. Emergency Card */}
          <section className="dashboard-card emergency-card">
            <div className="card-header">
              <h2 className="card-title">Emergency Help & Legal Protections</h2>
              <span className="emergency-alert-tag">Immediate Action</span>
            </div>
            <div className="card-body">
              <div className="emergency-legal-banner">
                <div className="banner-icon">⚖️</div>
                <div className="banner-text">
                  <strong>There is no &quot;digital arrest&quot; in Indian law.</strong>
                  <p>
                    Law enforcement never arrests anyone over video calls or demands money transfers to
                    &ldquo;safe accounts&rdquo;.
                  </p>
                </div>
              </div>

              <div className="emergency-buttons-row">
                <a
                  href="tel:1930"
                  className="btn-emergency-action btn-call-1930-large"
                  title="Directly dial Cyber Crime Helpline 1930"
                >
                  <svg
                    width="22"
                    height="22"
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
                  Call 1930 Helpline
                </a>

                <button
                  type="button"
                  className="btn-emergency-action btn-download-pdf-large"
                  onClick={handleDownloadPdf}
                  title="Generate and download 1930 Cyber Fraud Evidence PDF"
                >
                  <svg
                    width="22"
                    height="22"
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
                  Download Evidence PDF
                </button>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
