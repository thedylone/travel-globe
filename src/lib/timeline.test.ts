import { describe, expect, it } from "vitest";
import type { Trip } from "../types";
import { dayOfYear, daysAway, timelineRows } from "./timeline";

const trip = (id: string, start: string, end = start): Trip => ({
    id, title: id, start, end, stops: [{ name: id, lat: 0, lng: 0, start, end, media: [] }],
});

describe("timeline", () => {
    it("has a row per year, newest first, including empty years", () => {
        const rows = timelineRows([trip("a", "2019-12-22", "2019-12-30"), trip("b", "2022-03-01")]);
        expect(rows.map((r) => r.year)).toEqual([2022, 2021, 2020, 2019]);
        expect(rows[1].segments).toEqual([]);
    });

    it("splits trips over New Year into a bar in each year", () => {
        const rows = timelineRows([trip("ny", "2018-12-24", "2019-01-04")]);
        const [y2019, y2018] = rows;
        expect(y2018.segments[0]).toMatchObject({ startDay: dayOfYear("2018-12-24"), endDay: 364, intoNextYear: true, fromPrevYear: false });
        expect(y2019.segments[0]).toMatchObject({ startDay: 0, endDay: 3, fromPrevYear: true, intoNextYear: false });
    });

    it("puts overlapping trips in separate lanes", () => {
        const [row] = timelineRows([
            trip("a", "2024-03-01", "2024-03-10"),
            trip("b", "2024-03-05", "2024-03-06"),
            trip("c", "2024-04-01"),
        ]);
        const lane = Object.fromEntries(row.segments.map((s) => [s.trip.id, s.lane]));
        expect(lane).toEqual({ a: 0, b: 1, c: 0 });
        expect(row.lanes).toBe(2);
    });

    it("handles leap years", () => {
        expect(dayOfYear("2024-12-31")).toBe(365);
        expect(timelineRows([trip("x", "2024-06-01")])[0].days).toBe(366);
    });

    it("counts days away without double-counting overlaps", () => {
        expect(daysAway([trip("a", "2024-03-01", "2024-03-03"), trip("b", "2024-03-03", "2024-03-04")])).toBe(4);
    });
});
