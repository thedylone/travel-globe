/**
 * App state kept in the URL hash so views can be shared:
 *   #trip=2024-03-poland                 focus on a trip
 *   #stop=2024-03-poland:2               open the 2nd stop of a trip (1-based)
 * Both can be combined: #trip=...&stop=...
 */
export interface Route {
    focus?: string;
    stop?: { tripId: string; index: number };
}

export const parseHash = (hash: string): Route => {
    const q = new URLSearchParams(hash.replace(/^#\/?/, ""));
    const route: Route = {};
    const focus = q.get("trip");
    if (focus) route.focus = focus;
    const m = q.get("stop")?.match(/^(.+):(\d+)$/);
    if (m && +m[2] > 0) route.stop = { tripId: m[1], index: +m[2] - 1 };
    return route;
};

export const toHash = ({ focus, stop }: Route): string => {
    const q = new URLSearchParams();
    if (focus) q.set("trip", focus);
    if (stop) q.set("stop", `${stop.tripId}:${stop.index + 1}`);
    // Colons are fine in a hash; keep "stop=trip:2" readable.
    const s = q.toString().replace(/%3A/gi, ":");
    return s ? `#${s}` : "";
};
