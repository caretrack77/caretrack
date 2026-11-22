# Deploying CareTrack online (free, no domain needed)

## Why the app needed the laptop

The Android app contains only the screens. Everything else (sign-in, patient records, saving to
Supabase, reminders, AI) is done by the **CareTrack API server** (`artifacts/api-server`). Until now
that server only ran on the laptop (`pnpm dev`), and the phone reached it through a temporary
Cloudflare tunnel. Laptop off, server off, tunnel gone: the app had nothing to talk to.

The fix is to run the same server on a free hosting service with a permanent HTTPS address, and
build the app with that address inside it. The database stays your existing Supabase project.

## Why Render (and not Vercel, Netlify or Cloudflare Pages)

Those three host static websites and short serverless functions. CareTrack's server is a
long-running Node.js process: a background job every minute (dose reminders, missed doses,
reports, AI retraining), live message updates, and PDF reports. It would have to be rewritten to run
there, and the every-minute job would be lost. **Render's free plan runs it unchanged** and gives a
free address: `https://<service-name>.onrender.com`. One Render service serves both the API
(for the app) and the website (for browsers).

`render.yaml` in the project root describes the whole setup (Singapore region, next to the
Supabase database in ap-southeast-1).

## Steps

### 1. Push the project to GitHub

All current changes must be on GitHub, because Render builds from there.

### 2. Create the Render service

1. Go to <https://render.com> and **sign up with GitHub** (free; no card needed for the free plan).
2. Dashboard → **New** → **Blueprint** → choose the `caretrack` repository → **Connect**.
3. Render reads `render.yaml` and asks for the secret values. Copy them **from your local `.env`**:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Same as in `.env` (Supabase Session pooler string) |
| `SESSION_SECRET` | **Exactly** the same as in `.env`. It also unlocks the encrypted messages and lab files; a different value makes them unreadable. |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | Same as `.env`, or leave empty (codes are then shown on screen) |
| `GROQ_API_KEY`, `ANTHROPIC_API_KEY` | Optional; leave empty to use the built-in answers |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase service-account JSON for Android message alerts; configure FCM as described in [docs/ANDROID.md](./ANDROID.md) |

4. Click **Apply**. The first build takes about 5 minutes.
5. When it says **Live**, open `https://<your-service>.onrender.com/api/healthz` in a browser.
   It must show `{"status":"ok"}`. `https://<your-service>.onrender.com` shows the website.

If the name `caretrack-app` is taken, Render adds a few letters; use the address Render shows.

After deploying the updated code, run `pnpm db:push` from a local checkout whose root `.env`
points to the same Supabase database. This creates the Android push-token table.

### 3. Build the app with the permanent address

In the root `.env` set:

```
CARETRACK_API_URL=https://<your-service>.onrender.com
```

then build the APK (`pnpm android:apk`, or `pnpm --filter @workspace/caretrack run android:apk:debug`).
The app then connects to that address automatically; nobody has to type a server address.
An app that saved an old `trycloudflare.com` address switches to the built-in one by itself.

### 4. Your laptop

The laptop is no longer needed. If you still run `pnpm dev` for development against the same
database, add `BACKGROUND_JOBS=false` to your local `.env`, so reminders and alerts are not sent
twice (once by Render, once by the laptop).

## Free plan limits

- **Sleeps after 15 minutes without visitors.** The first request after that takes about 30–60
  seconds while it wakes up. The app keeps working meanwhile with its saved (offline) data and
  syncs when the server answers. Phone dose reminders are alarms on the phone and are not affected.
- While asleep, server-side jobs (in-app reminder notifications, automatic "missed" marking,
  scheduled reports) pause and catch up when it wakes. For a demo day, keep it awake with a free
  monitor such as cron-job.org or UptimeRobot calling `https://<your-service>.onrender.com/api/healthz`
  every 10 minutes. The free plan's 750 hours a month cover one service running all month.
- Data is not stored on Render, only in Supabase, so restarts and redeploys lose nothing.

## Security notes

- The APK contains only the public server address. No database password, Supabase key or
  session secret is in the app; secrets live only in Render's environment settings and your `.env`.
- The server talks to Supabase with `DATABASE_URL` on the server side. Access control is the
  server's role and patient checks (the same as before); nothing about it changes.
- `OTP_OFFLINE_FALLBACK=true` shows login codes on screen when they can't be sent, which the demo
  accounts need. For real users with real email or phone numbers, set it to `false` in Render.
