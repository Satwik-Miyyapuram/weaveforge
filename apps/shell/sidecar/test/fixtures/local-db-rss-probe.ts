// Opens the local database the way the app does, then prints settled RSS in MB.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { engineStartParams } from "../../src/local-db-engine-params";

void (async () => {
  const db = await PGlite.create({
    extensions: { pgcrypto },
    startParams: engineStartParams(PGlite.defaultStartParams),
  });
  await db.query("select 1");
  const gc = (globalThis as { gc?: () => void }).gc;
  gc?.();
  gc?.();
  process.stdout.write(String(Math.round(process.memoryUsage().rss / 1048576)));
  await db.close();
})();
