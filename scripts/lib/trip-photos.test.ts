import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import YAML from "yaml";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The photo pipeline reads its data folder once, when loaded.
const root = vi.hoisted(() => {
    const dir = require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "trip-photos-"));
    process.env.TRAVEL_GLOBE_DATA = dir;
    return dir as string;
});
/** Each test photo's time and position, by file name, as exifr would read them. */
const exif = vi.hoisted(() => new Map<string, { DateTimeOriginal?: string; latitude?: number; longitude?: number }>());
vi.mock("exifr", () => ({ default: { parse: async (file: string) => exif.get(file.split(/[/\\]/).pop()!) } }));
vi.mock("./geocode.ts", async (load) => ({ ...(await load<object>()), nominatimReverse: async () => "Höfn" }));

const { addPhotos } = await import("./importer.ts");
const { deleteTrip } = await import("./remove.ts");

const jpeg = (file: string, shade: number) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    return sharp({ create: { width: 32, height: 24, channels: 3, background: { r: shade, g: shade, b: shade } } }).jpeg().toFile(file);
};
const write = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
};
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel: string) => fs.existsSync(path.join(root, rel));

beforeEach(() => {
    for (const f of fs.readdirSync(root)) fs.rmSync(path.join(root, f), { recursive: true, force: true });
    exif.clear();
});

describe("addPhotos", () => {
    it("puts each photo in the stop it was taken at, and makes new stops for the rest", async () => {
        write(
            "data/trips/2024-03-iceland.yaml",
            YAML.stringify({
                title: "Iceland",
                stops: [
                    { place: "Reykjavík", lat: 64.146, lng: -21.94, date: "2024-03-07..2024-03-08", photos: "iceland/reykjavik" },
                    { place: "Vík", lat: 63.419, lng: -19.006, date: "2024-03-10" },
                ],
            })
        );
        await jpeg(path.join(root, "photos/iceland/reykjavik/01-old.jpg"), 10);

        const src = path.join(root, "upload");
        await jpeg(path.join(src, "city.jpg"), 50);
        exif.set("city.jpg", { DateTimeOriginal: "2024:03:08 12:00:00", latitude: 64.15, longitude: -21.93 });
        await jpeg(path.join(src, "beach.jpg"), 90);
        exif.set("beach.jpg", { DateTimeOriginal: "2024:03:10 09:00:00", latitude: 63.4, longitude: -19.0 });
        await jpeg(path.join(src, "glacier.jpg"), 130);
        exif.set("glacier.jpg", { DateTimeOriginal: "2024:03:09 15:00:00", latitude: 64.25, longitude: -15.2 });
        await jpeg(path.join(src, "mystery.jpg"), 170);
        // The same photo as one already in the trip.
        fs.copyFileSync(path.join(root, "photos/iceland/reykjavik/01-old.jpg"), path.join(src, "old.jpg"));

        const r = await addPhotos({ root, id: "2024-03-iceland", src, log: () => {} });
        expect(r).toEqual({ added: 4, skipped: 1, newStops: 1, unplaced: 1 });

        const trip = YAML.parse(read("data/trips/2024-03-iceland.yaml"));
        expect(trip.stops.map((s: { place: string; photos?: string }) => [s.place, s.photos])).toEqual([
            ["Reykjavík", "iceland/reykjavik"],
            ["Höfn", "iceland/hofn"],
            ["Vík", "iceland/vik"],
        ]);
        expect(trip.stops[1]).toMatchObject({ date: "2024-03-09", lat: 64.25, lng: -15.2 });
        expect(fs.readdirSync(path.join(root, "photos/iceland/reykjavik"))).toEqual(["01-old.jpg", "02-city.jpg"]);
        expect(Object.keys(JSON.parse(read("data/photos.json")))).toEqual([
            "iceland/hofn/1-glacier",
            "iceland/reykjavik/01-old",
            "iceland/reykjavik/02-city",
            "iceland/unsorted/1-mystery",
            "iceland/vik/1-beach",
        ]);
        expect(exists("public/photos/thumb/iceland/vik/1-beach.webp")).toBe(true);
    });

    it("adds to a stop's list of photos, and starts a folder for a trip without one", async () => {
        write(
            "data/trips/2025-01-rome.yaml",
            YAML.stringify({ title: "Rome", stops: [{ place: "Rome", lat: 41.9, lng: 12.5, date: "2025-01-02", photos: ["other/a"] }] })
        );
        const src = path.join(root, "upload");
        await jpeg(path.join(src, "forum.jpg"), 40);
        exif.set("forum.jpg", { DateTimeOriginal: "2025:01:02 10:00:00" });

        await addPhotos({ root, id: "2025-01-rome", src, log: () => {} });
        const trip = YAML.parse(read("data/trips/2025-01-rome.yaml"));
        expect(trip.stops[0].photos).toEqual(["other/a", "other/rome/1-forum"]);
    });
});

describe("addPhotos: dates", () => {
    it("stretches a stop by a day, but not over another stop", async () => {
        write(
            "data/trips/2025-01-italy.yaml",
            YAML.stringify({
                title: "Italy",
                stops: [
                    { place: "Rome", lat: 41.9, lng: 12.5, date: "2025-01-02", photos: "italy/rome" },
                    { place: "Florence", lat: 43.77, lng: 11.25, date: "2025-01-03..2025-01-04", photos: "italy/florence" },
                ],
            })
        );
        const src = path.join(root, "upload");
        await jpeg(path.join(src, "early.jpg"), 20);
        exif.set("early.jpg", { DateTimeOriginal: "2025:01:01 20:00:00", latitude: 41.9, longitude: 12.5 });
        await jpeg(path.join(src, "late.jpg"), 60);
        exif.set("late.jpg", { DateTimeOriginal: "2025:01:03 08:00:00", latitude: 41.9, longitude: 12.5 });

        const r = await addPhotos({ root, id: "2025-01-italy", src, log: () => {} });
        expect(r.newStops).toBe(1);
        const trip = YAML.parse(read("data/trips/2025-01-italy.yaml"));
        // The night before joins Rome; the morning Florence starts is a stop of its own.
        expect(trip.stops.map((s: { place: string; date: string }) => [s.place, s.date])).toEqual([
            ["Rome", "2025-01-01..2025-01-02"],
            ["Florence", "2025-01-03..2025-01-04"],
            ["Höfn", "2025-01-03"],
        ]);
    });
});

describe("deleteTrip", () => {
    const photo = async (id: string) => {
        await jpeg(path.join(root, "photos", `${id}.jpg`), 60);
        for (const sub of ["full", "thumb"]) write(`public/photos/${sub}/${id}.webp`, "x");
    };

    it("removes the trip's photos but keeps ones another trip shows", async () => {
        const ids = ["iceland/reykjavik/01-a", "iceland/unsorted/1-b", "shared/x", "shared/y"];
        for (const id of ids) await photo(id);
        write("data/photos.json", JSON.stringify(Object.fromEntries(ids.map((id) => [id, { kind: "image", width: 32, height: 24 }]))));
        write("data/trips/2024-03-iceland.yaml", YAML.stringify({ title: "Iceland", stops: [
            { place: "Reykjavík", date: "2024-03-07", photos: "iceland/reykjavik" },
            { place: "Vík", date: "2024-03-08", photos: ["shared/x"] },
        ] }));
        write("data/trips/2024-05-other.yaml", YAML.stringify({ title: "Other", stops: [{ place: "Oslo", date: "2024-05-01", photos: "shared" }] }));

        expect(deleteTrip(root, "2024-03-iceland")).toEqual({ removed: 2, kept: 1 });
        expect(exists("data/trips/2024-03-iceland.yaml")).toBe(false);
        expect(Object.keys(JSON.parse(read("data/photos.json")))).toEqual(["shared/x", "shared/y"]);
        // Its own folder goes, unsorted photos and all.
        for (const dir of ["photos/iceland", "public/photos/full/iceland", "public/photos/thumb/iceland"]) expect(exists(dir)).toBe(false);
        for (const f of ["photos/shared/x.jpg", "public/photos/thumb/shared/x.webp"]) expect(exists(f)).toBe(true);
    });

    it("only takes its own photos from a folder another trip uses", async () => {
        const ids = ["japan/tokyo/1", "japan/tokyo/2", "japan/kyoto/1"];
        for (const id of ids) await photo(id);
        write("data/photos.json", JSON.stringify(Object.fromEntries(ids.map((id) => [id, { kind: "image", width: 32, height: 24 }]))));
        write("data/trips/a.yaml", YAML.stringify({ title: "A", stops: [{ place: "Tokyo", date: "2024-01-01", photos: ["japan/tokyo/1", "japan/kyoto/1"] }] }));
        write("data/trips/b.yaml", YAML.stringify({ title: "B", stops: [{ place: "Tokyo", date: "2025-01-01", photos: ["japan/tokyo/2"] }] }));

        expect(deleteTrip(root, "a")).toEqual({ removed: 2, kept: 0 });
        expect(Object.keys(JSON.parse(read("data/photos.json")))).toEqual(["japan/tokyo/2"]);
        expect(fs.readdirSync(path.join(root, "photos/japan"))).toEqual(["tokyo"]);
        expect(fs.readdirSync(path.join(root, "photos/japan/tokyo"))).toEqual(["2.jpg"]);
        expect(exists("public/photos/full/japan/kyoto")).toBe(false);
    });
});
