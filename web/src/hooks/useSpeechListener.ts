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

interface UseSpeechListenerReturn {
  transcript: string;
  interim: string;
  listening: boolean;
  supported: boolean;
  error: string | null;
  start: () => void;
  stop: () => void;
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
  const isListeningRef = useRef<boolean>(false);
  const isPausedRef = useRef<boolean>(paused);
  const restartTimerRef = useRef<number | null>(null);
  const currentLangRef = useRef<SpeechLanguage>(language);

  isListeningRef.current = listening;
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

  // Periodic pruning of segments older than 60 seconds
  useEffect(() => {
    const interval = window.setInterval(() => {
      const now = Date.now();
      setSegments((prev) => {
        const filtered = prev.filter((seg) => now - seg.ts <= ROLLING_WINDOW_MS);
        return filtered.length === prev.length ? prev : filtered;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, []);

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  // Safe start of recognition instance
  const safeStart = useCallback(() => {
    clearRestartTimer();
    const SpeechClass =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechClass || isPausedRef.current || !isListeningRef.current) {
      return;
    }

    // Clean up previous instance if any
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
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
        setError(null);
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        if (isPausedRef.current) {
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

        if (newFinalSegments.length > 0) {
          setSegments((prev) => {
            const cutoff = Date.now() - ROLLING_WINDOW_MS;
            const updated = [...prev, ...newFinalSegments].filter(
              (seg) => seg.ts >= cutoff
            );
            return updated;
          });
        }

        setInterim(interimAccumulator);
      };

      recognition.onerror = (ev: SpeechRecognitionErrorEvent) => {
        const errType = ev.error;
        if (errType === "no-speech") {
          // Normal idle condition; don't report as critical error
          return;
        }

        if (errType === "not-allowed") {
          setError("Microphone permission denied. Please allow microphone access in your browser.");
          setListening(false);
          isListeningRef.current = false;
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
        // Automatically restart if user still wants to listen and not paused
        if (isListeningRef.current && !isPausedRef.current) {
          clearRestartTimer();
          restartTimerRef.current = window.setTimeout(() => {
            safeStart();
          }, 300);
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err: any) {
      setError(`Failed to start recognition: ${err.message || err}`);
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
    setListening(true);
    isListeningRef.current = true;
    safeStart();
  }, [safeStart]);

  const stop = useCallback(() => {
    clearRestartTimer();
    setListening(false);
    isListeningRef.current = false;
    setInterim("");
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
  }, [clearRestartTimer]);

  // Handle paused flag change
  useEffect(() => {
    if (paused) {
      clearRestartTimer();
      setInterim("");
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
        recognitionRef.current = null;
      }
    } else if (isListeningRef.current) {
      safeStart();
    }
  }, [paused, clearRestartTimer, safeStart]);

  // Handle language switch: restart recognition if actively listening
  useEffect(() => {
    if (isListeningRef.current && !paused) {
      safeStart();
    }
  }, [language, paused, safeStart]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearRestartTimer();
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // ignore
        }
        recognitionRef.current = null;
      }
    };
  }, [clearRestartTimer]);

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
  };
}
