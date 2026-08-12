// Makes the tab strips usable once there are more tabs than fit.
//
// Two things a plain `overflow-x: auto` does not give you:
//   1. A mouse wheel only scrolls vertically, so on a strip that only scrolls
//      horizontally the wheel does nothing at all. Trackpad users can swipe;
//      mouse users would be stuck.
//   2. Selecting a tab from the keyboard, or restoring the active tab on
//      mount, can leave it outside the visible run with no hint it exists.

import { useEffect } from "react";

export function useTabStripScroll(activeTab?: string) {
  useEffect(() => {
    const strips = Array.from(
      document.querySelectorAll<HTMLElement>(".tab-strip"),
    );
    if (!strips.length) return;

    const onWheel = (e: WheelEvent) => {
      const strip = e.currentTarget as HTMLElement;
      // Leave real horizontal intent (trackpad swipe) to the browser.
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (strip.scrollWidth <= strip.clientWidth) return;

      e.preventDefault();
      strip.scrollLeft += e.deltaY;
    };

    strips.forEach((s) => s.addEventListener("wheel", onWheel, { passive: false }));
    return () => {
      strips.forEach((s) => s.removeEventListener("wheel", onWheel));
    };
  }, []);

  // Keep whichever tab is active inside the visible run.
  useEffect(() => {
    if (!activeTab) return;
    const id = window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(
        `.tab-strip [data-state="active"]`,
      );
      el?.scrollIntoView({ inline: "nearest", block: "nearest" });
    }, 50);
    return () => window.clearTimeout(id);
  }, [activeTab]);
}
