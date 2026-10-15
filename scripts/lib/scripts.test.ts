import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadTravelData } from "./load.ts";
import { groupIntoStops } from "./stops.ts";
import { slugify, tripYaml } from "./write.ts";

describe("groupIntoStops", () => {
    it("starts a new stop when you move more than the threshold", () => {
        const { stops, unplaced } = groupIntoStops([
            { file: "a", time: "2024-03-08 09:00:00", at: { lat: 50.03, lng: 19.2 } },
            { file: "c", time: "2024-03-08 15:00:00", at: { lat: 50.06, lng: 19.94 } },
            { file: "b", time: "2024-03-08 10:00:00", at: { lat: 50.031, lng: 19.201 } },
            { file: "d", time: "2024-03-08 16:00:00" }, // no GPS: joins the stop it was taken during
            { file: "e" }, // nothing at all
        ]);
        expect(stops.map((s) => s.photos.map((p) => p.file))).toEqual([["a", "b"], ["c", "d"]]);
        expect(stops[0]).toMatchObject({ start: "2024-03-08", end: "2024-03-08" });
        expect(unplaced.map((p) => p.file)).toEqual(["e"]);
    });

    it("makes one unlocated stop when nothing has GPS", () => {
        const { stops } = groupIntoStops([
            { file: "a", time: "2024-01-02 10:00:00" },
            { file: "b", time: "2024-01-01 10:00:00" },
        ]);
        expect(stops).toHaveLength(1);
        expect(stops[0].at).toBeUndefined();
        expect(stops[0]).toMatchObject({ start: "2024-01-01", end: "2024-01-02" });
    });
});

describe("write", () => {
    it("slugifies titles", () => {
        expect(slugify("Berlin, Hamburg & Copenhagen")).toBe("berlin-hamburg-copenhagen");
        expect(slugify("Jökulsárlón")).toBe("jokulsarlon");
        expect(slugify("中国＋四国")).toBe("中国-四国");
    });

    it("writes YAML that reads back the same", () => {
        const trip = {
            title: "lake wakatipu?",
            from: "home",
            stops: [{ place: "a: b", date: "2024-01-01", photos: ["x/1", "x/2"], note: "two\nlines" }],
        };
        expect(YAML.parse(tripYaml(trip, "comment"))).toEqual(trip);
    });
});

describe("loadTravelData", () => {
    let root: string;
    const write = (rel: string, content: string) => {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), content);
    };
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "travel-"));
        write("data/bases.yaml", "school: { name: imperial, lat: 51.5, lng: -0.17, icon: school }\n");
        write("data/photos.json", JSON.stringify({
            "krakow/1": { kind: "image", width: 1600, height: 1200 },
            "krakow/10": { kind: "image", width: 1600, height: 1200 },
            "krakow/2": { kind: "image", width: 1200, height: 1600 },
            "krakow/old/1": { kind: "image", width: 1600, height: 1200 },
        }));
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    it("resolves places, photos and bases", async () => {
        write("data/trips/2024-03-poland.yaml", [
            "title: poland",
            "from: school",
            "stops:",
            "  - place: kraków",
            "    date: 2024-03-07..2024-03-09",
            "    photos: krakow",
            "  - place: auschwitz",
            "    lat: 50.03",
            "    lng: 19.2",
            "    date: 2024-03-08",
            "    photos: [krakow/2.jpg]",
        ].join("\n"));
        const looked: string[] = [];
        const { data, errors } = await loadTravelData({
            root,
            geocoder: async (q) => (looked.push(q), { lat: 50.06, lng: 19.94 }),
        });
        expect(errors).toEqual([]);
        expect(looked).toEqual(["kraków"]); // explicit lat/lng isn't looked up
        const [t] = data.trips;
        expect(t).toMatchObject({ id: "2024-03-poland", start: "2024-03-07", end: "2024-03-09", from: { name: "imperial" } });
        expect(t.stops[0].media.map((m) => m.id)).toEqual(["krakow/1", "krakow/2", "krakow/10"]);
        expect(t.stops[1].media[0].src).toBe("photos/full/krakow/2.webp");
        // Geocoded places are cached for next time.
        expect(JSON.parse(fs.readFileSync(path.join(root, "data/places.json"), "utf8"))).toEqual({ "kraków": { lat: 50.06, lng: 19.94 } });
    });

    it("reports every problem with its file and stop", async () => {
        write("data/trips/bad.yaml", [
            "title: bad",
            "stops:",
            "  - place: nowhere",
            "    date: 8 March 2024",
            "  - place: somewhere",
            "    date: 2024-03-08",
            "    photos: [krakow/99]",
            "    lat: 1",
        ].join("\n"));
        const { errors } = await loadTravelData({ root, geocoder: false });
        expect(errors.join("\n")).toMatch(/bad\.yaml: stops\[1\]: give both lat and lng/);

        write("data/trips/bad.yaml", "title: bad\nstops:\n  - place: nowhere\n    date: 8 March 2024\n  - place: x\n    date: 2024-03-08\n    photos: [krakow/99]\n");
        const second = await loadTravelData({ root, geocoder: false });
        expect(second.errors).toEqual([
            expect.stringMatching(/stops\[0\] \(nowhere\): invalid date "8 March 2024"/),
            expect.stringMatching(/stops\[1\] \(x\): "x" is not in data\/places.json/),
        ]);
    });

    it("flags missing photos", async () => {
        write("data/trips/t.yaml", "title: t\nstops:\n  - place: x\n    lat: 1\n    lng: 2\n    date: 2024-01-01\n    photos: [krakow/99]\n");
        const { errors } = await loadTravelData({ root, geocoder: false });
        expect(errors).toEqual([expect.stringMatching(/photo "krakow\/99" not found/)]);
    });
});
