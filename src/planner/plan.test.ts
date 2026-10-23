import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { TripSchema } from "../../scripts/lib/schema.ts";
import { draftFromFile, fromDraft } from "../studio/draft";
import { emptyPlan, emptyStop, fileName, fromYaml, needsExport, type Plan, stopDate, toTrip, toYaml, unfinished } from "./plan";

const plan = (patch: Partial<Plan> = {}): Plan => ({
    ...emptyPlan(1000),
    title: "japan",
    from: "home",
    country: "JP",
    stops: [
        { ...emptyStop(), place: "Tokyo", start: "2026-12-20", end: "2026-12-23", note: "teamLab\n" },
        { ...emptyStop(), place: "Nara", start: "2026-12-24", side: true },
        { ...emptyStop(), place: " " },
    ],
    ...patch,
});

describe("trip planner", () => {
    it("writes a stop's dates as a trip file does", () => {
        expect(stopDate({ start: "2026-12-20", end: "2026-12-23" })).toBe("2026-12-20..2026-12-23");
        expect(stopDate({ start: "2026-12-20", end: "2026-12-20" })).toBe("2026-12-20");
        expect(stopDate({ start: "2026-12-20", end: "" })).toBe("2026-12-20");
        expect(stopDate({ start: "", end: "" })).toBe("");
    });

    it("a new stop starts when the last one ends", () => {
        expect(emptyStop({ ...emptyStop(), start: "2026-12-20", end: "2026-12-23" }).start).toBe("2026-12-23");
        expect(emptyStop({ ...emptyStop(), start: "2026-12-20" }).start).toBe("2026-12-20");
    });

    it("exports a valid trip, leaving out stops without a place", () => {
        const trip = toTrip(plan());
        expect(TripSchema.parse(trip)).toEqual({
            title: "japan",
            from: "home",
            country: "jp",
            stops: [
                { place: "Tokyo", date: "2026-12-20..2026-12-23", note: "teamLab" },
                { place: "Nara", date: "2026-12-24", side: true },
            ],
        });
    });

    it("names the file as data/trips/ does", () => {
        expect(fileName(plan())).toBe("2026-12-japan.yaml");
        expect(fileName(plan({ title: "", stops: [emptyStop()] }))).toBe("planned-trip.yaml");
    });

    it("reads back what it exported", () => {
        const p = plan();
        const back = fromYaml(toYaml(p));
        expect(toTrip(back)).toEqual(toTrip(p));
        expect(back.id).not.toBe(p.id);
    });

    it("opens a trip file whose stops have no dates yet, and keeps coordinates", () => {
        const p = fromYaml("title: x\nstops:\n  - place: Kyoto\n  - place: Uji\n    lat: 34.9\n    lng: 135.8\n    date: 2026-12-25\n");
        expect(p.stops.map((s) => [s.place, s.start, s.lat])).toEqual([["Kyoto", "", undefined], ["Uji", "2026-12-25", 34.9]]);
        expect(unfinished(p)).toBe(1);
        expect(() => fromYaml("hello")).toThrow(/isn't a trip file/);
        expect(() => fromYaml("title: x\nstops: [{ place: A, date: 2026-01-01, colour: red }]")).toThrow(/isn't a trip file/);
    });

    it("needs exporting until it's exported, and again after a change", () => {
        const p = plan();
        expect(needsExport(p)).toBe(true);
        expect(needsExport({ ...p, exported: p.updated })).toBe(false);
        expect(needsExport({ ...p, exported: p.updated, updated: p.updated + 1 })).toBe(true);
    });

    it("opens in the studio as the same trip", () => {
        const text = toYaml(plan());
        expect(fromDraft(draftFromFile(text))).toEqual(YAML.parse(text));
        expect(() => draftFromFile("title: x")).toThrow(/no stops/);
        expect(() => draftFromFile("a: [")).toThrow(/isn't YAML/);
    });
});
