import { describe, expect, it } from "vitest";
import { dayOf, groupPhotos, momentIds, type PhotoWhen } from "./moments";

const KRAKOW = { lat: 50.0614, lng: 19.9366 };
/** About `m` metres north of Kraków's square. */
const north = (m: number) => ({ lat: KRAKOW.lat + m / 111_320, lng: KRAKOW.lng });
const p = (id: string, time?: string, at?: PhotoWhen["at"]): PhotoWhen => ({ id, ...(time ? { time } : {}), ...(at ? { at } : {}) });

describe("groupPhotos", () => {
    it("splits at a long gap in time", () => {
        const days = groupPhotos([
            p("1", "2024-03-07 10:00:00", KRAKOW),
            p("2", "2024-03-07 10:20:00", north(100)),
            p("3", "2024-03-07 11:00:00", north(200)),
            p("4", "2024-03-07 13:30:00", north(250)),
        ]);
        expect(days.map((d) => d.day)).toEqual(["2024-03-07"]);
        expect(momentIds(days)).toEqual([["1", "2", "3"], ["4"]]);
        expect(days[0].moments[0]).toMatchObject({ start: "2024-03-07 10:00:00", end: "2024-03-07 11:00:00" });
    });

    it("splits when you move on, even soon after", () => {
        const days = groupPhotos([
            p("1", "2024-03-07 10:00:00", KRAKOW),
            p("2", "2024-03-07 10:10:00", north(3000)),
            p("3", "2024-03-07 10:15:00", north(3100)),
        ]);
        expect(momentIds(days)).toEqual([["1"], ["2", "3"]]);
    });

    it("splits a slow walk away from where it started", () => {
        const walk = [0, 600, 1200, 1800, 2400].map((m, i) => p(String(i), `2024-03-07 10:${String(i * 10).padStart(2, "0")}:00`, north(m)));
        expect(momentIds(groupPhotos(walk))).toEqual([["0", "1", "2", "3"], ["4"]]);
    });

    it("groups by day, in time order, keeping a late night with its evening", () => {
        const days = groupPhotos([
            p("b", "2024-03-08 09:00:00"),
            p("a", "2024-03-07 23:40:00"),
            p("late", "2024-03-08 00:20:00"),
        ]);
        expect(days.map((d) => d.day)).toEqual(["2024-03-07", "2024-03-08"]);
        expect(momentIds(days)).toEqual([["a", "late"], ["b"]]);
    });

    it("puts photos without a time with the photo before them in the stop", () => {
        const days = groupPhotos([
            p("x"),
            p("1", "2024-03-07 10:00:00"),
            p("y"),
            p("2", "2024-03-07 15:00:00"),
            p("z"),
        ]);
        expect(momentIds(days)).toEqual([["1", "x", "y"], ["2", "z"]]);
    });

    it("leaves photos with no times at all as they are", () => {
        expect(groupPhotos([p("a"), p("b")])).toEqual([{ moments: [{ ids: ["a", "b"] }] }]);
        expect(groupPhotos([])).toEqual([]);
    });

    it("takes its thresholds as options", () => {
        const photos = [p("1", "2024-03-07 10:00:00"), p("2", "2024-03-07 10:20:00")];
        expect(momentIds(groupPhotos(photos))).toEqual([["1", "2"]]);
        expect(momentIds(groupPhotos(photos, { minutes: 10 }))).toEqual([["1"], ["2"]]);
    });
});

describe("dayOf", () => {
    it("counts the small hours as the day before", () => {
        expect(dayOf("2024-03-08 03:59:00")).toBe("2024-03-07");
        expect(dayOf("2024-03-08 04:00:00")).toBe("2024-03-08");
        expect(dayOf("2024-03-08 03:00:00", 0)).toBe("2024-03-08");
    });
});
