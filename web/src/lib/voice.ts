export const WARNINGS: Record<string, string> = {
  "en-IN": "Warning. Real police never do this. Hang up now and call one nine three zero.",
  "hi-IN": "सावधान। असली पुलिस ऐसा कभी नहीं करती। फोन काट दीजिए और 1930 पर कॉल कीजिए।",
  "kn-IN": "ಎಚ್ಚರಿಕೆ. ನಿಜವಾದ ಪೊಲೀಸರು ಹೀಗೆ ಮಾಡುವುದಿಲ್ಲ. ಕರೆ ಕಟ್ ಮಾಡಿ ಮತ್ತು 1930 ಗೆ ಕರೆ ಮಾಡಿ.",
};

/**
 * Finds the best available SpeechSynthesisVoice for the requested language.
 * Falls back: requested -> hi-IN -> en-IN -> any available voice.
 */
function findVoice(lang: string, voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (voices.length === 0) {
    return null;
  }

  const normalizedLang = lang.toLowerCase();
  const langPrefix = normalizedLang.split("-")[0];

  // 1. Direct match for requested lang (e.g. kn-IN, then kn)
  const exact = voices.find((v) => v.lang.toLowerCase() === normalizedLang);
  if (exact) return exact;

  const prefixMatch = voices.find((v) => v.lang.toLowerCase().startsWith(langPrefix));
  if (prefixMatch) return prefixMatch;

  // 2. Fall back to hi-IN
  const hindi = voices.find(
    (v) => v.lang.toLowerCase() === "hi-in" || v.lang.toLowerCase().startsWith("hi")
  );
  if (hindi) return hindi;

  // 3. Fall back to en-IN / English
  const english = voices.find(
    (v) => v.lang.toLowerCase() === "en-in" || v.lang.toLowerCase().startsWith("en")
  );
  if (english) return english;

  // 4. Default fallback
  return voices[0] || null;
}

/**
 * Speaks the warning message in the specified language using the Web Speech API.
 * Never throws; if speechSynthesis is missing, it safely exits.
 */
export function speakWarning(lang: string): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return;
  }

  try {
    // Cancel any ongoing speech first
    window.speechSynthesis.cancel();

    const text = WARNINGS[lang] || WARNINGS["en-IN"];
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;

    const voices = window.speechSynthesis.getVoices();
    const voice = findVoice(lang, voices);
    if (voice) {
      utterance.voice = voice;
    }

    utterance.rate = 0.95;
    utterance.pitch = 1.0;

    window.speechSynthesis.speak(utterance);
  } catch (err) {
    console.error("speakWarning failed:", err);
  }
}

/**
 * Cancels any active speech synthesis output.
 */
export function stopWarning(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return;
  }

  try {
    window.speechSynthesis.cancel();
  } catch (err) {
    console.error("stopWarning failed:", err);
  }
}
