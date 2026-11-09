# Offline reminders and real-time messaging evidence

## Offline dose reminder test

1. Sign in as the Alex Morgan patient demo account and open **Today’s doses** while online.
2. Verify a scheduled dose with a near-future time, preferably seeded for the current day.
3. Open the browser developer tools **Application** panel and confirm the `caretrack-offline` IndexedDB database contains the `schedule` value in `reminders`.
4. Disconnect network access. Keep the app open and confirm the due dose produces an in-app chime/alarm, and confirm a Notification API alert when browser and OS notification permissions allow it.
5. Mark a scheduled dose **taken** while offline. Confirm it appears in the amber offline banner queue.
6. Restore network access. Confirm the banner changes to syncing, then synced, and that the server log preserves the original offline confirmation timestamp.

Closed-app alarms can be blocked by browser, mobile, battery-saving, and installed-PWA notification settings; this is a browser limitation rather than application failure.

## SSE and fallback messaging test

1. Open Alex Morgan in two authorized sessions (patient and assigned doctor/admin).
2. Confirm the doctor can send a message and the patient receives it without refreshing, generally within two seconds.
3. Open the doctor and patient notifications while the session is active; send a notification-producing action and confirm SSE invalidates both notification views.
4. Temporarily close the EventSource stream or disconnect it. Existing React Query polling continues to refresh message threads, conversations, and notifications.
5. Sign in as the caregiver demo account and confirm its Messages screen remains read-only: the API returns 403 for send attempts and no caregiver send control is displayed.

## Seed evidence

No schema or seed change is required for these existing features. The normal dose schedule, Alex Morgan account, caregiver account, and notification seeds exercise the local reminder and real-time evidence paths. Existing encrypted message seed values remain protected by the AES-256-GCM migration.
