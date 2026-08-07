import { expect, test } from "@playwright/test";
import { bootstrapSession } from "./helpers/auth.js";
import { e2eEnabled, e2eUserA } from "./helpers/env.js";

test.use({ storageState: { cookies: [], origins: [] } });

const rawToken = "overleaf-browser-test-secret";

function report(id: string, ownerProjectId: string, title: string) {
  return {
    id,
    project_id: ownerProjectId,
    title,
    connection_id: "connection-a",
    overleaf_project_id: "overleaf-project-a",
    entry_file: "main.tex",
    external_url: "https://www.overleaf.com/project/overleaf-project-a",
    last_fetched_at: null,
  };
}

test.describe("Overleaf browser privacy boundary", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    if (!e2eEnabled()) testInfo.skip(true, "Set WEAVEFORGE_* env vars to run browser tests");
    await bootstrapSession(page, e2eUserA().email, e2eUserA().password);
  });

  test("never renders or receives the saved Overleaf token", async ({ page }) => {
    const responseBodies: string[] = [];
    let activeProjectId = "";
    page.on("response", async (response) => {
      if (response.url().includes("/api/overleaf/")) responseBodies.push(await response.text().catch(() => ""));
    });

    await page.route("**/api/overleaf/connections", async (route) => {
      if (route.request().method() === "POST") {
        const body = JSON.parse(route.request().postData() ?? "{}");
        expect(body.token).toBe(rawToken);
        await route.fulfill({ json: { connection: { id: "connection-a", name: body.name, token_prefix: "over", enabled: true } } });
        return;
      }
      await route.fulfill({ json: { connections: [] } });
    });
    await page.route("**/api/overleaf/reports**", async (route) => {
      if (route.request().method() === "POST") {
        const body = JSON.parse(route.request().postData() ?? "{}");
        activeProjectId = body.projectId;
        await route.fulfill({ json: { report: report("report-a", activeProjectId, "MSc thesis") } });
        return;
      }
      activeProjectId = new URL(route.request().url()).searchParams.get("projectId") ?? "";
      await route.fulfill({ json: { reports: [report("report-a", activeProjectId, "MSc thesis")] } });
    });
    await page.route("**/api/overleaf/reports/*/content", async (route) => {
      await route.fulfill({ json: {
        reportId: "report-a",
        files: [{ path: "main.tex", content: "\\section{Introduction}\\nPrivate source" }],
        entryFile: "main.tex",
        sectionTree: { roots: [{ id: "main.tex:1:1", title: "Introduction", command: "section", level: 2, file: "main.tex", startLine: 1, endLine: 2, preview: "Private source", children: [] }], files: ["main.tex"], warnings: [] },
        overleafUrl: "https://www.overleaf.com/project/overleaf-project-a",
      } });
    });

    await page.goto("/report");
    await expect(page.getByRole("heading", { name: "Overleaf reports" })).toBeVisible();
    await page.getByRole("button", { name: "Link report" }).click();
    await page.getByLabel("Connection name").fill("Test Overleaf");
    await page.getByLabel("Overleaf Git token").fill(rawToken);
    await page.getByLabel("Report title").fill("MSc thesis");
    await page.getByLabel("Overleaf project ID").fill("overleaf-project-a");
    await page.getByRole("button", { name: "Save and link report" }).click();
    await expect(page.getByRole("button", { name: /MSc thesis/ })).toBeVisible();
    await page.getByRole("button", { name: /MSc thesis/ }).click();
    await expect(page.getByText("Introduction")).toBeVisible();

    expect(await page.locator("body").innerText()).not.toContain(rawToken);
    expect(responseBodies.join("\\n")).not.toContain(rawToken);
    expect(responseBodies.join("\\n")).not.toContain("token_ciphertext");
    await expect(page.getByRole("link", { name: /Open in Overleaf/ })).toHaveAttribute("href", /overleaf-project-a/);
  });

  test("renders only reports belonging to the active project", async ({ page }) => {
    let requestedProjectId = "";
    await page.route("**/api/overleaf/reports**", async (route) => {
      requestedProjectId = new URL(route.request().url()).searchParams.get("projectId") ?? "";
      await route.fulfill({ json: { reports: [report("report-a", requestedProjectId, "Visible thesis"), report("report-b", "project-b", "Foreign thesis")] } });
    });

    await page.goto("/report");
    await expect(page.getByRole("heading", { name: "Overleaf reports" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Visible thesis/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Foreign thesis/ })).not.toBeVisible();
    expect(requestedProjectId).toBeTruthy();
  });
});
