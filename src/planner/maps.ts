import type { PlanPlace } from "./plan";

/** Where a maps app should go for a place: its coordinates, or else its name and address. */
const where = (x: PlanPlace) =>
    x.lat !== undefined && x.lng !== undefined ? `${x.lat},${x.lng}` : [x.place, x.address].filter(Boolean).join(", ");

/** Opens one place in Google Maps (the app on a phone that has it, the website otherwise). */
export const googlePlace = (x: PlanPlace) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(where(x))}`;

/** Opens one place in Apple Maps (the app on an iPhone, iPad or Mac). */
export const applePlace = (x: PlanPlace) => {
    const q = new URLSearchParams({ q: x.name || x.place || where(x) });
    if (x.lat !== undefined && x.lng !== undefined) q.set("ll", `${x.lat},${x.lng}`);
    return `https://maps.apple.com/?${q}`;
};

/** Google Maps takes at most this many stops in one route (start, 8 stops between, end). */
export const MAX_ROUTE = 10;

/** Directions through a day's places in order, from the first to the last; undefined for fewer than two. */
export const googleRoute = (places: PlanPlace[]) => {
    const stops = places.map(where).filter(Boolean).slice(0, MAX_ROUTE);
    if (stops.length < 2) return undefined;
    const q = new URLSearchParams({ api: "1", origin: stops[0], destination: stops[stops.length - 1] });
    if (stops.length > 2) q.set("waypoints", stops.slice(1, -1).join("|"));
    return `https://www.google.com/maps/dir/?${q}`;
};

const NUM = String.raw`[-+]?\d{1,3}(?:\.\d+)?`;
const COORDS = new RegExp(String.raw`^(.*?)[\s,;]*(${NUM})\s*°?\s*([NS])?\s*[,; ]\s*(${NUM})\s*°?\s*([EW])?$`, "i");

/**
 * Coordinates typed into the search box: "35.0394, 135.7292", "Hut 35.03 135.72", "35.03° N, 135.72° E",
 * or a Google Maps link with "@lat,lng" in it. The text before them, if any, is the place's name.
 */
export const parseCoords = (text: string): { name: string; lat: number; lng: number } | undefined => {
    const t = text.trim();
    const link = /@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/.exec(t);
    let name = "";
    let lat: number;
    let lng: number;
    if (link && /^https?:\/\//i.test(t)) {
        lat = Number(link[1]);
        lng = Number(link[2]);
    } else {
        const m = COORDS.exec(t);
        if (!m) return undefined;
        name = m[1].trim();
        lat = Number(m[2]) * (m[3]?.toUpperCase() === "S" ? -1 : 1);
        lng = Number(m[4]) * (m[5]?.toUpperCase() === "W" ? -1 : 1);
        // Two bare whole numbers ("Route 66 2") are more likely part of a name than a place.
        if (!m[2].includes(".") && !m[4].includes(".") && !m[3] && !m[5]) return undefined;
    }
    if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) return undefined;
    const round = (n: number) => Math.round(n * 1e6) / 1e6;
    return { name, lat: round(lat), lng: round(lng) };
};
