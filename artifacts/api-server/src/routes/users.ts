import { and, eq, ne } from "drizzle-orm";
import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { CreateUserResponse, ListUsersResponse, UpdateUserBody, UpdateUserResponse, CreateUserBody, UpdateUserParams } from "@workspace/api-zod";
import { db, usersTable } from "@workspace/db";
import { authenticate, currentUser, passwordProblem, requireRoles, requireUser } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";

const router: IRouter = Router();
router.use("/users", authenticate, requireUser, requireRoles("admin"));

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
    ListUsersResponse.parse(
      users.map((user) => ({ ...user, createdAt: user.createdAt.toISOString() })),
    ),
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
  const inserted = await db
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
    ;
  const [user] = await db.select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      active: usersTable.active,
      phone: usersTable.phone,
      mustChangePassword: usersTable.mustChangePassword,
      createdAt: usersTable.createdAt,
    }).from(usersTable).where(eq(usersTable.id, Number(inserted[0].insertId))).limit(1);
  await writeAuditLog(currentUser(res)!.id, "create", "user", user.id, {
    role: user.role,
  });
  res.status(201).json(
    CreateUserResponse.parse({ ...user, createdAt: user.createdAt.toISOString() }),
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

  await db
    .update(usersTable)
    .set(changes)
    .where(eq(usersTable.id, params.data.id))
    ;
  const [user] = await db.select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      active: usersTable.active,
      phone: usersTable.phone,
      mustChangePassword: usersTable.mustChangePassword,
      createdAt: usersTable.createdAt,
    }).from(usersTable).where(eq(usersTable.id, params.data.id)).limit(1);
  if (!user) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  await writeAuditLog(currentUser(res)!.id, "update", "user", user.id, {
    changedFields: Object.keys(changes).filter((field) => field !== "passwordHash"),
  });
  res.json(
    UpdateUserResponse.parse({ ...user, createdAt: user.createdAt.toISOString() }),
  );
});

export default router;
