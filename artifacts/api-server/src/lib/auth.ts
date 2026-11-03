import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull, ne } from "drizzle-orm";
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
import { sendEmail, sendSms, undeliverableEmail } from "./otp-delivery";

const SESSION_COOKIE = "caretrack_session";
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export type CurrentUser = Pick<
  typeof usersTable.$inferSelect,
  "id" | "name" | "email" | "role" | "active" | "mustChangePassword"
>;

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

function publicUser(user: CurrentUser): CurrentUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    active: user.active,
    mustChangePassword: user.mustChangePassword,
  };
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
  const token = req.cookies?.[SESSION_COOKIE];
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
    res.clearCookie(SESSION_COOKIE, { path: "/api", sameSite: "lax" });
    next();
    return;
  }

  res.locals.currentUser = publicUser(record);
  next();
}

function cookieOptions(req: Request) {
  return {
    httpOnly: true,
    // HTTPS deployments get secure cookies; plain-HTTP localhost still works.
    secure: req.secure,
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

async function startSession(req: Request, res: Response, userId: number): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessionsTable).values({
    tokenHash: hashToken(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS),
  });
  res.cookie(SESSION_COOKIE, token, cookieOptions(req));
}

const router: IRouter = Router();

router.post("/auth/login", async (req, res): Promise<void> => {
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
      user: publicUser(user),
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

router.post("/auth/otp/send", async (req, res): Promise<void> => {
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
  const channel = parsed.data.channel;
  const phone = channel === "sms" ? await phoneFor(user) : null;
  if (channel === "sms" && !phone) {
    res.status(400).json({ error: "No mobile number is saved for this account. Use email instead." });
    return;
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db
    .update(otpChallengesTable)
    .set({
      codeHash: hashToken(code + challenge.id),
      channel,
      codeExpiresAt: new Date(Date.now() + OTP_CODE_LIFETIME_MS),
      lastSentAt: new Date(),
      attempts: 0,
    })
    .where(eq(otpChallengesTable.id, challenge.id));

  const text = `Your CareTrack login code is ${code}. It expires in 5 minutes. Do not share this code with anyone.`;
  const delivered =
    channel === "sms"
      ? await sendSms(phone!, text)
      : await sendEmail(user.email, "Your CareTrack login code", text);

  // Offline mode: with no internet or no provider configured, show the code on screen.
  const showOffline = !delivered && process.env.OTP_OFFLINE_FALLBACK !== "false";
  if (!delivered) {
    logger.info({ userId: user.id, channel }, `Offline OTP for ${user.email}: ${code}`);
  }
  if (!delivered && !showOffline) {
    res.status(503).json({ error: "We couldn't send the code right now. Try the other option or try again later." });
    return;
  }
  await writeAuditLog(user.id, "otp_sent", "user", user.id, { channel, delivered });
  const sentTo = channel === "sms" ? maskPhone(phone!) : maskEmail(user.email);
  res.json(
    SendLoginOtpResponse.parse({
      channel,
      sentTo,
      delivered,
      offlineCode: showOffline ? code : null,
      message: delivered
        ? `We sent a 6-digit code to ${sentTo}.`
        : channel === "email" && undeliverableEmail(user.email)
          ? `${user.email} is not a real inbox, so your code is shown here. Add a real Gmail address to this account under Team access.`
          : `Offline mode: ${channel === "sms" ? "SMS" : "email"} could not be sent, so your code is shown here.`,
      expiresInSeconds: OTP_CODE_LIFETIME_MS / 1000,
    }),
  );
});

router.post("/auth/otp/verify", async (req, res): Promise<void> => {
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
  await db
    .update(otpChallengesTable)
    .set({ consumedAt: new Date() })
    .where(eq(otpChallengesTable.id, challenge.id));
  await startSession(req, res, user.id);
  await writeAuditLog(user.id, "login", "user", user.id, { method: `otp_${challenge.channel}` });
  res.json(VerifyLoginOtpResponse.parse(publicUser(user)));
});

router.post("/auth/change-password", authenticate, requireUser, async (req, res): Promise<void> => {
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
  const token = req.cookies?.[SESSION_COOKIE];
  await db
    .delete(sessionsTable)
    .where(and(eq(sessionsTable.userId, user.id), ne(sessionsTable.tokenHash, hashToken(String(token)))));
  await writeAuditLog(user.id, "password_changed", "user", user.id);
  res.json(ChangePasswordResponse.parse(publicUser(updated)));
});

router.get("/auth/me", authenticate, requireUser, (_req, res): void => {
  res.json(GetCurrentUserResponse.parse(currentUser(res)));
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  const token = req.cookies?.[SESSION_COOKIE];
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
