import { describe, expect, it } from "vitest";
import type { Stop, Trip } from "../types";
import { clusterPlaces, clusterRadiusDeg, zoomIntoCluster } from "./cluster";
import { formatDateRange, parseDateRange } from "./dates";
import { distanceKm } from "./geo";
import { buildPlaces, filterPlaces } from "./places";
import { parseHash, toHash } from "./route";

const stop = (name: string, lat: number, lng: number, start = "2024-01-01"): Stop => ({
    name, lat, lng, start, end: start, media: [],
});
const trip = (id: string, stops: Stop[]): Trip => ({ id, title: id, start: stops[0].start, end: stops[0].end, stops });

describe("dates", () => {
    it("parses single days and ranges", () => {
        expect(parseDateRange("2024-03-07")).toEqual({ start: "2024-03-07", end: "2024-03-07" });
        expect(parseDateRange("2024-03-07..2024-03-09")).toEqual({ start: "2024-03-07", end: "2024-03-09" });
    });
    it("rejects bad dates", () => {
        expect(() => parseDateRange("7 March 2024")).toThrow(/YYYY-MM-DD/);
        expect(() => parseDateRange("2024-02-30")).toThrow();
        expect(() => parseDateRange("2024-03-09..2024-03-07")).toThrow(/before/);
    });
    it("formats compactly", () => {
        expect(formatDateRange({ start: "2024-03-07", end: "2024-03-07" })).toBe("7 Mar 2024");
        expect(formatDateRange({ start: "2024-03-07", end: "2024-03-09" })).toBe("7–9 Mar 2024");
        expect(formatDateRange({ start: "2024-02-27", end: "2024-03-02" })).toBe("27 Feb – 2 Mar 2024");
        expect(formatDateRange({ start: "2018-12-24", end: "2019-01-04" })).toBe("24 Dec 2018 – 4 Jan 2019");
    });
});

describe("places", () => {
    const a = trip("a", [stop("kyoto", 35.0116, 135.7681), stop("osaka", 34.6937, 135.5023)]);
    const b = trip("b", [stop("Kyoto", 35.02, 135.76, "2025-01-01")]);
    const c = trip("c", [stop("osaka castle", 34.6937, 135.5023)]); // same spot, different name

    it("merges the same place across trips", () => {
        const places = buildPlaces([a, b, c]);
        expect(places).toHaveLength(2);
        const kyoto = places.find((p) => p.name.toLowerCase() === "kyoto")!;
        expect(kyoto.visits.map((v) => v.trip.id)).toEqual(["a", "b"]);
        expect(kyoto.name).toBe("Kyoto"); // the most recent visit's name
        expect(places.find((p) => p.visits.some((v) => v.trip.id === "c"))!.visits).toHaveLength(2);
    });

    it("keeps different places with the same name apart", () => {
        const places = buildPlaces([trip("x", [stop("cambridge", 52.2, 0.12)]), trip("y", [stop("cambridge", 42.37, -71.1)])]);
        expect(places).toHaveLength(2);
    });

    it("filters visits by trip and drops empty places", () => {
        const places = filterPlaces(buildPlaces([a, b]), new Set(["b"]));
        expect(places).toHaveLength(1);
        expect(places[0].visits.map((v) => v.trip.id)).toEqual(["b"]);
    });
});

describe("clustering", () => {
    const places = buildPlaces([
        trip("uk", [stop("london", 51.5, -0.12), stop("bath", 51.38, -2.36), stop("york", 53.96, -1.08)]),
        trip("jp", [stop("tokyo", 35.68, 139.69)]),
    ]);

    it("merges nearby places when zoomed out, and splits them when zoomed in", () => {
        const far = clusterPlaces(places, clusterRadiusDeg(2.5, 850));
        expect(far).toHaveLength(2);
        expect(far.find((c) => c.places.length === 3)).toBeTruthy();
        const near = clusterPlaces(places, clusterRadiusDeg(0.1, 850));
        expect(near).toHaveLength(4);
    });

    it("radius shrinks with altitude in half-octave steps", () => {
        const r1 = clusterRadiusDeg(1, 850);
        expect(clusterRadiusDeg(0.5, 850)).toBeCloseTo(r1 / 2, 5);
        expect(clusterRadiusDeg(1.02, 850)).toBe(r1); // small zoom changes don't re-cluster
    });

    it("zooming into a cluster splits it", () => {
        const [uk] = clusterPlaces(places, clusterRadiusDeg(2.5, 850)).filter((c) => c.places.length === 3);
        const { altitude } = zoomIntoCluster(uk, 850);
        const after = clusterPlaces(uk.places, clusterRadiusDeg(altitude, 850));
        expect(after.length).toBeGreaterThan(1);
    });

    it("cluster ids are stable regardless of input order", () => {
        const r = clusterRadiusDeg(2.5, 850);
        const ids = clusterPlaces(places, r).map((c) => c.id).sort();
        expect(clusterPlaces([...places].reverse(), r).map((c) => c.id).sort()).toEqual(ids);
    });
});

describe("route", () => {
    it("round-trips through the hash", () => {
        const r = { focus: "2024-03-poland", stop: { tripId: "2018-12-中国-四国", index: 1 } };
        expect(parseHash(toHash(r))).toEqual(r);
        expect(toHash({ stop: { tripId: "2024-03-poland", index: 0 } })).toBe("#stop=2024-03-poland:1");
        expect(parseHash("")).toEqual({});
        expect(parseHash("#stop=bad")).toEqual({});
    });
});

describe("geo", () => {
    it("measures great-circle distance", () => {
        expect(distanceKm({ lat: 51.5074, lng: -0.1278 }, { lat: 48.8566, lng: 2.3522 })).toBeCloseTo(344, -1);
    });
});
