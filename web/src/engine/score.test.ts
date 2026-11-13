import { describe, it, expect } from "vitest";
import { score, YELLOW_AT, RED_AT } from "./score";

describe("Scam-stage scoring engine", () => {
  it("exports threshold constants", () => {
    expect(YELLOW_AT).toBe(25);
    expect(RED_AT).toBe(50);
  });

  describe("Must be red", () => {
    it("flags multi-stage authority + accusation + isolation as red", () => {
      const text =
        "this is cbi your aadhaar is linked to money laundering do not tell anyone stay on the call";
      const result = score(text);
      expect(result.level).toBe("red");
      expect(result.total).toBeGreaterThanOrEqual(RED_AT);
      expect(result.stagesHit).toEqual([1, 2, 3]);
      expect(result.matched).toContain("cbi");
      expect(result.matched).toContain("money laundering");
      expect(result.matched).toContain("aadhaar is linked");
      expect(result.matched).toContain("do not tell anyone");
      expect(result.matched).toContain("stay on the call");
    });

    it("flags isolation + safe account payment demand as red", () => {
      const text = "tell no one and move your money to the rbi safe account";
      const result = score(text);
      expect(result.level).toBe("red");
      expect(result.total).toBeGreaterThanOrEqual(RED_AT);
      expect(result.stagesHit).toEqual([3, 4]);
      expect(result.matched).toContain("tell no one");
      expect(result.matched).toContain("safe account");
    });
  });

  describe("Must be yellow", () => {
    it("flags accusation + isolation as yellow", () => {
      const text = "your parcel has drugs found do not tell anyone";
      const result = score(text);
      expect(result.level).toBe("yellow");
      expect(result.total).toBeGreaterThanOrEqual(YELLOW_AT);
      expect(result.total).toBeLessThan(RED_AT);
      expect(result.stagesHit).toEqual([2, 3]);
      expect(result.matched).toContain("parcel");
      expect(result.matched).toContain("drugs found");
      expect(result.matched).toContain("do not tell anyone");
    });
  });

  describe("Must be green", () => {
    it("scores benign greeting as green", () => {
      const result = score("hello how are you");
      expect(result.level).toBe("green");
      expect(result.total).toBe(0);
      expect(result.stagesHit).toEqual([]);
      expect(result.matched).toEqual([]);
    });

    it("scores benign transfer conversation as green", () => {
      const result = score("i will transfer rent tomorrow");
      expect(result.level).toBe("green");
      expect(result.total).toBe(0);
      expect(result.stagesHit).toEqual([]);
      expect(result.matched).toEqual([]);
    });

    it("scores bank mention without bank officer as green", () => {
      const result = score("the bank closes at five");
      expect(result.level).toBe("green");
      expect(result.total).toBe(0);
      expect(result.stagesHit).toEqual([]);
      expect(result.matched).toEqual([]);
    });
  });

  describe("Deduplication and Stage Weights", () => {
    it("scores repeating otp five times the same as once", () => {
      const single = score("otp");
      const repeated = score("otp otp otp otp otp");

      expect(single.total).toBe(15);
      expect(repeated.total).toBe(15);
      expect(repeated.level).toBe("green");
      expect(repeated.stagesHit).toEqual([5]);
    });
  });

  describe("Multilingual phrases (Kannada & Hindi)", () => {
    it("matches Kannada isolation phrase", () => {
      const result = score("ದಯವಿಟ್ಟು ಯಾರಿಗೂ ಹೇಳಬೇಡಿ");
      expect(result.stagesHit).toContain(3);
      expect(result.matched).toContain("ಯಾರಿಗೂ ಹೇಳಬೇಡಿ");
    });

    it("matches Kannada safe account phrase", () => {
      const result = score("ದಯವಿಟ್ಟು ಹಣ ವರ್ಗಾಯಿಸಿ");
      expect(result.stagesHit).toContain(4);
      expect(result.matched).toContain("ಹಣ ವರ್ಗಾಯಿಸಿ");
    });

    it("matches Hindi isolation phrase", () => {
      const result = score("kisi ko mat batana");
      expect(result.stagesHit).toContain(3);
      expect(result.matched).toContain("kisi ko mat batana");
    });
  });
});

