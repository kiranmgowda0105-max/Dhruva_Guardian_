import { useState, useEffect, useRef, useCallback } from "react";

export type SpeechLanguage = "kn-IN" | "hi-IN" | "en-IN";

interface TranscriptSegment {
  text: string;
  ts: number;
}

interface UseSpeechListenerOptions {
  language?: SpeechLanguage;
  paused?: boolean;
}

export interface UseSpeechListenerReturn {
  transcript: string;
  interim: string;
  listening: boolean;
  supported: boolean;
  error: string | null;
  start: () => void;
  stop: () => void;
  clearTranscript: () => void;
  scoringText?: string;
}

const ROLLING_WINDOW_MS = 60 * 1000; // 60 seconds
const WATCHDOG_TIMEOUT_MS = 15 * 1000; // 15 seconds without start/audioStart/result
const DEFAULT_RESTART_DELAY_MS = 250;
const MAX_AUDIO_CAPTURE_RETRIES = 3;

export function useSpeechListener(
  options: UseSpeechListenerOptions = {}
): UseSpeechListenerReturn {
  const { language = "en-IN", paused = false } = options;

  const [supported, setSupported] = useState<boolean>(true);
  const [listening, setListening] = useState<boolean>(false);
  const [interim, setInterim] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);

  // 1. Intent flag: true from user Start until explicit user Stop (or fatal error)
  const shouldListenRef = useRef<boolean>(false);
  const isSessionActiveRef = useRef<boolean>(false);
  const isPausedRef = useRef<boolean>(paused);
  const currentLangRef = useRef<SpeechLanguage>(language);

  // Timers and instances
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const restartTimerRef = useRef<number | null>(null);
  const watchdogIntervalRef = useRef<number | null>(null);
  const pruneIntervalRef = useRef<number | null>(null);

  // Watchdog & error recovery
  const lastActivityTimeRef = useRef<number>(Date.now());
  const networkBackoffRef = useRef<number>(1000); // 1s, 2s, 4s, capped at 5s
  const audioCaptureRetriesRef = useRef<number>(0);
  const restartDelayRef = useRef<number>(DEFAULT_RESTART_DELAY_MS);

  // Transcript persistence and deduplication
  const interimRef = useRef<string>("");
  const lastFinalSegmentRef = useRef<string>("");
  const flushedInterimRef = useRef<string | null>(null);

  // Screen Wake Lock
  const wakeLockRef = useRef<any>(null);

  isPausedRef.current = paused;
  currentLangRef.current = language;

  // Check Web Speech API availability on mount
  useEffect(() => {
    const SpeechClass =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechClass) {
      setSupported(false);
      setError("Web Speech API is not supported in this browser. Please use Google Chrome.");
    }
  }, []);

  // Screen Wake Lock handlers
  const requestWakeLock = useCallback(async () => {
    try {
      if (
        typeof navigator !== "undefined" &&
        "wakeLock" in navigator &&
        !wakeLockRef.current
      ) {
        const lock = await (navigator as any).wakeLock.request("screen");
        wakeLockRef.current = lock;
        lock.addEventListener?.("release", () => {
          wakeLockRef.current = null;
        });
      }
    } catch {
      // Wake lock not supported, rejected, or disabled by policy
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    try {
      if (wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
      }
    } catch {
      // ignore
    }
  }, []);

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const clearWatchdog = useCallback(() => {
    if (watchdogIntervalRef.current !== null) {
      window.clearInterval(watchdogIntervalRef.current);
      watchdogIntervalRef.current = null;
    }
  }, []);

  const clearPruneInterval = useCallback(() => {
    if (pruneIntervalRef.current !== null) {
      window.clearInterval(pruneIntervalRef.current);
      pruneIntervalRef.current = null;
    }
  }, []);

  // 4. Clean up any existing recognition instance completely before creating a new one
  const cleanupRecognition = useCallback(() => {
    if (recognitionRef.current) {
      const prev = recognitionRef.current;
      prev.onstart = null;
      prev.onaudiostart = null;
      prev.onspeechstart = null;
      prev.onresult = null;
      prev.onerror = null;
      prev.onend = null;
      try {
        prev.abort();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    isSessionActiveRef.current = false;
  }, []);

  // Rolling transcript window pruning (60 seconds)
  const startPruning = useCallback(() => {
    clearPruneInterval();
    pruneIntervalRef.current = window.setInterval(() => {
      if (!shouldListenRef.current) return;
      const now = Date.now();
      setSegments((prev) => {
        const filtered = prev.filter((seg) => now - seg.ts <= ROLLING_WINDOW_MS);
        return filtered.length === prev.length ? prev : filtered;
      });
    }, 1000);
  }, [clearPruneInterval]);

  // Safe start of recognition instance
  const safeStart = useCallback(() => {
    clearRestartTimer();
    const SpeechClass =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechClass || isPausedRef.current || !shouldListenRef.current) {
      return;
    }

    // Never create overlapping instances: abort previous instance and null handlers first
    cleanupRecognition();

    try {
      const recognition = new SpeechClass();
      // 5. Settings
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = currentLangRef.current;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        isSessionActiveRef.current = true;
        lastActivityTimeRef.current = Date.now();
        audioCaptureRetriesRef.current = 0;
        if (!shouldListenRef.current) {
          cleanupRecognition();
          return;
        }
        // Clear transient network/audio error on successful connection
        setError((prev) => (prev?.startsWith("Microphone permission") ? prev : null));
      };

      recognition.onaudiostart = () => {
        lastActivityTimeRef.current = Date.now();
        audioCaptureRetriesRef.current = 0;
      };

      recognition.onspeechstart = () => {
        lastActivityTimeRef.current = Date.now();
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        if (!shouldListenRef.current || isPausedRef.current) {
          return;
        }

        // 9. Watchdog activity refresh
        lastActivityTimeRef.current = Date.now();
        // 3. Reset network backoff & audio capture retries on successful result
        networkBackoffRef.current = 1000;
        audioCaptureRetriesRef.current = 0;
        setError((prev) => (prev?.startsWith("Microphone permission") ? prev : null));

        let interimAccumulator = "";
        const now = Date.now();
        const newFinalSegments: TranscriptSegment[] = [];

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const text = result[0]?.transcript || "";
          if (result.isFinal) {
            const trimmed = text.trim();
            if (trimmed) {
              const lower = trimmed.toLowerCase();
              const lastFinal = lastFinalSegmentRef.current.trim().toLowerCase();
              const flushed = flushedInterimRef.current?.trim().toLowerCase();

              // 6. Dedupe: do not emit duplicate segment right across a restart
              const isDuplicateOfFlushed = Boolean(flushed && lower === flushed);
              const isImmediateDuplicate = Boolean(lastFinal && lower === lastFinal);

              if (isDuplicateOfFlushed || isImmediateDuplicate) {
                flushedInterimRef.current = null;
              } else {
                flushedInterimRef.current = null;
                newFinalSegments.push({ text: trimmed, ts: now });
                lastFinalSegmentRef.current = trimmed;
              }
            }
          } else {
            interimAccumulator += text;
          }
        }

        if (newFinalSegments.length > 0 && shouldListenRef.current) {
          setSegments((prev) => {
            const cutoff = Date.now() - ROLLING_WINDOW_MS;
            const updated = [...prev, ...newFinalSegments].filter(
              (seg) => seg.ts >= cutoff
            );
            return updated;
          });
        }

        if (shouldListenRef.current) {
          interimRef.current = interimAccumulator;
          setInterim(interimAccumulator);
        }
      };

      recognition.onerror = (ev: SpeechRecognitionErrorEvent) => {
        if (!shouldListenRef.current) return;
        const errType = ev.error;

        // 3a. "no-speech" and "aborted": ignore, onend will restart
        if (errType === "no-speech" || errType === "aborted") {
          return;
        }

        // 3d. "not-allowed" and "service-not-allowed": permission denied -> stop retrying
        if (errType === "not-allowed" || errType === "service-not-allowed") {
          setError("Microphone permission denied. Please allow microphone access in your browser.");
          shouldListenRef.current = false;
          setListening(false);
          releaseWakeLock();
          clearWatchdog();
          clearRestartTimer();
          return;
        }

        // 3b. "network": retry with backoff (1s, 2s, 4s, capped at 5s)
        if (errType === "network") {
          restartDelayRef.current = networkBackoffRef.current;
          networkBackoffRef.current = Math.min(networkBackoffRef.current * 2, 5000);
          setError("Network error connecting to speech recognition service. Retrying...");
          return;
        }

        // 3c. "audio-capture": retry a few times, then show existing error state
        if (errType === "audio-capture") {
          audioCaptureRetriesRef.current += 1;
          if (audioCaptureRetriesRef.current >= MAX_AUDIO_CAPTURE_RETRIES) {
            setError("Microphone not available or audio capture failed. Please check your microphone.");
            shouldListenRef.current = false;
            setListening(false);
            releaseWakeLock();
            clearWatchdog();
            clearRestartTimer();
          } else {
            restartDelayRef.current = 500;
          }
          return;
        }

        setError(`Speech recognition error: ${errType}${ev.message ? ` (${ev.message})` : ""}`);
      };

      recognition.onend = () => {
        isSessionActiveRef.current = false;

        // 6. Don't lose words at a restart: treat any pending interim text as final
        const pendingInterim = interimRef.current.trim();
        if (pendingInterim && shouldListenRef.current) {
          const lower = pendingInterim.toLowerCase();
          const lastFinal = lastFinalSegmentRef.current.trim().toLowerCase();
          if (lower !== lastFinal) {
            const now = Date.now();
            setSegments((prev) => {
              const cutoff = Date.now() - ROLLING_WINDOW_MS;
              return [...prev, { text: pendingInterim, ts: now }].filter(
                (seg) => seg.ts >= cutoff
              );
            });
            lastFinalSegmentRef.current = pendingInterim;
            flushedInterimRef.current = lower;
          }
        }
        interimRef.current = "";
        setInterim("");

        // 1 & 2. Auto-restart: if shouldListenRef is true, restart after short delay
        if (shouldListenRef.current && !isPausedRef.current) {
          clearRestartTimer();
          const delay = restartDelayRef.current;
          restartDelayRef.current = DEFAULT_RESTART_DELAY_MS; // reset to 250ms for next restart

          restartTimerRef.current = window.setTimeout(() => {
            if (shouldListenRef.current && !isPausedRef.current) {
              safeStart();
            }
          }, delay);
        }
      };

      recognitionRef.current = recognition;

      // 2. Wrap start() in try/catch to ignore InvalidStateError
      try {
        recognition.start();
      } catch (err: any) {
        if (err?.name === "InvalidStateError") {
          // Already started, ignore
        } else if (shouldListenRef.current) {
          setError(`Failed to start recognition: ${err.message || err}`);
        }
      }
    } catch (err: any) {
      if (shouldListenRef.current) {
        setError(`Failed to initialize speech recognition: ${err.message || err}`);
      }
    }
  }, [clearRestartTimer, cleanupRecognition, releaseWakeLock, clearWatchdog]);

  // 9. Watchdog: abort and restart if no start/audioStart/result has arrived for 15s
  const startWatchdog = useCallback(() => {
    clearWatchdog();
    lastActivityTimeRef.current = Date.now();
    watchdogIntervalRef.current = window.setInterval(() => {
      if (!shouldListenRef.current || isPausedRef.current) {
        return;
      }
      // If a restart timer is already pending, let it run
      if (restartTimerRef.current !== null) {
        return;
      }
      const elapsed = Date.now() - lastActivityTimeRef.current;
      if (elapsed >= WATCHDOG_TIMEOUT_MS) {
        lastActivityTimeRef.current = Date.now();

        // Flush pending interim before restarting
        const pendingInterim = interimRef.current.trim();
        if (pendingInterim) {
          const lower = pendingInterim.toLowerCase();
          const lastFinal = lastFinalSegmentRef.current.trim().toLowerCase();
          if (lower !== lastFinal) {
            const now = Date.now();
            setSegments((prev) => {
              const cutoff = Date.now() - ROLLING_WINDOW_MS;
              return [...prev, { text: pendingInterim, ts: now }].filter(
                (seg) => seg.ts >= cutoff
              );
            });
            lastFinalSegmentRef.current = pendingInterim;
            flushedInterimRef.current = lower;
          }
          interimRef.current = "";
          setInterim("");
        }

        cleanupRecognition();
        safeStart();
      }
    }, 2000);
  }, [clearWatchdog, cleanupRecognition, safeStart]);

  // Public start handler
  const start = useCallback(() => {
    const SpeechClass =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechClass) {
      setError("Web Speech API is not supported in this browser. Please use Google Chrome.");
      return;
    }
    setError(null);
    shouldListenRef.current = true;
    setListening(true);
    restartDelayRef.current = DEFAULT_RESTART_DELAY_MS;
    networkBackoffRef.current = 1000;
    audioCaptureRetriesRef.current = 0;
    flushedInterimRef.current = null;
    startPruning();
    startWatchdog();
    requestWakeLock();
    safeStart();
  }, [safeStart, startPruning, startWatchdog, requestWakeLock]);

  // 11. Public stop handler: cleanup everything and release locks
  const stop = useCallback(() => {
    shouldListenRef.current = false;
    isSessionActiveRef.current = false;
    clearRestartTimer();
    clearWatchdog();
    clearPruneInterval();
    networkBackoffRef.current = 1000;
    audioCaptureRetriesRef.current = 0;

    cleanupRecognition();
    releaseWakeLock();

    setListening(false);
    setInterim("");
    interimRef.current = "";
    lastFinalSegmentRef.current = "";
    flushedInterimRef.current = null;
    setSegments([]); // clear live transcript text
  }, [clearRestartTimer, clearWatchdog, clearPruneInterval, cleanupRecognition, releaseWakeLock]);

  const clearTranscript = useCallback(() => {
    setSegments([]);
    setInterim("");
    interimRef.current = "";
    lastFinalSegmentRef.current = "";
    flushedInterimRef.current = null;
  }, []);

  // 10. Tab visibility listener
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        if (shouldListenRef.current && !isPausedRef.current) {
          requestWakeLock();
          const isRunning = isSessionActiveRef.current && recognitionRef.current !== null;
          const elapsed = Date.now() - lastActivityTimeRef.current;
          if (!isRunning || elapsed >= WATCHDOG_TIMEOUT_MS) {
            lastActivityTimeRef.current = Date.now();
            cleanupRecognition();
            safeStart();
          }
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [safeStart, cleanupRecognition, requestWakeLock]);

  // 8. Language switching: stop cleanly, keep shouldListenRef true, restart with new lang
  useEffect(() => {
    currentLangRef.current = language;

    if (shouldListenRef.current && !isPausedRef.current) {
      // Flush interim before switching
      const pendingInterim = interimRef.current.trim();
      if (pendingInterim) {
        const lower = pendingInterim.toLowerCase();
        const lastFinal = lastFinalSegmentRef.current.trim().toLowerCase();
        if (lower !== lastFinal) {
          const now = Date.now();
          setSegments((prev) => {
            const cutoff = Date.now() - ROLLING_WINDOW_MS;
            return [...prev, { text: pendingInterim, ts: now }].filter(
              (seg) => seg.ts >= cutoff
            );
          });
          lastFinalSegmentRef.current = pendingInterim;
          flushedInterimRef.current = lower;
        }
        interimRef.current = "";
        setInterim("");
      }

      cleanupRecognition();
      clearRestartTimer();

      restartTimerRef.current = window.setTimeout(() => {
        if (shouldListenRef.current && !isPausedRef.current) {
          safeStart();
        }
      }, 150);
    }
  }, [language, cleanupRecognition, clearRestartTimer, safeStart]);

  // Handle paused flag change
  useEffect(() => {
    isPausedRef.current = paused;
    if (paused) {
      clearRestartTimer();
      clearWatchdog();
      releaseWakeLock();
      const pendingInterim = interimRef.current.trim();
      if (pendingInterim) {
        const lower = pendingInterim.toLowerCase();
        const lastFinal = lastFinalSegmentRef.current.trim().toLowerCase();
        if (lower !== lastFinal) {
          const now = Date.now();
          setSegments((prev) => {
            const cutoff = Date.now() - ROLLING_WINDOW_MS;
            return [...prev, { text: pendingInterim, ts: now }].filter(
              (seg) => seg.ts >= cutoff
            );
          });
          lastFinalSegmentRef.current = pendingInterim;
          flushedInterimRef.current = lower;
        }
        interimRef.current = "";
        setInterim("");
      }
      cleanupRecognition();
    } else if (shouldListenRef.current) {
      requestWakeLock();
      startWatchdog();
      safeStart();
    }
  }, [paused, clearRestartTimer, clearWatchdog, releaseWakeLock, cleanupRecognition, requestWakeLock, startWatchdog, safeStart]);

  // 11. Cleanup on unmount
  useEffect(() => {
    return () => {
      shouldListenRef.current = false;
      isSessionActiveRef.current = false;
      clearRestartTimer();
      clearWatchdog();
      clearPruneInterval();
      cleanupRecognition();
      releaseWakeLock();
    };
  }, [clearRestartTimer, clearWatchdog, clearPruneInterval, cleanupRecognition, releaseWakeLock]);

  // Compute concatenated rolling 60-second transcript
  const transcript = segments.map((s) => s.text).join(" ");

  return {
    transcript,
    interim,
    listening,
    supported,
    error,
    start,
    stop,
    clearTranscript,
    scoringText: transcript,
  };
}
