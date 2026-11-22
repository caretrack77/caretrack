import { and, eq, inArray, ne } from "drizzle-orm";
import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { CreateUserResponse, ListUsersResponse, UpdateUserBody, UpdateUserResponse, CreateUserBody, UpdateUserParams, DeleteUserParams } from "@workspace/api-zod";
import { db, privacyConsentsTable, usersTable } from "@workspace/db";
import { PRIVACY_NOTICE_VERSION } from "../lib/security-config";
import { authenticate, currentUser, passwordProblem, phoneVerifiedFor, requireRoles, requireUser } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";

const router: IRouter = Router();
router.use("/users", authenticate, requireUser, requireRoles("admin"));

/**
 * The API contract includes whether each user accepted the current privacy notice. It was never
 * filled in, so every Team access request failed response validation (HTTP 500).
 */
async function withConsent<T extends { id: number; createdAt: Date }>(users: T[]) {
  const ids = users.map((user) => user.id);
  const accepted = ids.length
    ? new Set((await db.select({ userId: privacyConsentsTable.userId }).from(privacyConsentsTable)
      .where(and(inArray(privacyConsentsTable.userId, ids), eq(privacyConsentsTable.version, PRIVACY_NOTICE_VERSION)))).map((row) => row.userId))
    : new Set<number>();
  return Promise.all(users.map(async (user) => ({
    ...user,
    createdAt: user.createdAt.toISOString(),
    privacyConsentAccepted: accepted.has(user.id),
    phoneVerified: await phoneVerifiedFor(user.id),
  })));
}

router.get("/users", async (_req, res): Promise<void> => {
  const users = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      active: usersTable.active,
      phone: usersTable.phone,
      mustChangePassword: usersTable.mustChangePassword,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .orderBy(usersTable.createdAt);
  res.json(
    ListUsersResponse.parse(await withConsent(users)),
  );
});

router.post("/users", async (req, res): Promise<void> => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const problem = passwordProblem(parsed.data.password.trim());
  if (problem) {
    res.status(400).json({ error: `Temporary password: ${problem}` });
    return;
  }
  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);
  if (existing) {
    res.status(409).json({ error: "An account with that email already exists." });
    return;
  }
  const [user] = await db
    .insert(usersTable)
    .values({
      name: parsed.data.name.trim(),
      email,
      passwordHash: await bcrypt.hash(parsed.data.password.trim(), 12),
      role: parsed.data.role,
      phone: parsed.data.phone?.trim() || null,
      // New accounts start with a temporary password and must choose their own.
      mustChangePassword: true,
    })
    .returning({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      active: usersTable.active,
      phone: usersTable.phone,
      mustChangePassword: usersTable.mustChangePassword,
      createdAt: usersTable.createdAt,
    });
  await writeAuditLog(currentUser(res)!.id, "create", "user", user.id, {
    role: user.role,
  });
  res.status(201).json(
    CreateUserResponse.parse((await withConsent([user]))[0]),
  );
});

router.patch("/users/:id", async (req, res): Promise<void> => {
  const params = UpdateUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const changes: Partial<typeof usersTable.$inferInsert> = {};
  if (parsed.data.name !== undefined) changes.name = parsed.data.name.trim();
  if (parsed.data.email !== undefined) {
    changes.email = parsed.data.email.trim().toLowerCase();
  }
  if (parsed.data.active !== undefined) changes.active = parsed.data.active;
  if (parsed.data.phone !== undefined) changes.phone = parsed.data.phone?.trim() || null;
  if (parsed.data.password !== undefined) {
    const problem = passwordProblem(parsed.data.password.trim());
    if (problem) {
      res.status(400).json({ error: `Temporary password: ${problem}` });
      return;
    }
    changes.passwordHash = await bcrypt.hash(parsed.data.password.trim(), 12);
    // An admin reset issues a temporary password; the user must replace it at next sign-in.
    changes.mustChangePassword = params.data.id !== currentUser(res)!.id;
  }
  if (changes.email) {
    const [taken] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.email, changes.email), ne(usersTable.id, params.data.id)))
      .limit(1);
    if (taken) {
      res.status(409).json({ error: "Another account already uses that email." });
      return;
    }
  }
  if (params.data.id === currentUser(res)!.id && parsed.data.active === false) {
    res.status(400).json({ error: "You can't deactivate your own account." });
    return;
  }
  if (Object.keys(changes).length === 0) {
    res.status(400).json({ error: "Provide at least one field to update." });
    return;
  }

  const [user] = await db
    .update(usersTable)
    .set(changes)
    .where(eq(usersTable.id, params.data.id))
    .returning({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      active: usersTable.active,
      phone: usersTable.phone,
      mustChangePassword: usersTable.mustChangePassword,
      createdAt: usersTable.createdAt,
    });
  if (!user) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  await writeAuditLog(currentUser(res)!.id, "update", "user", user.id, {
    changedFields: Object.keys(changes).filter((field) => field !== "passwordHash"),
  });
  res.json(
    UpdateUserResponse.parse((await withConsent([user]))[0]),
  );
});


router.delete("/users/:id", async (req, res): Promise<void> => {
  const params = DeleteUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (params.data.id === currentUser(res)!.id) {
    res.status(400).json({ error: "You can't delete your own account." });
    return;
  }
  const [existing] = await db
    .select({ id: usersTable.id, name: usersTable.name, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, params.data.id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  await db.delete(usersTable).where(eq(usersTable.id, params.data.id));
  await writeAuditLog(currentUser(res)!.id, "delete", "user", existing.id, {
    name: existing.name,
    role: existing.role,
  });
  res.status(204).end();
});

export default router;
