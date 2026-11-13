# Dhruva: context

## What it is
[One paragraph from the PDF: the problem, who it protects, what it does]

## Stack
- api/: FastAPI (Python), state in memory, Telegram bot, token from the TG_TOKEN environment variable
- web/: Vite + React + TypeScript, Web Speech API (kn-IN, hi-IN, en-IN)
- android/: Kotlin, foreground service polling /poll (built later in Android Studio)

## API contract
- POST /event: [{"code": "DEMO01", "level": "red", "score": 0.0, "stage": 1, "matched": ["..."], "ts": 0}] -> ["ok": true]
- GET /poll: [code=DEMO01&since=<ts>:] -> ["event": {...} or null]
- POST /payment: [request JSON] -> [response JSON]
- GET/POST /voice/{code}: [upload and download details]

## Demo values
- Family code: DEMO01

## Stages and weights
1. [Authority claim ]: weight [10]
2. [ Accusation]: weight [20]
3. [Isolation and urgency]: weight [25]
4. [Safe account payment demand]: weight [30]
5. [OTP / screen-share]: weight [15]
Red threshold: [50]
Yellow threshold : [25]

## Working rules
- Edit only the folder named in the task (api/, web/ or android/).
- Never change the API contract without asking me.
- Never put secrets in code, prompts or commits.
- Commit after each working step.
- Start every task by reading this file, and update the Status section when a task is done.

## Status
- [x] Project skeleton
- [x] Backend /event and /poll
- [x] Web listener hook
- [x] Stage engine
- [x] UI and red overlay
- [x] Fake RED button
- [ ] Deploy backend
- [x] Telegram and voice
- [x] Voice warning
- [x] 1930 evidence pack
- [x] Android app build (Dhruva Guardian)
- [x] Reliable backend alerts (/alerts/latest, monotonic ID, 60s expiry)
- [x] Background GuardianService & notifications when app is closed
- [x] Full-screen over-lockscreen AlertActivity & wakeup (Android 15)
- [x] SYSTEM_ALERT_WINDOW permission and overlay settings button
- [x] Lockscreen alert diagnosis & fresh high-importance channel (v2)
- [x] Auto-disconnect active phone call via TelecomManager & manual fallback warning
- [x] AccessibilityService payment app blocker (Protected Mode for 20 minutes)



