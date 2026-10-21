// What the studio's map shows for a draft trip: a pin per stop, the route between them,
// and the stops it can't place yet.
import type { LatLng } from "../lib/geo";
import { type Leg, routeLegs } from "../lib/legs";
import type { Base } from "./api";
import type { Draft } from "./draft";

/** A place name looked up by the studio's API; null = not found. */
export interface Lookup {
    at: LatLng | null;
    /** From data/places.json, so it's where the globe puts it. Otherwise only looked up, until saved. */
    saved: boolean;
    /** Why it couldn't be looked up, e.g. offline. */
    error?: string;
}

/** How a pin got where it is: lat/lng on the stop, places.json, or a lookup not saved yet. */
export type PinSource = "set" | "saved" | "lookup";

export interface Pin {
    key: number;
    index: number;
    label: string;
    date: string;
    side: boolean;
    at: LatLng;
    source: PinSource;
}

export interface Unplaced {
    key: number;
    index: number;
    label: string;
    why: string;
}

export interface MapLayout {
    pins: Pin[];
    unplaced: Unplaced[];
    /** Where the trip starts and ends, when known. */
    from?: LatLng;
    to?: LatLng;
    /** The route as the globe draws it; `side` legs go out to a side trip or back. */
    legs: (Leg & { side: boolean })[];
    /** Place names (with the trip's countries) still to look up. */
    queries: { q: string; country?: string }[];
}

export const lookupKey = (q: string, country?: string) => `${q.trim().toLowerCase()}|${country ?? ""}`;

/** Lat/lng as typed: a point, "bad" when they don't make one, or undefined when both are blank. */
export const typedAt = (lat: string, lng: string): LatLng | "bad" | undefined => {
    if (!lat.trim() && !lng.trim()) return undefined;
    const [a, b] = [Number(lat), Number(lng)];
    if (!lat.trim() || !lng.trim() || !Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180) {
        return "bad";
    }
    return { lat: a, lng: b };
};

/** Rounded as the geocoder rounds, about a metre. */
export const roundAt = ({ lat, lng }: LatLng): LatLng => ({
    lat: Math.round(lat * 1e5) / 1e5,
    lng: Math.round(((((lng + 180) % 360) + 360) % 360 - 180) * 1e5) / 1e5,
});

export const layoutMap = (draft: Draft, bases: Base[], lookups: Map<string, Lookup>): MapLayout => {
    const country = draft.country.trim().toLowerCase() || undefined;
    const queries = new Map<string, { q: string; country?: string }>();
    const find = (q: string) => {
        const key = lookupKey(q, country);
        const hit = lookups.get(key);
        if (!hit) queries.set(key, { q: q.trim(), country });
        return hit;
    };

    const pins: Pin[] = [];
    const unplaced: Unplaced[] = [];
    draft.stops.forEach((s, index) => {
        const label = s.name.trim() || s.place.trim() || `Stop ${index + 1}`;
        const base = { key: s.key, index, label, date: s.date.trim(), side: s.side && index > 0 };
        const typed = typedAt(s.lat, s.lng);
        if (typed === "bad") return unplaced.push({ key: s.key, index, label, why: "lat/lng aren't a valid point" });
        if (typed) return pins.push({ ...base, at: typed, source: "set" });
        if (!s.place.trim()) return unplaced.push({ key: s.key, index, label, why: "no place yet" });
        const hit = find(s.place);
        if (!hit) return unplaced.push({ key: s.key, index, label, why: "looking it up…" });
        if (!hit.at) {
            const why = hit.error ? `couldn't look it up: ${hit.error}` : `couldn't find "${s.place.trim()}"`;
            return unplaced.push({ key: s.key, index, label, why });
        }
        pins.push({ ...base, at: hit.at, source: hit.saved ? "saved" : "lookup" });
    });

    const endpoint = (ref: string) => {
        if (!ref.trim()) return undefined;
        const b = bases.find((x) => x.key === ref.trim());
        if (b) return { lat: b.lat, lng: b.lng };
        return find(ref)?.at ?? undefined;
    };
    const from = endpoint(draft.from);
    const to = endpoint(draft.to);

    const sides = new Set(pins.filter((p) => p.side).map((p) => `${p.at.lat},${p.at.lng}`));
    const legs = routeLegs({ from, to, stops: pins.map((p) => ({ ...p.at, side: p.side })) }).map(
        (leg) => Object.assign(leg, { side: leg.some((x) => sides.has(`${x.lat},${x.lng}`)) })
    );
    return { pins, unplaced, from, to, legs, queries: [...queries.values()] };
};
