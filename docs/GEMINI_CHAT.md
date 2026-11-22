# CareTrack Gemini chat

Website and Android chat both use the authenticated CareTrack API. The API checks the CareTrack session and patient/caregiver role, then calls the Supabase Edge Function with a short-lived signed JWT. The Gemini API key stays in Supabase and is never sent to either client.

Questions about the next dose, missed doses, active medication schedules, upcoming appointments, and the last 7 days of dose progress are answered directly from the signed-in user's accessible CareTrack API records. Other supported care-record questions use Gemini with only that user's scoped records. If Gemini is unavailable, these direct record lookups continue to work.

## Configure secrets

1. In Supabase **Project Settings → Edge Functions → Secrets**, set `GEMINI_API_KEY` to your Google AI Studio key.
2. Generate a random secret of at least 32 characters, then set it as `GEMINI_ASSISTANT_JWT_SECRET` in both Supabase Edge Function Secrets and the Render service environment. The values must match.
3. The API derives the Supabase project URL from the project reference in `DATABASE_URL`. If your database URL uses a custom host, set `SUPABASE_URL` in Render explicitly.

For local API development, add the same `GEMINI_ASSISTANT_JWT_SECRET` to the repository `.env` file. Never put `GEMINI_API_KEY` in `.env`, Vite variables, or the APK.

## Deploy the function

From the repository root, link the Supabase project and deploy the function:

```sh
supabase link --project-ref <project-ref>
supabase functions deploy gemini-assistant
```

The function reads `GEMINI_API_KEY`, `GEMINI_ASSISTANT_JWT_SECRET`, `SUPABASE_URL`, and Supabase's injected `SUPABASE_SERVICE_ROLE_KEY`. Its `verify_jwt = false` setting is intentional: the Edge Function verifies the short-lived CareTrack-signed JWT itself.

After setting the Render environment values, redeploy the Render service. No Supabase Auth session or Supabase client key is needed in the website or APK.
