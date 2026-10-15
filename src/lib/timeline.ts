import type { Trip } from "../types";
import { yearOf } from "./dates";

const DAY_MS = 86_400_000;
const utc = (iso: string) => Date.parse(iso + "T00:00:00Z");

export const daysInYear = (year: number) => ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365);

/** 0-based day of the year. */
export const dayOfYear = (iso: string) => Math.round((utc(iso) - Date.UTC(yearOf(iso), 0, 1)) / DAY_MS);

/** Day of the year each month starts on. */
export const monthStarts = (year: number) => Array.from({ length: 12 }, (_, m) => Math.round((Date.UTC(year, m, 1) - Date.UTC(year, 0, 1)) / DAY_MS));

export interface Segment {
    trip: Trip;
    /** Inclusive, 0-based days of the year. */
    startDay: number;
    endDay: number;
    /** Row within the year, so overlapping trips don't cover each other. */
    lane: number;
    /** The trip carries on from the previous year / into the next one. */
    fromPrevYear: boolean;
    intoNextYear: boolean;
}

export interface YearRow {
    year: number;
    days: number;
    lanes: number;
    segments: Segment[];
}

/** Bars this many days apart still go in separate lanes, so they don't touch. */
const LANE_GAP_DAYS = 2;

/**
 * One row per year (newest first, empty years included) with each trip as a bar.
 * Trips over New Year are split into a bar in each year.
 */
export const timelineRows = (trips: Trip[]): YearRow[] => {
    if (!trips.length) return [];
    const first = Math.min(...trips.map((t) => yearOf(t.start)));
    const last = Math.max(...trips.map((t) => yearOf(t.end)));
    const rows: YearRow[] = [];
    for (let year = last; year >= first; year--) {
        const days = daysInYear(year);
        const segments: Omit<Segment, "lane">[] = trips.flatMap((trip) => {
            const sy = yearOf(trip.start), ey = yearOf(trip.end);
            if (year < sy || year > ey) return [];
            return [{
                trip,
                startDay: year === sy ? dayOfYear(trip.start) : 0,
                endDay: year === ey ? dayOfYear(trip.end) : days - 1,
                fromPrevYear: year > sy,
                intoNextYear: year < ey,
            }];
        });
        segments.sort((a, b) => a.startDay - b.startDay || b.endDay - a.endDay);
        const laneEnds: number[] = [];
        const placed = segments.map((s) => {
            let lane = laneEnds.findIndex((end) => end + LANE_GAP_DAYS < s.startDay);
            if (lane < 0) lane = laneEnds.length;
            laneEnds[lane] = s.endDay;
            return { ...s, lane };
        });
        rows.push({ year, days, lanes: Math.max(1, laneEnds.length), segments: placed });
    }
    return rows;
};

/** Number of distinct days spent on these trips. */
export const daysAway = (trips: Trip[]) => {
    const days = new Set<number>();
    for (const t of trips) for (let d = utc(t.start); d <= utc(t.end); d += DAY_MS) days.add(d);
    return days.size;
};
