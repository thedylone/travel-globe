// Making plans, days and places, and the trip's dates: the bits of plan.ts with no imports, so the
// sync server (worker/) can edit plans the same way the planner does.
import type { Booking, Plan, PlanDay, PlanPlace } from "./plan";

export const newKey = () => crypto.randomUUID();

export const newPlace = (patch: Partial<PlanPlace> = {}): PlanPlace => ({
    key: newKey(),
    place: "",
    name: "",
    side: false,
    note: "",
    ...patch,
});

export const newBooking = (kind: Booking["kind"], patch: Partial<Booking> = {}): Booking => ({
    key: newKey(),
    kind,
    name: "",
    start: "",
    end: "",
    time: "",
    arrive: "",
    from: "",
    to: "",
    note: "",
    ...patch,
});

export const newDay = (places: PlanPlace[] = []): PlanDay => ({ key: newKey(), places });

export const emptyPlan = (now = Date.now()): Plan => ({
    id: newKey(),
    title: "",
    from: "",
    to: "",
    country: "",
    start: "",
    days: [newDay()],
    ideas: [],
    created: now,
    updated: now,
});

export const ISO = /^\d{4}-\d\d-\d\d$/;

/** "2026-12-30" + 3 -> "2027-01-02". */
export const addDays = (iso: string, n: number) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
};

/** Days from `a` to `b`. */
export const daysBetween = (a: string, b: string) =>
    Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Day `i`'s date, or "" when the trip has no dates yet. */
export const dayDate = (p: Pick<Plan, "start">, i: number) => (ISO.test(p.start) ? addDays(p.start, i) : "");

/** The last day's date, or "". */
export const endDate = (p: Pick<Plan, "start" | "days">) => dayDate(p, Math.max(0, p.days.length - 1));

/**
 * The trip's dates set to `start`..`end`. Days keep their places in order; days dropped off the
 * end send their places to the ideas, so nothing is lost.
 */
export const setDates = (p: Plan, start: string, end: string): Plan => {
    if (!ISO.test(start)) return { ...p, start: "" };
    const count = ISO.test(end) && end >= start ? Math.min(daysBetween(start, end) + 1, 90) : p.days.length;
    const kept = p.days.slice(0, count);
    const dropped = p.days.slice(count).flatMap((d) => d.places);
    return {
        ...p,
        start,
        days: [...kept, ...Array.from({ length: count - kept.length }, () => newDay())],
        ideas: [...p.ideas, ...dropped],
    };
};


const MAX_DAYS = 90;

/**
 * What's booked on day `i`: the hotel slept in the night before (`morning`), the flights that day,
 * and the hotel for that night (`night`). Nothing on a trip without dates.
 */
export const bookingsOn = (p: Pick<Plan, "start" | "bookings">, i: number) => {
    const d = dayDate(p, i);
    const all = p.bookings ?? [];
    const hotels = all.filter((b) => b.kind === "hotel" && ISO.test(b.start) && ISO.test(b.end) && b.end > b.start);
    return {
        morning: d ? hotels.filter((b) => b.start < d && d <= b.end) : [],
        flights: d ? all.filter((b) => b.kind === "flight" && b.start === d) : [],
        night: d ? hotels.filter((b) => b.start <= d && d < b.end) : [],
    };
};

/**
 * The trip's days grown to cover every booking's dates: days are added at the start (so the days
 * already planned keep their dates) or the end. A trip without dates starts on the first booking.
 */
export const coverBookings = (p: Plan): Plan => {
    const dates = (p.bookings ?? []).flatMap((b) => [b.start, b.end]).filter((d) => ISO.test(d)).sort();
    if (!dates.length) return p;
    const [first, last] = [dates[0], dates[dates.length - 1]];
    if (!ISO.test(p.start)) {
        const count = Math.min(Math.max(p.days.length, daysBetween(first, last) + 1), MAX_DAYS);
        return { ...p, start: first, days: [...p.days, ...Array.from({ length: count - p.days.length }, () => newDay())] };
    }
    const before = Math.max(0, Math.min(daysBetween(first, p.start), MAX_DAYS - p.days.length));
    const start = addDays(p.start, -before);
    const days = [...Array.from({ length: before }, () => newDay()), ...p.days];
    const after = Math.max(0, Math.min(daysBetween(addDays(start, days.length - 1), last), MAX_DAYS - days.length));
    if (!before && !after) return p;
    return { ...p, start, days: [...days, ...Array.from({ length: after }, () => newDay())] };
};
