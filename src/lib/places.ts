import type { Stop, Trip } from "../types";
import { distanceKm } from "./geo";

/** One stop of one trip, seen from the place it happened at. */
export interface Visit {
    trip: Trip;
    stopIndex: number;
    stop: Stop;
}

/** A spot on the map, which may have been visited on several trips. */
export interface Place {
    id: string;
    name: string;
    lat: number;
    lng: number;
    /** Oldest first. */
    visits: Visit[];
}

/** Stops with the same name this close together are the same place (e.g. "kyoto" on three trips). */
export const SAME_NAME_KM = 30;
/** Stops this close together are the same place whatever they're called. */
export const SAME_SPOT_KM = 1;

const norm = (s: string) =>
    s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Merges stops from all trips into places, so a city visited twice gets one pin. */
export const buildPlaces = (trips: Trip[]): Place[] => {
    const places: Place[] = [];
    for (const trip of trips) {
        trip.stops.forEach((stop, stopIndex) => {
            const key = norm(stop.name);
            const match = places.find((p) => {
                const d = distanceKm(p, stop);
                return d <= SAME_SPOT_KM || (d <= SAME_NAME_KM && norm(p.name) === key);
            });
            const visit = { trip, stopIndex, stop };
            if (match) match.visits.push(visit);
            else places.push({ id: `${trip.id}/${stopIndex}`, name: stop.name, lat: stop.lat, lng: stop.lng, visits: [visit] });
        });
    }
    for (const p of places) {
        p.visits.sort((a, b) => a.stop.start.localeCompare(b.stop.start));
        // Label with the most recent name used.
        p.name = p.visits[p.visits.length - 1].stop.name;
    }
    return places;
};

/** Places with only the visits from the given trips; places left with none are dropped. */
export const filterPlaces = (places: Place[], tripIds: ReadonlySet<string>): Place[] =>
    places.flatMap((p) => {
        const visits = p.visits.filter((v) => tripIds.has(v.trip.id));
        if (!visits.length) return [];
        return visits.length === p.visits.length ? [p] : [{ ...p, visits }];
    });

export const findPlace = (places: Place[], tripId: string, stopIndex: number) =>
    places.find((p) => p.visits.some((v) => v.trip.id === tripId && v.stopIndex === stopIndex));
