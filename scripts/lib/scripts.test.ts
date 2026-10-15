import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { splitCountries, visitedParts } from "../../src/lib/borders.ts";
import { renderShareSvg } from "../../src/lib/share.ts";
import { computeStats } from "../../src/lib/stats.ts";
import type { Trip } from "../../src/types.ts";
import { countryAt, countryFeatures } from "./countries.ts";
import { worldInfo } from "./world.ts";
import { loadTravelData } from "./load.ts";
import { EXAMPLE_DIR, loadSite, resolveDataDir } from "./site.ts";
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

describe("site", () => {
    let dir: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "site-"));
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it("takes the base path and share-image URL from url", () => {
        fs.writeFileSync(path.join(dir, "site.yaml"), "name: sam\nurl: https://sam.github.io/trips/\n");
        expect(loadSite(dir)).toMatchObject({
            title: "Travel History",
            description: "sam's travels on an interactive globe",
            base: "/trips/",
            shortUrl: "sam.github.io/trips",
        });
    });

    it("works without a site.yaml, served from the root", () => {
        expect(loadSite(dir)).toMatchObject({ base: "/", shortUrl: "" });
    });

    it("reports bad fields", () => {
        fs.writeFileSync(path.join(dir, "site.yaml"), "url: not a url\ntwitter: sam\n");
        expect(() => loadSite(dir)).toThrow(/url: .*\n.*twitter: /s);
    });

    it("uses the data folder given, else the current folder with a site.yaml, else the example", () => {
        const cwd = process.cwd();
        const env = process.env.TRAVEL_HISTORY_DATA;
        delete process.env.TRAVEL_HISTORY_DATA;
        try {
            process.chdir(dir);
            expect(resolveDataDir("x")).toBe(path.join(fs.realpathSync(dir), "x"));
            expect(resolveDataDir()).toBe(EXAMPLE_DIR);
            fs.writeFileSync(path.join(dir, "site.yaml"), "");
            expect(fs.realpathSync(resolveDataDir())).toBe(fs.realpathSync(dir));
        } finally {
            process.chdir(cwd);
            if (env !== undefined) process.env.TRAVEL_HISTORY_DATA = env;
        }
    });

    it("example/ is a valid data folder", async () => {
        expect(() => loadSite(EXAMPLE_DIR)).not.toThrow();
        const { data, errors } = await loadTravelData({ root: EXAMPLE_DIR, geocoder: false });
        expect(errors).toEqual([]);
        expect(data.trips.length).toBeGreaterThan(0);
    });
});

describe("countryAt", () => {
    it("finds the country a point is in", () => {
        expect(countryAt({ lat: 51.5, lng: -0.12 })).toBe("United Kingdom");
        expect(countryAt({ lat: 35.01, lng: 135.77 })).toBe("Japan");
    });
    it("snaps points just off the coast, but not mid-ocean ones", () => {
        expect(countryAt({ lat: 50.05, lng: -5.8 })).toBe("United Kingdom"); // off Land's End
        expect(countryAt({ lat: 30, lng: -40 })).toBeUndefined();
    });
});

describe("visitedParts", () => {
    const parts = splitCountries(countryFeatures());
    const shaded = (stops: { lat: number; lng: number; country: string }[]) =>
        [...visitedParts(parts, stops)].map((id) => id.split("#")[0]);

    it("shades the land masses near your stops, not far-off territories", () => {
        const paris = { lat: 48.86, lng: 2.35, country: "France" };
        const france = parts.filter((p) => p.properties.name === "France");
        const ids = visitedParts(parts, [paris]);
        expect(ids.size).toBeGreaterThan(0);
        expect(ids.size).toBeLessThan(france.length); // French Guiana, Réunion etc. stay grey
        expect(new Set(shaded([paris]))).toEqual(new Set(["France"]));
    });

    it("only shades countries with a stop", () => {
        expect(shaded([{ lat: 0, lng: -30, country: "Atlantis" }])).toEqual([]);
    });
});

describe("renderShareSvg", () => {
    const stop = (name: string, lat: number, lng: number, country: string, start: string) =>
        ({ name, lat, lng, country, start, end: start, media: [] });
    const trips: Trip[] = [
        { id: "a", title: "a", start: "2023-01-01", end: "2023-01-03", stops: [stop("paris", 48.86, 2.35, "France", "2023-01-01")] },
        { id: "b", title: "b", start: "2024-05-01", end: "2024-05-01", stops: [stop("tokyo", 35.68, 139.69, "Japan", "2024-05-01")] },
    ];
    const stats = computeStats(trips, worldInfo(["France", "Japan"]));
    const input = { countries: countryFeatures(), stops: trips.flatMap((t) => t.stops), stats, url: "example.com" };

    it("works out continents and the share of the world", () => {
        expect(stats.worldShare).toBeCloseTo(2 / 195);
        expect(stats.continents.find((c) => c.name === "Europe")).toMatchObject({ visited: 1, total: 45 });
        expect(stats.continents.find((c) => c.name === "Asia")).toMatchObject({ visited: 1, total: 47 });
        expect(stats.continents.reduce((n, c) => n + c.total, 0)).toBe(195);
    });

    it("draws the numbers, the years, the share and every continent", () => {
        const svg = renderShareSvg({ ...input, size: "post", theme: "dark" });
        expect(svg).toMatch(/^<svg [^>]*width="1080" height="1350"/);
        expect(svg).toContain(">2</tspan>"); // countries
        expect(svg).toContain("2023–2024");
        expect(svg).toContain(">1%</tspan> of the world");
        for (const c of ["EUROPE", "ASIA", "AFRICA", "NORTH AMERICA", "SOUTH AMERICA", "OCEANIA"]) expect(svg).toContain(c);
        expect(svg).toContain("example.com");
        expect((svg.match(/<circle /g) ?? []).length).toBe(2);
    });

    it("zooms the map to the stops when asked", () => {
        const world = renderShareSvg({ ...input, size: "post", theme: "dark" });
        const zoomed = renderShareSvg({ ...input, size: "post", theme: "dark", zoom: true });
        expect(world).not.toContain("clipPath");
        expect(zoomed).toContain('<clipPath id="map-frame">');
        // Both stops are still drawn, inside the frame.
        expect((zoomed.match(/<circle /g) ?? []).length).toBe(2);
    });

    it("has a light version", () => {
        const dark = renderShareSvg({ ...input, size: "story", theme: "dark" });
        const light = renderShareSvg({ ...input, size: "story", theme: "light" });
        expect(dark).toContain('fill="#0b1220"');
        expect(light).toContain('fill="#f5f7fb"');
        expect(light).not.toContain('fill="#0b1220"');
    });
});
