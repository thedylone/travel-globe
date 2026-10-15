// Shapes of the data the app receives from the `virtual:travel-data` module.
// Built from data/*.yaml by scripts/lib/load.ts.

export interface Media {
    /** Photo id: path under photos/ without extension, e.g. "nz/2". */
    id: string;
    kind: "image" | "video";
    /** Paths relative to the site root. */
    src: string;
    thumb: string;
    width: number;
    height: number;
}

export interface Stop {
    name: string;
    lat: number;
    lng: number;
    /** Natural Earth country name, e.g. "United Kingdom". Worked out from lat/lng. */
    country?: string;
    /** ISO dates (YYYY-MM-DD); equal for single-day stops. */
    start: string;
    end: string;
    note?: string;
    media: Media[];
}

export interface Base {
    id: string;
    name: string;
    lat: number;
    lng: number;
    icon: "home" | "school" | "work";
}

export interface Endpoint {
    name: string;
    lat: number;
    lng: number;
}

export interface Trip {
    /** File name without extension, e.g. "2024-03-poland". */
    id: string;
    title: string;
    start: string;
    end: string;
    from?: Endpoint;
    to?: Endpoint;
    stops: Stop[];
}

export const CONTINENTS = ["Europe", "Asia", "Africa", "North America", "South America", "Oceania"] as const;
export type Continent = (typeof CONTINENTS)[number];

/** How your countries fit into the world, worked out at build time from the world-countries dataset. */
export interface WorldInfo {
    /** Countries in the world: the 193 UN members plus the two observer states. */
    total: number;
    /** Of those, how many are on each continent. */
    continents: Record<Continent, number>;
    /** Each country you've been to (by Natural Earth name): its continent, and whether it's one of `total`. */
    countries: Record<string, { continent?: Continent; counted: boolean }>;
}

export interface TravelData {
    trips: Trip[];
    bases: Base[];
    world: WorldInfo;
}
