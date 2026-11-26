// Undo and redo in the planner. Each step keeps the plan as it was before and after one of
// this phone's edits. Undoing doesn't put the old plan back as it was: it merges the step back
// out of the plan as it is now (with the three-way merge that syncing uses), so what someone
// else changed since on a shared plan, or an AI agent through the trip connector, stays.
import { content, merge, type PlanContent, sameContent } from "./merge";
import type { Plan } from "./plan";

export interface Step {
    before: PlanContent;
    after: PlanContent;
    /** What was edited, e.g. "title" or "note:<place key>": typing in one field is one step. */
    group?: string;
    at: number;
}

export interface History {
    undo: Step[];
    redo: Step[];
}

export const emptyHistory = (): History => ({ undo: [], redo: [] });

/** How many steps are kept, and how long a pause in typing ends a step. */
const KEEP = 100;
const TYPING = 1500;

/** The history with an edit from `before` to `after` added; a new edit clears what could be redone. */
export const record = (h: History, before: Plan, after: Plan, group?: string, now = Date.now()): History => {
    const step: Step = { before: content(before), after: content(after), group, at: now };
    if (sameContent(step.before, step.after)) return h;
    const last = h.undo[h.undo.length - 1];
    if (group && last?.group === group && now - last.at < TYPING && h.redo.length === 0) {
        const merged = { ...last, after: step.after, at: now };
        // Typed and deleted again: nothing to undo.
        return { undo: sameContent(merged.before, merged.after) ? h.undo.slice(0, -1) : [...h.undo.slice(0, -1), merged], redo: [] };
    }
    return { undo: [...h.undo, step].slice(-KEEP), redo: [] };
};

/**
 * `now` with the change from `from` to `to` applied: what changed between them is changed in
 * `now` too, unless `now` has changed it since (someone else's edit wins over an undo).
 */
const apply = (now: Plan, from: PlanContent, to: PlanContent): Plan => ({
    ...merge(from, content(now), to),
    exported: now.exported,
    shared: now.shared,
});

const step = (h: History, now: Plan, back: boolean): { plan: Plan; history: History } | undefined => {
    const from = back ? h.undo : h.redo;
    const to = back ? h.redo : h.undo;
    // Steps that change nothing now (someone else already did the same) are passed over.
    for (let i = from.length - 1; i >= 0; i--) {
        const s = from[i];
        const plan = back ? apply(now, s.after, s.before) : apply(now, s.before, s.after);
        if (sameContent(content(plan), content(now))) continue;
        return { plan, history: back ? { undo: from.slice(0, i), redo: [...to, { ...s, group: undefined }] } : { undo: [...to, s], redo: from.slice(0, i) } };
    }
    return undefined;
};

/** The plan with the last edit undone, and the history after it; undefined if there's nothing to undo. */
export const undo = (h: History, now: Plan) => step(h, now, true);
export const redo = (h: History, now: Plan) => step(h, now, false);
