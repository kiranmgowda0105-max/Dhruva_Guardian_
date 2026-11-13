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
}

const ROLLING_WINDOW_MS = 60 * 1000; // 60 seconds

export function useSpeechListener(
  options: UseSpeechListenerOptions = {}
): UseSpeechListenerReturn {
  const { language = "en-IN", paused = false } = options;

  const [supported, setSupported] = useState<boolean>(true);
  const [listening, setListening] = useState<boolean>(false);
  const [interim, setInterim] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);

  // Refs for state accessed inside event callbacks
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const wantListening = useRef<boolean>(false);
  const isPausedRef = useRef<boolean>(paused);
  const restartTimerRef = useRef<number | null>(null);
  const pruneIntervalRef = useRef<number | null>(null);
  const currentLangRef = useRef<SpeechLanguage>(language);

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

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const clearPruneInterval = useCallback(() => {
    if (pruneIntervalRef.current !== null) {
      window.clearInterval(pruneIntervalRef.current);
      pruneIntervalRef.current = null;
    }
  }, []);

  const startPruning = useCallback(() => {
    clearPruneInterval();
    pruneIntervalRef.current = window.setInterval(() => {
      if (!wantListening.current) return;
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
    if (!SpeechClass || isPausedRef.current || !wantListening.current) {
      return;
    }

    // Clean up previous instance completely before creating a new one
    if (recognitionRef.current) {
      const prev = recognitionRef.current;
      prev.onstart = null;
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

    try {
      const recognition = new SpeechClass();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = currentLangRef.current;

      recognition.onstart = () => {
        if (!wantListening.current) {
          try {
            recognition.abort();
          } catch {
            // ignore
          }
          return;
        }
        setError(null);
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        // Drop any late result immediately if monitoring was stopped or paused
        if (!wantListening.current || isPausedRef.current) {
          return;
        }

        let interimAccumulator = "";
        const now = Date.now();
        const newFinalSegments: TranscriptSegment[] = [];

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const text = result[0]?.transcript || "";
          if (result.isFinal) {
            const trimmed = text.trim();
            if (trimmed) {
              newFinalSegments.push({ text: trimmed, ts: now });
            }
          } else {
            interimAccumulator += text;
          }
        }

        if (newFinalSegments.length > 0 && wantListening.current) {
          setSegments((prev) => {
            const cutoff = Date.now() - ROLLING_WINDOW_MS;
            const updated = [...prev, ...newFinalSegments].filter(
              (seg) => seg.ts >= cutoff
            );
            return updated;
          });
        }

        if (wantListening.current) {
          setInterim(interimAccumulator);
        }
      };

      recognition.onerror = (ev: SpeechRecognitionErrorEvent) => {
        if (!wantListening.current) return;
        const errType = ev.error;
        if (errType === "no-speech") {
          return;
        }

        if (errType === "not-allowed") {
          setError("Microphone permission denied. Please allow microphone access in your browser.");
          wantListening.current = false;
          setListening(false);
          return;
        }

        if (errType === "network") {
          setError("Network error connecting to speech recognition service.");
          return;
        }

        setError(`Speech recognition error: ${errType}${ev.message ? ` (${ev.message})` : ""}`);
      };

      recognition.onend = () => {
        setInterim("");
        // Automatically restart ONLY if wantListening is true and not paused
        if (wantListening.current && !isPausedRef.current) {
          clearRestartTimer();
          restartTimerRef.current = window.setTimeout(() => {
            if (wantListening.current) {
              safeStart();
            }
          }, 300);
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err: any) {
      if (wantListening.current) {
        setError(`Failed to start recognition: ${err.message || err}`);
      }
    }
  }, [clearRestartTimer]);

  const start = useCallback(() => {
    const SpeechClass =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechClass) {
      setError("Web Speech API is not supported in this browser.");
      return;
    }
    setError(null);
    wantListening.current = true;
    setListening(true);
    startPruning();
    safeStart();
  }, [safeStart, startPruning]);

  const stop = useCallback(() => {
    // 1. Set wantListening false FIRST so no new/pending events are accepted
    wantListening.current = false;
    clearRestartTimer();
    clearPruneInterval();

    // 2. Tear down active recognition instance immediately
    if (recognitionRef.current) {
      const rec = recognitionRef.current;
      rec.onstart = null;
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null; // null onend handler so it does not auto-restart
      try {
        rec.abort(); // call abort() instead of stop()
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }

    setListening(false);
    setInterim("");
    setSegments([]); // clear live transcript text
  }, [clearRestartTimer, clearPruneInterval]);

  const clearTranscript = useCallback(() => {
    setSegments([]);
    setInterim("");
  }, []);

  // Handle paused flag change
  useEffect(() => {
    if (paused) {
      clearRestartTimer();
      setInterim("");
      if (recognitionRef.current) {
        const rec = recognitionRef.current;
        rec.onend = null;
        try {
          rec.abort();
        } catch {
          // ignore
        }
        recognitionRef.current = null;
      }
    } else if (wantListening.current) {
      safeStart();
    }
  }, [paused, clearRestartTimer, safeStart]);

  // Handle language switch: restart recognition if actively listening
  useEffect(() => {
    if (wantListening.current && !paused) {
      safeStart();
    }
  }, [language, paused, safeStart]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wantListening.current = false;
      clearRestartTimer();
      clearPruneInterval();
      if (recognitionRef.current) {
        const rec = recognitionRef.current;
        rec.onstart = null;
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        try {
          rec.abort();
        } catch {
          // ignore
        }
        recognitionRef.current = null;
      }
    };
  }, [clearRestartTimer, clearPruneInterval]);

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
  };
}
