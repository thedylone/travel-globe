// A connector for AI agents (an MCP server, https://modelcontextprotocol.io): tools to read, plan
// and edit shared trips, so an assistant like Claude can plan a trip with you. It's at /mcp, over
// "Streamable HTTP" without sessions: each request is one JSON-RPC message (or a batch), answered
// with JSON.
//
// There are no accounts here either: each tool takes a trip's share link, which is the key to it,
// as it is for a phone. An agent's edit is saved like a phone's: based on the newest version, and
// done again on the newer one if someone saved in between. Places keep their keys, so a phone that
// was changing the trip at the same time merges the two as it does any other edit (merge.ts).
import { addDays, daysBetween, emptyPlan, ISO, newDay, newPlace, setDates } from "../../src/planner/days";
import type { Plan, PlanPlace } from "../../src/planner/plan";
import { type Found, searchPlaces } from "../../src/planner/search";

/** Asks a plan's room (see index.ts): GET the plan, or PUT { version, plan }. */
export type AskRoom = (token: string, id: string | undefined, body?: { version: number; plan: unknown }) => Promise<Response>;

export interface McpOptions {
    ask: AskRoom;
    /** Where share links are, e.g. https://plan.thedylone.com. */
    origin: string;
    /** Looks up places; Photon (search.ts) unless a test gives its own. */
    search?: (q: string, o: { near?: { lat: number; lng: number }; country?: string }) => Promise<Found[]>;
    /** Makes a share code (sync.ts makes them the same way). */
    newCode?: () => string;
}

const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_DAYS = 90;
const MAX_TEXT = 5000;

const INSTRUCTIONS = `Plans trips in the trip planner (travel.thedylone.com/planner/), with the person.

A trip is opened by its share link (like https://plan.thedylone.com/Xk3f9QmT2aLp7RvB), which the person gets from Share in the planner; anyone with it can see and change the trip, so don't post it anywhere. Every tool but create_trip and search_places takes that link. Changes show on the person's phones within about 15 seconds while the trip is open, and merge with what they change at the same time.

A trip has days, in order (day 1 is the first), each with its places in visiting order, and "places to visit" (day 0): ideas not on a day yet. With a start date, day n is start + n - 1, and the number of days sets the end date. A place has an id, which the other tools take; get_trip lists them. A side trip (side: true) is a detour from the main stop before it. Places are looked up on the map (OpenStreetMap) when added without lat/lng: check what was found, and give lat/lng (from search_places) when it's the wrong one.

Read the trip (get_trip) before changing it, and say what you changed. Trips can't be deleted from here.`;

class ToolError extends Error {}

// ---- Reading what tools are given ----

type Args = Record<string, unknown>;

const str = (a: Args, k: string, max = 300): string | undefined => {
    const v = a[k];
    if (v === undefined || v === null) return undefined;
    if (typeof v !== "string") throw new ToolError(`${k} should be text`);
    if (v.length > max) throw new ToolError(`${k} is too long (at most ${max} characters)`);
    return v;
};
const num = (a: Args, k: string, min: number, max: number, whole = false): number | undefined => {
    const v = a[k];
    if (v === undefined || v === null) return undefined;
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max || (whole && !Number.isInteger(v))) throw new ToolError(`${k} should be ${whole ? "a whole number" : "a number"} from ${min} to ${max}`);
    return v;
};
const bool = (a: Args, k: string): boolean | undefined => {
    const v = a[k];
    if (v === undefined || v === null) return undefined;
    if (typeof v !== "boolean") throw new ToolError(`${k} should be true or false`);
    return v;
};
const date = (a: Args, k: string): string | undefined => {
    const v = str(a, k, 10);
    if (v === undefined || v === "") return v;
    if (!ISO.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`)) || new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v) throw new ToolError(`${k} should be a date like 2027-04-03`);
    return v;
};

/** The code (or, from older links, the plan id and secret) in a share link, or a planner "#join=…" link. */
export const readLink = (link: string): { token: string; id?: string } | undefined => {
    const old = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([0-9a-f]{64})/.exec(link);
    if (old) return { id: old[1], token: old[2] };
    const code = /(?:^|[/=#])([A-Za-z0-9_-]{16})(?=$|[/?#&])/.exec(link.trim());
    return code ? { token: code[1] } : undefined;
};

const linkOf = (a: Args) => {
    const link = str(a, "link", 500);
    if (!link) throw new ToolError("link is needed: the trip's share link, from Share in the planner");
    const at = readLink(link);
    if (!at) throw new ToolError("that isn't a share link (it looks like https://plan.thedylone.com/Xk3f9QmT2aLp7RvB)");
    return at;
};

// ---- The trip, as tools show it ----

const showPlace = (x: PlanPlace) => ({
    id: x.key,
    place: x.place,
    ...(x.name ? { name: x.name } : {}),
    ...(x.address ? { address: x.address } : {}),
    ...(x.lat !== undefined && x.lng !== undefined ? { lat: x.lat, lng: x.lng } : { on_map: false }),
    ...(x.side ? { side: true } : {}),
    ...(x.note ? { note: x.note } : {}),
});

const showTrip = (p: Plan, link: string) => ({
    link,
    title: p.title,
    ...(p.from ? { from: p.from } : {}),
    ...(p.to ? { to: p.to } : {}),
    ...(p.country ? { country: p.country } : {}),
    start: p.start || null,
    end: p.start ? addDays(p.start, p.days.length - 1) : null,
    days: p.days.map((d, i) => ({ day: i + 1, ...(p.start ? { date: addDays(p.start, i) } : {}), places: d.places.map(showPlace) })),
    places_to_visit: p.ideas.map(showPlace),
});

// ---- Editing ----

/** Where a place is: day index (-1 for the ideas) and its index there. */
const find = (p: Plan, id: string) => {
    if (p.ideas.some((x) => x.key === id)) return { day: -1, i: p.ideas.findIndex((x) => x.key === id) };
    const day = p.days.findIndex((d) => d.places.some((x) => x.key === id));
    if (day < 0) throw new ToolError(`there's no place with id ${id} on this trip (get_trip lists them)`);
    return { day, i: p.days[day].places.findIndex((x) => x.key === id) };
};

const listOf = (p: Plan, day: number) => (day < 0 ? p.ideas : p.days[day].places);

/** A copy of the plan with day `day`'s list (or the ideas) changed. */
const withList = (p: Plan, day: number, places: PlanPlace[]): Plan =>
    day < 0 ? { ...p, ideas: places } : { ...p, days: p.days.map((d, j) => (j === day ? { ...d, places } : d)) };

/** Day `n` as tools number it (0 for the places to visit), as an index; adds days up to it. */
const dayIndex = (p: Plan, n: number): [Plan, number] => {
    if (n === 0) return [p, -1];
    if (n > MAX_DAYS) throw new ToolError(`a trip has at most ${MAX_DAYS} days`);
    if (n <= p.days.length) return [p, n - 1];
    return [{ ...p, days: [...p.days, ...Array.from({ length: n - p.days.length }, () => newDay())] }, n - 1];
};

const insert = <T>(list: T[], x: T, position: number | undefined) => {
    const at = position === undefined ? list.length : Math.max(0, Math.min(list.length, position - 1));
    return [...list.slice(0, at), x, ...list.slice(at)];
};

/** The place's fields from a tool's arguments; only what was given. */
const placeFields = (a: Args): Partial<PlanPlace> => {
    const out: Partial<PlanPlace> = {};
    const place = str(a, "place", 300);
    if (place !== undefined) {
        if (!place.trim()) throw new ToolError("place can't be empty");
        out.place = place.trim();
    }
    const name = str(a, "name", 100);
    if (name !== undefined) out.name = name.trim();
    const address = str(a, "address", 300);
    if (address !== undefined) out.address = address.trim();
    const note = str(a, "note", MAX_TEXT);
    if (note !== undefined) out.note = note;
    const side = bool(a, "side");
    if (side !== undefined) out.side = side;
    const lat = num(a, "lat", -90, 90);
    const lng = num(a, "lng", -180, 180);
    if ((lat === undefined) !== (lng === undefined)) throw new ToolError("give lat and lng together");
    if (lat !== undefined) Object.assign(out, { lat, lng });
    return out;
};

// ---- The tools ----

const LINK = { type: "string", description: "The trip's share link, e.g. https://plan.thedylone.com/Xk3f9QmT2aLp7RvB" };
const ID = { type: "string", description: "The place's id, from get_trip" };
const DAY = { type: "integer", minimum: 0, maximum: MAX_DAYS, description: "Day number, 1 for the first day; 0 for the places to visit (not on a day yet)" };
const POSITION = { type: "integer", minimum: 1, description: "Where in that day's list, 1 for first; at the end if left out" };
const PLACE_PROPS = {
    place: { type: "string", description: "What it is and where, as you'd search for it, e.g. \"Fushimi Inari Taisha, Kyoto\"" },
    name: { type: "string", description: "A short label for the map, if different from place, e.g. \"Fushimi Inari\"" },
    address: { type: "string", description: "A line saying where it is, e.g. \"Kyoto, Japan\"; filled in by the look-up if left out" },
    lat: { type: "number", minimum: -90, maximum: 90, description: "Latitude; with lng, skips the look-up" },
    lng: { type: "number", minimum: -180, maximum: 180 },
    note: { type: "string", description: "Notes: why go, opening hours, bookings, tips" },
    side: { type: "boolean", description: "A side trip from the main stop before it (a detour you come back from)" },
};
const TRIP_PROPS = {
    title: { type: "string", description: "The trip's name" },
    start: { type: "string", description: "First day, YYYY-MM-DD; \"\" for no dates yet" },
    end: { type: "string", description: "Last day, YYYY-MM-DD. Days are added or taken off the end to match (places on days taken off go to the places to visit)" },
    country: { type: "string", description: "Country codes, comma-separated (e.g. \"jp\" or \"fr,it\"); look-ups stay in them" },
    from: { type: "string", description: "Where the trip starts from, e.g. a home city" },
    to: { type: "string", description: "Where it ends, if not back where it started" },
};
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

export const TOOLS = [
    {
        name: "get_trip",
        title: "Read a trip",
        description: "The trip behind a share link: its dates, its days with their places in order (each with an id), and the places to visit.",
        inputSchema: { type: "object", properties: { link: LINK }, required: ["link"] },
        annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
        name: "create_trip",
        title: "Start a new trip",
        description:
            "Makes a new shared trip and gives its share link. Opening the link on a phone adds the trip to the planner there. Give either end or days for its length; it has 1 day otherwise.",
        inputSchema: {
            type: "object",
            properties: { ...TRIP_PROPS, days: { type: "integer", minimum: 1, maximum: MAX_DAYS, description: "How many days, without dates" } },
            required: ["title"],
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
        name: "update_trip",
        title: "Change a trip's name or dates",
        description:
            "Changes the trip's title, dates, countries, from or to; only what's given. A new start keeps the number of days (so the end moves) unless end is given too.",
        inputSchema: { type: "object", properties: { link: LINK, ...TRIP_PROPS }, required: ["link"] },
        annotations: WRITE,
    },
    {
        name: "add_places",
        title: "Add places",
        description:
            "Adds places to days (or to the places to visit), in the order given. A day past the last one adds days up to it. Places without lat/lng are looked up on the map: check what was found.",
        inputSchema: {
            type: "object",
            properties: {
                link: LINK,
                places: {
                    type: "array",
                    minItems: 1,
                    maxItems: 50,
                    items: { type: "object", properties: { day: DAY, position: POSITION, ...PLACE_PROPS }, required: ["place", "day"] },
                },
            },
            required: ["link", "places"],
        },
        annotations: WRITE,
    },
    {
        name: "update_place",
        title: "Change a place",
        description: "Changes a place's details; only what's given. A new place without lat/lng is looked up again.",
        inputSchema: { type: "object", properties: { link: LINK, id: ID, ...PLACE_PROPS }, required: ["link", "id"] },
        annotations: WRITE,
    },
    {
        name: "move_place",
        title: "Move a place",
        description: "Moves a place to another day, to another spot on its day, or to the places to visit (day 0).",
        inputSchema: { type: "object", properties: { link: LINK, id: ID, day: DAY, position: POSITION }, required: ["link", "id", "day"] },
        annotations: WRITE,
    },
    {
        name: "remove_place",
        title: "Remove a place",
        description: "Takes a place off the trip altogether. To keep it for later, move it to day 0 instead.",
        inputSchema: { type: "object", properties: { link: LINK, id: ID }, required: ["link", "id"] },
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    {
        name: "add_day",
        title: "Add a day",
        description: "Adds an empty day, at the end or before day `before`. With dates, the trip ends a day later and the days after it move a day on.",
        inputSchema: { type: "object", properties: { link: LINK, before: { type: "integer", minimum: 1, description: "The day it goes before; at the end if left out" } }, required: ["link"] },
        annotations: WRITE,
    },
    {
        name: "remove_day",
        title: "Remove a day",
        description: "Removes a day; its places go to the places to visit. The days after it move a day earlier, so the trip ends a day sooner.",
        inputSchema: { type: "object", properties: { link: LINK, day: { type: "integer", minimum: 1, description: "The day to remove" } }, required: ["link", "day"] },
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    {
        name: "move_day",
        title: "Move a day",
        description: "Moves a whole day, with its places, so it becomes day `to`. Dates stay with the positions, so its places take that day's date.",
        inputSchema: { type: "object", properties: { link: LINK, day: { type: "integer", minimum: 1 }, to: { type: "integer", minimum: 1 } }, required: ["link", "day", "to"] },
        annotations: WRITE,
    },
    {
        name: "search_places",
        title: "Look up places",
        description: "Searches the map (OpenStreetMap) for places matching a name, nearest a point first when given. Gives names, addresses and lat/lng to add.",
        inputSchema: {
            type: "object",
            properties: {
                query: { type: "string", description: "e.g. \"ramen Shinjuku\" or \"Louvre\"" },
                near_lat: { type: "number", minimum: -90, maximum: 90 },
                near_lng: { type: "number", minimum: -180, maximum: 180 },
                country: { type: "string", description: "Country codes to keep to, comma-separated, e.g. \"jp\"" },
            },
            required: ["query"],
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
    },
] as const;

interface Saved {
    version: number;
    plan: Plan;
}

/** A change to a trip: the trip before it, to the trip after it. */
type Edit = (p: Plan) => Plan;

export const mcpTools = (o: McpOptions) => {
    const search = o.search ?? searchPlaces;
    const linkFor = (at: { token: string; id?: string }) => (at.id ? `${o.origin}/p/${at.id}.${at.token}` : `${o.origin}/${at.token}`);

    const read = async (at: { token: string; id?: string }): Promise<Saved> => {
        const res = await o.ask(at.token, at.id);
        if (res.status === 404) throw new ToolError("there's no trip at that link (it may have been deleted for everyone)");
        if (res.status === 403) throw new ToolError("that link doesn't open a trip");
        if (!res.ok) throw new Error(`the trip couldn't be read (${res.status})`);
        return res.json();
    };

    /** Saves `edit` done to the newest trip; if someone saves in between, it's done again to theirs. */
    const save = async (at: { token: string; id?: string }, edit: Edit, first?: Saved): Promise<Plan> => {
        let saved = first ?? (await read(at));
        for (let tries = 0; tries < 5; tries++) {
            const plan = { ...edit(saved.plan), updated: Date.now() };
            const res = await o.ask(at.token, at.id, { version: saved.version, plan });
            if (res.ok) return ((await res.json()) as Saved).plan;
            if (res.status === 409) {
                saved = await res.json();
                continue;
            }
            if (res.status === 413) throw new ToolError("the trip would be too big to save; make the notes shorter");
            throw new Error(`the trip couldn't be saved (${res.status})`);
        }
        throw new ToolError("the trip kept changing while saving; try again");
    };

    /** Looks a place up, near the last place on the map before it. */
    const lookUp = async (place: string, p: Plan, near?: { lat: number; lng: number }) => {
        try {
            const found = await search(place, { near, country: p.country || undefined });
            return found[0];
        } catch {
            return undefined;
        }
    };
    const lastOnMap = (places: PlanPlace[]) => places.findLast((x) => x.lat !== undefined && x.lng !== undefined);
    const nearFor = (p: Plan, day: number) => {
        const before = day < 0 ? [...p.days.flatMap((d) => d.places), ...p.ideas] : p.days.slice(0, day + 1).flatMap((d) => d.places);
        const x = lastOnMap(before) ?? lastOnMap([...p.days.flatMap((d) => d.places), ...p.ideas]);
        return x ? { lat: x.lat!, lng: x.lng! } : undefined;
    };
    const lookedUp = (x: PlanPlace, f: Found | undefined) =>
        f ? `"${x.place}" was found as ${f.name}${f.address ? `, ${f.address}` : ""} (${f.lat}, ${f.lng})` : `"${x.place}" wasn't found on the map, so it isn't on it; give lat and lng to put it there`;

    const done = (p: Plan, at: { token: string; id?: string }, notes: string[] = []) => ({ ...(notes.length ? { notes } : {}), trip: showTrip(p, linkFor(at)) });

    const tools: Record<string, (a: Args) => Promise<unknown>> = {
        get_trip: async (a) => {
            const at = linkOf(a);
            return showTrip((await read(at)).plan, linkFor(at));
        },

        create_trip: async (a) => {
            const title = str(a, "title", 200)?.trim();
            if (!title) throw new ToolError("title is needed");
            const start = date(a, "start") ?? "";
            const end = date(a, "end") ?? "";
            const days = num(a, "days", 1, MAX_DAYS, true);
            if (end && !start) throw new ToolError("give start with end");
            if (start && end && end < start) throw new ToolError("end is before start");
            const count = start && end ? Math.min(daysBetween(start, end) + 1, MAX_DAYS) : (days ?? 1);
            const plan: Plan = {
                ...emptyPlan(),
                title,
                start,
                country: str(a, "country", 100)?.trim().toLowerCase() ?? "",
                from: str(a, "from", 200)?.trim() ?? "",
                to: str(a, "to", 200)?.trim() ?? "",
                days: Array.from({ length: count }, () => newDay()),
            };
            const code = (o.newCode ?? newCode)();
            const res = await o.ask(code, undefined, { version: 0, plan });
            if (!res.ok) throw new Error(`the trip couldn't be made (${res.status})`);
            return {
                notes: ["Made. Give the person the link: opening it on their phone adds the trip to the planner, and anyone with it can change the trip."],
                trip: showTrip(((await res.json()) as Saved).plan, linkFor({ token: code })),
            };
        },

        update_trip: async (a) => {
            const at = linkOf(a);
            const title = str(a, "title", 200);
            const country = str(a, "country", 100);
            const from = str(a, "from", 200);
            const to = str(a, "to", 200);
            const start = date(a, "start");
            const end = date(a, "end");
            if (end && start === "") throw new ToolError("a trip without a start can't have an end");
            const p = await save(at, (p) => {
                let next = { ...p };
                if (title !== undefined) next.title = title.trim();
                if (country !== undefined) next.country = country.trim().toLowerCase();
                if (from !== undefined) next.from = from.trim();
                if (to !== undefined) next.to = to.trim();
                if (start !== undefined || end !== undefined) {
                    const s = start ?? next.start;
                    if (!s) throw new ToolError("the trip has no dates yet: give start too");
                    const e = end ?? addDays(s, next.days.length - 1);
                    if (e < s) throw new ToolError("end is before start");
                    if (daysBetween(s, e) + 1 > MAX_DAYS) throw new ToolError(`a trip has at most ${MAX_DAYS} days`);
                    next = setDates(next, s, s ? e : "");
                }
                return next;
            });
            return done(p, at);
        },

        add_places: async (a) => {
            const at = linkOf(a);
            const list = a.places;
            if (!Array.isArray(list) || !list.length) throw new ToolError("places should be a list of places to add");
            if (list.length > 50) throw new ToolError("at most 50 places at a time");
            const adds = list.map((x, n) => {
                if (!x || typeof x !== "object") throw new ToolError(`places[${n}] should be a place`);
                const fields = placeFields(x as Args);
                if (!fields.place) throw new ToolError(`places[${n}] needs a place`);
                const day = num(x as Args, "day", 0, MAX_DAYS, true);
                if (day === undefined) throw new ToolError(`places[${n}] needs a day (0 for the places to visit)`);
                return { place: newPlace(fields), day, position: num(x as Args, "position", 1, 1000, true) };
            });

            // Look up the places not on the map yet, one after another, each near the one before.
            const first = await read(at);
            let draft = first.plan;
            const notes: string[] = [];
            for (const x of adds) {
                let i: number;
                [draft, i] = dayIndex(draft, x.day);
                if (x.place.lat === undefined) {
                    const f = await lookUp(x.place.place, draft, nearFor(draft, i));
                    if (f) Object.assign(x.place, { lat: f.lat, lng: f.lng, address: x.place.address || f.address });
                    notes.push(lookedUp(x.place, f));
                }
                draft = withList(draft, i, insert(listOf(draft, i), x.place, x.position));
            }

            const p = await save(
                at,
                (p) => {
                    let next = p;
                    for (const x of adds) {
                        let i: number;
                        [next, i] = dayIndex(next, x.day);
                        next = withList(next, i, insert(listOf(next, i), x.place, x.position));
                    }
                    return next;
                },
                first
            );
            return done(p, at, notes);
        },

        update_place: async (a) => {
            const at = linkOf(a);
            const id = str(a, "id", 100) ?? "";
            const fields = placeFields(a);
            const first = await read(at);
            const { day } = find(first.plan, id);
            const notes: string[] = [];
            if (fields.place !== undefined && fields.lat === undefined) {
                const was = listOf(first.plan, day).find((x) => x.key === id)!;
                if (fields.place !== was.place) {
                    const f = await lookUp(fields.place, first.plan, nearFor(first.plan, day));
                    if (f) Object.assign(fields, { lat: f.lat, lng: f.lng, ...(fields.address === undefined ? { address: f.address } : {}) });
                    notes.push(lookedUp({ ...was, ...fields }, f));
                }
            }
            const p = await save(
                at,
                (p) => {
                    const { day, i } = find(p, id);
                    const list = [...listOf(p, day)];
                    const next: PlanPlace = { ...list[i], ...fields };
                    // Typed again and not found: it's no longer where the old one was.
                    if (fields.place !== undefined && fields.place !== list[i].place && fields.lat === undefined) {
                        delete next.lat;
                        delete next.lng;
                    }
                    list[i] = next;
                    return withList(p, day, list);
                },
                first
            );
            return done(p, at, notes);
        },

        move_place: async (a) => {
            const at = linkOf(a);
            const id = str(a, "id", 100) ?? "";
            const to = num(a, "day", 0, MAX_DAYS, true);
            if (to === undefined) throw new ToolError("day is needed (0 for the places to visit)");
            const position = num(a, "position", 1, 1000, true);
            const p = await save(at, (p) => {
                const { day, i } = find(p, id);
                const x = listOf(p, day)[i];
                const out = withList(p, day, listOf(p, day).filter((_, j) => j !== i));
                const [next, target] = dayIndex(out, to);
                return withList(next, target, insert(listOf(next, target), x, position));
            });
            return done(p, at);
        },

        remove_place: async (a) => {
            const at = linkOf(a);
            const id = str(a, "id", 100) ?? "";
            const p = await save(at, (p) => {
                const { day } = find(p, id);
                return withList(p, day, listOf(p, day).filter((x) => x.key !== id));
            });
            return done(p, at);
        },

        add_day: async (a) => {
            const at = linkOf(a);
            const before = num(a, "before", 1, MAX_DAYS, true);
            const p = await save(at, (p) => {
                if (p.days.length >= MAX_DAYS) throw new ToolError(`a trip has at most ${MAX_DAYS} days`);
                return { ...p, days: insert(p.days, newDay(), before) };
            });
            return done(p, at);
        },

        remove_day: async (a) => {
            const at = linkOf(a);
            const day = num(a, "day", 1, MAX_DAYS, true);
            if (day === undefined) throw new ToolError("day is needed");
            const p = await save(at, (p) => {
                if (day > p.days.length) throw new ToolError(`the trip has ${p.days.length} days`);
                if (p.days.length === 1) throw new ToolError("a trip keeps at least one day");
                const places = p.days[day - 1].places;
                return { ...p, days: p.days.filter((_, j) => j !== day - 1), ideas: [...p.ideas, ...places] };
            });
            return done(p, at);
        },

        move_day: async (a) => {
            const at = linkOf(a);
            const day = num(a, "day", 1, MAX_DAYS, true);
            const to = num(a, "to", 1, MAX_DAYS, true);
            if (day === undefined || to === undefined) throw new ToolError("day and to are needed");
            const p = await save(at, (p) => {
                if (day > p.days.length || to > p.days.length) throw new ToolError(`the trip has ${p.days.length} days`);
                const days = [...p.days];
                const [d] = days.splice(day - 1, 1);
                days.splice(to - 1, 0, d);
                return { ...p, days };
            });
            return done(p, at);
        },

        search_places: async (a) => {
            const query = str(a, "query", 200)?.trim();
            if (!query) throw new ToolError("query is needed");
            const lat = num(a, "near_lat", -90, 90);
            const lng = num(a, "near_lng", -180, 180);
            const country = str(a, "country", 100);
            try {
                return { results: await search(query, { near: lat !== undefined && lng !== undefined ? { lat, lng } : undefined, country }) };
            } catch {
                throw new ToolError("the map search isn't answering; try again in a moment");
            }
        },
    };
    return tools;
};

/** A share code: 16 characters of base64url, 96 random bits (as sync.ts makes them). */
const newCode = () =>
    btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(12))))
        .replace(/\+/g, "-")
        .replace(/\//g, "_");

// ---- JSON-RPC ----

interface RpcRequest {
    jsonrpc?: string;
    id?: string | number | null;
    method?: unknown;
    params?: Record<string, unknown>;
}

const rpcError = (id: RpcRequest["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/** One JSON-RPC message's answer, or undefined for a notification. */
export const answer = async (msg: RpcRequest, o: McpOptions): Promise<object | undefined> => {
    if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcError(msg?.id, -32600, "invalid request");
    const notification = msg.id === undefined;
    const ok = (result: unknown) => (notification ? undefined : { jsonrpc: "2.0", id: msg.id, result });
    switch (msg.method) {
        case "initialize": {
            const asked = msg.params?.protocolVersion;
            return ok({
                protocolVersion: typeof asked === "string" && VERSIONS.includes(asked) ? asked : VERSIONS[0],
                capabilities: { tools: { listChanged: false } },
                serverInfo: { name: "trip-planner", title: "Trip planner", version: "1.0.0" },
                instructions: INSTRUCTIONS,
            });
        }
        case "ping":
            return ok({});
        case "tools/list":
            return ok({ tools: TOOLS });
        case "tools/call": {
            const name = msg.params?.name;
            const tool = typeof name === "string" ? mcpTools(o)[name] : undefined;
            if (!tool) return notification ? undefined : rpcError(msg.id, -32602, `no tool called ${String(name)}`);
            const args = msg.params?.arguments;
            try {
                const result = await tool(args && typeof args === "object" ? (args as Args) : {});
                return ok({ content: [{ type: "text", text: JSON.stringify(result, null, 1) }], structuredContent: result });
            } catch (e) {
                // A ToolError is something the agent can fix; anything else is this server's fault.
                const text = e instanceof ToolError ? e.message : `something went wrong on the server: ${(e as Error).message}`;
                return ok({ content: [{ type: "text", text }], isError: true });
            }
        }
        default:
            if (notification) return undefined; // notifications/initialized and the like
            return rpcError(msg.id, -32601, `no method ${msg.method}`);
    }
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

/** POST /mcp: one message or a batch, answered with JSON (or 202 when it was only notifications). */
export const handleMcp = async (request: Request, o: McpOptions): Promise<Response> => {
    if (request.method !== "POST") return new Response(JSON.stringify({ error: "POST JSON-RPC messages here" }), { status: 405, headers: { Allow: "POST", "Content-Type": "application/json" } });
    let body: unknown;
    try {
        const text = await request.text();
        if (text.length > 256 * 1024) return json(rpcError(null, -32600, "too big"), 413);
        body = JSON.parse(text);
    } catch {
        return json(rpcError(null, -32700, "not JSON"), 400);
    }
    if (Array.isArray(body)) {
        if (!body.length || body.length > 20) return json(rpcError(null, -32600, "a batch has 1 to 20 messages"), 400);
        const out = (await Promise.all(body.map((m) => answer(m, o)))).filter(Boolean);
        return out.length ? json(out) : new Response(null, { status: 202 });
    }
    const out = await answer(body as RpcRequest, o);
    return out ? json(out) : new Response(null, { status: 202 });
};
