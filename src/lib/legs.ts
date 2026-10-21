import type { LatLng } from "./geo";

export type Leg = [LatLng, LatLng];

/** Just what the legs need from a trip, so the studio can draw one it hasn't saved yet. */
type Route = { from?: LatLng; to?: LatLng; stops: (LatLng & { side?: boolean })[] };

const same = (a: LatLng, b: LatLng) => a.lat === b.lat && a.lng === b.lng;

/**
 * Every journey a trip made, in order: from where it started, through its stops, to where
 * it ended. A side trip goes out from the last main stop before it and back again.
 */
export const tripLegs = (trip: Route): Leg[] => {
    const legs: Leg[] = [];
    let at: LatLng | undefined = trip.from;
    const go = (p: LatLng) => {
        if (at && !same(at, p)) legs.push([at, p]);
        at = p;
    };
    let base: LatLng | undefined;
    for (const s of trip.stops) {
        go(s);
        if (s.side && base) go(base);
        else base = s;
    }
    if (trip.to) go(trip.to);
    return legs;
};

/** The legs to draw: a journey back the way it came (the end of a side trip) is drawn once. */
export const routeLegs = (trip: Route): Leg[] => {
    const legs = tripLegs(trip);
    return legs.filter(([a, b], i) => !legs.slice(0, i).some(([c, d]) => (same(a, c) && same(b, d)) || (same(a, d) && same(b, c))));
};
