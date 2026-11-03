import { aliasedTable, and, asc, count, desc, eq, inArray, or } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { CreateCoverageBody, EndCoverageParams } from "@workspace/api-zod";
import {
  db,
  notificationsTable,
  patientProviderAssignmentsTable,
  providerCoverageTable,
  usersTable,
} from "@workspace/db";
import { authenticate, currentUser, requireRoles, requireUser } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { manilaDate } from "../lib/dose-scheduler";

const router: IRouter = Router();
router.use(authenticate, requireUser);

const absentUser = aliasedTable(usersTable, "absent_user");
const coveringUser = aliasedTable(usersTable, "covering_user");

function statusOf(row: typeof providerCoverageTable.$inferSelect): "active" | "upcoming" | "ended" {
  const today = manilaDate();
  if (row.endedAt || (row.endDate && row.endDate < today)) return "ended";
  return row.startDate > today ? "upcoming" : "active";
}

async function loadCoverage(where?: ReturnType<typeof eq>) {
  const rows = await db
    .select({
      coverage: providerCoverageTable,
      absentName: absentUser.name,
      coveringName: coveringUser.name,
    })
    .from(providerCoverageTable)
    .innerJoin(absentUser, eq(absentUser.id, providerCoverageTable.absentProviderId))
    .innerJoin(coveringUser, eq(coveringUser.id, providerCoverageTable.coveringProviderId))
    .where(where)
    .orderBy(desc(providerCoverageTable.createdAt))
    .limit(100);
  const absentIds = [...new Set(rows.map((row) => row.coverage.absentProviderId))];
  const counts = absentIds.length
    ? await db
        .select({ providerId: patientProviderAssignmentsTable.providerId, total: count() })
        .from(patientProviderAssignmentsTable)
        .where(inArray(patientProviderAssignmentsTable.providerId, absentIds))
        .groupBy(patientProviderAssignmentsTable.providerId)
    : [];
  return rows.map(({ coverage, absentName, coveringName }) => ({
    id: coverage.id,
    absentProviderId: coverage.absentProviderId,
    absentProviderName: absentName,
    coveringProviderId: coverage.coveringProviderId,
    coveringProviderName: coveringName,
    startDate: coverage.startDate,
    endDate: coverage.endDate,
    reason: coverage.reason,
    status: statusOf(coverage),
    patientCount: Number(counts.find((c) => c.providerId === coverage.absentProviderId)?.total ?? 0),
  }));
}

router.get("/providers", requireRoles("admin", "provider"), async (_req, res): Promise<void> => {
  const providers = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
    .from(usersTable)
    .where(and(eq(usersTable.role, "provider"), eq(usersTable.active, true)))
    .orderBy(asc(usersTable.name));
  res.json(providers);
});

router.get("/coverage", requireRoles("admin", "provider"), async (_req, res): Promise<void> => {
  const user = currentUser(res)!;
  res.json(
    await loadCoverage(
      user.role === "admin"
        ? undefined
        : (or(
            eq(providerCoverageTable.absentProviderId, user.id),
            eq(providerCoverageTable.coveringProviderId, user.id),
          ) as ReturnType<typeof eq>),
    ),
  );
});

router.post("/coverage", requireRoles("admin", "provider"), async (req, res): Promise<void> => {
  const parsed = CreateCoverageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose the absent doctor, the covering doctor and a start date." });
    return;
  }
  const user = currentUser(res)!;
  const { absentProviderId, coveringProviderId, startDate } = parsed.data;
  const endDate = parsed.data.endDate || null;
  // Doctors can hand over their own patients; admins can arrange coverage for anyone.
  if (user.role === "provider" && absentProviderId !== user.id) {
    res.status(403).json({ error: "You can only arrange coverage for your own patients." });
    return;
  }
  if (absentProviderId === coveringProviderId) {
    res.status(400).json({ error: "Choose a different doctor to cover." });
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate))) {
    res.status(400).json({ error: "Dates must be in YYYY-MM-DD format." });
    return;
  }
  if (endDate && endDate < startDate) {
    res.status(400).json({ error: "The end date must be on or after the start date." });
    return;
  }
  const providers = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      and(
        inArray(usersTable.id, [absentProviderId, coveringProviderId]),
        eq(usersTable.role, "provider"),
        eq(usersTable.active, true),
      ),
    );
  if (providers.length !== 2) {
    res.status(400).json({ error: "Both people must be active doctors or nurses." });
    return;
  }
  const inserted = await db
    .insert(providerCoverageTable)
    .values({
      absentProviderId,
      coveringProviderId,
      startDate,
      endDate,
      reason: parsed.data.reason?.trim() || null,
      createdBy: user.id,
    })
    ;
  const [coverage] = await db.select().from(providerCoverageTable).where(eq(providerCoverageTable.id, Number(inserted[0].insertId))).limit(1);
  const [result] = await loadCoverage(eq(providerCoverageTable.id, coverage.id));
  const period = `${startDate}${endDate ? ` to ${endDate}` : " until further notice"}`;
  await db.insert(notificationsTable).values([
    {
      userId: coveringProviderId,
      kind: "coverage",
      title: `You're covering for ${result.absentProviderName}`,
      message: `${result.patientCount} patient${result.patientCount === 1 ? "" : "s"} will appear in your list, ${period}. You'll receive their alerts and messages.`,
    },
    {
      userId: absentProviderId,
      kind: "coverage",
      title: `${result.coveringProviderName} is covering your patients`,
      message: `Coverage is in place ${period}.`,
    },
  ]);
  await writeAuditLog(user.id, "coverage_created", "coverage", coverage.id, {
    absentProviderId,
    coveringProviderId,
    startDate,
    endDate,
  });
  res.status(201).json(result);
});

router.post("/coverage/:id/end", requireRoles("admin", "provider"), async (req, res): Promise<void> => {
  const params = EndCoverageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const user = currentUser(res)!;
  const [existing] = await db
    .select()
    .from(providerCoverageTable)
    .where(eq(providerCoverageTable.id, params.data.id))
    .limit(1);
  const involved =
    existing && (existing.absentProviderId === user.id || existing.coveringProviderId === user.id);
  if (!existing || (user.role !== "admin" && !involved)) {
    res.status(404).json({ error: "Coverage not found." });
    return;
  }
  await db
    .update(providerCoverageTable)
    .set({ endedAt: new Date() })
    .where(eq(providerCoverageTable.id, existing.id));
  await writeAuditLog(user.id, "coverage_ended", "coverage", existing.id);
  const [result] = await loadCoverage(eq(providerCoverageTable.id, existing.id));
  res.json(result);
});

export default router;
