"use client";

import { useEffect, type RefObject } from "react";
import s from "./scrolly.module.css";

/**
 * Drives every scrollytelling stage on the pitch page.
 *
 * Each `[data-scrolly]` block pairs a sticky stage with a column of steps. The
 * step nearest the middle of the screen is "now": objects on the stage whose
 * `data-at` is at or before it are lit, the one equal to it is lifted, and
 * `data-hot` lines light up while their step is showing.
 *
 * The drawing is complete in the markup. Nothing is dimmed until this effect
 * marks the page `data-js`, so a reader without JavaScript sees every stage
 * finished rather than every stage blank.
 */
export function useScrolly(
  rootRef: RefObject<HTMLElement | null>,
  onSection: (id: string) => void,
) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.dataset.js = "";
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const scenes = [...root.querySelectorAll<HTMLElement>("[data-scrolly]")].map((el) => ({
      name: el.dataset.scrolly ?? "",
      steps: [...el.querySelectorAll<HTMLElement>("[data-step]")],
      stage: el.querySelector<HTMLElement>("[data-stage]")!,
      pips: [...el.querySelectorAll<HTMLElement>("[data-pip]")],
      count: el.querySelector<HTMLElement>("[data-count]"),
      cur: 0,
    }));

    let timer: number | undefined;
    const runMetric = (stage: HTMLElement, n: number) => {
      const metric = stage.querySelector<HTMLElement>("[data-metric]");
      const epoch = stage.querySelector<HTMLElement>("[data-epoch]");
      const chip = stage.querySelector<HTMLElement>("[data-runchip]");
      if (!metric || !epoch || !chip) return;
      window.clearInterval(timer);
      const done = n >= 3;
      chip.textContent = done ? "done" : "running";
      chip.classList.toggle(s["c-read"]!, done);
      chip.classList.toggle(s["c-reading"]!, !done);
      if (n !== 2 || reduce) {
        metric.textContent = n < 2 ? "0.9412" : "0.1826";
        epoch.textContent = n < 2 ? "0" : "50";
        return;
      }
      // A loss that falls the way a real one does: fast, then flattening, with
      // a little noise that settles as it converges.
      let e = 0;
      timer = window.setInterval(() => {
        e += 1;
        const v = 0.1826 + 0.76 * Math.exp(-e / 9) + (Math.random() - 0.5) * 0.01 * Math.exp(-e / 25);
        metric.textContent = (e >= 50 ? 0.1826 : v).toFixed(4);
        epoch.textContent = String(e);
        if (e >= 50) window.clearInterval(timer);
      }, 45);
    };

    const apply = (sc: (typeof scenes)[number], n: number) => {
      if (sc.cur === n) return;
      sc.cur = n;
      sc.steps.forEach((st, i) => st.classList.toggle(s.now!, i + 1 === n));
      sc.pips.forEach((p, i) => p.classList.toggle(s.on!, i < n));
      if (sc.count) sc.count.textContent = `${n} / ${sc.steps.length}`;
      for (const el of sc.stage.querySelectorAll<HTMLElement | SVGElement>("[data-at]")) {
        const at = Number(el.dataset.at);
        el.classList.toggle(s.on!, at <= n);
        if (el.classList.contains(s.obj!)) el.classList.toggle(s.now!, at === n);
      }
      for (const el of sc.stage.querySelectorAll<HTMLElement>("[data-hot]")) {
        el.classList.toggle(s.hot!, ` ${el.dataset.hot} `.includes(` ${n} `));
      }
      if (sc.name === "labs") sc.stage.classList.toggle(s.solo!, n === 4);
      if (sc.name === "exp") runMetric(sc.stage, n);
    };

    const term = root.querySelector<HTMLElement>("[data-term]");
    const cmds = term ? [...term.querySelectorAll<HTMLElement>("[data-cmd]")] : [];
    const sections = [...root.querySelectorAll<HTMLElement>("[data-section]")];
    const bar = root.querySelector<HTMLElement>("[data-progress]");
    let lastSection = "";

    const paint = () => {
      const vh = window.innerHeight;
      const mid = vh * 0.5;
      const doc = document.documentElement;
      if (bar) bar.style.transform = `scaleX(${Math.min(1, window.scrollY / Math.max(1, doc.scrollHeight - vh))})`;

      for (const sc of scenes) {
        let n = 1;
        sc.steps.forEach((st, i) => { if (st.getBoundingClientRect().top < mid) n = i + 1; });
        apply(sc, n);
      }

      // The terminal types itself in as it scrolls up the screen.
      if (term) {
        const top = term.getBoundingClientRect().top;
        const p = Math.max(0, Math.min(1, (vh * 0.9 - top) / (vh * 0.55)));
        const shown = Math.max(1, Math.ceil(p * cmds.length));
        cmds.forEach((c, i) => {
          c.classList.toggle(s.on!, i < shown);
          c.classList.toggle(s.cur!, i === shown - 1);
        });
      }

      let active = sections[0]?.dataset.section ?? "";
      for (const sec of sections) if (sec.getBoundingClientRect().top < vh * 0.35) active = sec.dataset.section ?? active;
      if (active !== lastSection) {
        lastSection = active;
        onSection(active);
      }
    };

    // Each stage is drawn at a fixed size and scaled to fit its sticky frame,
    // so the arrows between cards stay where they were drawn at every width.
    const fit = () => {
      for (const el of root.querySelectorAll<HTMLElement>("[data-w]")) {
        const box = el.parentElement!;
        const w = Number(el.dataset.w);
        const h = Number(el.dataset.h);
        const k = Math.min(1.15, (box.clientWidth - 36) / w, (box.clientHeight - 56) / h);
        el.style.transform = `translateY(12px) scale(${k})`;
        el.style.margin = `${(h * k - h) / 2}px ${(w * k - w) / 2}px`;
      }
    };

    let frame = 0;
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; paint(); });
    };
    const onResize = () => { fit(); onScroll(); };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(fit);
    for (const el of root.querySelectorAll<HTMLElement>("[data-stage-frame]")) ro.observe(el);
    fit();
    paint();

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      if (frame) cancelAnimationFrame(frame);
      window.clearInterval(timer);
      delete root.dataset.js;
    };
  }, [rootRef, onSection]);
}
