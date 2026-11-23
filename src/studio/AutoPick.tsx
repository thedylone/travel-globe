// The auto picker's view of a stop: each pick ticked, with its runners-up beside it to swap in.
import type { Media } from "../types";
import { type Pick, siteUrl, type StopPicks } from "./api";
import type { DraftStop } from "./draft";

/** One pick and the photos it can be swapped for; `chosen` is the one kept, or none to drop it. */
export interface Slot {
    options: string[];
    chosen?: string;
}

export interface StopPick {
    slots: Slot[];
    /** Every photo considered for picking; the ones not chosen are removed when you keep the picks. */
    considered: string[];
    scores: Record<string, number>;
}

/** Picks keyed by stop key, so they follow a stop that's moved while you look. */
export type Picking = Map<number, StopPick>;

export const toPicking = (stops: DraftStop[], result: StopPicks[]): Picking =>
    new Map(
        stops.map((s, i) => {
            const r = result[i] ?? { picks: [], scores: {}, considered: 0 };
            const slots = r.picks.map((p: Pick) => ({ options: [p.id, ...p.runnersUp], chosen: p.id }));
            return [s.key, { slots, considered: Object.keys(r.scores), scores: r.scores }];
        })
    );

export const chosenIn = (p: StopPick) => p.slots.flatMap((s) => (s.chosen ? [s.chosen] : []));

/** What keeping the picks does: the photos it removes, and each stop's best kept photo for its cover. */
export const outcome = (picking: Picking) => {
    const drop = new Set<string>();
    const covers = new Map<number, string>();
    for (const [key, p] of picking) {
        const keep = new Set(chosenIn(p));
        for (const id of p.considered) if (!keep.has(id)) drop.add(id);
        const best = [...keep].sort((a, b) => (p.scores[b] ?? 0) - (p.scores[a] ?? 0))[0];
        if (best) covers.set(key, best);
    }
    return { drop, covers, kept: [...picking.values()].reduce((n, p) => n + chosenIn(p).length, 0) };
};

interface Props {
    stop: DraftStop;
    pick: StopPick;
    onChange: (slots: Slot[]) => void;
}

export const PickRow = ({ stop, pick, onChange }: Props) => {
    const byId = new Map<string, Media>(stop.media.map((m) => [m.id, m]));
    const set = (i: number, chosen: string | undefined) => onChange(pick.slots.map((s, j) => (j === i ? { ...s, chosen } : s)));
    const considered = new Set(pick.considered);
    const kept = chosenIn(pick).length + stop.media.filter((m) => !considered.has(m.id)).length;
    if (!pick.slots.length) {
        return <p className="muted picks-none">{stop.media.length ? "Nothing to pick here (videos and photos without a thumbnail stay as they are)." : "No photos."}</p>;
    }
    return (
        <div className="picks">
            {pick.slots.map((slot, i) => {
                const shown = slot.chosen ?? slot.options[0];
                const m = byId.get(shown);
                return (
                    <div key={slot.options[0]} className={`pick-slot ${slot.chosen ? "" : "dropped"}`}>
                        <button
                            className="pick-main"
                            title={slot.chosen ? `${shown}: picked. Click to drop it.` : `${shown}: dropped. Click to pick it again.`}
                            onClick={() => set(i, slot.chosen ? undefined : shown)}
                        >
                            {m && <img src={siteUrl(m.thumb)} alt={shown} loading="lazy" />}
                            <span className="tick">{slot.chosen ? "✓" : ""}</span>
                        </button>
                        {slot.options.length > 1 && (
                            <div className="pick-alts" aria-label="Runners-up">
                                {slot.options
                                    .filter((o) => o !== shown)
                                    .map((o) => {
                                        const alt = byId.get(o);
                                        return (
                                            <button key={o} title={`${o}: click to pick this one instead`} onClick={() => set(i, o)}>
                                                {alt && <img src={siteUrl(alt.thumb)} alt={o} loading="lazy" />}
                                            </button>
                                        );
                                    })}
                            </div>
                        )}
                    </div>
                );
            })}
            <p className="muted picks-count">
                Keeping {kept} of {stop.media.length}
            </p>
        </div>
    );
};
