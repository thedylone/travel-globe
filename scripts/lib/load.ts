import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { z } from "zod";
import { parseDateRange } from "../../src/lib/dates.ts";
import type { LatLng } from "../../src/lib/geo.ts";
import type { Base, Endpoint, Media, Stop, TravelData, Trip } from "../../src/types.ts";
import { type Geocoder, PlaceCache } from "./geocode.ts";
import {
    BasesSchema,
    formatIssues,
    type PhotoManifest,
    PhotoManifestSchema,
    type StopInput,
    TripSchema,
} from "./schema.ts";

export interface LoadOptions {
    /** Repository root (contains data/). */
    root: string;
    /** Used for places missing from data/places.json. `false` = offline: report them as errors. */
    geocoder: Geocoder | false;
}

export interface LoadResult {
    data: TravelData;
    errors: string[];
    warnings: string[];
    /** Every file read, so callers can watch them. */
    files: string[];
}

export const paths = (root: string) => ({
    data: path.join(root, "data"),
    trips: path.join(root, "data", "trips"),
    bases: path.join(root, "data", "bases.yaml"),
    places: path.join(root, "data", "places.json"),
    manifest: path.join(root, "data", "photos.json"),
});

const MEDIA_EXT = /\.(jpe?g|png|gif|webp|heic|avif|tiff?|mp4|mov|m4v|webm)$/i;
const naturalSort = (a: string, b: string) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

const readYaml = (file: string) => YAML.parse(fs.readFileSync(file, "utf8"));

export const mediaFor = (id: string, entry: PhotoManifest[string]): Media => ({
    id,
    kind: entry.kind,
    src: `photos/full/${id}.${entry.kind === "video" ? "mp4" : "webp"}`,
    thumb: `photos/thumb/${id}.webp`,
    width: entry.width,
    height: entry.height,
});

/** Resolves a stop's `photos` field against the processed-photo manifest. */
export const resolvePhotos = (
    photos: StopInput["photos"],
    manifest: PhotoManifest
): { media: Media[]; missing: string[] } => {
    if (photos === undefined) return { media: [], missing: [] };
    let ids: string[];
    const missing: string[] = [];
    if (typeof photos === "string") {
        // A folder: every photo directly inside it, in natural order (2 before 10).
        const folder = photos.replace(/^\/+|\/+$/g, "");
        ids = Object.keys(manifest)
            .filter((id) => path.posix.dirname(id) === folder)
            .sort(naturalSort);
        if (!ids.length) missing.push(`${folder}/ (empty or not processed)`);
    } else {
        ids = [];
        for (const raw of photos) {
            const id = raw.replace(MEDIA_EXT, "").replace(/^\/+/, "");
            if (manifest[id]) ids.push(id);
            else missing.push(raw);
        }
    }
    return { media: ids.map((id) => mediaFor(id, manifest[id])), missing };
};

const parseWith = <T>(schema: z.ZodType<T>, value: unknown, label: string, errors: string[]) => {
    const r = schema.safeParse(value);
    if (!r.success) {
        errors.push(...formatIssues(r.error).map((m) => `${label}: ${m}`));
        return undefined;
    }
    return r.data;
};

export const loadTravelData = async ({ root, geocoder }: LoadOptions): Promise<LoadResult> => {
    const p = paths(root);
    const errors: string[] = [];
    const warnings: string[] = [];
    const files: string[] = [];
    const rel = (f: string) => path.relative(root, f);

    // --- bases (home, school, ...) ---
    files.push(p.bases);
    const basesIn = fs.existsSync(p.bases)
        ? parseWith(BasesSchema, readYaml(p.bases) ?? {}, rel(p.bases), errors) ?? {}
        : {};
    const bases: Base[] = Object.entries(basesIn).map(([id, b]) => ({ id, ...b }));

    // --- processed photo manifest ---
    files.push(p.manifest);
    const manifest: PhotoManifest = fs.existsSync(p.manifest)
        ? parseWith(PhotoManifestSchema, JSON.parse(fs.readFileSync(p.manifest, "utf8")), rel(p.manifest), errors) ?? {}
        : {};

    // --- geocoding ---
    files.push(p.places);
    const cache = new PlaceCache(p.places);
    const locate = async (query: string, country: string | undefined, label: string) => {
        const key = PlaceCache.key(query, country);
        const hit = cache.get(key) ?? (country ? cache.get(PlaceCache.key(query)) : undefined);
        if (hit) return hit;
        if (!geocoder) {
            errors.push(`${label}: "${query}" is not in data/places.json (run \`npm run check\` online, or add lat/lng)`);
            return undefined;
        }
        try {
            const found = await geocoder(query, country);
            if (!found) {
                errors.push(`${label}: could not find "${query}" on the map; make "place" more specific or add lat/lng`);
                return undefined;
            }
            cache.set(key, found);
            warnings.push(`${label}: geocoded "${query}" -> ${found.lat}, ${found.lng} (saved to data/places.json; check it looks right)`);
            return found;
        } catch (e) {
            errors.push(`${label}: geocoding "${query}" failed: ${(e as Error).message}`);
            return undefined;
        }
    };

    const endpoint = async (ref: string | undefined, country: string | undefined, label: string) => {
        if (!ref) return undefined;
        const base = basesIn[ref];
        if (base) return { name: base.name, lat: base.lat, lng: base.lng } satisfies Endpoint;
        const at = await locate(ref, country, label);
        return at ? ({ name: ref, ...at } satisfies Endpoint) : undefined;
    };

    // --- trips ---
    const tripFiles = fs.existsSync(p.trips)
        ? fs.readdirSync(p.trips).filter((f) => /\.ya?ml$/.test(f)).sort()
        : [];
    const trips: Trip[] = [];
    for (const name of tripFiles) {
        const file = path.join(p.trips, name);
        const label = rel(file);
        files.push(file);
        let raw: unknown;
        try {
            raw = readYaml(file);
        } catch (e) {
            errors.push(`${label}: ${(e as Error).message}`);
            continue;
        }
        const t = parseWith(TripSchema, raw, label, errors);
        if (!t) continue;

        const stops: Stop[] = [];
        for (const [i, s] of t.stops.entries()) {
            const sl = `${label}: stops[${i}] (${s.place})`;
            let range;
            try {
                range = parseDateRange(s.date);
            } catch (e) {
                errors.push(`${sl}: ${(e as Error).message}`);
                continue;
            }
            const at: LatLng | undefined =
                s.lat !== undefined && s.lng !== undefined
                    ? { lat: s.lat, lng: s.lng }
                    : await locate(s.place, t.country, sl);
            if (!at) continue;
            const { media, missing } = resolvePhotos(s.photos, manifest);
            for (const m of missing) {
                errors.push(`${sl}: photo "${m}" not found (put the original in photos/ and run \`npm run photos\`)`);
            }
            stops.push({
                name: s.name ?? s.place,
                ...at,
                ...range,
                ...(s.note ? { note: s.note } : {}),
                media,
            });
        }
        if (!stops.length) continue;
        // Sequential, so geocoding stays within Nominatim's rate limit.
        const from = await endpoint(t.from, t.country, `${label}: from`);
        const to = await endpoint(t.to, t.country, `${label}: to`);
        trips.push({
            id: name.replace(/\.ya?ml$/, ""),
            title: t.title,
            start: stops.reduce((m, s) => (s.start < m ? s.start : m), stops[0].start),
            end: stops.reduce((m, s) => (s.end > m ? s.end : m), stops[0].end),
            ...(from ? { from } : {}),
            ...(to ? { to } : {}),
            stops,
        });
    }
    trips.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
    cache.save();

    return { data: { trips, bases }, errors, warnings, files };
};
