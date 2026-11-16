# Offline mode, sync and real-time messaging: manual tests

## How offline mode works (summary)

- **Reading.** Every successful API response is saved in IndexedDB (`caretrack-data` → `cache`) for the
  signed-in user and server. When the server can't be reached, the saved copy is shown and the banner
  says when it was last updated. The service worker (`public/sw.js`) keeps only the app's screens so the
  website opens offline; the Android app has its screens inside the APK.
- **Writing.** Dose status changes, health readings, symptom notes and messages go through an outbox
  (`caretrack-data` → `outbox`). Each change is written to the device first, shown immediately with a
  *Pending sync* marker, and uploaded automatically when the connection returns (browser `online` event,
  app back in the foreground, every 15 s, with back-off on failure). It is removed from the device only
  after the server confirms it.
- **No duplicates.** Each change carries a random `Idempotency-Key`; the server stores the first result
  (`caretrack_idempotency_keys`) and replays it for any retry.
- **Original times.** Changes carry `x-caretrack-captured-at`; doses keep the time they were marked,
  readings and notes keep the time they were entered. Messages get the server's receive time (so
  unread counts stay correct); the capture time is kept in the audit log for doses.
- **Conflicts.** An offline dose change older than a newer change made elsewhere (another device,
  caregiver, doctor) is refused by the server; the newer value is kept and the user is asked
  ("Use my change instead" / "Keep the newer change"). Automatic "missed" marking does not count as a
  newer change, so a dose taken offline replaces an automatic "missed".
- **Online-only features** (sign-in, file downloads, reports, AI, admin, patient/medication editing,
  appointments) show "You're offline. This needs an internet connection." and are never shown as saved.

## Web browser test

1. Sign in as Alex Morgan (`patient@caretrack.com`, password `demo1234`) on a phone or with browser device emulation. Open
   **Today's doses**, **My health** and **Messages** once while online.
2. DevTools → Network → **Offline** (or turn Wi-Fi off). The header chip shows **Offline** and the banner
   explains that saved information is shown.
3. Mark a dose **I've taken it**, record a reading on **My health**, add a symptom note, send a message.
   Each shows "saved on this device" and a *Pending sync* marker. The header shows *N pending*.
4. Refresh the page, then close the tab and open the site again (still offline): everything is still there.
   DevTools → Application → IndexedDB → `caretrack-data` → `outbox` lists the waiting changes.
5. Go back online. Without pressing anything the banner shows *Uploading…*, then *Back online. N changes
   saved to CareTrack.*; markers disappear and the outbox is empty.
6. Check the server: sign in as the doctor on another browser and open Alex Morgan; the dose shows
   *taken* at the original time and the reading/note/message appear once.

Conflict check: before step 5, have the doctor change the same dose (e.g. *skipped*). After reconnecting,
the patient sees "1 change couldn't be saved… Review"; the dose shows the doctor's value.

## Android app (APK) test

Same steps in the installed app, using Wi-Fi + mobile data off (or airplane mode) instead of DevTools,
and **force-closing** the app (recent apps → swipe away) instead of closing a tab.

## SSE and fallback messaging test

1. Open Alex Morgan in two authorized sessions (patient and assigned doctor/admin).
2. Confirm the doctor can send a message and the patient receives it without refreshing, generally within two seconds.
3. Notifications created by background jobs reach open sessions within about five seconds.
4. Temporarily close the EventSource stream or disconnect it. Existing React Query polling continues to refresh message threads, conversations, and notifications.
5. Sign in as the caregiver demo account and confirm its Messages screen remains read-only: the API returns 403 for send attempts and no caregiver send control is displayed.

## Offline reminder test

1. As Alex Morgan open **Today's doses** while online (the schedule is cached for reminders).
2. Disconnect. Keep the app open and confirm the due dose produces an in-app chime, and a notification
   where browser/OS permissions allow it. In the Android app reminders are phone alarms and also fire
   with the app closed.

Closed-app alarms in a browser can be blocked by browser, mobile, battery-saving and notification settings.
