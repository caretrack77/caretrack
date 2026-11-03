import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "../lib/auth";
import usersRouter from "./users";
import patientsRouter from "./patients";
import medicationsRouter from "./medications";
import dosesRouter from "./doses";
import analyticsRouter from "./analytics";
import insightsRouter from "./insights";
import notificationsRouter from "./notifications";
import reportsRouter from "./reports";
import adminRouter from "./admin";
import progressRouter from "./progress";
import messagesRouter from "./messages";
import coverageRouter from "./coverage";
import aiRouter from "./ai";
import careRouter from "./care";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(patientsRouter);
router.use(medicationsRouter);
router.use(dosesRouter);
router.use(analyticsRouter);
router.use(insightsRouter);
router.use(notificationsRouter);
router.use(reportsRouter);
router.use(adminRouter);
router.use(progressRouter);
router.use(messagesRouter);
router.use(coverageRouter);
router.use(aiRouter);
router.use(careRouter);

export default router;
