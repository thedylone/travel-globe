// Place search as you type, from Photon (photon.komoot.io): OpenStreetMap data, made for
// search-as-you-type, which Nominatim's usage policy doesn't allow.

export interface Found {
    name: string;
    /** Where it is, e.g. "Kyoto, Japan". */
    address: string;
    lat: number;
    lng: number;
}

interface Feature {
    geometry: { coordinates: [number, number] };
    properties: Record<string, string | undefined>;
}

const round = (x: number) => Math.round(x * 1e5) / 1e5;

/** "Fushimi Inari Taisha", "Kyoto, Japan" from a Photon result. */
export const describe = (f: Feature): Found | undefined => {
    const p = f.properties;
    const name = p.name ?? p.street ?? p.city;
    if (!name) return undefined;
    const parts = [p.city ?? p.town ?? p.village ?? p.county, p.state, p.country].filter((x, i, a) => x && x !== name && a.indexOf(x) === i);
    const [lng, lat] = f.geometry.coordinates;
    return { name, address: parts.join(", "), lat: round(lat), lng: round(lng) };
};

/**
 * Places matching `q`, nearest `near` first when given (e.g. the last place on the trip). `country`
 * is the plan's country codes, to leave out places elsewhere.
 */
export const searchPlaces = async (q: string, o: { near?: { lat: number; lng: number }; country?: string; signal?: AbortSignal } = {}) => {
    const params = new URLSearchParams({ q, limit: "8", lang: "en" });
    if (o.near) {
        params.set("lat", String(o.near.lat));
        params.set("lon", String(o.near.lng));
    }
    const res = await fetch(`https://photon.komoot.io/api/?${params}`, { signal: o.signal });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const { features } = (await res.json()) as { features: Feature[] };
    const codes = (o.country ?? "").toLowerCase().split(",").map((c) => c.trim()).filter(Boolean);
    const seen = new Set<string>();
    return features
        .filter((f) => !codes.length || codes.includes((f.properties.countrycode ?? "").toLowerCase()))
        .map(describe)
        .filter((x): x is Found => {
            if (!x) return false;
            const key = `${x.name}|${x.address}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
};
