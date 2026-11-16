import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull, ne } from "drizzle-orm";
import bcrypt from "bcryptjs";
import {
  type NextFunction,
  type Request,
  type Response,
  Router,
  type IRouter,
} from "express";
import {
  db,
  otpChallengesTable,
  patientsTable,
  privacyConsentsTable,
  sessionsTable,
  usersTable,
} from "@workspace/db";
import {
  ChangePasswordBody,
  ChangePasswordResponse,
  GetCurrentUserResponse,
  LoginBody,
  LoginResponse,
  SendLoginOtpBody,
  SendLoginOtpResponse,
  VerifyLoginOtpBody,
  VerifyLoginOtpResponse,
} from "@workspace/api-zod";
import { writeAuditLog } from "./audit";
import { logger } from "./logger";
import { isDemoAccountEmail, sendEmail, sendSmsDetailed, toInternational, undeliverableEmail, type SmsResult } from "./otp-delivery";
import {
  loginRateLimit,
  otpRequestRateLimit,
  otpVerifyRateLimit,
  passwordRateLimit,
} from "./rate-limit";
import { PRIVACY_NOTICE_VERSION } from "./security-config";
export { PRIVACY_NOTICE_VERSION } from "./security-config";

const SESSION_COOKIE = "caretrack_session";
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
/** Response header that hands the Android app its session token (it can't use cross-site cookies). */
export const SESSION_HEADER = "x-caretrack-session";

/** True for the CareTrack Android app, which authenticates with a bearer token instead of a cookie. */
export function isAppClient(req: Request): boolean {
  return req.header("x-caretrack-client")?.toLowerCase() === "android-app";
}

/** The session token: the HTTP-only cookie (web) or `Authorization: Bearer` (Android app). */
export function sessionToken(req: Request): string | undefined {
  const auth = req.header("authorization");
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, "").trim();
  const cookie = req.cookies?.[SESSION_COOKIE];
  return typeof cookie === "string" ? cookie : undefined;
}

export type CurrentUser = Pick<
  typeof usersTable.$inferSelect,
  "id" | "name" | "email" | "role" | "active" | "mustChangePassword"
> & { privacyConsentAccepted?: boolean };


function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET must be configured to enable CareTrack login.");
  }
  return secret;
}

function hashToken(token: string): string {
  return createHash("sha256")
    .update(token)
    .update(getSessionSecret())
    .digest("hex");
}

async function privacyConsentAccepted(userId: number): Promise<boolean> {
  const [consent] = await db
    .select({ version: privacyConsentsTable.version })
    .from(privacyConsentsTable)
    .where(eq(privacyConsentsTable.userId, userId))
    .orderBy(desc(privacyConsentsTable.acceptedAt))
    .limit(1);
  return consent?.version === PRIVACY_NOTICE_VERSION;
}

async function publicUser(user: Omit<CurrentUser, "privacyConsentAccepted"> & { privacyConsentAccepted?: boolean }): Promise<CurrentUser> {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    active: user.active,
    mustChangePassword: user.mustChangePassword,
    privacyConsentAccepted: await privacyConsentAccepted(user.id),
  };
}

export function isMobileClient(req: Request): boolean {
  const clientHeader = req.header("x-caretrack-client")?.toLowerCase();
  if (clientHeader === "android-app" || clientHeader === "mobile-app") return true;
  const ua = req.header("user-agent");
  return Boolean(ua && /(Android|iPhone|iPad|iPod|Mobile)/i.test(ua));
}

export function rejectsPatientWebDevice(req: Request, role: string): boolean {
  return (role === "patient" || role === "caregiver") && !isMobileClient(req);
}

export function currentUser(res: Response): CurrentUser | undefined {
  return res.locals.currentUser as CurrentUser | undefined;
}

export function requireUser(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const user = currentUser(res);
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }
  if (!user.privacyConsentAccepted && !req.originalUrl.startsWith("/api/auth/")) {
    res.status(403).json({ error: "Please review and accept the privacy notice.", code: "PRIVACY_CONSENT_REQUIRED" });
    return;
  }
  if (rejectsPatientWebDevice(req, user.role)) {
    res.status(403).json({
      error: "Patient and caregiver accounts must sign in from the CareTrack mobile app.",
      code: "MOBILE_APP_REQUIRED",
    });
    return;
  }
  // Accounts with a temporary password can only reach the auth endpoints until they change it.
  if (user.mustChangePassword && !req.originalUrl.startsWith("/api/auth/")) {
    res.status(403).json({ error: "Please set a new password before continuing.", code: "PASSWORD_CHANGE_REQUIRED" });
    return;
  }
  next();
}

/** Minimum password rules: 8+ characters with at least one letter and one number. */
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return "Use at least 8 characters.";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return "Use a mix of letters and numbers.";
  }
  return null;
}

export function requireRoles(...roles: string[]) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    const user = currentUser(res);
    if (!user) {
      res.status(401).json({ error: "Sign in to continue." });
      return;
    }
    if (!roles.includes(user.role)) {
      res.status(403).json({ error: "You do not have permission to do that." });
      return;
    }
    next();
  };
}

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Each router applies this middleware; only look the session up once per request.
  if (res.locals.authChecked) {
    next();
    return;
  }
  res.locals.authChecked = true;
  const token = sessionToken(req);
  if (typeof token !== "string" || token.length < 32) {
    next();
    return;
  }

  const [record] = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      active: usersTable.active,
      mustChangePassword: usersTable.mustChangePassword,
      tokenHash: sessionsTable.tokenHash,
    })
    .from(sessionsTable)
    .innerJoin(usersTable, eq(sessionsTable.userId, usersTable.id))
    .where(
      and(
        eq(sessionsTable.tokenHash, hashToken(token)),
        gt(sessionsTable.expiresAt, new Date()),
        eq(usersTable.active, true),
      ),
    )
    .limit(1);

  if (!record) {
    res.clearCookie(SESSION_COOKIE, { path: "/api", sameSite: "lax", secure: process.env.NODE_ENV === "production" });
    next();
    return;
  }

  res.locals.currentUser = await publicUser(record);
  next();
}

function cookieOptions(req: Request) {
  return {
    httpOnly: true,
    // HTTPS deployments get secure cookies; plain-HTTP localhost still works.
    secure: process.env.NODE_ENV === "production" ? true : req.secure,
    sameSite: "lax" as const,
    path: "/api",
    maxAge: SESSION_LIFETIME_MS,
  };
}

const OTP_CHALLENGE_LIFETIME_MS = 15 * 60 * 1000;
const OTP_CODE_LIFETIME_MS = 5 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 30 * 1000;
const OTP_MAX_ATTEMPTS = 5;

/** Two-step login is on unless OTP_ENABLED=false. */
function otpEnabled(): boolean {
  return process.env.OTP_ENABLED !== "false";
}

function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 2)}${"*".repeat(Math.max(1, name.length - 2))}@${domain}`;
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `•••• ••• ${digits.slice(-4)}`;
}

/** The mobile number for SMS codes: the account's own, or the linked patient profile's. */
async function phoneFor(user: typeof usersTable.$inferSelect): Promise<string | null> {
  if (user.phone) return user.phone;
  if (user.role !== "patient") return null;
  const [patient] = await db
    .select({ phone: patientsTable.phone })
    .from(patientsTable)
    .where(eq(patientsTable.userId, user.id))
    .limit(1);
  return patient?.phone || null;
}

/** True while the account's current mobile number is the one it confirmed with an SMS code. */
export async function phoneVerifiedFor(userId: number): Promise<boolean> {
  const [row] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!row?.verifiedPhone) return false;
  const current = await phoneFor(row);
  return !!current && toInternational(current) === row.verifiedPhone;
}

async function startSession(req: Request, res: Response, userId: number): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessionsTable).values({
    tokenHash: hashToken(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS),
  });
  // Browsers get an HTTP-only cookie (never readable by page scripts). The Android app
  // runs on its own origin, so it receives the token in a header and sends it back as a bearer token.
  if (isAppClient(req)) res.setHeader(SESSION_HEADER, token);
  else res.cookie(SESSION_COOKIE, token, cookieOptions(req));
}

const router: IRouter = Router();

router.post("/auth/login", loginRateLimit, async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const email = parsed.data.email.trim().toLowerCase();
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);
  const matches =
    user?.active && (await bcrypt.compare(parsed.data.password.trim(), user.passwordHash));

  if (!user || !matches) {
    await writeAuditLog(user?.id ?? null, "login_failed", "user", user?.id ?? null, { email });
    res.status(401).json({ error: "Email or password is incorrect." });
    return;
  }
  if (rejectsPatientWebDevice(req, user.role)) {
    await writeAuditLog(user.id, "login_mobile_required", "user", user.id, {
      userAgent: req.header("user-agent")?.slice(0, 200) ?? "",
    });
    res.status(403).json({
      error: "Patient and caregiver accounts can only sign in from the CareTrack mobile app.",
      code: "MOBILE_APP_REQUIRED",
    });
    return;
  }

  // Two-step login: the password is correct, now a one-time code is required.
  if (otpEnabled()) {
    const phone = await phoneFor(user);
    const challengeId = randomBytes(24).toString("base64url");
    await db.insert(otpChallengesTable).values({
      tokenHash: hashToken(challengeId),
      userId: user.id,
      expiresAt: new Date(Date.now() + OTP_CHALLENGE_LIFETIME_MS),
    });
    await writeAuditLog(user.id, "login_password_ok", "user", user.id);
    res.json(
      LoginResponse.parse({
        otpRequired: true,
        challengeId,
        channels: phone ? ["email", "sms"] : ["email"],
        maskedEmail: maskEmail(user.email),
        maskedPhone: phone ? maskPhone(phone) : null,
        user: null,
      }),
    );
    return;
  }

  await startSession(req, res, user.id);
  await writeAuditLog(user.id, "login", "user", user.id);
  res.json(
    LoginResponse.parse({
      otpRequired: false,
      challengeId: null,
      channels: [],
      maskedEmail: null,
      maskedPhone: null,
      user: await publicUser(user),
    }),
  );
});

async function loadChallenge(challengeId: string) {
  const [challenge] = await db
    .select()
    .from(otpChallengesTable)
    .where(
      and(
        eq(otpChallengesTable.tokenHash, hashToken(challengeId)),
        gt(otpChallengesTable.expiresAt, new Date()),
        isNull(otpChallengesTable.consumedAt),
      ),
    )
    .limit(1);
  return challenge;
}

router.post("/auth/otp/send", otpRequestRateLimit, async (req, res): Promise<void> => {
  const parsed = SendLoginOtpBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const challenge = await loadChallenge(parsed.data.challengeId);
  if (!challenge) {
    res.status(401).json({ error: "Your sign-in session expired. Please enter your password again." });
    return;
  }
  if (challenge.lastSentAt && Date.now() - challenge.lastSentAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
    res.status(429).json({ error: "Please wait 30 seconds before requesting another code." });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, challenge.userId)).limit(1);
  if (!user?.active) {
    res.status(401).json({ error: "This account is not active." });
    return;
  }
  if (rejectsPatientWebDevice(req, user.role)) {
    res.status(403).json({
      error: "Patient and caregiver accounts can only sign in from the CareTrack mobile app.",
      code: "MOBILE_APP_REQUIRED",
    });
    return;
  }
  const channel = parsed.data.channel;
  // Account type comes from the server's fixed list of seeded demo accounts, never from anything
  // the client sends. Demo accounts: the code is shown on screen, nothing is texted or emailed,
  // and no phone number is needed, so panelists can try CareTrack without a personal number.
  const demo = isDemoAccountEmail(user.email);
  const phone = channel === "sms" && !demo ? await phoneFor(user) : null;
  if (channel === "sms" && !demo && !phone) {
    res.status(400).json({ error: "No mobile number is saved for this account. Ask your administrator to add it, or use email." });
    return;
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db
    .update(otpChallengesTable)
    .set({
      codeHash: hashToken(code + challenge.id),
      channel,
      smsPhone: phone ? toInternational(phone) : null,
      codeExpiresAt: new Date(Date.now() + OTP_CODE_LIFETIME_MS),
      lastSentAt: new Date(),
      attempts: 0,
    })
    .where(eq(otpChallengesTable.id, challenge.id));

  if (demo) {
    await writeAuditLog(user.id, "otp_sent", "user", user.id, { channel, delivered: false, demoAccount: true });
    res.json(
      SendLoginOtpResponse.parse({
        channel,
        sentTo: "this screen",
        delivered: false,
        offlineCode: code,
        message: "Demo account: your code is shown here. No text message or email is sent for demo accounts.",
        expiresInSeconds: OTP_CODE_LIFETIME_MS / 1000,
      }),
    );
    return;
  }

  // Regular accounts: the code is only ever sent to the user's own phone or inbox. It is never
  // returned to the screen or written to the logs.
  const text = `Your CareTrack login code is ${code}. It expires in 5 minutes. Do not share this code with anyone.`;
  // SMS: the gateway drops it if it can't be sent within the code's lifetime.
  const sms: SmsResult | null = channel === "sms" ? await sendSmsDetailed(phone!, text, OTP_CODE_LIFETIME_MS / 1000) : null;
  const delivered = sms ? sms.ok : await sendEmail(user.email, "Your CareTrack login code", text);
  await writeAuditLog(user.id, "otp_sent", "user", user.id, { channel, delivered, ...(sms ? { smsStatus: sms.status } : {}) });
  if (!delivered) {
    logger.info({ userId: user.id, channel, smsStatus: sms?.status }, "Login code could not be delivered");
    res.status(503).json({
      error: channel === "sms"
        ? "We couldn't send the text message right now. The CareTrack SMS phone may be off or offline. Try again in a minute, or choose email."
        : undeliverableEmail(user.email)
          ? "This account's email address can't receive mail. Use SMS, or ask your administrator to update the email."
          : "We couldn't send the email right now. Try SMS or try again later.",
    });
    return;
  }
  const sentTo = channel === "sms" ? maskPhone(phone!) : maskEmail(user.email);
  res.json(
    SendLoginOtpResponse.parse({
      channel,
      sentTo,
      delivered: true,
      offlineCode: null,
      message: sms?.status === "queued"
        ? `Your code is on its way by text message to ${sentTo}. It usually arrives within a minute.`
        : `We sent a 6-digit code to ${sentTo}.`,
      expiresInSeconds: OTP_CODE_LIFETIME_MS / 1000,
    }),
  );
});

router.post("/auth/otp/verify", otpVerifyRateLimit, async (req, res): Promise<void> => {
  const parsed = VerifyLoginOtpBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter the 6-digit code." });
    return;
  }
  const challenge = await loadChallenge(parsed.data.challengeId);
  if (!challenge) {
    res.status(401).json({ error: "Your sign-in session expired. Please enter your password again." });
    return;
  }
  if (!challenge.codeHash || !challenge.codeExpiresAt) {
    res.status(400).json({ error: "Request a code first." });
    return;
  }
  if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
    res.status(429).json({ error: "Too many incorrect codes. Please request a new code." });
    return;
  }
  if (challenge.codeExpiresAt < new Date()) {
    res.status(401).json({ error: "This code has expired. Please request a new one." });
    return;
  }
  const expected = Buffer.from(challenge.codeHash);
  const actual = Buffer.from(hashToken(parsed.data.code.trim() + challenge.id));
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    await db
      .update(otpChallengesTable)
      .set({ attempts: challenge.attempts + 1 })
      .where(eq(otpChallengesTable.id, challenge.id));
    const left = OTP_MAX_ATTEMPTS - challenge.attempts - 1;
    res.status(401).json({
      error: left > 0 ? `That code is incorrect. ${left} attempt${left === 1 ? "" : "s"} left.` : "Too many incorrect codes. Please request a new code.",
    });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, challenge.userId)).limit(1);
  if (!user?.active) {
    res.status(401).json({ error: "This account is not active." });
    return;
  }
  const [consumed] = await db
    .update(otpChallengesTable)
    .set({ consumedAt: new Date() })
    .where(and(eq(otpChallengesTable.id, challenge.id), isNull(otpChallengesTable.consumedAt)))
    .returning({ id: otpChallengesTable.id });
  if (!consumed) {
    res.status(401).json({ error: "This code was already used. Please sign in again." });
    return;
  }
  // The right code texted to a number proves the user has that phone: mark it verified,
  // but only if it is still the account's current number.
  if (challenge.channel === "sms" && challenge.smsPhone) {
    const current = await phoneFor(user);
    if (current && toInternational(current) === challenge.smsPhone) {
      await db.update(usersTable).set({ verifiedPhone: challenge.smsPhone, phoneVerifiedAt: new Date() }).where(eq(usersTable.id, user.id));
      user.verifiedPhone = challenge.smsPhone;
      await writeAuditLog(user.id, "phone_verified", "user", user.id, { phone: maskPhone(challenge.smsPhone) });
    }
  }
  await startSession(req, res, user.id);
  await writeAuditLog(user.id, "login", "user", user.id, { method: `otp_${challenge.channel}` });
  res.json(VerifyLoginOtpResponse.parse({ ...(await publicUser(user)), phoneVerified: await phoneVerifiedFor(user.id) }));
});

router.post("/auth/change-password", passwordRateLimit, authenticate, requireUser, async (req, res): Promise<void> => {
  const parsed = ChangePasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter your current password and a new password of at least 8 characters." });
    return;
  }
  const signedIn = currentUser(res)!;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, signedIn.id)).limit(1);
  if (!user || !(await bcrypt.compare(parsed.data.currentPassword.trim(), user.passwordHash))) {
    res.status(400).json({ error: "Your current password is incorrect." });
    return;
  }
  const problem = passwordProblem(parsed.data.newPassword.trim());
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }
  if (await bcrypt.compare(parsed.data.newPassword.trim(), user.passwordHash)) {
    res.status(400).json({ error: "Choose a password different from your current one." });
    return;
  }
  const [updated] = await db
    .update(usersTable)
    .set({ passwordHash: await bcrypt.hash(parsed.data.newPassword.trim(), 12), mustChangePassword: false })
    .where(eq(usersTable.id, user.id))
    .returning();
  // Sign out every other device; keep this session.
  const token = sessionToken(req);
  await db
    .delete(sessionsTable)
    .where(and(eq(sessionsTable.userId, user.id), ne(sessionsTable.tokenHash, hashToken(String(token)))));
  await writeAuditLog(user.id, "password_changed", "user", user.id);
  res.json(ChangePasswordResponse.parse(await publicUser(updated)));
});

router.post("/auth/privacy-consent", authenticate, requireUser, async (req, res): Promise<void> => {
  const user = currentUser(res)!;
  if (req.body?.version !== PRIVACY_NOTICE_VERSION) {
    res.status(400).json({ error: "Privacy notice version is no longer current. Please retry.", code: "PRIVACY_VERSION_MISMATCH" });
    return;
  }
  await db.insert(privacyConsentsTable).values({ userId: user.id, version: PRIVACY_NOTICE_VERSION });
  await writeAuditLog(user.id, "privacy_consent_accepted", "user", user.id, { version: PRIVACY_NOTICE_VERSION });
  res.json({ accepted: true, version: PRIVACY_NOTICE_VERSION });
});

router.get("/auth/me", authenticate, requireUser, async (_req, res): Promise<void> => {
  const user = currentUser(res)!;
  res.json(GetCurrentUserResponse.parse({ ...user, phoneVerified: await phoneVerifiedFor(user.id) }));
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  const token = sessionToken(req);
  if (typeof token === "string" && token.length >= 32) {
    const [session] = await db
      .delete(sessionsTable)
      .where(eq(sessionsTable.tokenHash, hashToken(token)))
      .returning({ userId: sessionsTable.userId });
    if (session) {
      await writeAuditLog(session.userId, "logout", "user", session.userId);
    }
  }
  res.clearCookie(SESSION_COOKIE, cookieOptions(req));
  res.status(204).send();
});

export default router;
