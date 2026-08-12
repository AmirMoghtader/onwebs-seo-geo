// Drag-to-reorder for tab bars, matching Screaming Frog.
//
// Implemented with pointer events rather than HTML5 drag-and-drop: Radix
// renders each tab as a <button>, and WebKit — which is what Tauri uses on
// macOS — will not start a native drag on a button even with draggable="true".
// Pointer events behave identically across engines and also let us keep the
// tab's normal click-to-activate behaviour, by only treating a gesture as a
// drag once it has moved past a small threshold.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const DRAG_THRESHOLD_PX = 5;

export function useTabOrder(storageKey: string, defaultOrder: string[]) {
  const [order, setOrder] = useState<string[]>(defaultOrder);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  const gesture = useRef<{
    key: string;
    startX: number;
    active: boolean;
  } | null>(null);
  const orderRef = useRef(order);
  orderRef.current = order;

  // Restore, then reconcile against the current tab set so a saved order never
  // hides a newly added tab or resurrects a removed one.
  useEffect(() => {
    let saved: string[] = [];
    try {
      saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
    } catch {
      saved = [];
    }
    const known = new Set(defaultOrder);
    const kept = saved.filter((k) => known.has(k));
    const added = defaultOrder.filter((k) => !kept.includes(k));
    setOrder([...kept, ...added]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, defaultOrder.join("|")]);

  const persist = useCallback(
    (next: string[]) => {
      setOrder(next);
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* storage unavailable — ordering just won't survive a restart */
      }
    },
    [storageKey],
  );

  // Global listeners live for the duration of a gesture only.
  useEffect(() => {
    if (!draggingKey) return;

    const onMove = (e: PointerEvent) => {
      const el = document
        .elementsFromPoint(e.clientX, e.clientY)
        .find((n) => (n as HTMLElement).dataset?.tabKey) as HTMLElement | undefined;
      setOverKey(el?.dataset.tabKey || null);
    };

    const onUp = () => {
      const from = gesture.current?.key;
      const to = overKey;
      gesture.current = null;
      setDraggingKey(null);
      setOverKey(null);

      if (!from || !to || from === to) return;
      const next = orderRef.current.filter((k) => k !== from);
      const at = next.indexOf(to);
      if (at < 0) return;
      next.splice(at, 0, from);
      persist(next);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [draggingKey, overKey, persist]);

  const dragProps = useCallback(
    (key: string) => ({
      "data-tab-key": key,
      onPointerDown: (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        gesture.current = { key, startX: e.clientX, active: false };
      },
      onPointerMove: (e: React.PointerEvent) => {
        const g = gesture.current;
        if (!g || g.active || g.key !== key) return;
        if (Math.abs(e.clientX - g.startX) < DRAG_THRESHOLD_PX) return;
        // Past the threshold: this is a reorder, not a click.
        g.active = true;
        setDraggingKey(key);
      },
      onPointerUp: () => {
        // A gesture that never passed the threshold stays a plain click, so
        // clear it here and let Radix activate the tab as usual.
        if (gesture.current && !gesture.current.active) gesture.current = null;
      },
      style: {
        // Only show a drag cursor once a drag is actually under way. A
        // permanent "grab" hand made the pointer change on every tab hover,
        // which read as the tab being draggable-only rather than clickable.
        cursor: draggingKey === key ? "grabbing" : "default",
        opacity: draggingKey === key ? 0.5 : 1,
        boxShadow:
          overKey === key && draggingKey && overKey !== draggingKey
            ? "inset 3px 0 0 var(--brand-bright, #2B6CC4)"
            : undefined,
        userSelect: "none" as const,
      },
    }),
    [draggingKey, overKey],
  );

  const reset = useCallback(() => persist(defaultOrder), [persist, defaultOrder]);

  return { order, dragProps, reset };
}
