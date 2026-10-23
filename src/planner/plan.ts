// A planned trip as the planner keeps it, and the trip file it exports.
import YAML from "yaml";
import { formatIssues, type StopInput, type TripInput, TripSchema } from "../../scripts/lib/schema.ts";
import { slugify, tripYaml } from "../../scripts/lib/write.ts";

export interface PlanStop {
    /** Stable key for React while stops are reordered. */
    key: string;
    place: string;
    /** Label on the globe, if different from `place`. */
    name: string;
    /** "YYYY-MM-DD", or "" while not decided. `end` is "" for a one-day stop. */
    start: string;
    end: string;
    /** A side trip from the main stop before it. */
    side: boolean;
    note: string;
    /** Kept from an opened trip file; the planner has no map to set them. */
    lat?: number;
    lng?: number;
}

export interface Plan {
    id: string;
    title: string;
    /** A key from data/bases.yaml or a place name, as in a trip file. */
    from: string;
    to: string;
    country: string;
    stops: PlanStop[];
    /** Milliseconds since 1970. `exported` is unset until the plan is first exported. */
    created: number;
    updated: number;
    exported?: number;
}

const newKey = () => crypto.randomUUID();

export const emptyStop = (after?: PlanStop): PlanStop => ({
    key: newKey(),
    place: "",
    name: "",
    // A new stop usually starts the day the last one ends.
    start: after ? after.end || after.start : "",
    end: "",
    side: false,
    note: "",
});

export const emptyPlan = (now = Date.now()): Plan => ({
    id: newKey(),
    title: "",
    from: "",
    to: "",
    country: "",
    stops: [emptyStop()],
    created: now,
    updated: now,
});

/** A stop's date as a trip file writes it: "2024-03-07", "2024-03-07..2024-03-09", or "" if not set. */
export const stopDate = (s: Pick<PlanStop, "start" | "end">) =>
    s.start && s.end && s.end !== s.start ? `${s.start}..${s.end}` : s.start || s.end;

/** First and last day of the plan, from the stops that have dates. */
export const planDates = (p: Plan) => {
    const days = p.stops.flatMap((s) => [s.start, s.end]).filter(Boolean).sort();
    return days.length ? { start: days[0], end: days[days.length - 1] } : undefined;
};

/** Stops that still need a place or a date before the trip will save in the studio. */
export const unfinished = (p: Plan) => p.stops.filter((s) => s.place.trim() && !s.start).length;

/** The trip file's contents. Stops without a place are left out; empty fields aren't written. */
export const toTrip = (p: Plan): TripInput => {
    const opt = (v: string) => (v.trim() ? v.trim() : undefined);
    const trip = {
        title: p.title.trim() || "planned trip",
        from: opt(p.from),
        to: opt(p.to),
        country: opt(p.country.toLowerCase()),
        stops: p.stops
            .filter((s) => s.place.trim())
            .map(
                (s): StopInput => ({
                    place: s.place.trim(),
                    name: opt(s.name),
                    lat: s.lat,
                    lng: s.lng,
                    date: stopDate(s),
                    side: s.side || undefined,
                    note: s.note.trim() ? s.note.trimEnd() : undefined,
                })
            ),
    };
    return JSON.parse(JSON.stringify(trip)); // drops the undefined fields
};

/** Named as in data/trips/: "2025-05-japan.yaml" (no month until a stop has a date). */
export const fileName = (p: Plan) => {
    const month = planDates(p)?.start.slice(0, 7);
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
    const t = r.data;
    return {
        ...emptyPlan(now),
        title: t.title,
        from: t.from ?? "",
        to: t.to ?? "",
        country: t.country ?? "",
        stops: t.stops.map((s) => {
            const [start = "", end = ""] = s.date.split("..").map((d) => d.trim());
            return {
                ...emptyStop(),
                place: s.place,
                name: s.name ?? "",
                start,
                end: end === start ? "" : end,
                side: s.side === true,
                note: s.note ?? "",
                ...(s.lat !== undefined && s.lng !== undefined ? { lat: s.lat, lng: s.lng } : {}),
            };
        }),
    };
};

/** Changed since it was last exported (or never exported), so only this phone has it. */
export const needsExport = (p: Plan) => p.exported === undefined || p.updated > p.exported;

/** Moves stop `from` so it ends up at index `to`. */
export const moveStop = (stops: PlanStop[], from: number, to: number): PlanStop[] => {
    if (from === to || to < 0 || to >= stops.length) return stops;
    const out = [...stops];
    const [s] = out.splice(from, 1);
    out.splice(to, 0, s);
    return out;
};
