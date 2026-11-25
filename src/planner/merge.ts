// Merging two copies of a shared plan that were both changed since they last agreed. Each phone
// keeps the copy it last synced (the "base"), so a merge can tell what each side changed: a change
// on one side is kept, and when both changed the same thing, this phone's version wins.
// Places are matched by their key, so one person can edit a note while the other adds a day.
import type { Plan, PlanDay, PlanPlace } from "./plan";

/** What's shared: the plan without what only this phone keeps. */
export type PlanContent = Omit<Plan, "exported" | "shared">;

export const content = (p: Plan): PlanContent => {
    const { exported: _e, shared: _s, ...rest } = p;
    return rest;
};

/** Same contents, ignoring when it was last changed. */
export const sameContent = (a: PlanContent, b: PlanContent) => {
    const strip = ({ updated: _u, ...rest }: PlanContent) => rest;
    return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
};

const IDEAS = "ideas";
type Lists = Map<string, string[]>;

/** Each list of places (a day, by its key, or the ideas) as the keys of its places, in order. */
const lists = (p: PlanContent): Lists => new Map([[IDEAS, p.ideas.map((x) => x.key)], ...p.days.map((d) => [d.key, d.places.map((x) => x.key)] as [string, string[]])]);

const places = (p: PlanContent) => new Map([...p.ideas, ...p.days.flatMap((d) => d.places)].map((x) => [x.key, x]));

/** The list each place is in. */
const where = (l: Lists) => new Map([...l].flatMap(([list, keys]) => keys.map((k) => [k, list] as [string, string])));

const same = <T>(a: T, b: T) => JSON.stringify(a) === JSON.stringify(b);

/** One value: whichever side changed it, this phone's if both did. */
const pick = <T>(base: T | undefined, mine: T, theirs: T) => (same(mine, base) ? theirs : mine);

/** A list of keys merged: the order from the side that changed it, with what the other side added at the end. */
const mergeOrder = (base: string[], mine: string[], theirs: string[], keep: (k: string) => boolean) => {
    const [first, other] = same(mine, base) ? [theirs, mine] : [mine, theirs];
    return [...new Set([...first, ...other])].filter(keep);
};

const mergePlace = (base: PlanPlace | undefined, mine: PlanPlace | undefined, theirs: PlanPlace | undefined): PlanPlace | undefined => {
    // Added on one side only, or removed on one side (a removal wins over an edit).
    if (!mine || !theirs) return base ? undefined : (mine ?? theirs);
    if (!base) return mine;
    const fields = [...new Set([...Object.keys(mine), ...Object.keys(theirs)])] as (keyof PlanPlace)[];
    const out: Record<string, unknown> = {};
    for (const f of fields) {
        const v = pick(base[f], mine[f], theirs[f]);
        if (v !== undefined) out[f] = v;
    }
    // The location comes from one side as a whole, so lat and lng always belong together.
    const loc = same([mine.lat, mine.lng], [base.lat, base.lng]) ? theirs : mine;
    delete out.lat;
    delete out.lng;
    if (loc.lat !== undefined && loc.lng !== undefined) Object.assign(out, { lat: loc.lat, lng: loc.lng });
    return out as unknown as PlanPlace;
};

/**
 * `mine` and `theirs` merged, given `base`, the copy they both started from. A place removed on
 * one side is removed; a place on a day the other side removed goes to the ideas, so nothing new
 * is lost.
 */
export const merge = (base: PlanContent, mine: PlanContent, theirs: PlanContent): PlanContent => {
    const [pb, pm, pt] = [places(base), places(mine), places(theirs)];
    const [lb, lm, lt] = [lists(base), lists(mine), lists(theirs)];
    const [wb, wm, wt] = [where(lb), where(lm), where(lt)];

    // The days, in order. A day lives while both sides still have it (or one side added it).
    const dayKeys = (p: PlanContent) => p.days.map((d) => d.key);
    const [db, dm, dt] = [new Set(dayKeys(base)), new Set(dayKeys(mine)), new Set(dayKeys(theirs))];
    const keepDay = (k: string) => (db.has(k) ? dm.has(k) && dt.has(k) : dm.has(k) || dt.has(k));
    let days = mergeOrder(dayKeys(base), dayKeys(mine), dayKeys(theirs), keepDay);
    if (!days.length) days = [dayKeys(mine)[0] ?? dayKeys(theirs)[0]];

    // Each place, and the list it ends up in.
    const merged = new Map<string, PlanPlace>();
    const target = new Map<string, string>();
    for (const key of new Set([...pb.keys(), ...pm.keys(), ...pt.keys()])) {
        const x = mergePlace(pb.get(key), pm.get(key), pt.get(key));
        if (!x) continue;
        merged.set(key, x);
        const list = pm.has(key) && pt.has(key) ? (wm.get(key) === wb.get(key) ? wt.get(key)! : wm.get(key)!) : (wm.get(key) ?? wt.get(key)!);
        target.set(key, list === IDEAS || days.includes(list) ? list : IDEAS);
    }

    const order = (list: string) => {
        const inList = (k: string) => target.get(k) === list;
        const keys = mergeOrder(lb.get(list) ?? [], lm.get(list) ?? [], lt.get(list) ?? [], inList);
        // Places that moved here from a list that has gone.
        const rest = [...target].filter(([k, l]) => l === list && !keys.includes(k)).map(([k]) => k);
        return [...keys, ...rest].map((k) => merged.get(k)!);
    };

    const ideas = order(IDEAS);
    const day = (key: string): PlanDay => ({ key, places: order(key) });
    return {
        ...mine,
        title: pick(base.title, mine.title, theirs.title),
        from: pick(base.from, mine.from, theirs.from),
        to: pick(base.to, mine.to, theirs.to),
        country: pick(base.country, mine.country, theirs.country),
        start: pick(base.start, mine.start, theirs.start),
        days: days.map(day),
        ideas,
        created: Math.min(mine.created, theirs.created),
        updated: Math.max(mine.updated, theirs.updated),
    };
};
