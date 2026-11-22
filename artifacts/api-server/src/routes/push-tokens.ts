import { and, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { db, pushTokensTable } from "@workspace/db";
import { authenticate, currentUser, isAppClient, requireUser } from "../lib/auth";
import { pushDeliveryConfigured } from "../lib/push";

const router: IRouter = Router();
router.use("/push-tokens", authenticate, requireUser);

const tokenBody = z.object({
  token: z.string().trim().min(1).max(4096),
});

router.post("/push-tokens", async (req, res): Promise<void> => {
  if (!isAppClient(req)) {
    res.status(403).json({ error: "Push tokens can only be registered by the CareTrack app." });
    return;
  }
  const parsed = tokenBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A valid push token is required." });
    return;
  }

  const user = currentUser(res)!;
  await db
    .insert(pushTokensTable)
    .values({ userId: user.id, token: parsed.data.token })
    .onConflictDoUpdate({
      target: pushTokensTable.token,
      set: { userId: user.id, updatedAt: new Date() },
    });

  res.json({ deliveryConfigured: pushDeliveryConfigured() });
});

router.delete("/push-tokens", async (req, res): Promise<void> => {
  if (!isAppClient(req)) {
    res.status(403).json({ error: "Push tokens can only be removed by the CareTrack app." });
    return;
  }
  const parsed = tokenBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A valid push token is required." });
    return;
  }

  const user = currentUser(res)!;
  await db
    .delete(pushTokensTable)
    .where(and(eq(pushTokensTable.userId, user.id), eq(pushTokensTable.token, parsed.data.token)));
  res.status(204).send();
});

export default router;
