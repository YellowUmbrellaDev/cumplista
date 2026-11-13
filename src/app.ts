import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { isSameOrigin } from "./domain/auth.js";
import type { Deps } from "./ports.js";
import { accountRoutes } from "./routes/account.js";
import { guestRoutes } from "./routes/guest.js";
import { MAX_FORM_BYTES, parseSafeBack } from "./routes/http.js";
import { ownerRoutes } from "./routes/owner.js";

export { MAX_FORM_BYTES, parseSafeBack };

export function createApp(getDeps: () => Deps): Hono {
  const app = new Hono();

  app.use("*", async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.method !== "OPTIONS") {
      if (!isSameOrigin(c.req.header("origin"), getDeps().env.APP_URL)) {
        return c.text("Forbidden", 403);
      }
    }
    return next();
  });

  app.get("/healthz", (c) => c.text("ok"));
  app.route("/", accountRoutes(getDeps));
  app.route("/", ownerRoutes(getDeps));
  app.route("/", guestRoutes(getDeps));

  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    console.error(err);
    return c.text("Internal Server Error", 500);
  });

  return app;
}
