/**
 * npm run import -- <folder> [--title "Iceland"] [--from school] [--km 15] [--force]
 *
 * Makes a draft trip from a folder of photos straight off your phone or camera:
 *  1. reads each photo's time and GPS position,
 *  2. groups them into stops (a new stop whenever you moved more than --km),
 *  3. names each stop from OpenStreetMap,
 *  4. copies the originals into photos/<trip>/<stop>/ and makes the web versions,
 *  5. writes data/trips/<yyyy-mm>-<trip>.yaml for you to check and tidy.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import exifr from "exifr";
import type { LatLng } from "../src/lib/geo.ts";
import { nominatimReverse } from "./lib/geocode.ts";
import { loadTravelData, paths } from "./lib/load.ts";
import { type DraftStop, groupIntoStops, type PhotoInfo } from "./lib/stops.ts";
import { slugify, tripYaml } from "./lib/write.ts";
import { processPhotos } from "./photos.ts";

const IMAGE = /\.(jpe?g|png|webp|avif|tiff?|gif)$/i;
const VIDEO = /\.(mp4|mov|m4v)$/i;
const HEIC = /\.(heic|heif)$/i;

const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
        title: { type: "string" },
        from: { type: "string" },
        km: { type: "string", default: "15" },
        force: { type: "boolean", default: false },
    },
});

const fail = (msg: string): never => {
    console.error(msg);
    process.exit(1);
};

const [srcArg] = positionals;
if (!srcArg) fail('Usage: npm run import -- <folder> [--title "Trip name"] [--from home|school|<place>] [--km 15]');
const src = path.resolve(srcArg);
if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) fail(`Not a folder: ${src}`);

const root = process.cwd();
const title = values.title ?? path.basename(src);
const slug = slugify(title);
const km = Number(values.km);

const files = fs
    .readdirSync(src)
    .filter((f) => !f.startsWith("."))
    .map((f) => path.join(src, f))
    .filter((f) => fs.statSync(f).isFile());

const heic = files.filter((f) => HEIC.test(f));
if (heic.length) {
    fail(
        `${heic.length} HEIC photo(s), e.g. ${path.basename(heic[0])}. These can't be processed yet:\n` +
            "export them as JPEG first (Photos app: File > Export, or iPhone Settings > Camera > Formats > Most Compatible)."
    );
}
const media = files.filter((f) => IMAGE.test(f) || VIDEO.test(f));
if (!media.length) fail(`No photos or videos in ${src}`);

// --- 1. read times and positions ---
const exifTime = (s: unknown) =>
    typeof s === "string" && /^\d{4}:\d\d:\d\d \d\d:\d\d:\d\d/.test(s)
        ? s.slice(0, 19).replace(/^(\d{4}):(\d\d):(\d\d)/, "$1-$2-$3")
        : undefined;

const hasFfprobe = spawnSync("ffprobe", ["-version"]).status === 0;
const videoInfo = (file: string): Pick<PhotoInfo, "time" | "at"> => {
    if (!hasFfprobe) return {};
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

console.log(`Reading ${media.length} files...`);
const photos: PhotoInfo[] = [];
for (const file of media) {
    if (VIDEO.test(file)) {
        photos.push({ file, ...videoInfo(file) });
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

// --- 2. group into stops ---
const { stops, unplaced } = groupIntoStops(photos, km);
if (!stops.length) fail("None of the photos have a date or location, so there's nothing to place on the map.");
const located = photos.filter((p) => p.at).length;
console.log(`${located}/${photos.length} have a location; ${stops.length} stop(s).`);

// --- 3. name the stops ---
const names: string[] = [];
for (const [i, s] of stops.entries()) {
    let name = "TODO";
    if (s.at) {
        try {
            name = (await nominatimReverse(s.at)) ?? `stop ${i + 1}`;
        } catch (e) {
            console.warn(`  couldn't name stop ${i + 1} (${(e as Error).message}); using "stop ${i + 1}"`);
            name = `stop ${i + 1}`;
        }
    }
    names.push(name);
    console.log(`  ${i + 1}. ${name} (${s.photos.length} photos${s.start ? `, ${s.start}${s.end !== s.start ? ` to ${s.end}` : ""}` : ""})`);
}

// --- 4. copy originals into photos/<trip>/<stop>/ ---
const firstDay = stops.flatMap((s) => (s.start ? [s.start] : [])).sort()[0];
const tripFile = path.join(paths(root).trips, `${(firstDay ?? new Date().toISOString()).slice(0, 7)}-${slug}.yaml`);
const tripDir = path.join(root, "photos", slug);
const inside = (a: string, b: string) => !path.relative(b, a).startsWith("..");
if (inside(src, tripDir) || inside(tripDir, src)) {
    fail(`Import from a folder outside photos/${slug}/ (e.g. your Desktop); the originals get copied in.`);
}
if (!values.force && (fs.existsSync(tripFile) || fs.existsSync(tripDir))) {
    fail(`${path.relative(root, fs.existsSync(tripFile) ? tripFile : tripDir)} already exists. Pick another --title, or pass --force to replace it.`);
}
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

console.log("Making web versions...");
const { failures } = await processPhotos({ only: [slug] });
if (failures.length) console.warn(`  ${failures.length} photo(s) couldn't be processed:\n    ${failures.join("\n    ")}`);

// --- 5. write the trip ---
const notes = [
    `Draft made by \`npm run import\` from ${photos.length} files in ${path.basename(src)}.`,
    "Check the stop names and dates, rename or merge stops as you like, then delete this comment.",
    "Each stop's photos are in photos/" + slug + "/<folder>; move files between folders to re-sort them.",
    ...(unplaced.length ? [`${unplaced.length} photo(s) had no date or location: see photos/${slug}/unsorted/.`] : []),
    ...(stops.some((s) => !s.at) ? ['Stops marked "TODO" had no GPS: set `place` to where it was (it will be looked up).'] : []),
];
const yaml = tripYaml(
    {
        title,
        ...(values.from ? { from: values.from } : {}),
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
console.log(`\nWrote ${path.relative(root, tripFile)}`);

const { errors } = await loadTravelData({ root, geocoder: false });
const mine = errors.filter((e) => e.startsWith(path.relative(root, tripFile)));
if (mine.length) console.log(`Still to fix:\n  ${mine.join("\n  ")}`);
console.log("Next: open the file, tidy it up, then `npm run dev` to see it on the globe.");
