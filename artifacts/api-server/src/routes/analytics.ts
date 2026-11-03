import { Router, type IRouter } from "express";
import { GetAnalyticsQueryParams } from "@workspace/api-zod";
import { authenticate, currentUser, requireUser } from "../lib/auth";
import { calculateAnalytics } from "../lib/analytics";
import { canAccessPatient } from "../lib/patient-access";

const router: IRouter = Router();
router.use(authenticate, requireUser);

router.get("/analytics", async (req, res): Promise<void> => {
  const query = GetAnalyticsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const user = currentUser(res)!;
  if (
    query.data.patientId !== undefined &&
    !(await canAccessPatient(user, query.data.patientId))
  ) {
    res.status(404).json({ error: "Patient not found." });
    return;
  }
  const data = await calculateAnalytics(user, query.data);
  res.json(data);
});

export default router;
