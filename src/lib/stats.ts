import { type Continent, CONTINENTS, type Trip, type WorldInfo } from "../types";
import { yearOf } from "./dates";
import { distanceKm, type LatLng } from "./geo";
import { buildPlaces } from "./places";
import { daysAway } from "./timeline";

export interface TravelStats {
    trips: number;
    /** Natural Earth names, in the order first visited. */
    countries: string[];
    places: number;
    /** Distinct days spent on trips. */
    days: number;
    /** Great-circle distance along every trip's route, from its start to its end. */
    km: number;
    firstYear?: number;
    lastYear?: number;
    /** Share of the world's countries (see WorldInfo.total) you've been to, 0–1. */
    worldShare: number;
    /** Every continent, in a fixed order: countries visited out of its total. */
    continents: { name: Continent; visited: number; total: number }[];
}

export const tripKm = (trip: Trip) => {
    const pts: LatLng[] = [...(trip.from ? [trip.from] : []), ...trip.stops, ...(trip.to ? [trip.to] : [])];
    return pts.slice(1).reduce((km, p, i) => km + distanceKm(pts[i], p), 0);
};

/** The headline numbers for a set of trips (sorted by date). Shared by the panel, the 2D map and the share image. */
export const computeStats = (trips: Trip[], world: WorldInfo): TravelStats => {
    const countries: string[] = [];
    for (const t of trips) for (const s of t.stops) if (s.country && !countries.includes(s.country)) countries.push(s.country);
    // Only countries that are among the world's 195 count towards the percentages.
    const counted = countries.map((c) => world.countries[c]).filter((c) => c?.counted);
    return {
        worldShare: world.total ? counted.length / world.total : 0,
        continents: CONTINENTS.map((name) => ({
            name,
            visited: counted.filter((c) => c.continent === name).length,
            total: world.continents[name] ?? 0,
        })),
        trips: trips.length,
        countries,
        places: buildPlaces(trips).length,
        days: daysAway(trips),
        km: trips.reduce((km, t) => km + tripKm(t), 0),
        ...(trips.length
            ? { firstYear: Math.min(...trips.map((t) => yearOf(t.start))), lastYear: Math.max(...trips.map((t) => yearOf(t.end))) }
            : {}),
    };
};

const SHORT_NAMES: Record<string, string> = {
    "United States of America": "United States",
    "Bosnia and Herz.": "Bosnia and Herzegovina",
    "Dominican Rep.": "Dominican Republic",
    "Central African Rep.": "Central African Republic",
    "Dem. Rep. Congo": "DR Congo",
    "Eq. Guinea": "Equatorial Guinea",
    "S. Sudan": "South Sudan",
    "Solomon Is.": "Solomon Islands",
    "Marshall Is.": "Marshall Islands",
    "Faeroe Is.": "Faroe Islands",
    "Falkland Is.": "Falkland Islands",
    "Cayman Is.": "Cayman Islands",
    "N. Mariana Is.": "Northern Mariana Islands",
    "U.S. Virgin Is.": "US Virgin Islands",
    "British Virgin Is.": "British Virgin Islands",
    "Fr. Polynesia": "French Polynesia",
    "St. Lucia": "Saint Lucia",
    "St. Kitts and Nevis": "Saint Kitts and Nevis",
    "St. Vin. and Gren.": "Saint Vincent and the Grenadines",
    "Antigua and Barb.": "Antigua and Barbuda",
    "São Tomé and Principe": "São Tomé and Príncipe",
};

/** Natural Earth abbreviates some names for maps; spell them out for text. */
export const countryLabel = (name: string) => SHORT_NAMES[name] ?? name;

/** "9%", or "0.5%" below 1% so a first trip doesn't read as 0%. */
export const percent = (share: number) => {
    const p = share * 100;
    return `${p > 0 && p < 1 ? p.toFixed(1) : Math.round(p)}%`;
};

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
