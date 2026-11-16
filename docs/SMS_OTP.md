# SMS login codes (OTP) with your own Android phone (no SMS subscription)

CareTrack sends real SMS login codes through **SMS Gateway for Android**, an open-source app
(Apache-2.0, <https://sms-gate.app>) that turns an Android phone with a SIM into an SMS sender.

## How it works

```
User signs in ──► Render server creates a 6-digit code (stored only as a hash)
                    │  HTTPS + secret username/password
                    ▼
             api.sms-gate.app (free cloud relay)
                    │  the phone keeps an OUTBOUND connection to the relay
                    ▼  (push notification / persistent connection, no public IP or open port needed)
        Gateway phone (your Android + Philippine SIM) ──SMS──► user's phone
User types the code ──► Render checks it (5 minutes, 5 tries, one use) ──► signed in
```

- The phone can be anywhere with mobile data or Wi-Fi; Render never connects to the phone directly.
- The relay credentials live only on Render (environment variables). The app and website never see
  them, and never see real users' codes.

## Cost (honest)

| Item | Cost |
|---|---|
| SMS Gateway for Android app | Free, open source |
| Cloud relay (api.sms-gate.app) | Free ("completely free", soft limits only for very high volume, >10k/day) |
| CareTrack / Render / Supabase changes | None |
| **Each text** | **Normal SIM texting charge** (regular prepaid text ≈ ₱1), or use an unlimited-text promo on that SIM (e.g. TM UNLIALLNET10 ≈ ₱10/day, Smart/TNT/Globe have similar). Check the promo's terms: some don't cover automated sending. |

So there is **no gateway subscription and no purchased API credits**, but the SIM's own texting
charges or promo still apply.

## Demo accounts vs real accounts

| | Demo accounts (`admin@`, `doctor@`, `doctor2@`, `patient@`, `caregiver@caretrack.com`) | Regular accounts |
|---|---|---|
| Code | Shown on the sign-in screen | Sent by SMS (or email) only, never shown |
| SMS sent | Never | Yes, to the account's mobile number |
| Phone number needed | No | Yes, for SMS |

Which accounts are demo accounts is fixed in the server code (`artifacts/api-server/src/lib/otp-delivery.ts`),
not decided by the app, so a regular user can't switch on the on-screen code.

A regular user's phone number is marked **verified** the first time they sign in with an SMS code
sent to it (shown under *My account* and in *Team access*). Changing the number makes it unverified again.

## Set-up (about 15 minutes)

### 1. The gateway phone
Use any Android phone (Android 5+) with a Philippine SIM that has load or an unli-text promo.

1. Install **SMS Gateway for Android** from <https://sms-gate.app> (or its GitHub releases page).
2. Open it, allow the **SMS** permission (on Android 15+ you may need to allow it in
   Settings › Apps › SMS Gateway › Permissions).
3. Turn on **Cloud server** and tap **Online / Start**. The app registers itself and shows a
   **username** and **password** in the Cloud Server section. Keep them secret.
4. Settings › Apps › SMS Gateway › Battery: choose **Unrestricted** (no battery optimization),
   so Android doesn't put it to sleep (see <https://dontkillmyapp.com> for your brand).
5. Keep the phone **on, charged, with signal and mobile data or Wi-Fi**.

### 2. Render
Dashboard › **caretrack-app** › **Environment** › add:

| Key | Value |
|---|---|
| `SMS_PROVIDER` | `sms-gate` |
| `SMS_GATEWAY_USER` | the username from the app |
| `SMS_GATEWAY_PASSWORD` | the password from the app |

Save. Render restarts the server in 1–2 minutes. No app reinstall is needed.

Optional: `SMS_DOSE_REMINDERS=false` stops CareTrack from also texting dose reminders and
missed-dose alerts to patients (saves load). They are on by default once SMS is set up.

### 3. Test
1. Sign in to the website as `admin@caretrack.com` › **Team access** › **Delivery test** (SMS) ›
   enter **your** mobile number. You should receive "CareTrack test message…".
2. Give a real (non-demo) account your mobile number (Team access › Edit, or the patient profile),
   sign in with it, choose **Text message**, and enter the code you receive.

## If a code doesn't arrive
- The sign-in screen says so ("The CareTrack SMS phone may be off or offline"); the code is not shown.
- Check the gateway phone: app running and **Online**, signal, load/promo, battery optimization off.
- The text expires on the relay after 5 minutes, so an old code is never delivered late.
- The user can choose **email** instead while the phone is fixed.

## Security notes
- Codes: cryptographically random, stored hashed, 5-minute expiry, 5 wrong attempts max,
  30 seconds between codes, single use, and 20 code requests per 15 minutes per network.
- The relay sees the phone number and message text (the code) while passing it to the phone. The
  code is useless without the account password and expires in 5 minutes. For full privacy the
  project supports end-to-end encryption or a self-hosted relay; neither is set up here.
- Android itself may ask for permission if an app sends many SMS quickly; the app's
  Settings › Messages › Limits can space messages out.
