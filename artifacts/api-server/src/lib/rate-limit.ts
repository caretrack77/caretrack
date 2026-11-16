import { rateLimit } from "express-rate-limit";

export const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many attempts. Please wait before trying again." },
});

// Per network address. People on one Wi-Fi (a classroom, a clinic) share an address, so 5 locked
// out everyone after a few sign-ins. Each sign-in is still limited separately: 30 s between codes,
// 5 wrong attempts, 5-minute expiry (auth.ts), which is what protects the codes themselves.
export const otpRequestRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many code requests. Please wait before trying again." },
});

export const otpVerifyRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many verification attempts. Please request a new code." },
});

export const passwordRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many password change attempts. Please wait before trying again." },
});

export const chatbotRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many chatbot requests. Please wait before trying again." },
});
