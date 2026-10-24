// A planned trip as the planner keeps it (a list of days, each with its places), and the trip
// file it exports.
import YAML from "yaml";
import { formatIssues, type StopInput, type TripInput, TripSchema } from "../../scripts/lib/schema.ts";
import { slugify, tripYaml } from "../../scripts/lib/write.ts";

export interface PlanPlace {
    /** Stable key for React while places are reordered. */
    key: string;
    /** The place's name, as found by the search or typed. Written as `place` in the trip file. */
    place: string;
    /** Label on the globe, if different from `place`. */
    name: string;
    /** Where it is, from the search (or an opened trip file). Unset if it was typed without searching. */
    lat?: number;
    lng?: number;
    /** A line saying where it is, e.g. "Kyoto, Japan". Only shown in the planner. */
    address?: string;
    /** A side trip from the main stop before it. */
    side: boolean;
    note: string;
}

export interface PlanDay {
    key: string;
    places: PlanPlace[];
}

export interface Plan {
    id: string;
    title: string;
    /** A key from data/bases.yaml or a place name, as in a trip file. */
    from: string;
    to: string;
    country: string;
    /** The first day, "YYYY-MM-DD", or "" until it's decided; day n is `start` + n. */
    start: string;
    days: PlanDay[];
    /** Places you might go, not on a day yet. Not exported. */
    ideas: PlanPlace[];
    /** Milliseconds since 1970. `exported` is unset until the plan is first exported. */
    created: number;
    updated: number;
    exported?: number;
}

const newKey = () => crypto.randomUUID();

export const newPlace = (patch: Partial<PlanPlace> = {}): PlanPlace => ({
    key: newKey(),
    place: "",
    name: "",
    side: false,
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

const ISO = /^\d{4}-\d\d-\d\d$/;

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

/** Every place on a day, with where it is in the plan. */
export const scheduled = (p: Plan) => p.days.flatMap((d, day) => d.places.map((place, i) => ({ place, day, i })));

/** Places that still need a date before the trip will save in the studio (the trip has none yet). */
export const unfinished = (p: Plan) => (p.start ? 0 : scheduled(p).length);

/**
 * Stops in the trip file: a place per day, in order, with a place on consecutive days (a stay) as one
 * stop where it first appears.
 */
export const toTrip = (p: Plan): TripInput => {
    const opt = (v: string) => (v.trim() ? v.trim() : undefined);
    const stops: (StopInput & { day: number })[] = [];
    p.days.forEach((d, day) => {
        for (const x of d.places.filter((x) => x.place.trim())) {
            const date = dayDate(p, day);
            // The same place was on the day before: the stay goes on.
            const prev = stops.find((s) => s.day === day - 1 && s.place === x.place.trim() && s.lat === x.lat && s.lng === x.lng);
            if (prev) {
                prev.day = day;
                if (date) prev.date = `${prev.date.split("..")[0]}..${date}`;
                const note = x.note.trim();
                if (note) prev.note = prev.note ? `${prev.note}\n\n${note}` : note;
                continue;
            }
            stops.push({
                place: x.place.trim(),
                name: opt(x.name),
                lat: x.lat,
                lng: x.lng,
                date,
                side: x.side || undefined,
                note: x.note.trim() || undefined,
                day,
            });
        }
    });
    const trip = {
        title: p.title.trim() || "planned trip",
        from: opt(p.from),
        to: opt(p.to),
        country: opt(p.country.toLowerCase()),
        stops: stops.map(({ day: _, ...s }) => s),
    };
    return JSON.parse(JSON.stringify(trip)); // drops the undefined fields
};

/** Named as in data/trips/: "2025-05-japan.yaml" (no month until the trip has dates). */
export const fileName = (p: Plan) => {
    const month = p.start.slice(0, 7);
    return `${month ? `${month}-` : ""}${slugify(p.title || "planned trip")}.yaml`;
};

export const toYaml = (p: Plan, today = new Date().toISOString().slice(0, 10)) =>
    tripYaml(
        toTrip(p),
        `Planned in the trip planner, exported ${today}.\n` +
            "Open it in the studio (Open a planned trip) to look up the places and add photos,\n" +
            "or put it in data/trips/ as it is."
    );

/**
 * A plan from a trip's stops: each stop goes on every day it covers, so a stay comes back out
 * as the same stop. Stops without a date go to the ideas.
 */
export const fromTrip = (t: TripInput, now = Date.now()): Plan => {
    const ranges = t.stops.map((s) => {
        const [a = "", b = a] = s.date.split("..").map((d) => d.trim());
        return ISO.test(a) ? { s, a, b: ISO.test(b) && b >= a ? b : a } : { s, a: "", b: "" };
    });
    const days = ranges.flatMap((r) => (r.a ? [r.a, r.b] : [])).sort();
    const start = days[0] ?? "";
    const count = start ? Math.min(daysBetween(start, days[days.length - 1]) + 1, 90) : 1;
    const plan: Plan = {
        ...emptyPlan(now),
        title: t.title,
        from: t.from ?? "",
        to: t.to ?? "",
        country: t.country ?? "",
        start,
        days: Array.from({ length: count }, () => newDay()),
    };
    for (const r of ranges) {
        const { s } = r;
        const place = (note: string) =>
            newPlace({
                place: s.place,
                name: s.name ?? "",
                side: s.side === true,
                note,
                ...(s.lat !== undefined && s.lng !== undefined ? { lat: s.lat, lng: s.lng } : {}),
            });
        if (!r.a || daysBetween(start, r.a) >= count) {
            plan.ideas.push(place(s.note ?? ""));
            continue;
        }
        const first = daysBetween(start, r.a);
        const last = Math.min(daysBetween(start, r.b), count - 1);
        // The note goes on the first day only, so it isn't repeated on the way back out.
        for (let d = first; d <= last; d++) plan.days[d].places.push(place(d === first ? (s.note ?? "") : ""));
    }
    return plan;
};

/**
 * A plan from a trip file: one the planner exported, or any file from data/trips/.
 * Photos aren't kept, as the planner doesn't show them. Throws with a readable message.
 */
export const fromYaml = (text: string, now = Date.now()): Plan => {
    let raw: unknown;
    try {
        raw = YAML.parse(text);
    } catch (e) {
        throw new Error(`this isn't a trip file: ${(e as Error).message}`);
    }
    // Planned stops may not have dates yet, so check everything else.
    const stops = (raw as { stops?: unknown })?.stops;
    const withDates = Array.isArray(stops)
        ? { ...(raw as object), stops: stops.map((s) => ({ date: "", ...(s as object) })) }
        : raw;
    const r = TripSchema.safeParse(withDates);
    if (!r.success) throw new Error(`this isn't a trip file: ${formatIssues(r.error).join("; ")}`);
    return fromTrip(r.data, now);
};

/**
 * A plan as read back from storage. Plans saved before the planner had days (a list of stops,
 * each with its own dates) are rebuilt from their stops.
 */
export const upgrade = (raw: Plan | (Omit<Plan, "days" | "ideas" | "start"> & { stops: OldStop[] })): Plan => {
    if (!("stops" in raw)) return raw;
    const { stops, ...rest } = raw;
    const trip = {
        title: raw.title || "planned trip",
        stops: stops.map((s) => ({
            place: s.place || "?",
            name: s.name || undefined,
            lat: s.lat,
            lng: s.lng,
            date: s.start && s.end && s.end !== s.start ? `${s.start}..${s.end}` : s.start || "",
            side: s.side || undefined,
            note: s.note || undefined,
        })),
    };
    const p = fromTrip(trip, raw.created);
    return { ...rest, start: p.start, days: p.days, ideas: p.ideas };
};
interface OldStop {
    place: string;
    name: string;
    start: string;
    end: string;
    side: boolean;
    note: string;
    lat?: number;
    lng?: number;
}

/** Changed since it was last exported (or never exported), so only this phone has it. */
export const needsExport = (p: Plan) => p.exported === undefined || p.updated > p.exported;

/** Moves item `from` so it ends up at index `to`. */
export const move = <T>(list: T[], from: number, to: number): T[] => {
    if (from === to || to < 0 || to >= list.length) return list;
    const out = [...list];
    const [x] = out.splice(from, 1);
    out.splice(to, 0, x);
    return out;
};

/** One colour per day, as on the map. Hues step by the golden angle so neighbouring days differ. */
export const dayColor = (day: number) => `hsl(${Math.round((day * 137.508 + 205) % 360)}, 80%, 58%)`;
