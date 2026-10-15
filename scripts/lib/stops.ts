import { centroid, distanceKm, type LatLng } from "../../src/lib/geo.ts";

export interface PhotoInfo {
    file: string;
    /** Local time the photo was taken, "YYYY-MM-DD HH:MM:SS". */
    time?: string;
    at?: LatLng;
}

export interface DraftStop {
    photos: PhotoInfo[];
    /** Centre of the stop's located photos; missing if none had GPS. */
    at?: LatLng;
    /** "YYYY-MM-DD" */
    start?: string;
    end?: string;
}

const ms = (time: string) => Date.parse(time.replace(" ", "T") + "Z");

/**
 * Groups a trip's photos into stops: walking through them in time order, a photo
 * taken more than `km` from the current stop starts a new one. Photos without GPS
 * join the stop they were taken during (or closest in time). Photos with neither
 * a time nor a location come back in `unplaced`.
 */
export const groupIntoStops = (photos: PhotoInfo[], km = 15): { stops: DraftStop[]; unplaced: PhotoInfo[] } => {
    const timed = photos.filter((p) => p.time).sort((a, b) => a.time!.localeCompare(b.time!));
    const unplaced = photos.filter((p) => !p.time && !p.at);
    const stops: DraftStop[] = [];

    // Located photos make the stops (untimed ones still count, in file order, after the timed ones).
    const located = [...timed.filter((p) => p.at), ...photos.filter((p) => !p.time && p.at)];
    for (const p of located) {
        const current = stops[stops.length - 1];
        if (current?.at && distanceKm(current.at, p.at!) <= km) {
            current.photos.push(p);
            current.at = centroid(current.photos.flatMap((q) => (q.at ? [q.at] : [])));
        } else {
            stops.push({ photos: [p], at: p.at });
        }
    }

    // Timed photos without a location go to the stop they fit into best by time.
    const unlocated = timed.filter((p) => !p.at);
    if (!stops.length && unlocated.length) stops.push({ photos: [] });
    for (const p of unlocated) {
        const t = ms(p.time!);
        let best = stops[0];
        let bestGap = Infinity;
        for (const s of stops) {
            const times = s.photos.flatMap((q) => (q.time ? [ms(q.time)] : []));
            if (!times.length) continue;
            const lo = Math.min(...times);
            const hi = Math.max(...times);
            const gap = t < lo ? lo - t : t > hi ? t - hi : 0;
            if (gap < bestGap) [best, bestGap] = [s, gap];
        }
        best.photos.push(p);
    }

    for (const s of stops) {
        s.photos.sort((a, b) => (a.time ?? "~").localeCompare(b.time ?? "~"));
        const days = s.photos.flatMap((p) => (p.time ? [p.time.slice(0, 10)] : [])).sort();
        if (days.length) [s.start, s.end] = [days[0], days[days.length - 1]];
    }
    return { stops, unplaced };
};
