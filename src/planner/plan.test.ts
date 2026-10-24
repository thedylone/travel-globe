import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { TripSchema } from "../../scripts/lib/schema.ts";
import { draftFromFile, fromDraft } from "../studio/draft";
import {
    addDays,
    emptyPlan,
    endDate,
    fileName,
    fromYaml,
    needsExport,
    newDay,
    newPlace,
    type Plan,
    setDates,
    toTrip,
    toYaml,
    unfinished,
    upgrade,
} from "./plan";
import { describe as describePlace } from "./search";

const tokyo = { place: "Tokyo", lat: 35.68, lng: 139.76 };
const plan = (patch: Partial<Plan> = {}): Plan => ({
    ...emptyPlan(1000),
    title: "japan",
    from: "home",
    country: "JP",
    start: "2026-12-20",
    days: [
        newDay([newPlace({ ...tokyo, note: "teamLab\n" }), newPlace({ place: "Shibuya Sky", lat: 35.66, lng: 139.7 })]),
        newDay([newPlace({ ...tokyo, note: "Ghibli museum" })]),
        newDay([newPlace({ place: "Kyoto" }), newPlace({ place: "Nara", side: true }), newPlace({ place: " " })]),
    ],
    ideas: [newPlace({ place: "Hiroshima" })],
    ...patch,
});

describe("trip planner", () => {
    it("counts days across months and years", () => {
        expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
        expect(endDate(plan())).toBe("2026-12-22");
        expect(endDate({ start: "", days: [] })).toBe("");
    });

    it("exports a stop per place per day, joining a stay over consecutive days", () => {
        expect(TripSchema.parse(toTrip(plan()))).toEqual({
            title: "japan",
            from: "home",
            country: "jp",
            stops: [
                { ...tokyo, date: "2026-12-20..2026-12-21", note: "teamLab\n\nGhibli museum" },
                { place: "Shibuya Sky", lat: 35.66, lng: 139.7, date: "2026-12-20" },
                { place: "Kyoto", date: "2026-12-22" },
                { place: "Nara", date: "2026-12-22", side: true },
            ],
        });
    });

    it("only joins days in a row", () => {
        const p = plan({ days: [newDay([newPlace(tokyo)]), newDay([newPlace({ place: "Kyoto" })]), newDay([newPlace(tokyo)])] });
        expect(toTrip(p).stops.map((s) => s.date)).toEqual(["2026-12-20", "2026-12-21", "2026-12-22"]);
    });

    it("moves the days with the start, and sends places on dropped days to the ideas", () => {
        const p = plan();
        expect(setDates(p, "2027-01-05", "2027-01-07").days).toEqual(p.days);
        const shorter = setDates(p, "2026-12-20", "2026-12-21");
        expect(shorter.days).toHaveLength(2);
        expect(shorter.ideas.map((x) => x.place)).toEqual(["Hiroshima", "Kyoto", "Nara", " "]);
        expect(setDates(p, "2026-12-20", "2026-12-24").days).toHaveLength(5);
    });

    it("names the file as data/trips/ does", () => {
        expect(fileName(plan())).toBe("2026-12-japan.yaml");
        expect(fileName(emptyPlan())).toBe("planned-trip.yaml");
    });

    it("reads back what it exported, day by day", () => {
        const back = fromYaml(toYaml(plan()));
        expect(back.start).toBe("2026-12-20");
        expect(back.days.map((d) => d.places.map((x) => x.place))).toEqual([["Tokyo", "Shibuya Sky"], ["Tokyo"], ["Kyoto", "Nara"]]);
        expect(toTrip(back)).toEqual(toTrip(plan()));
    });

    it("opens a trip file whose stops have no dates yet, as ideas", () => {
        const p = fromYaml("title: x\nstops:\n  - place: Kyoto\n  - place: Uji\n    lat: 34.9\n    lng: 135.8\n    date: 2026-12-25\n");
        expect(p.start).toBe("2026-12-25");
        expect(p.days[0].places.map((x) => [x.place, x.lat])).toEqual([["Uji", 34.9]]);
        expect(p.ideas.map((x) => x.place)).toEqual(["Kyoto"]);
        expect(() => fromYaml("hello")).toThrow(/isn't a trip file/);
        expect(() => fromYaml("title: x\nstops: [{ place: A, date: 2026-01-01, colour: red }]")).toThrow(/isn't a trip file/);
    });

    it("exports an undated plan for the studio to finish", () => {
        const p = plan({ start: "" });
        expect(unfinished(p)).toBe(6);
        expect(fileName(p)).toBe("japan.yaml");
        expect(toTrip(p).stops.every((s) => s.date === "")).toBe(true);
    });

    it("upgrades plans saved before it had days", () => {
        const old = {
            id: "a", title: "japan", from: "", to: "", country: "", created: 1, updated: 2,
            stops: [
                { place: "Tokyo", name: "", start: "2026-12-20", end: "2026-12-21", side: false, note: "hi" },
                { place: "Nara", name: "", start: "2026-12-22", end: "", side: true, note: "" },
            ],
        };
        const p = upgrade(old as never);
        expect(p.id).toBe("a");
        expect(p.start).toBe("2026-12-20");
        expect(p.days.map((d) => d.places.map((x) => x.place))).toEqual([["Tokyo"], ["Tokyo"], ["Nara"]]);
        expect(toTrip(p).stops).toEqual([
            { place: "Tokyo", date: "2026-12-20..2026-12-21", note: "hi" },
            { place: "Nara", date: "2026-12-22", side: true },
        ]);
        expect(upgrade(p)).toBe(p);
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

    it("describes a search result by name and where it is", () => {
        const f = {
            geometry: { coordinates: [135.772695, 34.967146] as [number, number] },
            properties: { name: "Fushimi Inari Taisha", city: "Kyoto", state: "Kyoto Prefecture", country: "Japan" },
        };
        expect(describePlace(f)).toEqual({ name: "Fushimi Inari Taisha", address: "Kyoto, Kyoto Prefecture, Japan", lat: 34.96715, lng: 135.7727 });
        expect(describePlace({ ...f, properties: { name: "Kyoto", city: "Kyoto", country: "Japan" } })?.address).toBe("Japan");
    });
});
