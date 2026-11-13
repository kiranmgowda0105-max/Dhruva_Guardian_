import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useSpeechListener, SpeechLanguage } from "./hooks/useSpeechListener";
import { score, ScoreResult } from "./engine/score";
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
    return <span className="transcript-final-chunk">{text}</span>;
  }

  // Safe escape for regex special characters (handles Devanagari/Kannada properly)
  const escaped = validPhrases
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");

  try {
    const regex = new RegExp(`(${escaped})`, "gi");
    const tokens = text.split(regex);
    return (
      <span className="transcript-final-chunk">
        {tokens.map((token, i) => {
          const isHit = validPhrases.some(
            (vp) => vp.toLowerCase() === token.toLowerCase()
          );
          if (isHit) {
            return (
              <mark key={i} className="transcript-glow-highlight">
                {token}
              </mark>
            );
          }
          return token;
        })}
      </span>
    );
  } catch {
    return <span className="transcript-final-chunk">{text}</span>;
  }
}

export default function App() {
  const [language, setLanguage] = useState<SpeechLanguage>("en-IN");
  const listener = useSpeechListener({ language });
  const { transcript, interim, listening, supported, error, start, stop, clearTranscript } = listener;

  // Track start time for call evidence
  const startedAtRef = useRef<number>(Date.now());

  // Call timer state (seconds)
  const [callSeconds, setCallSeconds] = useState<number>(0);

  // Preserved score when monitoring is stopped (allows PDF export & dimmed review)
  const [stoppedScore, setStoppedScore] = useState<ScoreResult | null>(null);

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

  // Stopped session review state: dimmed cards with "Stopped" badge
  const isStoppedSession = !listening && stoppedScore !== null && !fakeRedActive;
  const activeScoreData = isStoppedSession ? stoppedScore : scored;

  const highestStage = useMemo(() => {
    return activeScoreData.stagesHit.length > 0 ? Math.max(...activeScoreData.stagesHit) : 0;
  }, [activeScoreData.stagesHit]);

  // Dismissed state: hides the overlay when dismissed
  const [dismissed, setDismissed] = useState<boolean>(false);

  // Highest stage seen at the moment of dismissal
  const lastDismissedStageRef = useRef<number>(0);

  // Track if we have already triggered speech for current red session
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
  useEffect(() => {
    // Only trigger full screen overlay while actively listening or in fake RED
    if (!listening && !fakeRedActive) {
      return;
    }

    // A simulated alert manages itself (handleFakeRed / handleDismiss).
    // Without this, the real-transcript check below cancels it immediately.
    if (fakeRedActive) {
      return;
    }

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
  }, [scored.level, highestStage, dismissed, listening, fakeRedActive]);

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
    // Only send events while listening or fake red is active
    if (!listening && !fakeRedActive) {
      if (pendingTimerRef.current !== null) {
        window.clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
      pendingPayloadRef.current = null;
      return;
    }

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

    const levelIncreased = currentRank > prevRank;
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
  }, [scored, highestStage, dispatchEvent, listening, fakeRedActive]);

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
      // Snapshot current score if anything was detected before clearing live transcript
      if (scored.total > 0 || scored.stagesHit.length > 0) {
        setStoppedScore(scored);
      }
      stop();
      stopWarning();
      if (pendingTimerRef.current !== null) {
        window.clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
      pendingPayloadRef.current = null;
      setBackendStatus(null);
    } else {
      setStoppedScore(null);
      setBackendStatus(null);
      startedAtRef.current = Date.now();
      start();
    }
  };

  const handleReset = () => {
    stop();
    clearTranscript();
    stopWarning();
    if (pendingTimerRef.current !== null) {
      window.clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
    pendingPayloadRef.current = null;
    setCallSeconds(0);
    setDismissed(false);
    setFakeRedActive(false);
    setStoppedScore(null);
    setBackendStatus(null);
    setLastResetTranscript("");
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
    setStoppedScore(null);
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
    const currentScore = isStoppedSession && stoppedScore ? stoppedScore : scored;
    return {
      startedAt: startedAtRef.current || Date.now() - 30000,
      endedAt: Date.now(),
      level: isFake ? "red" : currentScore.level,
      score: isFake ? 55 : currentScore.total,
      stagesHit: isFake ? [3, 4] : currentScore.stagesHit,
      matched: isFake ? ["safe account", "tell no one"] : currentScore.matched,
      language,
    };
  };

  const handleDownloadPdf = () => {
    buildEvidencePdf(getEvidenceData());
  };

  // Effective values taking simulated fake red into account
  const isRed = (scored.level === "red" && listening) || fakeRedActive;
  const showRedAlert = isRed && !dismissed;

  const displayLevel = fakeRedActive ? "red" : activeScoreData.level;
  const displayScore = fakeRedActive ? 55 : activeScoreData.total;
  const displayStagesHit = fakeRedActive ? [3, 4] : activeScoreData.stagesHit;
  const displayMatched = fakeRedActive
    ? ["safe account", "tell no one"]
    : activeScoreData.matched;

  // Level colour mapping for --level CSS variable
  const levelHex =
    displayLevel === "red"
      ? "#ef4444"
      : displayLevel === "yellow"
      ? "#f59e0b"
      : "#22c55e";

  const levelGlow =
    displayLevel === "red"
      ? "rgba(239, 68, 68, 0.45)"
      : displayLevel === "yellow"
      ? "rgba(245, 158, 11, 0.45)"
      : "rgba(34, 197, 94, 0.45)";

  const levelSoft =
    displayLevel === "red"
      ? "rgba(239, 68, 68, 0.16)"
      : displayLevel === "yellow"
      ? "rgba(245, 158, 11, 0.16)"
      : "rgba(34, 197, 94, 0.16)";

  return (
    <div
      className="command-center-viewport"
      style={
        {
          "--level": levelHex,
          "--level-glow": levelGlow,
          "--level-soft": levelSoft,
        } as React.CSSProperties
      }
    >
      {/* Background Animated Gradient Mesh & Grid */}
      <div className="mesh-gradient-canvas" aria-hidden="true">
        <div className="mesh-blob blob-indigo" />
        <div className="mesh-blob blob-violet" />
        <div className="mesh-blob blob-cyan" />
        <div className="mesh-blob blob-pink" />
        <div className="cyber-grid-overlay" />
      </div>

      {/* Dramatic Full-Screen Red Alert Overlay */}
      {showRedAlert && (
        <RedAlert
          onDismiss={handleDismiss}
          onDownloadPdf={handleDownloadPdf}
          matched={displayMatched}
        />
      )}

      {/* ROW 1: TOP BAR */}
      <header className="command-top-bar glass-card">
        <div className="top-bar-left">
          <div className="shield-logo-wrap" aria-hidden="true">
            <div className="shield-glow-ring" />
            <svg
              className="shield-svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          </div>
          <div className="brand-title-group">
            <h1 className="brand-wordmark">Dhruva</h1>
            <span className="brand-tagline">Digital-Arrest Call Guardian</span>
          </div>
        </div>

        {/* Right Status Pills with Glowing Dots */}
        <div className="top-bar-right-pills">
          {/* 1. Live / Idle Pill */}
          <div
            className={`cyber-status-pill ${listening ? "pill-active-live" : "pill-idle"}`}
            title={listening ? "Audio analysis active" : "Audio capture idle"}
          >
            <span className={`glowing-dot ${listening ? "dot-pulsing-green" : "dot-grey"}`} />
            <span className="pill-label">{listening ? "Live" : "Idle"}</span>
          </div>

          {/* 2. Backend Online/Offline Pill */}
          <div
            className={`cyber-status-pill ${
              backendConnected === true
                ? "pill-backend-ok"
                : backendConnected === false
                ? "pill-backend-err"
                : "pill-backend-wait"
            }`}
            title="Backend server connectivity"
          >
            <span
              className={`glowing-dot ${
                backendConnected === true
                  ? "dot-green"
                  : backendConnected === false
                  ? "dot-red"
                  : "dot-amber"
              }`}
            />
            <span className="pill-label">
              {backendConnected === true
                ? "Backend online"
                : backendConnected === false
                ? "Backend offline"
                : "Backend checking..."}
              {listening && backendStatus === "sent"
                ? " · Alert sent"
                : listening && backendStatus === "failed"
                ? " · Send failed"
                : ""}
            </span>
          </div>

          {/* 3. Telegram Bot Status Pill */}
          {telegramBotActive !== null && (
            <div
              className={`cyber-status-pill ${
                telegramBotActive ? "pill-tg-on" : "pill-tg-off"
              }`}
              title="Family Guardian Telegram alerts"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ marginRight: 6 }}
                aria-hidden="true"
              >
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
              <span className="pill-label">
                {telegramBotActive ? "Telegram on" : "Telegram off"}
              </span>
            </div>
          )}
        </div>
      </header>

      {/* ROW 2: MAIN 3-COLUMN DASHBOARD */}
      <main className="command-main-grid">
        {/* COLUMN A: CONTROL (3fr) */}
        <section className="glass-card column-card col-control animate-card card-delay-1">
          <div className="section-title-bar">
            <span className="section-title">Control</span>
            {listening && <span className="timer-badge-neon">{formatTimer(callSeconds)}</span>}
          </div>

          {/* Circular Listen Orb */}
          <div className="orb-center-zone">
            <button
              type="button"
              onClick={handleToggle}
              disabled={!supported}
              className={`listen-orb ${listening ? "orb-listening" : "orb-idle"}`}
              aria-label={listening ? "Stop monitoring" : "Start monitoring"}
              title={listening ? "Click to Stop monitoring" : "Click to Start monitoring"}
            >
              {listening && (
                <>
                  <div className="orb-ripple ripple-1" />
                  <div className="orb-ripple ripple-2" />
                  <div className="orb-ripple ripple-3" />
                </>
              )}
              <div className="orb-core">
                <svg
                  className="orb-mic-icon"
                  width="44"
                  height="44"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
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
              </div>
            </button>
            <div className="orb-label-zone">
              <span className="orb-status-text">
                {listening ? "Monitoring active" : "Start monitoring"}
              </span>
              <span className="orb-sub-text">
                {listening ? "Analyzing live speakerphone" : "Click orb to start listener"}
              </span>
            </div>
          </div>

          {/* Language Segmented Control */}
          <div className="control-widget">
            <span className="widget-label">Language</span>
            <div className="segmented-pill-track" role="group" aria-label="Speech Language">
              <button
                type="button"
                className={`seg-btn ${language === "kn-IN" ? "seg-active" : ""}`}
                onClick={() => setLanguage("kn-IN")}
                disabled={!supported}
              >
                Kannada
              </button>
              <button
                type="button"
                className={`seg-btn ${language === "hi-IN" ? "seg-active" : ""}`}
                onClick={() => setLanguage("hi-IN")}
                disabled={!supported}
              >
                Hindi
              </button>
              <button
                type="button"
                className={`seg-btn ${language === "en-IN" ? "seg-active" : ""}`}
                onClick={() => setLanguage("en-IN")}
                disabled={!supported}
              >
                English
              </button>
            </div>
          </div>

          {/* Voice Warning Toggle */}
          <div className="control-widget toggle-widget-row">
            <div className="toggle-meta">
              <span className="toggle-title">Voice warning</span>
              <span className="toggle-sub">Speaks alert on Red detection</span>
            </div>
            <label className="cyber-switch" aria-label="Toggle voice warning">
              <input
                type="checkbox"
                checked={voiceWarningEnabled}
                onChange={(e) => setVoiceWarningEnabled(e.target.checked)}
              />
              <span className="cyber-slider" />
            </label>
          </div>

          {/* Buttons Row: Reset & Simulate Scam */}
          <div className="control-buttons-row">
            <button
              type="button"
              onClick={handleReset}
              className="cyber-btn cyber-btn-ghost"
              title="Reset session and scores"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
              Reset
            </button>

            <button
              type="button"
              onClick={handleFakeRed}
              className="cyber-btn cyber-btn-hotpink"
              title="Simulate Scam Red Alert"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              Simulate scam
            </button>
          </div>

          {/* Inline Error Banner */}
          {(!supported || error) && (
            <div className="cyber-inline-error" role="alert">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{error || "Web Speech API is unsupported in this browser. Please use Chrome."}</span>
            </div>
          )}
        </section>

        {/* COLUMN B: RISK (4fr) */}
        <section className="glass-card column-card col-risk animate-card card-delay-2">
          <div className="section-title-bar">
            <span className="section-title">Risk Analysis</span>
            <span className="neon-accent-tag">Real-Time Threat</span>
          </div>

          {/* 270-degree Radial SVG Gauge */}
          <div className="gauge-zone">
            <RiskGauge score={displayScore} level={displayLevel} />
          </div>

          {/* Scam Script 5-Stage Compact Stepper */}
          <div className="stepper-zone">
            <div className="stepper-sub-header">
              <span className="sub-header-title">Scam Script Progression</span>
              <span className="sub-header-meta">5 Stages</span>
            </div>
            <ScamTimeline
              stagesHit={displayStagesHit}
              level={displayLevel}
              matched={displayMatched}
            />
          </div>
        </section>

        {/* COLUMN C: LIVE CALL (5fr) */}
        <section className="glass-card column-card col-transcript animate-card card-delay-3">
          <div className="section-title-bar">
            <div className="title-with-pill">
              <span className="section-title">Live Call</span>
              <span className="neon-rolling-pill">Rolling 60s window</span>
            </div>
            <div className="call-ticker-status">
              <span className={`glowing-dot ${listening ? "dot-pulsing-green" : "dot-grey"}`} />
              <span className="ticker-label">{listening ? "Audio Stream Live" : "Standby"}</span>
            </div>
          </div>

          {/* Internally Scrollable Transcript Box */}
          <div
            className="cyber-transcript-viewport"
            tabIndex={0}
            aria-label="Live Speech Transcript"
          >
            {activeTranscript && renderHighlightedTranscript(activeTranscript, displayMatched)}
            {interim && (
              <span className="transcript-interim-chunk">
                {" "}{interim}
                <span className="blinking-cursor" aria-hidden="true">▎</span>
              </span>
            )}

            {!activeTranscript && !interim && (
              <div className="transcript-empty-view">
                <div className="empty-wave-bars" aria-hidden="true">
                  <span className="wave-line wl-1" />
                  <span className="wave-line wl-2" />
                  <span className="wave-line wl-3" />
                  <span className="wave-line wl-4" />
                  <span className="wave-line wl-5" />
                </div>
                <p className="empty-title">Put the call on speaker near this device</p>
                <p className="empty-sub">
                  Live voice stream is parsed against digital-arrest patterns without recording audio.
                </p>
              </div>
            )}
            <div ref={transcriptEndRef} />
          </div>

          {/* Bottom Strip Inside Column C */}
          <div className="column-c-bottom-strip">
            <div className="bottom-buttons-grid">
              <a
                href="tel:1930"
                className="cyber-action-btn btn-call-red"
                title="Directly dial Cyber Crime Helpline 1930"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
                Call 1930
              </a>

              <button
                type="button"
                onClick={handleDownloadPdf}
                className="cyber-action-btn btn-evidence-glass"
                title="Download 1930 Evidence Pack PDF"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
                Evidence PDF
              </button>
            </div>

            <div className="bottom-ticker-line">
              <span className="ticker-text">
                Real police, CBI, ED or courts never arrest anyone on a video call.
              </span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
