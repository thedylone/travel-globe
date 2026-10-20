import { describe, expect, it } from "vitest";
import { emptyDraft, emptyStop } from "./draft";
import { layoutMap, type Lookup, lookupKey, roundAt, typedAt } from "./mapdata";

describe("studio map", () => {
    const stop = (place: string, more = {}) => ({ ...emptyStop(), place, date: "2024-03-07", ...more });
    const draft = {
        ...emptyDraft(),
        from: "school",
        country: "PL",
        stops: [
            stop("kraków"),
            stop("auschwitz", { lat: "50.03", lng: "19.2", side: true }),
            stop("zakopane"),
            stop("nowhere"),
            stop("gdańsk", { lat: "54.3", lng: "" }),
        ],
    };
    const bases = [{ key: "school", name: "School", icon: "school", lat: 51.5, lng: -0.1 }];
    const lookups = new Map<string, Lookup>([
        [lookupKey("Kraków", "pl"), { at: { lat: 50.06, lng: 19.94 }, saved: true }],
        [lookupKey("zakopane", "pl"), { at: { lat: 49.3, lng: 19.95 }, saved: false }],
        [lookupKey("nowhere", "pl"), { at: null, saved: false }],
    ]);

    it("places stops from lat/lng, places.json and new lookups", () => {
        const { pins, unplaced, from, queries } = layoutMap(draft, bases, lookups);
        expect(pins.map((p) => [p.index, p.source, p.side])).toEqual([
            [0, "saved", false],
            [1, "set", true],
            [2, "lookup", false],
        ]);
        expect(unplaced.map((u) => [u.index, u.why])).toEqual([
            [3, `couldn't find "nowhere"`],
            [4, "lat/lng aren't a valid point"],
        ]);
        expect(from).toEqual({ lat: 51.5, lng: -0.1 });
        expect(queries).toEqual([]);
    });

    it("asks for places it hasn't looked up, with the trip's countries", () => {
        const { queries, unplaced } = layoutMap({ ...draft, stops: [stop("Wrocław ")] }, bases, lookups);
        expect(queries).toEqual([{ q: "Wrocław", country: "pl" }]);
        expect(unplaced[0].why).toBe("looking it up…");
    });

    it("draws side trips out and back as dashed legs", () => {
        const { legs } = layoutMap(draft, bases, lookups);
        expect(legs.map((l) => l.side)).toEqual([false, true, false]);
    });

    it("reads typed lat/lng and rounds dropped pins", () => {
        expect(typedAt("", " ")).toBeUndefined();
        expect(typedAt("91", "0")).toBe("bad");
        expect(typedAt("1.5", "-2")).toEqual({ lat: 1.5, lng: -2 });
        expect(roundAt({ lat: 50.123456789, lng: 199.5 })).toEqual({ lat: 50.12346, lng: -160.5 });
    });
});
