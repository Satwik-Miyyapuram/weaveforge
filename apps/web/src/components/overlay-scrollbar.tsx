"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";

export interface OverlayScrollbarProps {
  /** The scrollable DOM container being watched and controlled. */
  scrollRef: React.RefObject<HTMLElement | null> | { current: HTMLElement | null };
  /** Extra CSS classes for the scrollbar track. */
  className?: string;
  /** Milliseconds before fading out after scrolling stops (default 1200ms). */
  autoHideDelay?: number;
}

/**
 * OverlayScrollbar
 *
 * Renders a floating scrollbar thumb over a scrollable element without consuming
 * layout width (zero layout shift). It appears when scrolling or when the track is
 * hovered, stays visible during pointer dragging, and fades away when idle.
 */
export function OverlayScrollbar({
  scrollRef,
  className = "",
  autoHideDelay = 1200,
}: OverlayScrollbarProps) {
  const [hasOverflow, setHasOverflow] = useState(() => {
    const el = scrollRef.current;
    return el ? el.scrollHeight > el.clientHeight + 1 : false;
  });
  const [isVisible, setIsVisible] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const trackRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDraggingRef = useRef(false);
  const dragStartYRef = useRef(0);
  const dragStartScrollTopRef = useRef(0);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => {
      if (!isDraggingRef.current && !isHovered) {
        setIsVisible(false);
      }
    }, autoHideDelay);
  }, [autoHideDelay, clearHideTimer, isHovered]);

  const updateThumb = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    const { scrollTop, scrollHeight, clientHeight } = el;
    const overflow = scrollHeight > clientHeight + 1;
    setHasOverflow(overflow);

    const thumb = thumbRef.current;
    if (!thumb || !overflow) return;

    const minThumbH = 32;
    const thumbH = Math.max(minThumbH, Math.round((clientHeight / scrollHeight) * clientHeight));
    const maxScroll = scrollHeight - clientHeight;
    const scrollRatio = maxScroll > 0 ? scrollTop / maxScroll : 0;
    const maxThumbTop = clientHeight - thumbH;
    const thumbTop = Math.round(scrollRatio * maxThumbTop);

    if (thumb && "style" in thumb && thumb.style) {
      thumb.style.height = `${thumbH}px`;
      thumb.style.transform = `translateY(${thumbTop}px)`;
    }
  }, [scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onScroll = () => {
      updateThumb();
      setIsVisible(true);
      scheduleHide();
    };

    // Hovering the content does not pin the thumb: it shows on scroll and
    // fades when idle, and only hovering the track itself keeps it up. Pinning
    // it for the whole pane meant a pen resting over the page never let it go.
    // The document's scroll events fire on the window, not on `<html>`.
    const scrollTarget: EventTarget =
      typeof document !== "undefined" && el === document.documentElement ? window : el;
    scrollTarget.addEventListener("scroll", onScroll, { passive: true });

    // Watch size changes on container & its children
    const resizeObserver = new ResizeObserver(() => {
      updateThumb();
    });
    resizeObserver.observe(el);

    // MutationObserver to catch dynamic content changes
    const mutationObserver = new MutationObserver(() => {
      updateThumb();
    });
    mutationObserver.observe(el, { childList: true, subtree: true });

    updateThumb();

    return () => {
      clearHideTimer();
      scrollTarget.removeEventListener("scroll", onScroll);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [scrollRef, updateThumb, scheduleHide, clearHideTimer]);

  const onThumbPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const el = scrollRef.current;
    if (!el) return;

    isDraggingRef.current = true;
    dragStartYRef.current = e.clientY;
    dragStartScrollTopRef.current = el.scrollTop;

    clearHideTimer();
    setIsVisible(true);

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore in environments where pointer capture isn't supported
    }
  };

  const onThumbPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    const el = scrollRef.current;
    const thumb = thumbRef.current;
    if (!el || !thumb) return;

    const deltaY = e.clientY - dragStartYRef.current;
    const clientHeight = el.clientHeight;
    const scrollHeight = el.scrollHeight;
    const minThumbH = 32;
    const thumbH = Math.max(minThumbH, Math.round((clientHeight / scrollHeight) * clientHeight));
    const maxThumbTop = clientHeight - thumbH;
    const maxScroll = scrollHeight - clientHeight;

    if (maxThumbTop > 0) {
      const scrollDelta = (deltaY / maxThumbTop) * maxScroll;
      el.scrollTop = dragStartScrollTopRef.current + scrollDelta;
    }
  };

  const onThumbPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
    scheduleHide();
  };

  const onTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // If click is on the thumb itself, ignore
    if (e.target === thumbRef.current) return;
    const el = scrollRef.current;
    const track = trackRef.current;
    if (!el || !track) return;

    const trackRect = track.getBoundingClientRect();
    const clickY = e.clientY - trackRect.top;
    const clientHeight = el.clientHeight;
    const scrollHeight = el.scrollHeight;
    const maxScroll = scrollHeight - clientHeight;

    const targetRatio = clickY / clientHeight;
    el.scrollTo({
      top: targetRatio * maxScroll,
      behavior: "smooth",
    });
  };

  if (!hasOverflow) {
    return null;
  }

  const visibleClass = isVisible || isHovered ? "is-visible" : "";

  return (
    <div
      ref={trackRef}
      className={`overlay-scrollbar-track ${visibleClass} ${className}`.trim()}
      onClick={onTrackClick}
      onPointerEnter={() => {
        setIsHovered(true);
        setIsVisible(true);
        clearHideTimer();
      }}
      onPointerLeave={() => {
        setIsHovered(false);
        scheduleHide();
      }}
      aria-hidden="true"
    >
      <div
        ref={thumbRef}
        className="overlay-scrollbar-thumb"
        onPointerDown={onThumbPointerDown}
        onPointerMove={onThumbPointerMove}
        onPointerUp={onThumbPointerUp}
        onPointerCancel={onThumbPointerUp}
      />
    </div>
  );
}
