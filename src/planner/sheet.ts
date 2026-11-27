import { type RefObject, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

/** Where the trip panel sits on a phone: under a short map, or pulled down to show the map. */
export type Sheet = "split" | "map";

/** Below this width the panel is a sheet under the map; above it, a sidebar beside it. */
export const PHONE = "(max-width: 899px)";

/** How tall `css` (a CSS height) is in pixels, measured in `inside` so it sees the same variables. */
const measure = (inside: HTMLElement, css: string) => {
    const probe = document.createElement("div");
    probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;height:${css}`;
    inside.appendChild(probe);
    const h = probe.offsetHeight;
    probe.remove();
    return h;
};

/** A touch on the panel that may become a drag of it. */
interface Drag {
    /** Where the finger was when the drag took over, and the map's height then. */
    y: number;
    h: number;
    /** Started on the header, which always drags. */
    top: boolean;
    /** Dragging the panel, or decided to leave this touch to the list's own scrolling. */
    on: boolean;
    off: boolean;
    /** The map's height at either end. */
    split: number;
    full: number;
    /** The last move, and the finger's speed (px/ms, down is positive). */
    last: number;
    t: number;
    v: number;
}

/** Things that scroll or pick by dragging themselves, so a drag starting on them is theirs. */
const OWN_DRAG = "textarea, select, .plan-results";

/**
 * Lets the trip panel be swiped down on a phone to make the map taller, and back up again.
 *
 * Swiping down on the list once it's scrolled to the top (or anywhere on its header) drags the
 * panel down with the finger; letting go snaps it to whichever end is nearer, or the way it was
 * flung. Pulled down, the panel keeps just its header showing, and a swipe up brings it back.
 *
 * It sets the map's height directly while dragging, so a drag doesn't re-render the plan, and
 * hands back to the stylesheet (which animates to the snapped height) on letting go.
 */
export const useSheet = (plan: RefObject<HTMLElement | null>, map: RefObject<HTMLElement | null>, side: RefObject<HTMLElement | null>) => {
    const [sheet, setSheet] = useState<Sheet>("split");
    const current = useRef(sheet);
    current.current = sheet;

    useEffect(() => {
        const el = side.current;
        const wrap = map.current;
        const root = plan.current;
        if (!el || !wrap || !root) return;
        const phone = matchMedia(PHONE);
        let drag: Drag | undefined;

        const start = (e: TouchEvent) => {
            if (!phone.matches || e.touches.length !== 1) return (drag = undefined);
            const target = e.target as HTMLElement;
            if (target.closest(OWN_DRAG)) return (drag = undefined);
            const y = e.touches[0].clientY;
            drag = {
                y,
                h: wrap.offsetHeight,
                top: !!target.closest(".plan-top"),
                on: false,
                off: false,
                split: measure(root, "calc(var(--map-h) + env(safe-area-inset-top))"),
                full: measure(root, "calc(100% - var(--peek))"),
                last: y,
                t: e.timeStamp,
                v: 0,
            };
        };

        const moveTo = (e: TouchEvent) => {
            const d = drag;
            if (!d || d.off) return;
            const y = e.touches[0].clientY;
            const dy = y - d.y;
            if (!d.on) {
                if (Math.abs(dy) < 6) return;
                // Pulled down: always from the header, or from the list when it can't scroll up any
                // more. Pushed up: only to bring a pulled-down panel back; otherwise the list scrolls.
                const down = dy > 0;
                const go = current.current === "map" || (down && (d.top || el.scrollTop <= 0));
                if (!go) return void (d.off = true);
                d.on = true;
                d.y = y;
                wrap.style.transition = "none";
            }
            e.preventDefault();
            const raw = d.h + (y - d.y);
            // Past either end it gives a little, like a rubber band.
            const h = raw < d.split ? d.split - (d.split - raw) * 0.25 : raw > d.full ? d.full + (raw - d.full) * 0.25 : raw;
            wrap.style.height = `${h}px`;
            const dt = Math.max(1, e.timeStamp - d.t);
            d.v = 0.8 * ((y - d.last) / dt) + 0.2 * d.v;
            d.last = y;
            d.t = e.timeStamp;
        };

        const end = () => {
            const d = drag;
            drag = undefined;
            if (!d?.on) return;
            const h = wrap.offsetHeight;
            // A flick decides; otherwise whichever end is nearer.
            const to: Sheet = d.v > 0.4 ? "map" : d.v < -0.4 ? "split" : h > (d.split + d.full) / 2 ? "map" : "split";
            if (to === "map") el.scrollTop = 0;
            flushSync(() => setSheet(to));
            wrap.style.transition = "";
            wrap.style.height = "";
        };

        el.addEventListener("touchstart", start, { passive: true });
        el.addEventListener("touchmove", moveTo, { passive: false });
        el.addEventListener("touchend", end);
        el.addEventListener("touchcancel", end);
        return () => {
            el.removeEventListener("touchstart", start);
            el.removeEventListener("touchmove", moveTo);
            el.removeEventListener("touchend", end);
            el.removeEventListener("touchcancel", end);
        };
    }, [plan, map, side]);

    const show = (to: Sheet) => {
        if (to === "map" && side.current) side.current.scrollTop = 0;
        setSheet(to);
    };
    return [sheet, show] as const;
};

const SIDE_KEY = "planner:sidebar";

/** Whether the sidebar is showing on a wide screen; remembered between visits. */
export const useSidebar = () => {
    const [shown, setShown] = useState(() => {
        try {
            return localStorage.getItem(SIDE_KEY) !== "hidden";
        } catch {
            return true;
        }
    });
    const toggle = () =>
        setShown((s) => {
            try {
                localStorage.setItem(SIDE_KEY, s ? "hidden" : "shown");
            } catch {
                // Not remembered, then.
            }
            return !s;
        });
    return [shown, toggle] as const;
};
