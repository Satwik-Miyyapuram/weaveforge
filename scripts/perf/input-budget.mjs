// Input re-render budget for WeaveForge Dev (CDP 9223). Usage: node scripts/perf/input-budget.mjs key|pen
// key: types 20 characters into the open note's editor (.cm-editor), then deletes them again.
// pen: draws one 40-move pen stroke over the open note's ink surface (.ink-page-scroll); pen tool must be on.
// Counts DOM mutations outside that element, layouts, style recalcs and script time per event, and
// exits 1 when any budget in .agents/ui-layers.md is broken (scripts/lib/input-budget.mjs). Edits the open note: Dev only.
import { checkInputBudget, perEvent } from "../lib/input-budget.mjs";
import { close, run, send } from "./cdp.mjs";

const kind = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (kind !== "key" && kind !== "pen") {
  console.error("usage: node scripts/perf/input-budget.mjs key|pen");
  process.exitCode = 2;
  close();
} else {
  const selector = kind === "key" ? ".cm-editor" : ".ink-page-scroll";
  const SEL = JSON.stringify(selector);

  const rect = await run(`(() => { const el = document.querySelector(${SEL}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);

  if (!rect) {
    console.error(`no ${selector} on the page`);
    process.exitCode = 2;
    close();
  } else {
    await run(`window.__wfInputMutations = 0; const t = document.querySelector(${SEL}); window.__wfInputObserver?.disconnect(); window.__wfInputObserver = new MutationObserver((list) => { for (const m of list) if (!t.contains(m.target)) window.__wfInputMutations++; }); window.__wfInputObserver.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true }); true`);

    await send("Performance.enable");
    const metrics = async () =>
      Object.fromEntries((await send("Performance.getMetrics")).result.metrics.map((m) => [m.name, m.value]));
    const settle = () => run("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 300))))");
    const outsideCount = () => run("window.__wfInputMutations");

    const key = async (type, props) => send("Input.dispatchKeyEvent", { type, ...props });
    const typeChar = async (c) => {
      await key("keyDown", { key: c, text: c });
      await key("keyUp", { key: c });
    };
    const backspace = async () => {
      const props = { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 };
      await key("keyDown", props);
      await key("keyUp", props);
    };

    let before;
    let after;
    let outside;
    let events;

    if (kind === "key") {
      await run(`document.querySelector(".cm-editor .cm-content")?.focus(); true`);
      await settle();
      before = await metrics();
      await run("window.__wfInputMutations = 0; true");
      const chars = "abcdefghijklmnopqrst";
      for (const c of chars) {
        await typeChar(c);
        await sleep(30);
      }
      await settle();
      after = await metrics();
      outside = await outsideCount();
      for (let i = 0; i < chars.length; i++) {
        await backspace();
        await sleep(30);
      }
      events = chars.length;
    } else {
      const y = rect.y + rect.height / 3;
      const x0 = rect.x + rect.width * 0.25;
      const x1 = rect.x + rect.width * 0.75;
      const pen = { button: "left", pointerType: "pen" };
      await settle();
      before = await metrics();
      await run("window.__wfInputMutations = 0; true");
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x: x0, y, buttons: 1, clickCount: 1, ...pen });
      for (let i = 1; i <= 40; i++) {
        await send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: x0 + ((x1 - x0) * i) / 40,
          y: y + 10 * Math.sin(i / 4),
          buttons: 1,
          ...pen,
        });
        await sleep(16);
      }
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x1, y, buttons: 0, clickCount: 1, ...pen });
      await settle();
      after = await metrics();
      outside = await outsideCount();
      events = 40;
    }

    await run(`window.__wfInputObserver?.disconnect(); true`);
    await send("Performance.disable");
    close();

    const measured = perEvent(before, after, outside, events);
    const failures = checkInputBudget(kind, measured);
    console.log(`${kind}: ${JSON.stringify(measured)} per event over ${events}`);
    for (const f of failures) console.log(`OVER ${f}`);
    console.log(failures.length ? `${failures.length} budget(s) broken` : "all budgets hold");
    process.exitCode = failures.length ? 1 : 0;
  }
}
