/**
 * Makes a draft trip from a folder of photos straight off your phone or camera:
 *  1. reads each photo's time and GPS position,
 *  2. groups them into stops (a new stop whenever you moved more than `km`),
 *  3. names each stop from OpenStreetMap,
 *  4. copies the originals into photos/<trip>/<stop>/ and makes the web versions,
 *  5. writes data/trips/<yyyy-mm>-<trip>.yaml for you to check and tidy.
 *
 * Used by `npm run import` and the studio, which can also add more photos to a trip (addPhotos).
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import exifr from "exifr";
import YAML from "yaml";
import { distanceKm, type LatLng } from "../../src/lib/geo.ts";
import { processPhotos } from "../photos.ts";
import { nominatimReverse, PlaceCache } from "./geocode.ts";
import { loadTravelData, paths } from "./load.ts";
import { type DraftStop, foldSideTrips, groupIntoStops, type PhotoInfo } from "./stops.ts";
import { slugify, tripYaml } from "./write.ts";

export const IMAGE = /\.(jpe?g|png|webp|avif|tiff?|gif)$/i;
export const VIDEO = /\.(mp4|mov|m4v)$/i;
export const HEIC = /\.(heic|heif)$/i;

/** A problem with the input, worth showing as it is (no stack trace). */
export class ImportError extends Error {
    /** `exists`: a trip of the same name is already there (`force` replaces it). */
    constructor(message: string, readonly exists = false) {
        super(message);
    }
}

export interface ImportOptions {
    /** The data folder. */
    root: string;
    /** Folder of photos and videos to import. */
    src: string;
    title?: string;
    from?: string;
    km?: number;
    /** Replace a trip of the same name. */
    force?: boolean;
    log?: (line: string) => void;
}

export interface ImportResult {
    /** Trip id, e.g. "2024-02-iceland". */
    id: string;
    file: string;
    /** Problems the trip still has, e.g. stops without a date. */
    problems: string[];
}

const exifTime = (s: unknown) =>
    typeof s === "string" && /^\d{4}:\d\d:\d\d \d\d:\d\d:\d\d/.test(s)
        ? s.slice(0, 19).replace(/^(\d{4}):(\d\d):(\d\d)/, "$1-$2-$3")
        : undefined;

const hasFfprobe = () => spawnSync("ffprobe", ["-version"]).status === 0;
const videoInfo = (file: string): Pick<PhotoInfo, "time" | "at"> => {
    const tags = JSON.parse(
        execFileSync("ffprobe", ["-v", "error", "-show_entries", "format_tags", "-of", "json", file]).toString()
    ).format?.tags ?? {};
    // iPhones store local time with an offset; others only UTC creation_time.
    const local = tags["com.apple.quicktime.creationdate"] ?? tags.creation_time;
    const iso = typeof local === "string" ? local.match(/^(\d{4}-\d\d-\d\d)T(\d\d:\d\d:\d\d)/) : null;
    const loc = String(tags["com.apple.quicktime.location.ISO6709"] ?? tags.location ?? "").match(/^([+-][\d.]+)([+-][\d.]+)/);
    return {
        ...(iso ? { time: `${iso[1]} ${iso[2]}` } : {}),
        ...(loc ? { at: { lat: +loc[1], lng: +loc[2] } } : {}),
    };
};

/** Reads the time and position of each photo or video. */
export const readPhotoInfo = async (files: string[]): Promise<PhotoInfo[]> => {
    const ffprobe = files.some((f) => VIDEO.test(f)) && hasFfprobe();
    const photos: PhotoInfo[] = [];
    for (const file of files) {
        if (VIDEO.test(file)) {
            photos.push({ file, ...(ffprobe ? videoInfo(file) : {}) });
            continue;
        }
        const tags = await exifr
            .parse(file, { gps: true, reviveValues: false, pick: ["DateTimeOriginal", "CreateDate", "GPSLatitude", "GPSLongitude", "GPSLatitudeRef", "GPSLongitudeRef"] })
            .catch(() => undefined);
        const time = exifTime(tags?.DateTimeOriginal) ?? exifTime(tags?.CreateDate);
        const at: LatLng | undefined =
            typeof tags?.latitude === "number" && typeof tags?.longitude === "number" && (tags.latitude || tags.longitude)
                ? { lat: +tags.latitude.toFixed(5), lng: +tags.longitude.toFixed(5) }
                : undefined;
        photos.push({ file, ...(time ? { time } : {}), ...(at ? { at } : {}) });
    }
    return photos;
};

/** The photos and videos in a folder to import (not its subfolders). */
const mediaIn = (src: string) => {
    if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) throw new ImportError(`Not a folder: ${src}`);
    const files = fs
        .readdirSync(src)
        .filter((f) => !f.startsWith("."))
        .map((f) => path.join(src, f))
        .filter((f) => fs.statSync(f).isFile());

    const heic = files.filter((f) => HEIC.test(f));
    if (heic.length) {
        throw new ImportError(
            `${heic.length} HEIC photo(s), e.g. ${path.basename(heic[0])}. These can't be processed yet:\n` +
                "export them as JPEG first (Photos app: File > Export, or iPhone Settings > Camera > Formats > Most Compatible)."
        );
    }
    const media = files.filter((f) => IMAGE.test(f) || VIDEO.test(f));
    if (!media.length) throw new ImportError(`No photos or videos in ${src}`);
    return media;
};

/** Names each stop from OpenStreetMap: "TODO" without a position, "stop <n>" if the lookup fails. */
const nameStops = async (stops: DraftStop[], log: (line: string) => void, first = 1) => {
    const names: string[] = [];
    for (const [i, s] of stops.entries()) {
        const n = first + i;
        let name = "TODO";
        if (s.at) {
            try {
                name = (await nominatimReverse(s.at)) ?? `stop ${n}`;
            } catch (e) {
                log(`  couldn't name stop ${n} (${(e as Error).message}); using "stop ${n}"`);
                name = `stop ${n}`;
            }
        }
        names.push(name);
        log(`  ${n}. ${name} (${s.photos.length} photos${s.start ? `, ${s.start}${s.end !== s.start ? ` to ${s.end}` : ""}` : ""})`);
    }
    return names;
};

export const importTrip = async ({ root, src, title: givenTitle, from, km = 15, force = false, log = console.log }: ImportOptions): Promise<ImportResult> => {
    const title = givenTitle?.trim() || path.basename(src);
    const slug = slugify(title);
    const media = mediaIn(src);

    // --- 1. read times and positions ---
    log(`Reading ${media.length} files...`);
    const photos = await readPhotoInfo(media);

    // --- 2. group into stops ---
    const grouped = groupIntoStops(photos, km);
    const stops = foldSideTrips(grouped.stops, km);
    const { unplaced } = grouped;
    if (!stops.length) throw new ImportError("None of the photos have a date or location, so there's nothing to place on the map.");
    const located = photos.filter((p) => p.at).length;
    const sides = stops.filter((s) => s.side).length;
    log(`${located}/${photos.length} have a location; ${stops.length} stop(s)${sides ? `, ${sides} of them side trips` : ""}.`);

    // --- 3. name the stops (checked first, so a clash fails before any lookups) ---
    const firstDay = stops.flatMap((s) => (s.start ? [s.start] : [])).sort()[0];
    const tripFile = path.join(paths(root).trips, `${(firstDay ?? new Date().toISOString()).slice(0, 7)}-${slug}.yaml`);
    const tripDir = path.join(root, "photos", slug);
    const inside = (a: string, b: string) => !path.relative(b, a).startsWith("..");
    if (inside(src, tripDir) || inside(tripDir, src)) {
        throw new ImportError(`Import from a folder outside photos/${slug}/ (e.g. your Desktop); the originals get copied in.`);
    }
    if (!force && (fs.existsSync(tripFile) || fs.existsSync(tripDir))) {
        throw new ImportError(`${path.relative(root, fs.existsSync(tripFile) ? tripFile : tripDir)} already exists.`, true);
    }

    const names = await nameStops(stops, log);

    // --- 4. copy originals into photos/<trip>/<stop>/ ---
    fs.rmSync(tripDir, { recursive: true, force: true });
    const used = new Map<string, number>();
    const folderFor = (name: string) => {
        const base = slugify(name);
        const n = (used.get(base) ?? 0) + 1;
        used.set(base, n);
        return n === 1 ? base : `${base}-${n}`;
    };
    const copyInto = (folder: string, list: PhotoInfo[]) => {
        const dir = path.join(tripDir, folder);
        fs.mkdirSync(dir, { recursive: true });
        const width = String(list.length).length;
        // Number the copies so they stay in time order.
        list.forEach((p, i) => fs.copyFileSync(p.file, path.join(dir, `${String(i + 1).padStart(width, "0")}-${path.basename(p.file)}`)));
    };
    const stopFolders = stops.map((s: DraftStop, i) => {
        const folder = folderFor(names[i]);
        copyInto(folder, s.photos);
        return folder;
    });
    if (unplaced.length) copyInto("unsorted", unplaced);

    log("Making web versions...");
    const { failures } = await processPhotos({ only: [slug] });
    if (failures.length) log(`  ${failures.length} photo(s) couldn't be processed:\n    ${failures.join("\n    ")}`);

    // --- 5. write the trip ---
    const notes = [
        `Draft made from ${photos.length} photos in ${path.basename(src)}.`,
        "Check the stop names and dates, rename or merge stops as you like, then delete this comment.",
        "Each stop's photos are in photos/" + slug + "/<folder>; move files between folders to re-sort them.",
        ...(unplaced.length ? [`${unplaced.length} photo(s) had no date or location: see photos/${slug}/unsorted/.`] : []),
        ...(stops.some((s) => !s.at) ? ['Stops marked "TODO" had no GPS: set `place` to where it was (it will be looked up).'] : []),
    ];
    const yaml = tripYaml(
        {
            title,
            ...(from ? { from } : {}),
            stops: stops.map((s, i) => ({
                place: names[i],
                ...(s.at ? { lat: +s.at.lat.toFixed(5), lng: +s.at.lng.toFixed(5) } : {}),
                date: s.start ? (s.end && s.end !== s.start ? `${s.start}..${s.end}` : s.start) : "TODO",
                ...(s.side ? { side: true } : {}),
                photos: `${slug}/${stopFolders[i]}`,
            })),
        },
        notes.join("\n")
    );
    fs.mkdirSync(path.dirname(tripFile), { recursive: true });
    fs.writeFileSync(tripFile, yaml);
    log(`Wrote ${path.relative(root, tripFile)}`);

    const { errors } = await loadTravelData({ root, geocoder: false });
    const problems = errors.filter((e) => e.startsWith(path.relative(root, tripFile)));
    return { id: path.basename(tripFile).replace(/\.yaml$/, ""), file: tripFile, problems };
};

export interface AddOptions {
    /** The data folder. */
    root: string;
    /** The trip to add to, e.g. "2024-02-iceland". */
    id: string;
    /** Folder of photos and videos to add. */
    src: string;
    km?: number;
    log?: (line: string) => void;
}

export interface AddResult {
    added: number;
    /** Already in the trip's folder (same name and size), so not copied again. */
    skipped: number;
    /** Stops made for photos that fit none of the trip's stops. */
    newStops: number;
    /** Had neither a time nor a location: copied to <folder>/unsorted/. */
    unplaced: number;
}

type RawStop = Record<string, unknown> & { place?: unknown; date?: unknown; photos?: unknown };

/** The days a stop covers as written, e.g. "2024-03-07..2024-03-09". */
const stopDays = (s: RawStop) => {
    if (typeof s.date !== "string") return undefined;
    const [start, end = start] = s.date.split("..").map((x) => x.trim());
    return /^\d{4}-\d\d-\d\d$/.test(start) && /^\d{4}-\d\d-\d\d$/.test(end) ? { start, end } : undefined;
};

const shiftDay = (day: string, by: number) => new Date(Date.parse(day) + by * 864e5).toISOString().slice(0, 10);

/** Leading numbers kept the copies in time order ("07-IMG_1.jpg"); the rest is the photo's own name. */
const ownName = (file: string) => file.replace(/^\d+-/, "");

/**
 * Adds more photos to a trip. Each photo joins the stop it was taken at (same day, within
 * `km`), going into that stop's folder; the rest are grouped into new stops as an import
 * would, placed among the others by date. Photos already in the trip's folder are skipped.
 */
export const addPhotos = async ({ root, id, src, km = 15, log = console.log }: AddOptions): Promise<AddResult> => {
    const tripFile = path.join(paths(root).trips, `${id}.yaml`);
    if (!fs.existsSync(tripFile)) throw new ImportError(`No trip ${id}`);
    const text = fs.readFileSync(tripFile, "utf8");
    const trip = (YAML.parse(text) ?? {}) as Record<string, unknown>;
    const stops: RawStop[] = Array.isArray(trip.stops) ? (trip.stops as RawStop[]) : [];
    const media = mediaIn(src);
    const photosDir = path.join(root, "photos");

    // The trip's folder under photos/: the one its photos are already in, else a new one.
    const tops = stops.flatMap((s) =>
        (typeof s.photos === "string" ? [s.photos] : Array.isArray(s.photos) ? s.photos : []).flatMap((x) =>
            typeof x === "string" && x.replace(/^\/+/, "").includes("/") ? [x.replace(/^\/+/, "").split("/")[0]] : []
        )
    );
    const own = slugify(String(trip.title ?? id));
    const base = tops[0] ?? (fs.existsSync(path.join(photosDir, own)) ? id : own);
    const baseDir = path.join(photosDir, base);

    // --- 1. skip photos the trip already has ---
    const walk = (dir: string): string[] =>
        fs.existsSync(dir)
            ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
                  e.isDirectory() ? walk(path.join(dir, e.name)) : e.isFile() ? [path.join(dir, e.name)] : []
              )
            : [];
    const have = new Set(walk(baseDir).map((f) => `${ownName(path.basename(f))}:${fs.statSync(f).size}`));
    const fresh = media.filter((f) => !have.has(`${path.basename(f)}:${fs.statSync(f).size}`));
    const skipped = media.length - fresh.length;
    if (skipped) log(`${skipped} photo(s) are already in photos/${base}/; skipping them.`);
    if (!fresh.length) return { added: 0, skipped, newStops: 0, unplaced: 0 };

    // --- 2. match each photo to a stop ---
    log(`Reading ${fresh.length} files...`);
    const photos = await readPhotoInfo(fresh);
    const cache = new PlaceCache(paths(root).places);
    const country = typeof trip.country === "string" ? trip.country : undefined;
    const where = (s: RawStop): LatLng | undefined => {
        if (typeof s.lat === "number" && typeof s.lng === "number") return { lat: s.lat, lng: s.lng };
        if (typeof s.place !== "string") return undefined;
        return cache.get(PlaceCache.key(s.place, country)) ?? (country ? cache.get(PlaceCache.key(s.place)) : undefined);
    };
    const known = stops.map((s) => ({ days: stopDays(s), at: where(s) }));
    const joining = stops.map((): PhotoInfo[] => []);
    const rest: PhotoInfo[] = [];
    for (const p of photos) {
        const day = p.time?.slice(0, 10);
        let best = -1;
        let bestKm = Infinity;
        known.forEach(({ days, at }, i) => {
            const away = p.at && at ? distanceKm(p.at, at) : undefined;
            let sameDay = day && days ? day >= days.start && day <= days.end : undefined;
            // Taken there the day before or after, with no other stop that day: the stay was longer.
            if (sameDay === false && away !== undefined && (day! === shiftDay(days!.start, -1) || day! === shiftDay(days!.end, 1))) {
                sameDay = !known.some((k, j) => j !== i && k.days && day! >= k.days.start && day! <= k.days.end);
            }
            if (sameDay === false || (away !== undefined && away > km) || (sameDay === undefined && away === undefined)) return;
            // Closest wins; a match by date alone counts as at the edge.
            if ((away ?? km) < bestKm) [best, bestKm] = [i, away ?? km];
        });
        if (best >= 0) joining[best].push(p);
        else rest.push(p);
    }
    const joined = photos.length - rest.length;
    if (joined) log(`${joined} photo(s) fit the trip's stops.`);

    // --- 3. group the rest into new stops ---
    const { stops: grouped, unplaced } = groupIntoStops(rest, km);
    if (grouped.length) log(`${rest.length - unplaced.length} photo(s) make ${grouped.length} new stop(s):`);
    const names = await nameStops(grouped, log, stops.length + 1);

    // --- 4. copy them in ---
    const taken = new Set(fs.existsSync(baseDir) ? fs.readdirSync(baseDir) : []);
    const newFolder = (name: string) => {
        const slug = slugify(name);
        let folder = slug;
        for (let n = 2; taken.has(folder); n++) folder = `${slug}-${n}`;
        taken.add(folder);
        return folder;
    };
    /** Copies photos into photos/<folder>/, numbered after what's there; returns their ids. */
    const copyInto = (folder: string, list: PhotoInfo[]) => {
        const dir = path.join(photosDir, folder);
        fs.mkdirSync(dir, { recursive: true });
        const existing = fs.readdirSync(dir).filter((f) => !f.startsWith("."));
        let n = Math.max(0, ...existing.map((f) => Number(f.match(/^(\d+)-/)?.[1] ?? 0))) + 1;
        const width = Math.max(String(n + list.length).length, ...existing.map((f) => f.match(/^(\d+)-/)?.[1].length ?? 0));
        list.sort((a, b) => (a.time ?? "~").localeCompare(b.time ?? "~"));
        return list.map((p) => {
            let name = `${String(n++).padStart(width, "0")}-${path.basename(p.file)}`;
            while (existing.includes(name)) name = `${String(n++).padStart(width, "0")}-${path.basename(p.file)}`;
            fs.copyFileSync(p.file, path.join(dir, name));
            return `${folder}/${name}`.replace(/\.[^./]+$/, "");
        });
    };
    joining.forEach((list, i) => {
        if (!list.length) return;
        const s = stops[i];
        const days = known[i].days;
        if (days) {
            const all = [days.start, days.end, ...list.flatMap((p) => (p.time ? [p.time.slice(0, 10)] : []))].sort();
            const [start, end] = [all[0], all[all.length - 1]];
            if (start !== days.start || end !== days.end) s.date = start === end ? start : `${start}..${end}`;
        }
        if (typeof s.photos === "string") {
            // A folder: what's copied into it shows up in the stop.
            copyInto(s.photos.replace(/^\/+|\/+$/g, ""), list);
        } else if (Array.isArray(s.photos)) {
            s.photos = [...s.photos, ...copyInto(`${base}/${newFolder(String(s.place ?? "stop"))}`, list)];
        } else {
            const folder = `${base}/${newFolder(String(s.place ?? "stop"))}`;
            copyInto(folder, list);
            s.photos = folder;
        }
    });
    const added: RawStop[] = grouped.map((s, i) => {
        const folder = `${base}/${newFolder(names[i])}`;
        copyInto(folder, s.photos);
        return {
            place: names[i],
            ...(s.at ? { lat: +s.at.lat.toFixed(5), lng: +s.at.lng.toFixed(5) } : {}),
            date: s.start ? (s.end && s.end !== s.start ? `${s.start}..${s.end}` : s.start) : "TODO",
            photos: folder,
        };
    });
    if (unplaced.length) {
        copyInto(`${base}/unsorted`, unplaced);
        log(`${unplaced.length} photo(s) had no date or location: see photos/${base}/unsorted/.`);
    }

    log("Making web versions...");
    const { failures } = await processPhotos({ only: [base] });
    if (failures.length) log(`  ${failures.length} photo(s) couldn't be processed:\n    ${failures.join("\n    ")}`);

    // --- 5. write the trip, new stops among the others by date ---
    for (const s of added) {
        const day = stopDays(s)?.start;
        const at = day ? stops.findIndex((x) => (stopDays(x)?.start ?? "") > day) : -1;
        stops.splice(at < 0 ? stops.length : at, 0, s);
    }
    // Keep the comment at the top of the file, if there is one.
    const header = text.match(/^(#.*\n)+/)?.[0].replace(/^# ?/gm, "");
    fs.writeFileSync(
        tripFile,
        tripYaml({ ...(trip as { title: string }), stops } as Parameters<typeof tripYaml>[0], header)
    );
    log(`Wrote ${path.relative(root, tripFile)}`);
    return { added: fresh.length, skipped, newStops: added.length, unplaced: unplaced.length };
};
