/** Opening the app: it loads the folder's projects, and does so without flooding the shell with reads. */
import { countShellCalls, expect, test, tally } from "./dev-app";

test.describe("startup", () => {
  test("loads projects without an error", async ({ app }) => {
    await app.reload();
    // toHaveCount(0) passes instantly, so let the app settle before asserting.
    await app.waitForLoadState("load");
    await app.waitForTimeout(5_000);
    await expect(app.getByText("Could not load projects")).toHaveCount(0, { timeout: 20_000 });
  });

  test("stays inside its call budget", async ({ app }) => {
    const counter = await countShellCalls(app);
    await counter.reload();
    const per = tally(await counter.calls());
    test.info().annotations.push({ type: "calls", description: JSON.stringify(per) });
    console.log(JSON.stringify(per));

    // Before the 0.9.8 read cache one start made 3944 reads, 561 lists and 971 stats.
    expect(per.readVaultFile ?? 0).toBeLessThan(Number(process.env.WF_E2E_READ_BUDGET ?? 800));
    expect(per.listVaultFiles ?? 0).toBeLessThan(Number(process.env.WF_E2E_LIST_BUDGET ?? 150));
    expect(per.statVaultFile ?? 0).toBeLessThan(Number(process.env.WF_E2E_STAT_BUDGET ?? 300));
  });
});
