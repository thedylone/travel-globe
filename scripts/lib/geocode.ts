import fs from "node:fs";
import type { LatLng } from "../../src/lib/geo.ts";

// OpenStreetMap Nominatim: free, no key, max 1 request/second.
// https://operations.osmfoundation.org/policies/nominatim/
const NOMINATIM = "https://nominatim.openstreetmap.org";
const USER_AGENT = "travel-globe (https://github.com/thedylone/travel-globe)";

let lastRequest = 0;
const throttle = async () => {
    const wait = lastRequest + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequest = Date.now();
};

const get = async (path: string, params: Record<string, string>) => {
    await throttle();
    const url = `${NOMINATIM}${path}?${new URLSearchParams({ format: "jsonv2", ...params })}`;
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) throw new Error(`Nominatim ${res.status} for ${url}`);
    return res.json();
};

export type Geocoder = (query: string, country?: string) => Promise<LatLng | null>;

export const nominatimSearch: Geocoder = async (query, country) => {
    const params: Record<string, string> = { q: query, limit: "1" };
    if (country) params.countrycodes = country.toLowerCase();
    const [hit] = (await get("/search", params)) as { lat: string; lon: string }[];
    return hit ? { lat: round(+hit.lat), lng: round(+hit.lon) } : null;
};

interface ReverseResult {
    name?: string;
    address?: Record<string, string>;
}

/** Best human-readable name for a coordinate (town/city level), e.g. "Vík" or "Kyoto". */
export const nominatimReverse = async ({ lat, lng }: LatLng): Promise<string | null> => {
    const r = (await get("/reverse", {
        lat: String(lat),
        lon: String(lng),
        zoom: "12",
        "accept-language": "en",
    })) as ReverseResult;
    const a = r.address ?? {};
    return (
        a.city ?? a.town ?? a.village ?? a.hamlet ?? a.suburb ?? a.municipality ??
        a.national_park ?? a.county ?? a.state ?? r.name ?? null
    );
};

const round = (n: number) => Math.round(n * 1e5) / 1e5;

/**
 * data/places.json: place name -> coordinates. Filled in automatically the first
 * time a place is geocoded, and committed so builds are repeatable and offline.
 * Edit an entry to fix a wrong lookup.
 */
export class PlaceCache {
    private entries: Record<string, LatLng>;
    changed = false;

    constructor(private file: string) {
        this.entries = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
    }

    static key(query: string, country?: string) {
        const q = query.trim().toLowerCase();
        return country ? `${q}|${country.toLowerCase()}` : q;
    }

    get(key: string): LatLng | undefined {
        return this.entries[key];
    }

    set(key: string, value: LatLng) {
        this.entries[key] = value;
        this.changed = true;
    }

    save() {
        if (!this.changed) return;
        // One place per line keeps diffs readable.
        const lines = Object.entries(this.entries)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `  ${JSON.stringify(k)}: { "lat": ${v.lat}, "lng": ${v.lng} }`);
        fs.writeFileSync(this.file, `{\n${lines.join(",\n")}\n}\n`);
        this.changed = false;
    }
}
