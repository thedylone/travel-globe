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

export interface TravelData {
    trips: Trip[];
    bases: Base[];
}
