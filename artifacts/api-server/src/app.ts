import { existsSync } from "node:fs";
import path from "node:path";
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import helmet from "helmet";
import router from "./routes";
import { logger } from "./lib/logger";
import { SESSION_HEADER } from "./lib/auth";
import { idempotency } from "./lib/idempotency";

const app: Express = express();

// Behind a reverse proxy (Render, Railway, Nginx...) this lets secure cookies work.
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      // index.html loads its fonts from Google Fonts; without these the production site
      // silently fell back to system fonts (the dev server sends no CSP, so it looked fine there).
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "https:", "wss:"],
      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
      workerSrc: ["'self'", "blob:"],
      manifestSrc: ["'self'"],
    },
  },
}));

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// The Android app (Capacitor) loads its screens from https://localhost and calls this API
// cross-origin with a bearer token. It is allowed without cookies (credentials), so a page on
// another site can never ride on a signed-in browser session through this rule.
const APP_ORIGINS = new Set(["https://localhost", "capacitor://localhost"]);
const webOrigins = process.env.CORS_ORIGIN?.split(",").map((o) => o.trim()).filter(Boolean) ?? [];
app.use(
  cors((req, callback) => {
    const origin = req.headers.origin;
    if (origin && APP_ORIGINS.has(origin)) {
      callback(null, { origin: true, credentials: false, exposedHeaders: [SESSION_HEADER, "content-disposition"], maxAge: 600 });
      return;
    }
    callback(null, { origin: webOrigins.length ? webOrigins : false, credentials: true });
  }),
);
app.use(cookieParser());
// Lab result uploads carry a file (up to 5 MB, base64-encoded); everything else stays small.
const smallJson = express.json({ limit: "100kb" });
const uploadJson = express.json({ limit: "8mb" });
app.use((req, res, next) =>
  req.method === "POST" && /^\/api\/patients\/\d+\/lab-results$/.test(req.originalUrl.split("?")[0])
    ? uploadJson(req, res, next)
    : smallJson(req, res, next),
);
app.use(express.urlencoded({ extended: true }));

// Changes synced from offline devices carry an Idempotency-Key, so retries never duplicate them.
app.use("/api", idempotency);
app.use("/api", router);

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found." });
});

// In production the API also serves the built web app (artifacts/caretrack/dist/public).
const webDist = path.resolve(
  process.env.WEB_DIST ?? path.join(__dirname, "..", "..", "caretrack", "dist", "public"),
);
if (existsSync(path.join(webDist, "index.html"))) {
  app.use(express.static(webDist, { index: false, maxAge: "1h" }));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });
}

app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  req.log?.error({ err }, "Unhandled request error");
  if (res.headersSent) return;
  const status =
    typeof err === "object" && err !== null && "status" in err && typeof err.status === "number"
      ? err.status
      : 500;
  res
    .status(status)
    .json({ error: status === 500 ? "Something went wrong. Please try again." : String((err as Error).message) });
});

export default app;
