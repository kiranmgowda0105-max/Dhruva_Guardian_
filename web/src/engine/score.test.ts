import { describe, it, expect } from "vitest";
import { score, matchesPhrase, YELLOW_AT, RED_AT } from "./score";
import { STAGES } from "./rules";

describe("Scam detection engine", () => {
  describe("Thresholds, weights, and deduplication", () => {
    it("exports threshold constants YELLOW_AT = 25 and RED_AT = 50", () => {
      expect(YELLOW_AT).toBe(25);
      expect(RED_AT).toBe(50);
    });

    it("ensures every stage weight is less than RED_AT", () => {
      for (const stage of STAGES) {
        expect(stage.weight).toBeLessThan(RED_AT);
      }
    });

    it("ensures no duplicate phrases exist within or across stages", () => {
      const allPhrases: string[] = [];
      for (const stage of STAGES) {
        for (const phrase of stage.phrases) {
          allPhrases.push(phrase.toLowerCase().trim());
        }
      }
      const uniquePhrases = new Set(allPhrases);
      expect(allPhrases.length).toBe(uniquePhrases.size);
    });
  });

  describe("Whole-word matching (matchesPhrase)", () => {
    it("verifies matchesPhrase does not match 'fir' in 'first' and 'otp' in 'hotpot'", () => {
      expect(matchesPhrase(["first"], ["fir"])).toBe(false);
      expect(matchesPhrase(["hotpot"], ["otp"])).toBe(false);
    });
  });

  describe("RED alerts", () => {
    it("flags FedEx drugs parcel and transfer to police with digital arrest as stages [1,2,3]", () => {
      const result = score(
        "this is fedex a parcel in your name contains drugs and fake passports your call is being transferred to mumbai police you are under digital arrest do not disconnect"
      );
      expect(result.level).toBe("red");
      expect(result.stagesHit).toEqual([1, 2, 3]);
    });

    it("flags CBI impersonation with money laundering accusation and verification payment as stages [1,2,4]", () => {
      const result = score(
        "i am calling from cbi your aadhaar is linked to money laundering transfer all your money to the rbi verification account it will be returned after verification"
      );
      expect(result.level).toBe("red");
      expect(result.stagesHit).toEqual([1, 2, 4]);
    });

    it("flags isolation and safe account transfer as stages [3,4]", () => {
      const result = score(
        "tell no one and move your money to the rbi safe account"
      );
      expect(result.level).toBe("red");
      expect(result.stagesHit).toEqual([3, 4]);
    });

    it("flags multi-stage authority, accusation, and isolation as stages [1,2,3]", () => {
      const result = score(
        "this is cbi your aadhaar is linked to money laundering do not tell anyone stay on the call"
      );
      expect(result.level).toBe("red");
      expect(result.stagesHit).toEqual([1, 2, 3]);
    });

    it("flags all five stages with total score 100", () => {
      const result = score(
        "i am from police a case registered against you do not tell anyone transfer all your money to the safe account and share the otp on anydesk"
      );
      expect(result.level).toBe("red");
      expect(result.total).toBe(100);
      expect(result.stagesHit).toEqual([1, 2, 3, 4, 5]);
    });

    it("flags Hinglish scam call as stages [1,2,3,4]", () => {
      const result = score(
        "main mumbai police se bol raha hoon aapka aadhaar money laundering case mein hai kisi ko mat batana paise safe account mein daalo"
      );
      expect(result.level).toBe("red");
      expect(result.stagesHit).toEqual([1, 2, 3, 4]);
    });

    it("flags Hindi digital arrest call as stages [1,3,4]", () => {
      const result = score(
        "मैं सीबीआई से बोल रहा हूं आप डिजिटल अरेस्ट में हैं किसी को मत बताना पैसे सेफ अकाउंट में डालो"
      );
      expect(result.level).toBe("red");
      expect(result.stagesHit).toEqual([1, 3, 4]);
    });

    it("flags Kannada digital arrest call as stages [3,4]", () => {
      const result = score(
        "ಇದು ಡಿಜಿಟಲ್ ಅರೆಸ್ಟ್ ಯಾರಿಗೂ ಹೇಳಬೇಡಿ ಹಣವನ್ನು ಸೇಫ್ ಅಕೌಂಟ್ ಗೆ ಹಾಕಿ"
      );
      expect(result.level).toBe("red");
      expect(result.stagesHit).toEqual([3, 4]);
    });
  });

  describe("YELLOW warnings", () => {
    it("flags enforcement directorate and arrest warrant as stages [1,2]", () => {
      const result = score(
        "this is the enforcement directorate an arrest warrant has been issued"
      );
      expect(result.level).toBe("yellow");
      expect(result.stagesHit).toEqual([1, 2]);
    });

    it("flags drugs in parcel accusation and isolation as stages [2,3] with total 45", () => {
      const result = score(
        "drugs found in the parcel in your name do not tell anyone"
      );
      expect(result.level).toBe("yellow");
      expect(result.stagesHit).toEqual([2, 3]);
      expect(result.total).toBe(45);
    });
  });

  describe("GREEN benign conversations", () => {
    it("scores benign greeting as green", () => {
      const result = score("hello amma how are you did you eat lunch");
      expect(result.level).toBe("green");
      expect(result.total).toBe(0);
      expect(result.stagesHit).toEqual([]);
    });

    it("scores rent money transfer as green", () => {
      const result = score("i will transfer the money for rent tomorrow");
      expect(result.level).toBe("green");
      expect(result.total).toBe(0);
      expect(result.stagesHit).toEqual([]);
    });

    it("scores bank closing statement as green", () => {
      const result = score("the bank closes at five");
      expect(result.level).toBe("green");
      expect(result.total).toBe(0);
      expect(result.stagesHit).toEqual([]);
    });

    it("scores train station first as green", () => {
      const result = score("i will go straight to the train station first");
      expect(result.level).toBe("green");
      expect(result.total).toBe(0);
      expect(result.stagesHit).toEqual([]);
    });

    it("scores hotpot dinner mention as green", () => {
      const result = score("we ordered hotpot for dinner");
      expect(result.level).toBe("green");
      expect(result.total).toBe(0);
      expect(result.stagesHit).toEqual([]);
    });

    it("scores security deposit for flat as green", () => {
      const result = score("please pay the security deposit for the flat");
      expect(result.level).toBe("green");
      expect(result.total).toBe(0);
      expect(result.stagesHit).toEqual([]);
    });

    it("scores parcel delivery tomorrow as green", () => {
      const result = score("your parcel will be delivered tomorrow");
      expect(result.level).toBe("green");
      expect(result.total).toBe(0);
      expect(result.stagesHit).toEqual([]);
    });

    it("scores request for money by evening as green", () => {
      const result = score("send me the money by evening");
      expect(result.level).toBe("green");
      expect(result.total).toBe(0);
      expect(result.stagesHit).toEqual([]);
    });

    it("scores police station near temple as green", () => {
      const result = score("the police station is near the temple");
      expect(result.level).toBe("green");
      expect(result.stagesHit).toEqual([1]);
      expect(result.total).toBe(10);
      expect(result.total).toBeLessThan(YELLOW_AT);
    });
  });
});
