import { describe, expect, it } from "vitest";
import { emptyHistory, type History, record, redo, undo } from "./history";
import { emptyPlan, newPlace, type Plan } from "./plan";

const start = (): Plan => ({
    ...emptyPlan(1000),
    title: "japan",
    days: [
        { key: "d1", places: [newPlace({ key: "tokyo", place: "Tokyo" }), newPlace({ key: "shibuya", place: "Shibuya Sky" })] },
        { key: "d2", places: [newPlace({ key: "kyoto", place: "Kyoto" })] },
    ],
    ideas: [newPlace({ key: "nara", place: "Nara" })],
});
const keys = (p: Plan) => [p.ideas.map((x) => x.key), ...p.days.map((d) => d.places.map((x) => x.key))];
const find = (p: Plan, key: string) => [...p.ideas, ...p.days.flatMap((d) => d.places)].find((x) => x.key === key);
const editPlace = (p: Plan, key: string, patch: object): Plan => ({
    ...p,
    ideas: p.ideas.map((x) => (x.key === key ? { ...x, ...patch } : x)),
    days: p.days.map((d) => ({ ...d, places: d.places.map((x) => (x.key === key ? { ...x, ...patch } : x)) })),
});
/** Edits `p` with `change`, as the planner does, and records it. */
const edit = (h: History, p: Plan, change: (p: Plan) => Plan, group?: string, at = 0) => {
    const next = change(p);
    return { h: record(h, p, next, group, at), p: next };
};

describe("undo and redo", () => {
    it("undoes and redoes an edit", () => {
        const a = start();
        const { h, p } = edit(emptyHistory(), a, (p) => ({ ...p, days: [...p.days, { key: "d3", places: [] }] }));
        const back = undo(h, p)!;
        expect(back.plan.days.map((d) => d.key)).toEqual(["d1", "d2"]);
        expect(back.history.undo).toHaveLength(0);
        const fwd = redo(back.history, back.plan)!;
        expect(fwd.plan.days.map((d) => d.key)).toEqual(["d1", "d2", "d3"]);
        expect(undo(fwd.history, fwd.plan)).toBeDefined();
        expect(redo(fwd.history, fwd.plan)).toBeUndefined();
    });

    it("undoes steps one at a time, newest first", () => {
        let s = { h: emptyHistory(), p: start() };
        s = edit(s.h, s.p, (p) => ({ ...p, title: "tokyo" }));
        s = edit(s.h, s.p, (p) => ({ ...p, ideas: [] }));
        const one = undo(s.h, s.p)!;
        expect(one.plan.title).toBe("tokyo");
        expect(keys(one.plan)[0]).toEqual(["nara"]);
        const two = undo(one.history, one.plan)!;
        expect(two.plan.title).toBe("japan");
    });

    it("puts a moved place back where it was", () => {
        const a = start();
        const { h, p } = edit(emptyHistory(), a, (p) => ({
            ...p,
            days: [{ ...p.days[0], places: [p.days[0].places[1]] }, { ...p.days[1], places: [...p.days[1].places, p.days[0].places[0]] }],
        }));
        expect(keys(p)).toEqual([["nara"], ["shibuya"], ["kyoto", "tokyo"]]);
        expect(keys(undo(h, p)!.plan)).toEqual([["nara"], ["tokyo", "shibuya"], ["kyoto"]]);
    });

    it("keeps what someone else changed since", () => {
        const a = start();
        const { h, p } = edit(emptyHistory(), a, (p) => editPlace(p, "tokyo", { note: "sushi" }));
        // Someone else, synced in: a new day, a note on another place, and a new idea.
        const synced: Plan = {
            ...editPlace(p, "kyoto", { note: "temples" }),
            days: [...editPlace(p, "kyoto", { note: "temples" }).days, { key: "d3", places: [] }],
            ideas: [...p.ideas, newPlace({ key: "osaka", place: "Osaka" })],
        };
        const back = undo(h, synced)!.plan;
        expect(find(back, "tokyo")!.note).toBe("");
        expect(find(back, "kyoto")!.note).toBe("temples");
        expect(back.days.map((d) => d.key)).toEqual(["d1", "d2", "d3"]);
        expect(keys(back)[0]).toEqual(["nara", "osaka"]);
    });

    it("doesn't undo over someone else's later change to the same thing", () => {
        const { h, p } = edit(emptyHistory(), start(), (p) => ({ ...p, title: "japan 2027" }));
        const synced = { ...p, title: "japan & korea" };
        // Nothing of this phone's is left to undo.
        expect(undo(h, synced)).toBeUndefined();
    });

    it("undoes adding a place that someone has since edited", () => {
        const { h, p } = edit(emptyHistory(), start(), (p) => ({ ...p, ideas: [...p.ideas, newPlace({ key: "osaka", place: "Osaka" })] }));
        const back = undo(h, editPlace(p, "osaka", { note: "food" }))!.plan;
        expect(find(back, "osaka")).toBeUndefined();
    });

    it("brings back a removed day with its places", () => {
        const a = start();
        const { h, p } = edit(emptyHistory(), a, (p) => ({ ...p, days: [p.days[0]], ideas: [...p.ideas, ...p.days[1].places] }));
        expect(keys(p)).toEqual([["nara", "kyoto"], ["tokyo", "shibuya"]]);
        expect(keys(undo(h, p)!.plan)).toEqual([["nara"], ["tokyo", "shibuya"], ["kyoto"]]);
    });

    it("keeps the plan's own bits (export time, sharing)", () => {
        const { h, p } = edit(emptyHistory(), start(), (p) => ({ ...p, title: "x" }));
        const shared = { ...p, exported: 5, shared: { secret: "s", version: 3, base: p, synced: 9 } };
        const back = undo(h, shared)!.plan;
        expect(back.exported).toBe(5);
        expect(back.shared?.version).toBe(3);
    });

    it("undoes a burst of typing in one field as one step", () => {
        let s = { h: emptyHistory(), p: start() };
        for (const [i, t] of ["j", "ja", "jap"].entries()) s = edit(s.h, s.p, (p) => editPlace(p, "tokyo", { note: t }), "note:tokyo", i * 300);
        s = edit(s.h, s.p, (p) => ({ ...p, title: "t" }), "title", 1000);
        expect(s.h.undo).toHaveLength(2);
        // A pause starts a new step.
        s = edit(s.h, s.p, (p) => ({ ...p, title: "to" }), "title", 5000);
        expect(s.h.undo).toHaveLength(3);
        const one = undo(s.h, s.p)!;
        const two = undo(one.history, one.plan)!;
        const three = undo(two.history, two.plan)!;
        expect(two.plan.title).toBe("japan");
        expect(find(three.plan, "tokyo")!.note).toBe("");
    });

    it("forgets what could be redone after a new edit", () => {
        const s = edit(emptyHistory(), start(), (p) => ({ ...p, title: "a" }));
        const back = undo(s.h, s.p)!;
        const after = edit(back.history, back.plan, (p) => ({ ...p, title: "b" }));
        expect(after.h.redo).toHaveLength(0);
    });

    it("records nothing for an edit that changes nothing", () => {
        const a = start();
        expect(record(emptyHistory(), a, { ...a, updated: 5 }).undo).toHaveLength(0);
    });
});
