import { describe, expect, it } from "vitest";
import { emptyPlan, newPlace } from "./plan";
import { feature } from "topojson-client";
import type { Topology } from "topojson-specification";
import topo from "world-atlas/countries-110m.json";
import type { CountryFeature } from "../lib/borders";
import { fitTitle, pictureKey, renderTripSvg, tripView } from "./picture";

describe("a shared trip's picture", () => {
    it("fits the title in three lines at most, as big as it can", () => {
        expect(fitTitle("Japan", 560)).toEqual([104, ["Japan"]]);
        const [size, lines] = fitTitle("A very long weekend road trip around the Scottish Highlands with friends", 560);
        expect(size).toBe(54);
        expect(lines).toHaveLength(3);
        expect(lines[2].endsWith("…")).toBe(true);
        expect(fitTitle("x".repeat(40), 560)[1].every((l) => l.length * 0.5 * 54 <= 560)).toBe(true);
    });

    it("draws the title, dates and route, and changes only with what it shows", () => {
        const p = {
            ...emptyPlan(1),
            title: "Tokyo <3 & Kyoto",
            start: "2026-12-20",
            days: [{ key: "a", places: [newPlace({ place: "Tokyo", lat: 35.68, lng: 139.76 }), newPlace({ place: "Kyoto", lat: 35.01, lng: 135.77 })] }],
        };
        const svg = renderTripSvg(p, { url: "travel.example.com" });
        expect(svg).toContain("Tokyo &lt;3 &amp;");
        expect(svg).not.toContain("<3");
        expect(svg).toContain("20 DEC 2026");
        expect(svg).toContain("<polyline");
        expect(svg).toContain("travel.example.com/planner");
        expect(pictureKey({ ...p, days: [{ ...p.days[0], places: p.days[0].places.map((x) => ({ ...x, note: "changed" })) }] })).toBe(pictureKey(p));
        expect(pictureKey({ ...p, title: "Osaka" })).not.toBe(pictureKey(p));
    });

    it("draws the route on a map of the countries around it", () => {
        const t = topo as unknown as Topology;
        const countries = (feature(t, t.objects.countries) as unknown as { features: CountryFeature[] }).features;
        const p = {
            ...emptyPlan(1),
            title: "Lisbon",
            days: [{ key: "a", places: [newPlace({ place: "Lisbon", lat: 38.72, lng: -9.14 }), newPlace({ place: "Porto", lat: 41.15, lng: -8.61 })] }],
        };
        const svg = renderTripSvg(p, { countries });
        expect(svg).toContain('clip-path="url(#card)"');
        expect(svg).toMatch(/<path d="M[^"]{50,}" fill="#f6f0e4"/);
        expect(renderTripSvg(p)).not.toContain("clip-path");
        // Lisbon is south of Porto, so lower on the card; both inside it.
        const v = tripView([{ lat: 38.72, lng: -9.14, name: "" }, { lat: 41.15, lng: -8.61, name: "" }], 0, 0, 100, 100);
        const [lisbon, porto] = [v.at(-9.14, 38.72), v.at(-8.61, 41.15)];
        expect(lisbon[1]).toBeGreaterThan(porto[1]);
        for (const [x, y] of [lisbon, porto]) expect(Math.min(x, y, 100 - x, 100 - y)).toBeGreaterThan(-1e-6);
    });
});
