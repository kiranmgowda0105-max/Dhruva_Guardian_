export interface Stage {
  id: number;
  name: string;
  weight: number;
  phrases: string[];
}

export const STAGES: Stage[] = [
  {
    id: 1,
    name: "Authority claim",
    weight: 10,
    phrases: [
      "cbi",
      "cyber crime",
      "from the police",
      "i am from police",
      "customs officer",
      "trai",
      "police station",
      "mumbai police",
      "narcotics",
      "bank officer",
      "from rbi",
    ],
  },
  {
    id: 2,
    name: "Accusation",
    weight: 20,
    phrases: [
      "money laundering",
      "aadhaar is linked",
      "parcel",
      "drugs found",
      "account will be blocked",
      "sim will be blocked",
      "case registered",
      "fir",
      "aapka account band",
      "nimma account block",
    ],
  },
  {
    id: 3,
    name: "Isolation and urgency",
    weight: 25,
    phrases: [
      "digital arrest",
      "don't tell anyone",
      "do not tell anyone",
      "tell no one",
      "dont disconnect",
      "stay on the call",
      "stay on video",
      "kisi ko mat batana",
      "yarigu helbedi",
      "ಯಾರಿಗೂ ಹೇಳಬೇಡಿ",
    ],
  },
  {
    id: 4,
    name: "Safe account payment demand",
    weight: 30,
    phrases: [
      "safe account",
      "rbi account",
      "verification account",
      "transfer the money",
      "pay the fine",
      "paise transfer karo",
      "hana transfer maadi",
      "ಹಣ ವರ್ಗಾಯಿಸಿ",
    ],
  },
  {
    id: 5,
    name: "OTP / screen-share",
    weight: 15,
    phrases: [
      "otp",
      "aadhaar number",
      "pan number",
      "card number",
      "cvv",
      "upi pin",
      "anydesk",
      "teamviewer",
      "share your screen",
      "screen share",
      "otp batao",
      "otp heli",
      "ಓಟಿಪಿ",
    ],
  },
];

