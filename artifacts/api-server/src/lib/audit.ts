import { db, auditLogsTable } from "@workspace/db";

export async function writeAuditLog(
  userId: number | null,
  action: string,
  entityType: string,
  entityId: number | null = null,
  details: Record<string, unknown> = {},
): Promise<void> {
  await db.insert(auditLogsTable).values({
    userId,
    action,
    entityType,
    entityId,
    details,
  });
}
