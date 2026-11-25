import { describe, expect, it } from "vitest";
import { emptyPlan, newPlace } from "./plan";
import { fitTitle, pictureKey, renderTripSvg } from "./picture";

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
});
