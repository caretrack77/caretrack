# CareTrack Android app

The Android app is the existing CareTrack web app packaged with [Capacitor](https://capacitorjs.com).
The screens are bundled inside the APK; the app talks to the same CareTrack API server and database
as the website, so anything done on the phone appears on the web (and the other way round).

## How it fits together

| Part | Where | Notes |
|---|---|---|
| Screens | `artifacts/caretrack/src` (same code as the website) | Built into `dist/public`, copied into the APK by `cap sync` |
| Android project | `artifacts/caretrack/android` | Normal Android Studio / Gradle project |
| App settings | `artifacts/caretrack/capacitor.config.ts` | App ID `com.caretrack.app`, splash, notification icon |
| Native features | `src/native.ts`, `src/native-notifications.ts` | Do nothing in a normal browser |
| API server | `artifacts/api-server` (unchanged deployment) | Accepts the app's bearer token; CORS allows the app origin |

**Sign-in.** Browsers keep using HTTP-only cookies. The app can't use cross-site cookies, so the server
hands it its session token in the `x-caretrack-session` response header when the request carries
`x-caretrack-client: android-app`. The app stores the token in app-private storage and sends it as
`Authorization: Bearer …`. Only the token's hash is stored on the server, sign-out deletes it, and
changing the password signs out other devices, exactly as on the web. Roles and patient-access checks
are the same server-side checks the website uses.

**Server address.** Nothing is hardcoded. Either set `CARETRACK_API_URL=https://your-server` in the
root `.env` before building (patients then never see the question), or leave it empty and the app asks
for the address on first launch ("Connect to your CareTrack server"). It must be **HTTPS**; the app
refuses plain HTTP. The address can be changed later from the sign-in screen ("Server: … · Change").

**Secrets.** The APK contains no database credentials, API keys or session secrets: only the public
server address. All secrets stay in the server's `.env`.

## Notifications

| Notification | How it is delivered in the app | Works offline / app closed |
|---|---|---|
| Medication reminders | Scheduled as Android alarms from the dose list (IDs = dose IDs, so no duplicates; cancelled when a dose is logged) | Yes |
| Wellness tips (hydration, health tips, motivation, quotes) | The next 5 days are scheduled as Android alarms, 2 or 4 per day between 8 AM and 9 PM, no repeats; today's are personalized from today's doses | Yes |
| Care-team notifications (messages, missed-dose alerts, appointments…) | In-app bell, refreshed live while the app is open (event stream + polling) | Shown when the app is next opened online |

Permissions: the app asks for notification permission once after sign-in (Android 13+). If Android
delays alarms, the notification panel shows **Allow exact reminder times** (Android 12+ "Alarms &
reminders"). Scheduled alarms survive a phone restart. Signing out cancels every scheduled reminder
and tip on the phone. Each kind has its own Android channel (Settings › Apps › CareTrack ›
Notifications), so users can mute tips without muting medication reminders.

## Offline

- Pages and recently loaded data are cached by the existing service worker (it now also caches the
  API responses from the configured server), so the app opens and shows saved information offline.
- Doses logged offline are queued with their original time and synced automatically when the
  connection returns (same queue as the website). The offline banner shows the status.
- Live updates reconnect automatically after a drop.
- Reports and lab files need a connection to download.

## Building the APK

Requirements: Node 22+, pnpm, Android Studio (its bundled JDK 21 and Android SDK 36).

```powershell
# 1. (optional) put the server address in the root .env
#    CARETRACK_API_URL=https://caretrack.example.com
# 2. release signing (once): copy android/keystore.properties.example to android/keystore.properties
#    and point it at your keystore. Keep the keystore safe; updates must be signed with the same key.
# 3. build
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
pnpm android:apk
```

Output: `artifacts/caretrack/android/app/build/outputs/apk/release/app-release.apk`
(debug build: `pnpm --filter @workspace/caretrack run android:apk:debug` →
`.../apk/debug/app-debug.apk`). You can also run `pnpm --filter @workspace/caretrack run android:open`
and use **Build › Generate Signed App Bundle / APK** in Android Studio.

After changing web code, always run `android:sync` (or `android:apk`) so the APK gets the new build.

## Server setup for the app

1. Deploy the API over **HTTPS** (Render, Railway, a VPS behind Nginx/Caddy, or a Cloudflare tunnel).
   The app cannot use `http://` or `localhost` addresses.
2. Nothing else is required: the app origin (`https://localhost`) is allowed by CORS automatically,
   without cookies.
3. For production set `OTP_OFFLINE_FALLBACK=false` and configure Gmail/SMS so login codes are delivered.

For a quick test against a laptop, a temporary HTTPS tunnel works, for example
`cloudflared tunnel --url http://localhost:8080` (enter the printed `https://….trycloudflare.com`
address in the app). Don't bake such temporary addresses into a release build.

## Installing on a phone

1. Copy `app-release.apk` to the phone (USB cable, Google Drive, email, or Bluetooth).
2. Open it from the Files app. If asked, allow **Install unknown apps** for that app (Files/Chrome/Drive).
3. Tap **Install**, then **Open**. Google Play Protect may warn about an app not from Play; choose
   **Install anyway** (or **More details › Install anyway**).
4. On first launch, enter the server address (if it wasn't built in), sign in, and allow notifications.

With USB debugging enabled you can also run `adb install -r app-release.apk`.

Updating: install a newer APK over the old one (same signing key); data and sign-in are kept.

## Testing checklist

| Area | How |
|---|---|
| Install / launch / splash / icon | Install the APK; check the CareTrack icon, navy splash, and the sign-in screen |
| Login / logout per role | Patient, caregiver (allowed only in the app), doctor, admin; sign out returns to sign-in |
| Sync with web | Log a dose on the phone → it shows as taken on the website, and vice versa |
| Notifications | Notification panel → "Send a tip now". As a doctor, give the patient a dose a few minutes ahead; on the patient phone open Today's doses once, then close the app and turn on airplane mode — the reminder still appears on time |
| Offline | Airplane mode → app opens with saved data; log a dose → turn data back on → "synced" banner |
| Downloads | Reports page → PDF/CSV opens the Android share sheet |
| Back button | Opens/closes the menu, goes back between pages, leaves the app on the first page |
