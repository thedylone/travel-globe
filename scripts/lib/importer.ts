/**
 * Makes a draft trip from a folder of photos straight off your phone or camera:
 *  1. reads each photo's time and GPS position,
 *  2. groups them into stops (a new stop whenever you moved more than `km`),
 *  3. names each stop from OpenStreetMap,
 *  4. copies the originals into photos/<trip>/<stop>/ and makes the web versions,
 *  5. writes data/trips/<yyyy-mm>-<trip>.yaml for you to check and tidy.
 *
 * Used by `npm run import` and the studio.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import exifr from "exifr";
import type { LatLng } from "../../src/lib/geo.ts";
import { processPhotos } from "../photos.ts";
import { nominatimReverse } from "./geocode.ts";
import { loadTravelData, paths } from "./load.ts";
import { type DraftStop, groupIntoStops, type PhotoInfo } from "./stops.ts";
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

export const importTrip = async ({ root, src, title: givenTitle, from, km = 15, force = false, log = console.log }: ImportOptions): Promise<ImportResult> => {
    if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) throw new ImportError(`Not a folder: ${src}`);
    const title = givenTitle?.trim() || path.basename(src);
    const slug = slugify(title);

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

    // --- 1. read times and positions ---
    log(`Reading ${media.length} files...`);
    const photos = await readPhotoInfo(media);

    // --- 2. group into stops ---
    const { stops, unplaced } = groupIntoStops(photos, km);
    if (!stops.length) throw new ImportError("None of the photos have a date or location, so there's nothing to place on the map.");
    const located = photos.filter((p) => p.at).length;
    log(`${located}/${photos.length} have a location; ${stops.length} stop(s).`);

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

    const names: string[] = [];
    for (const [i, s] of stops.entries()) {
        let name = "TODO";
        if (s.at) {
            try {
                name = (await nominatimReverse(s.at)) ?? `stop ${i + 1}`;
            } catch (e) {
                log(`  couldn't name stop ${i + 1} (${(e as Error).message}); using "stop ${i + 1}"`);
                name = `stop ${i + 1}`;
            }
        }
        names.push(name);
        log(`  ${i + 1}. ${name} (${s.photos.length} photos${s.start ? `, ${s.start}${s.end !== s.start ? ` to ${s.end}` : ""}` : ""})`);
    }

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
