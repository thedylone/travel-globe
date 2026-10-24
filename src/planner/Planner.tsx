import { useEffect, useRef, useState } from "react";
import bases from "virtual:travel-bases";
import { formatDateRange } from "../lib/dates";
import {
    addDays,
    dayColor,
    dayDate,
    emptyPlan,
    endDate,
    fileName,
    fromYaml,
    move,
    needsExport,
    newDay,
    newPlace,
    type Plan,
    type PlanPlace,
    scheduled,
    setDates,
    toYaml,
    unfinished,
    upgrade,
} from "./plan";
import { PlanMap } from "./PlanMap";
import { type Found, searchPlaces } from "./search";
import { persist, saveFiles, store } from "./store";

const readHash = () => new URLSearchParams(location.hash.slice(1)).get("plan") ?? undefined;
const go = (id?: string) => {
    location.hash = id ? `plan=${encodeURIComponent(id)}` : "";
};

const yamlFile = (p: Plan) => new File([toYaml(p)], fileName(p), { type: "text/yaml" });

const dates = (p: Plan) => (p.start ? formatDateRange({ start: p.start, end: endDate(p) }) : "no dates yet");
const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** "Sat 20 Dec". */
const dayLabel = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

export const Planner = () => {
    const [plans, setPlans] = useState<Plan[]>();
    const [open, setOpen] = useState(readHash);
    const [error, setError] = useState<string>();

    useEffect(() => {
        store.all().then((ps) => setPlans(ps.map(upgrade)), (e: Error) => setError(`Couldn't read your plans: ${e.message}`));
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
    const errorBox = error && (
        <p className="planner-error" onClick={() => setError(undefined)}>
            {error}
        </p>
    );

    if (plan) {
        return (
            <>
                {errorBox}
                <PlanEditor key={plan.id} plan={plan} onEdit={edit} onExport={() => exportPlans([plan])} onDelete={() => remove(plan)} />
            </>
        );
    }
    return (
        <div className="planner">
            {errorBox}
            {plans && open && (
                <div className="planner-empty">
                    <p>This plan isn't on this phone.</p>
                    <button onClick={() => go()}>All plans</button>
                </div>
            )}
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
                            Plan a trip day by day: search for the places you'll go and they appear on the map. When
                            you're back, export it and open it in the studio to add the photos.
                        </p>
                    )}
                    <ul className="planner-list">
                        {plans?.map((p) => (
                            <li key={p.id}>
                                <button onClick={() => go(p.id)}>
                                    <span className="title">{p.title || "Untitled trip"}</span>
                                    <span className="muted">
                                        {dates(p)} · {count(scheduled(p).length, "place")}
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

/** Where a place is: on day `day`, or in the ideas (`day` -1). */
interface At {
    day: number;
    i: number;
}

const PlanEditor = ({ plan, onEdit, onExport, onDelete }: EditorProps) => {
    const [focus, setFocus] = useState<number>();
    const [active, setActive] = useState<string>();
    const set = (patch: Partial<Plan>) => onEdit({ ...plan, ...patch });

    const list = (day: number) => (day < 0 ? plan.ideas : plan.days[day].places);
    /** The plan with one list of places changed. */
    const withList = (p: Plan, day: number, places: PlanPlace[]): Plan =>
        day < 0 ? { ...p, ideas: places } : { ...p, days: p.days.map((d, j) => (j === day ? { ...d, places } : d)) };
    const editList = (day: number, change: (ps: PlanPlace[]) => PlanPlace[]) => onEdit(withList(plan, day, change(list(day))));
    const add = (day: number, x: PlanPlace) => {
        editList(day, (ps) => [...ps, x]);
        setActive(x.key);
    };
    const moveTo = ({ day, i }: At, to: number) => {
        if (to === day) return;
        const x = list(day)[i];
        const out = withList(plan, day, list(day).filter((_, j) => j !== i));
        onEdit(withList(out, to, [...(to < 0 ? out.ideas : out.days[to].places), x]));
    };
    const removeDay = (day: number) => {
        const places = plan.days[day].places;
        if (places.length && !confirm(`Remove this day? Its ${count(places.length, "place")} go to Places to visit.`)) return;
        // Days after it move a day earlier, so the trip ends a day sooner.
        set({ days: plan.days.filter((_, j) => j !== day), ideas: [...plan.ideas, ...places] });
        setFocus(undefined);
    };
    /** Opens a place's card; if the map is showing another day, it shows this place's day instead. */
    const open = (key: string | undefined) => {
        setActive(key);
        const day = plan.days.findIndex((d) => d.places.some((x) => x.key === key));
        if (key && focus !== undefined && day !== focus) setFocus(day < 0 ? undefined : day);
    };
    /** Selects a place from the map: shows its day and scrolls to it. */
    const select = (key: string) => {
        open(key);
        requestAnimationFrame(() => document.querySelector(`[data-place="${key}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
    };
    /** The last place with a location before day `day`'s end, to search near. */
    const near = (day: number) => {
        const places = day < 0 ? scheduled(plan).map((s) => s.place) : plan.days.slice(0, day + 1).flatMap((d) => d.places);
        return places.filter((x) => x.lat !== undefined).pop() as { lat: number; lng: number } | undefined;
    };
    const days = plan.days.map((_, i) => ({ value: i, label: plan.start ? dayLabel(dayDate(plan, i)) : `Day ${i + 1}` }));

    const placeList = (day: number) => (
        <ol className="plan-places">
            {list(day).map((x, i) => (
                <PlaceCard
                    key={x.key}
                    place={x}
                    n={day < 0 ? undefined : i + 1}
                    color={day < 0 ? undefined : dayColor(day)}
                    open={x.key === active}
                    first={i === 0}
                    last={i === list(day).length - 1}
                    day={day}
                    days={days}
                    onOpen={() => open(x.key === active ? undefined : x.key)}
                    onChange={(patch) => editList(day, (ps) => ps.map((p) => (p.key === x.key ? { ...p, ...patch } : p)))}
                    onMove={(by) => editList(day, (ps) => move(ps, i, i + by))}
                    onMoveTo={(to) => moveTo({ day, i }, to)}
                    onRemove={() => editList(day, (ps) => ps.filter((p) => p.key !== x.key))}
                />
            ))}
        </ol>
    );

    return (
        <div className="plan">
            <div className="plan-map-wrap">
                <PlanMap plan={plan} focus={focus} active={active} onSelect={select} />
                {focus !== undefined && (
                    <button className="plan-map-all" onClick={() => setFocus(undefined)}>
                        All days
                    </button>
                )}
            </div>
            <div className="plan-side">
                <header className="plan-head">
                    <button className="link" onClick={() => go()}>
                        ‹ Plans
                    </button>
                    <button className={needsExport(plan) ? "primary" : ""} onClick={onExport}>
                        Export
                    </button>
                </header>
                <input className="plan-title" value={plan.title} placeholder="Trip title" onChange={(e) => set({ title: e.target.value })} />
                <div className="plan-dates">
                    <label>
                        Start
                        <input
                            type="date"
                            value={plan.start}
                            onChange={(e) => {
                                // The days move with the start; the trip keeps its length.
                                const start = e.target.value;
                                onEdit(setDates(plan, start, start ? addDays(start, plan.days.length - 1) : ""));
                            }}
                        />
                    </label>
                    <label>
                        End
                        <input
                            type="date"
                            value={endDate(plan)}
                            min={plan.start || undefined}
                            disabled={!plan.start}
                            onChange={(e) => {
                                const next = setDates(plan, plan.start, e.target.value);
                                const dropped = plan.days.length - next.days.length;
                                const lost = next.ideas.length - plan.ideas.length;
                                if (lost && !confirm(`That drops ${count(dropped, "day")}. Its ${count(lost, "place")} go to Places to visit.`)) return;
                                onEdit(next);
                            }}
                        />
                    </label>
                </div>
                <details className="plan-details">
                    <summary>
                        {needsExport(plan) ? "Not exported since it changed" : "Exported"} · From, to, countries
                    </summary>
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
                            Country codes (narrow the search)
                            <input value={plan.country} placeholder="e.g. jp or gb,ie" autoCapitalize="off" onChange={(e) => set({ country: e.target.value })} />
                        </label>
                        <datalist id="planner-bases">
                            {bases.map((b) => (
                                <option key={b.key} value={b.key}>
                                    {b.name}
                                </option>
                            ))}
                        </datalist>
                    </div>
                </details>

                <section className="plan-day ideas">
                    <h2>
                        <span>Places to visit</span>
                        <span className="muted">{plan.ideas.length || ""}</span>
                    </h2>
                    {placeList(-1)}
                    <AddPlace country={plan.country} near={near(-1)} placeholder="Add a place you might go" onAdd={(x) => add(-1, x)} />
                </section>

                {plan.days.map((d, day) => (
                    <section key={d.key} className={`plan-day${focus === day ? " focused" : ""}`}>
                        <h2>
                            <button className="plan-day-name" onClick={() => setFocus(focus === day ? undefined : day)} title="Show this day on the map">
                                <span className="swatch" style={{ background: dayColor(day) }} />
                                {plan.start ? dayLabel(dayDate(plan, day)) : `Day ${day + 1}`}
                            </button>
                            <span className="muted">{d.places.length ? count(d.places.length, "place") : ""}</span>
                            {plan.days.length > 1 && (
                                <button className="link plan-day-remove" aria-label="Remove this day" onClick={() => removeDay(day)}>
                                    ✕
                                </button>
                            )}
                        </h2>
                        {placeList(day)}
                        <AddPlace country={plan.country} near={near(day)} placeholder="Add a place" onAdd={(x) => add(day, x)} />
                    </section>
                ))}
                <button className="plan-add-day" onClick={() => set({ days: [...plan.days, newDay()] })}>
                    + Add a day
                </button>

                {unfinished(plan) > 0 && (
                    <p className="muted plan-hint">The trip has no dates yet. That's fine for now; set the start date before you add it in the studio.</p>
                )}
                <p className="muted plan-hint">
                    Export saves <b>{fileName(plan)}</b>, with a stop for each place (a place on several days in a row is one
                    stop). Open it in the studio with <b>Open a planned trip</b> to add your photos. Places to visit aren't exported.
                </p>
                <button className="danger plan-delete" onClick={onDelete}>
                    Delete trip
                </button>
            </div>
        </div>
    );
};

interface PlaceProps {
    place: PlanPlace;
    /** Its number in the day, and the day's colour; none in Places to visit. */
    n?: number;
    color?: string;
    open: boolean;
    first: boolean;
    last: boolean;
    day: number;
    days: { value: number; label: string }[];
    onOpen: () => void;
    onChange: (patch: Partial<PlanPlace>) => void;
    onMove: (by: number) => void;
    onMoveTo: (day: number) => void;
    onRemove: () => void;
}

const PlaceCard = ({ place, n, color, open, first, last, day, days, onOpen, onChange, onMove, onMoveTo, onRemove }: PlaceProps) => (
    <li className={`plan-place${open ? " open" : ""}${place.side ? " side" : ""}`} data-place={place.key}>
        <button className="plan-place-head" onClick={onOpen}>
            <span className="num" style={color ? { background: color } : undefined}>
                {n ?? "•"}
            </span>
            <span className="plan-place-text">
                <span className="name">{place.name || place.place}</span>
                {(place.address || place.lat === undefined) && (
                    <span className="muted">{place.address || "no location: the studio looks it up"}</span>
                )}
                {!open && place.note && <span className="note">{place.note}</span>}
            </span>
        </button>
        {open && (
            <div className="plan-place-body">
                <textarea
                    value={place.note}
                    placeholder="Notes: what to see, bookings, times…"
                    rows={Math.min(8, place.note.split("\n").length + 1)}
                    autoFocus={!place.note}
                    onChange={(e) => onChange({ note: e.target.value })}
                />
                <label>
                    Label on the globe
                    <input value={place.name} placeholder={place.place} onChange={(e) => onChange({ name: e.target.value })} />
                </label>
                <div className="plan-place-actions">
                    <select value={day} aria-label="Day" onChange={(e) => onMoveTo(Number(e.target.value))}>
                        <option value={-1}>Places to visit</option>
                        {days.map((d) => (
                            <option key={d.value} value={d.value}>
                                {d.label}
                            </option>
                        ))}
                    </select>
                    <button className="icon" disabled={first} aria-label="Move up" onClick={() => onMove(-1)}>
                        ↑
                    </button>
                    <button className="icon" disabled={last} aria-label="Move down" onClick={() => onMove(1)}>
                        ↓
                    </button>
                </div>
                <div className="plan-place-foot">
                    {day >= 0 && (
                        <label className="check" title="Out from the stop before it and back again, e.g. a day trip">
                            <input type="checkbox" checked={place.side} onChange={(e) => onChange({ side: e.target.checked })} />
                            Side trip
                        </label>
                    )}
                    <button className="link danger" onClick={onRemove}>
                        Remove
                    </button>
                </div>
            </div>
        )}
    </li>
);

interface AddProps {
    country: string;
    near?: { lat: number; lng: number };
    placeholder: string;
    onAdd: (x: PlanPlace) => void;
}

/** A search box: type a place, pick it from the results. Offline, it adds what's typed without a location. */
const AddPlace = ({ country, near, placeholder, onAdd }: AddProps) => {
    const [q, setQ] = useState("");
    const [found, setFound] = useState<Found[]>([]);
    const [state, setState] = useState<"idle" | "searching" | "failed">("idle");
    const input = useRef<HTMLInputElement>(null);
    const results = useRef<HTMLUListElement>(null);
    // Keep the results on screen as they come in (the keyboard takes half of a phone's).
    useEffect(() => {
        results.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    }, [found, state]);

    useEffect(() => {
        const text = q.trim();
        if (text.length < 2) {
            setFound([]);
            setState("idle");
            return;
        }
        const ctl = new AbortController();
        const timer = setTimeout(() => {
            setState("searching");
            searchPlaces(text, { near, country, signal: ctl.signal }).then(
                (r) => {
                    setFound(r);
                    setState("idle");
                },
                (e: Error) => e.name !== "AbortError" && setState("failed")
            );
        }, 350);
        return () => {
            clearTimeout(timer);
            ctl.abort();
        };
        // Searching near a place that moved doesn't need a new search.
    }, [q, country]);

    const pick = (x: PlanPlace) => {
        onAdd(x);
        setQ("");
        setFound([]);
        input.current?.blur();
    };
    const typed = () => q.trim() && pick(newPlace({ place: q.trim() }));

    return (
        <div className="plan-add">
            <input
                ref={input}
                type="search"
                enterKeyHint="search"
                value={q}
                placeholder={`＋ ${placeholder}`}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        const [first] = found;
                        if (first) pick(newPlace({ place: first.name, lat: first.lat, lng: first.lng, address: first.address }));
                        else typed();
                    }
                    if (e.key === "Escape") setQ("");
                }}
            />
            {q.trim().length >= 2 && (
                <ul className="plan-results" ref={results}>
                    {found.map((f) => (
                        <li key={`${f.name}|${f.address}|${f.lat}`}>
                            <button onClick={() => pick(newPlace({ place: f.name, lat: f.lat, lng: f.lng, address: f.address }))}>
                                <span className="name">{f.name}</span>
                                <span className="muted">{f.address}</span>
                            </button>
                        </li>
                    ))}
                    <li>
                        <button onClick={typed}>
                            <span className="name">Add “{q.trim()}”</span>
                            <span className="muted">
                                {state === "searching"
                                    ? "Searching…"
                                    : state === "failed"
                                      ? "Couldn't search (offline?), so without a location for now"
                                      : "without a location; the studio looks it up"}
                            </span>
                        </button>
                    </li>
                </ul>
            )}
        </div>
    );
};
