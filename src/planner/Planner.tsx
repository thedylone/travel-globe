import { useEffect, useState } from "react";
import bases from "virtual:travel-bases";
import { formatDateRange } from "../lib/dates";
import {
    emptyPlan,
    emptyStop,
    fileName,
    fromYaml,
    moveStop,
    needsExport,
    type Plan,
    planDates,
    type PlanStop,
    toYaml,
    unfinished,
} from "./plan";
import { persist, saveFiles, store } from "./store";

const readHash = () => new URLSearchParams(location.hash.slice(1)).get("plan") ?? undefined;
const go = (id?: string) => {
    location.hash = id ? `plan=${encodeURIComponent(id)}` : "";
};

const yamlFile = (p: Plan) => new File([toYaml(p)], fileName(p), { type: "text/yaml" });

const dates = (p: Plan) => {
    const d = planDates(p);
    return d ? formatDateRange(d) : "no dates yet";
};

export const Planner = () => {
    const [plans, setPlans] = useState<Plan[]>();
    const [open, setOpen] = useState(readHash);
    const [error, setError] = useState<string>();

    useEffect(() => {
        store.all().then(setPlans, (e: Error) => setError(`Couldn't read your plans: ${e.message}`));
        void persist();
        const onHash = () => setOpen(readHash());
        addEventListener("hashchange", onHash);
        return () => removeEventListener("hashchange", onHash);
    }, []);

    const fail = (e: unknown) => setError(`Couldn't save: ${(e as Error).message}`);
    /** Keeps a plan, in this list and in the browser's storage. */
    const keep = (p: Plan) => {
        setPlans((ps) => [p, ...(ps ?? []).filter((x) => x.id !== p.id)].sort((a, b) => b.updated - a.updated));
        store.put(p).catch(fail);
    };
    const edit = (p: Plan) => keep({ ...p, updated: Date.now() });
    const remove = (p: Plan) => {
        if (!confirm(`Delete "${p.title || "untitled trip"}" from this phone?`)) return;
        setPlans((ps) => ps?.filter((x) => x.id !== p.id));
        store.remove(p.id).catch(fail);
        go();
    };
    const exportPlans = async (ps: Plan[]) => {
        if (!ps.length) return;
        if (!(await saveFiles(ps.map(yamlFile)))) return;
        const now = Date.now();
        ps.forEach((p) => keep({ ...p, exported: now }));
    };
    const create = () => {
        const p = emptyPlan();
        keep(p);
        go(p.id);
    };
    const openFiles = async (files: File[]) => {
        const problems: string[] = [];
        for (const f of files) {
            try {
                const p = fromYaml(await f.text());
                keep({ ...p, exported: p.updated });
            } catch (e) {
                problems.push(`${f.name}: ${(e as Error).message}`);
            }
        }
        setError(problems.length ? `Couldn't open ${problems.join("\n")}` : undefined);
    };

    const plan = open ? plans?.find((p) => p.id === open) : undefined;
    const unsaved = (plans ?? []).filter(needsExport);

    return (
        <div className="planner">
            {error && (
                <p className="planner-error" onClick={() => setError(undefined)}>
                    {error}
                </p>
            )}
            {plans && open && !plan && (
                <div className="planner-empty">
                    <p>This plan isn't on this phone.</p>
                    <button onClick={() => go()}>All plans</button>
                </div>
            )}
            {plan && <PlanEditor plan={plan} onEdit={edit} onExport={() => exportPlans([plan])} onDelete={() => remove(plan)} />}
            {!open && (
                <>
                    <header className="planner-head">
                        <h1>Trip planner</h1>
                        <a href={import.meta.env.BASE_URL}>Globe</a>
                    </header>
                    {unsaved.length > 0 && (
                        <div className="planner-banner">
                            <p>
                                {unsaved.length === 1 ? "1 plan is" : `${unsaved.length} plans are`} only on this phone. Safari
                                can clear a site's data when it isn't opened for a few weeks, so export to keep a copy.
                            </p>
                            <button onClick={() => exportPlans(unsaved)}>Export {unsaved.length === 1 ? "it" : "them"}</button>
                        </div>
                    )}
                    <button className="primary planner-new" onClick={create}>
                        New trip
                    </button>
                    {plans?.length === 0 && (
                        <p className="muted planner-intro">
                            Plan a trip here, with or without signal: its stops, dates and notes. When you're back, export
                            it and open it in the studio to add the photos.
                        </p>
                    )}
                    <ul className="planner-list">
                        {plans?.map((p) => (
                            <li key={p.id}>
                                <button onClick={() => go(p.id)}>
                                    <span className="title">{p.title || "Untitled trip"}</span>
                                    <span className="muted">
                                        {dates(p)} · {p.stops.length} {p.stops.length === 1 ? "stop" : "stops"}
                                        {needsExport(p) && <span className="dot" title="Not exported since it changed" />}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                    <footer className="planner-foot">
                        <label className="button">
                            Open a trip file
                            <input
                                type="file"
                                hidden
                                multiple
                                onChange={(e) => {
                                    void openFiles([...(e.target.files ?? [])]);
                                    e.target.value = "";
                                }}
                            />
                        </label>
                        {(plans?.length ?? 0) > 1 && <button onClick={() => exportPlans(plans!)}>Export all</button>}
                    </footer>
                </>
            )}
        </div>
    );
};

interface EditorProps {
    plan: Plan;
    onEdit: (p: Plan) => void;
    onExport: () => void;
    onDelete: () => void;
}

const PlanEditor = ({ plan, onEdit, onExport, onDelete }: EditorProps) => {
    const set = (patch: Partial<Plan>) => onEdit({ ...plan, ...patch });
    const setStops = (stops: PlanStop[]) => set({ stops });
    const setStop = (i: number, patch: Partial<PlanStop>) => setStops(plan.stops.map((s, j) => (j === i ? { ...s, ...patch } : s)));
    const undated = unfinished(plan);

    return (
        <div className="plan">
            <header className="plan-head">
                <button className="link" onClick={() => go()}>
                    ‹ Plans
                </button>
                <button className={needsExport(plan) ? "primary" : ""} onClick={onExport}>
                    Export
                </button>
            </header>
            <input
                className="plan-title"
                value={plan.title}
                placeholder="Trip title"
                onChange={(e) => set({ title: e.target.value })}
            />
            <p className="muted plan-meta">
                {dates(plan)}
                {needsExport(plan) ? " · not exported since it changed" : " · exported"}
            </p>

            <div className="plan-fields">
                <label>
                    From
                    <input list="planner-bases" value={plan.from} placeholder="home, or a place" onChange={(e) => set({ from: e.target.value })} />
                </label>
                <label>
                    To
                    <input list="planner-bases" value={plan.to} placeholder="if not where it started" onChange={(e) => set({ to: e.target.value })} />
                </label>
                <label>
                    Country codes
                    <input
                        value={plan.country}
                        placeholder="e.g. jp or gb,ie"
                        autoCapitalize="off"
                        onChange={(e) => set({ country: e.target.value })}
                    />
                </label>
                <datalist id="planner-bases">
                    {bases.map((b) => (
                        <option key={b.key} value={b.key}>
                            {b.name}
                        </option>
                    ))}
                </datalist>
            </div>

            <ol className="plan-stops">
                {plan.stops.map((s, i) => (
                    <StopCard
                        key={s.key}
                        stop={s}
                        n={i + 1}
                        first={i === 0}
                        last={i === plan.stops.length - 1}
                        onChange={(patch) => setStop(i, patch)}
                        onMove={(by) => setStops(moveStop(plan.stops, i, i + by))}
                        onRemove={() => setStops(plan.stops.filter((_, j) => j !== i))}
                    />
                ))}
            </ol>
            <button className="plan-add" onClick={() => setStops([...plan.stops, emptyStop(plan.stops[plan.stops.length - 1])])}>
                + Add stop
            </button>

            {undated > 0 && (
                <p className="muted plan-hint">
                    {undated === 1 ? "1 stop has" : `${undated} stops have`} no date yet. That's fine for now; the studio
                    asks for one when you save the trip there.
                </p>
            )}
            <p className="muted plan-hint">
                Export saves <b>{fileName(plan)}</b>. Open it in the studio (<b>Open a planned trip</b>) to look up the
                places and add your photos.
            </p>
            <button className="danger plan-delete" onClick={onDelete}>
                Delete trip
            </button>
        </div>
    );
};

interface StopProps {
    stop: PlanStop;
    n: number;
    first: boolean;
    last: boolean;
    onChange: (patch: Partial<PlanStop>) => void;
    onMove: (by: number) => void;
    onRemove: () => void;
}

const StopCard = ({ stop, n, first, last, onChange, onMove, onRemove }: StopProps) => {
    const [more, setMore] = useState(!!stop.name);
    return (
        <li className={`plan-stop${stop.side ? " side" : ""}`}>
            <div className="plan-stop-head">
                <span className="num">{n}</span>
                <input
                    className="plan-place"
                    value={stop.place}
                    placeholder="Place, e.g. Kyoto"
                    onChange={(e) => onChange({ place: e.target.value })}
                />
                <button className="icon" disabled={first} aria-label="Move up" onClick={() => onMove(-1)}>
                    ↑
                </button>
                <button className="icon" disabled={last} aria-label="Move down" onClick={() => onMove(1)}>
                    ↓
                </button>
            </div>
            <div className="plan-dates">
                <label>
                    From
                    <input type="date" value={stop.start} onChange={(e) => onChange({ start: e.target.value })} />
                </label>
                <label>
                    To
                    <input
                        type="date"
                        value={stop.end}
                        min={stop.start || undefined}
                        onChange={(e) => onChange({ end: e.target.value })}
                    />
                </label>
            </div>
            <textarea
                value={stop.note}
                placeholder="Notes"
                rows={stop.note ? Math.min(8, stop.note.split("\n").length + 1) : 2}
                onChange={(e) => onChange({ note: e.target.value })}
            />
            {more && (
                <label className="plan-name">
                    Label on the globe
                    <input value={stop.name} placeholder={stop.place || "if not the place name"} onChange={(e) => onChange({ name: e.target.value })} />
                </label>
            )}
            <div className="plan-stop-foot">
                <label className="check">
                    <input type="checkbox" checked={stop.side} disabled={first} onChange={(e) => onChange({ side: e.target.checked })} />
                    Side trip
                </label>
                {!more && (
                    <button className="link" onClick={() => setMore(true)}>
                        Label
                    </button>
                )}
                <button
                    className="link danger"
                    onClick={() => (stop.place || stop.note ? confirm(`Remove stop ${n}?`) : true) && onRemove()}
                >
                    Remove
                </button>
            </div>
        </li>
    );
};
