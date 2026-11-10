// CareTrack wellness notifications: motivational messages, health tips, hydration
// reminders and quotes. Everything here is stored on the device and needs no internet.
// Loaded by the service worker (importScripts) and by the tests; it has no dependencies.
(function (root) {
  "use strict";

  const CATEGORIES = {
    hydration: { label: "Hydration", emoji: "💧" },
    motivation: { label: "Motivation", emoji: "💪" },
    tip: { label: "Health Tip", emoji: "🩺" },
    quote: { label: "Inspirational Quote", emoji: "✨" },
  };
  // How often each category is picked. Hydration is the main daily habit we encourage.
  const CATEGORY_WEIGHTS = { hydration: 0.35, motivation: 0.25, tip: 0.25, quote: 0.15 };

  // periods: when the message fits (omit = any time). when: needs today's dose activity.
  // Tokens: {, name} -> ", Ana" or "" · {taken} {total} · {totalDoses} {remainingDoses} -> "2 doses".
  const m = (id, category, title, body, extra) => Object.assign({ id, category, title, body }, extra);
  const MESSAGES = [
    // Hydration
    m("h1", "hydration", "Water break", "Drink a glass of water now! Staying hydrated helps your body function properly."),
    m("h2", "hydration", "Keep sipping", "You've got this! Keep drinking water throughout the day to stay hydrated."),
    m("h3", "hydration", "Recharge with water", "Your body needs water to stay energized. Take a quick hydration break!"),
    m("h4", "hydration", "Small sips count", "Small sips make a big difference. Keep your hydration on track!"),
    m("h5", "hydration", "Start the day hydrated", "Good morning! A glass of water now helps wake up your body after a night's rest.", { periods: ["morning"] }),
    m("h6", "hydration", "Afternoon slump?", "Feeling tired this afternoon? Sometimes it's thirst. Try a glass of water first.", { periods: ["afternoon"] }),
    m("h7", "hydration", "Keep a bottle nearby", "Keep a water bottle within reach. You'll drink more without even thinking about it."),
    m("h8", "hydration", "Evening refill", "Have a glass of water with dinner. It's an easy way to finish the day well hydrated.", { periods: ["evening"] }),
    m("h9", "hydration", "Warm day?", "On warm days your body loses more water. Take a few extra sips this afternoon.", { periods: ["afternoon"] }),
    m("h10", "hydration", "Follow your fluid plan", "If your doctor has set a daily fluid limit for you, follow it. Ask your care team if you're unsure how much to drink."),
    m("h11", "hydration", "Water with meals", "Pair every meal with a glass of water. It's a simple habit that adds up."),

    // Motivation
    m("m1", "motivation", "Invest in yourself", "Every healthy choice you make today is an investment in your future."),
    m("m2", "motivation", "Keep showing up", "Progress doesn't happen overnight. Keep showing up for yourself!"),
    m("m3", "motivation", "Consistency wins", "You're doing great! Remember, consistency is better than perfection."),
    m("m4", "motivation", "Little things matter", "A healthier you starts with the little things you do every day."),
    m("m5", "motivation", "Fresh start", "Today is a fresh start. Pick one healthy habit and make it happen.", { periods: ["morning"] }),
    m("m6", "motivation", "Halfway there", "The day is halfway done and you're still going strong. Keep it up!", { periods: ["afternoon"] }),
    m("m7", "motivation", "Notice your wins", "Take a moment to notice what went well today. Small wins count.", { periods: ["evening"] }),
    m("m8", "motivation", "One step at a time", "You don't have to be perfect. Just take the next healthy step."),
    m("m9", "motivation", "You're not alone", "Your care team is cheering you on. Reach out if you ever need help."),
    m("m10", "motivation", "Rest is progress too", "Rest is part of getting better. Give yourself credit for today's effort.", { periods: ["evening"] }),

    // Health tips
    m("t1", "tip", "Stretch break", "Don't forget to take a short break and stretch your body."),
    m("t2", "tip", "Sleep well", "Getting enough sleep helps your body recover and recharge.", { periods: ["evening"] }),
    m("t3", "tip", "Take a short walk", "Take a few minutes to walk around. Your body will thank you!", { periods: ["morning", "afternoon"] }),
    m("t4", "tip", "Eat on time", "Remember to eat on time and give your body the energy it needs."),
    m("t5", "tip", "Rest your eyes", "On a screen? Every 20 minutes, look at something far away for 20 seconds."),
    m("t6", "tip", "Breathe deeply", "Try this: breathe in for 4 seconds, hold for 4, then breathe out for 6. Repeat three times."),
    m("t7", "tip", "Add some color", "Add a fruit or vegetable to your next meal. More color means more nutrients.", { periods: ["morning", "afternoon"] }),
    m("t8", "tip", "Morning daylight", "A few minutes of morning daylight helps set your body clock for better sleep tonight.", { periods: ["morning"] }),
    m("t9", "tip", "Wind down", "Try putting screens away 30 minutes before bed for a better night's sleep.", { periods: ["evening"] }),
    m("t10", "tip", "Posture check", "Relax your shoulders, sit up straight and unclench your jaw. Feel better?"),
    m("t11", "tip", "Clean hands", "Wash your hands before meals and after going out. It's a simple way to avoid getting sick."),
    m("t12", "tip", "Plan for tomorrow", "Get tomorrow's medicines ready tonight so the morning is easier.", { periods: ["evening"] }),

    // Inspirational quotes
    m("q1", "quote", "Quote of the moment", "\"Take care of your body. It's the only place you have to live.\" — Jim Rohn"),
    m("q2", "quote", "Quote of the moment", "\"Healthy habits are built one day at a time.\""),
    m("q3", "quote", "Quote of the moment", "\"Your health is your greatest wealth.\""),
    m("q4", "quote", "Quote of the moment", "\"A little progress each day adds up to big results.\""),
    m("q5", "quote", "Quote of the moment", "\"Be patient with yourself. Healing and growth take time.\""),
    m("q6", "quote", "Quote of the moment", "\"Every day is a new chance to take care of yourself.\""),
    m("q7", "quote", "Quote to start your day", "\"Start where you are. Use what you have. Do what you can.\" — Arthur Ashe", { periods: ["morning"] }),
    m("q8", "quote", "Quote of the moment", "\"Strength grows when you keep going, even on the hard days.\""),
    m("q9", "quote", "Evening reflection", "\"Rest when you're weary. Refresh and renew yourself.\"", { periods: ["evening"] }),

    // Personalized from today's doses (only used when they apply)
    m("p1", "motivation", "All doses done", "Great job{, name}! You've taken all {totalDoses} scheduled for today. 🎉", { when: "allTaken" }),
    m("p2", "motivation", "Nice progress", "You've taken {taken} of {total} doses today. Keep going{, name}!", { when: "inProgress" }),
    m("p3", "motivation", "Evening check-in", "You still have {remainingDoses} left today. Check your schedule so none are missed.", { when: "remaining", periods: ["evening"] }),
    m("p4", "motivation", "Next dose, fresh start", "Missed a dose earlier? That's okay. Focus on the next one and keep going.", { when: "missed" }),
    m("p5", "motivation", "Today's plan", "You have {totalDoses} scheduled today{, name}. You've got this!", { when: "notStarted", periods: ["morning"] }),
  ];

  const CONDITIONS = {
    allTaken: (a) => a.total > 0 && a.taken === a.total,
    inProgress: (a) => a.taken > 0 && a.remaining > 0,
    remaining: (a) => a.remaining > 0,
    missed: (a) => a.missed > 0,
    notStarted: (a) => a.total > 0 && a.taken === 0 && a.missed === 0,
  };

  const MINUTE = 60 * 1000;
  // Delivery windows (minutes after local midnight). Nothing is sent before 8 AM or after 9 PM.
  const WINDOWS = [
    { period: "morning", start: 8 * 60, end: 10 * 60 + 30 },
    { period: "afternoon", start: 11 * 60 + 30, end: 13 * 60 + 30 },
    { period: "afternoon", start: 14 * 60 + 30, end: 16 * 60 + 30 },
    { period: "evening", start: 18 * 60, end: 20 * 60 + 30 },
  ];
  const FREQUENCIES = { off: [], low: [0, 3], normal: [0, 1, 2, 3] }; // window indexes per day
  const LATEST_MINUTE = 21 * 60; // a postponed slot is dropped rather than sent after this
  const GRACE = 60 * MINUTE; // a slot missed by more than this (device asleep) is skipped, not sent late
  const MIN_GAP = 60 * MINUTE; // at least this long between two wellness notifications
  const DOSE_BUFFER = 10 * MINUTE; // don't compete with a dose reminder due around the same time
  const RECENT_LIMIT = 20; // a message is not repeated until this many others have been shown

  function periodOf(date) {
    const h = date.getHours();
    if (h >= 5 && h < 12) return "morning";
    if (h >= 12 && h < 17) return "afternoon";
    return "evening";
  }
  function dayKey(date) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
  function atMinute(date, minute) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
    d.setMinutes(minute);
    return d.getTime();
  }

  /** Random delivery times for one day, one per window, so tips are spread out. */
  function planDay(date, frequency, rng) {
    const random = rng || Math.random;
    const indexes = FREQUENCIES[frequency] || FREQUENCIES.normal;
    return {
      day: dayKey(date),
      frequency,
      slots: indexes.map((i) => {
        const w = WINDOWS[i];
        const minute = w.start + Math.floor(random() * (w.end - w.start));
        return { at: atMinute(date, minute), period: w.period, done: false };
      }),
    };
  }

  /** Today's dose activity from the cached dose schedule (works offline). */
  function activityFrom(doses, now) {
    const today = dayKey(now);
    const mine = (doses || []).filter((d) => d && d.scheduledTime && dayKey(new Date(d.scheduledTime)) === today);
    const taken = mine.filter((d) => d.status === "taken").length;
    const missed = mine.filter((d) => d.status === "missed").length;
    const remaining = mine.filter((d) => d.status === "scheduled").length;
    return {
      total: mine.length,
      taken,
      missed,
      remaining,
      doseTimes: mine.filter((d) => d.status === "scheduled").map((d) => new Date(d.scheduledTime).getTime()),
    };
  }

  /**
   * Decides what to do at `now` for today's plan. Returns updated slots, the index of a slot
   * to deliver now (or -1), and when to check next. Never delivers more than one at a time.
   */
  function decide(plan, now, options) {
    const opts = options || {};
    const slots = plan.slots.map((s) => Object.assign({}, s));
    let deliver = -1;
    const due = slots.map((_, i) => i).filter((i) => !slots[i].done && slots[i].at <= now);
    if (due.length) {
      const latest = due[due.length - 1];
      due.slice(0, -1).forEach((i) => { slots[i].done = true; slots[i].skipped = "stale"; });
      const slot = slots[latest];
      const lastLimit = atMinute(new Date(now), LATEST_MINUTE);
      const doseSoon = (opts.doseTimes || []).some((t) => Math.abs(t - now) < DOSE_BUFFER);
      if (now - slot.at > GRACE) {
        slot.done = true; slot.skipped = "stale";
      } else if (opts.lastShownAt && now - opts.lastShownAt < MIN_GAP) {
        const later = opts.lastShownAt + MIN_GAP;
        if (later <= lastLimit) slot.at = later;
        else { slot.done = true; slot.skipped = "too-soon"; }
      } else if (doseSoon && !slot.shifted) {
        slot.shifted = true;
        if (now + 15 * MINUTE <= lastLimit) slot.at = now + 15 * MINUTE;
        else { slot.done = true; slot.skipped = "dose"; }
      } else {
        slot.done = true;
        deliver = latest;
      }
    }
    const pending = slots.filter((s) => !s.done).map((s) => s.at).sort((a, b) => a - b);
    return { slots, deliver, nextAt: pending.length ? pending[0] : null };
  }

  function choose(list, random) {
    return list[Math.floor(random() * list.length) % list.length];
  }

  /**
   * Picks a message that fits the time of day, avoids recently shown ones and, when possible,
   * the category shown last. Personalized dose messages are used when they apply.
   */
  function pickMessage(input) {
    const random = input.rng || Math.random;
    const recent = input.recent || [];
    const activity = input.activity || { total: 0, taken: 0, missed: 0, remaining: 0 };
    const fits = MESSAGES.filter((msg) =>
      (!msg.periods || msg.periods.includes(input.period)) &&
      (!msg.when || CONDITIONS[msg.when](activity)));
    const fresh = fits.filter((msg) => !recent.includes(msg.id));

    const personal = fresh.filter((msg) => msg.when);
    if (personal.length && random() < 0.4) return choose(personal, random);

    let general = fresh.filter((msg) => !msg.when);
    if (!general.length) {
      // Everything was shown recently: reuse the one shown longest ago.
      const pool = fits.filter((msg) => !msg.when);
      return pool.slice().sort((a, b) => recent.indexOf(b.id) - recent.indexOf(a.id))[0];
    }
    const categories = Object.keys(CATEGORY_WEIGHTS).filter((c) =>
      c !== input.lastCategory && general.some((msg) => msg.category === c));
    if (categories.length) {
      const total = categories.reduce((n, c) => n + CATEGORY_WEIGHTS[c], 0);
      let roll = random() * total;
      let category = categories[categories.length - 1];
      for (const c of categories) { roll -= CATEGORY_WEIGHTS[c]; if (roll < 0) { category = c; break; } }
      general = general.filter((msg) => msg.category === category);
    }
    return choose(general, random);
  }

  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  /** The notification's title and text, with the user's name and dose counts filled in. */
  function render(msg, context) {
    const ctx = context || {};
    const a = ctx.activity || { total: 0, taken: 0, remaining: 0 };
    const first = String(ctx.name || "").trim().split(/\s+/)[0] || "";
    const body = msg.body
      .replace("{, name}", first ? `, ${first}` : "")
      .replace("{taken}", String(a.taken))
      .replace("{total}", String(a.total))
      .replace("{totalDoses}", plural(a.total, "dose"))
      .replace("{remainingDoses}", plural(a.remaining, "dose"));
    const cat = CATEGORIES[msg.category];
    return {
      id: msg.id,
      category: msg.category,
      categoryLabel: cat.label,
      title: `${cat.emoji} ${cat.label} · ${msg.title}`,
      body,
    };
  }

  /** Remembers a shown message so it is not repeated soon. */
  function remember(recent, id) {
    return [id].concat((recent || []).filter((x) => x !== id)).slice(0, RECENT_LIMIT);
  }

  root.CareTrackWellness = {
    CATEGORIES, MESSAGES, WINDOWS, FREQUENCIES, MIN_GAP, GRACE, RECENT_LIMIT,
    periodOf, dayKey, planDay, activityFrom, decide, pickMessage, render, remember,
  };
})(typeof self !== "undefined" ? self : globalThis);
