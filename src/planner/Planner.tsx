import { useCallback, useEffect, useRef, useState } from "react";
import bases from "virtual:travel-bases";
import { formatDateRange } from "../lib/dates";
import {
    addDays,
    type Booking,
    bookingsOn,
    coverBookings,
    dayColor,
    dayDate,
    daysBetween,
    emptyPlan,
    endDate,
    fileName,
    fromYaml,
    move,
    needsExport,
    newBooking,
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
import { PHONE, useSheet, useSidebar } from "./sheet";
import { type Found, searchPlaces } from "./search";
import { persist, saveFiles, store } from "./store";
import { pictureKey, tripPicture } from "./picture";
import { emptyHistory, type History, record, redo, undo } from "./history";
import { Gone, join, readJoin, sendPicture, settle, share, shareLink, sync, SYNC_URL, unshare } from "./sync";
import { shareFontDataUrl } from "../lib/rasterize";

const readHash = () => new URLSearchParams(location.hash.slice(1)).get("plan") ?? undefined;
const go = (id?: string) => {
    location.hash = id ? `plan=${encodeURIComponent(id)}` : "";
};

const yamlFile = (p: Plan) => new File([toYaml(p)], fileName(p), { type: "text/yaml" });

const dates = (p: Plan) => (p.start ? formatDateRange({ start: p.start, end: endDate(p) }) : "no dates yet");
const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** How long after an edit a shared plan syncs, and how often it checks for the others' changes while open. */
const SYNC_AFTER_EDIT = 1500;
const SYNC_EVERY = 15_000;

/** "just now", "5 min ago", "3 h ago", or the date. */
const ago = (t: number, now = Date.now()) => {
    const min = Math.round((now - t) / 60_000);
    if (min < 1) return "just now";
    if (min < 60) return `${min} min ago`;
    if (min < 24 * 60) return `${Math.round(min / 60)} h ago`;
    return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

/** Sends a link through the share sheet, or copies it. */
const sendLink = async (title: string, url: string) => {
    if (navigator.share) {
        try {
            await navigator.share({ title, url });
            return "";
        } catch (e) {
            if ((e as Error).name === "AbortError") return "";
        }
    }
    await navigator.clipboard.writeText(url);
    return "Link copied. Send it to whoever you're planning with.";
};

/** A shared plan's sync: whether it's going, or what went wrong last time. */
type SyncState = "syncing" | "ok" | { error: string };

/** "Sat 20 Dec". */
const dayLabel = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

export const Planner = () => {
    const [plans, setPlans] = useState<Plan[]>();
    const [open, setOpen] = useState(readHash);
    const [error, setError] = useState<string>();
    /** A message that isn't a problem, shown where problems are. */
    const [notice, setNotice] = useState<string>();
    const [syncing, setSyncing] = useState<Record<string, SyncState>>({});
    /** The plans as they are now, for syncs that finish later. */
    const current = useRef<Plan[]>([]);
    current.current = plans ?? [];

    useEffect(() => {
        store.all().then(
            (ps) => {
                const all = ps.map(upgrade);
                current.current = all;
                setPlans(all);
                all.forEach((p) => runSync(p));
                void openJoin();
            },
            (e: Error) => setError(`Couldn't read your plans: ${e.message}`)
        );
        void persist();
        const onHash = () => {
            setOpen(readHash());
            void openJoin();
        };
        addEventListener("hashchange", onHash);
        return () => removeEventListener("hashchange", onHash);
    }, []);

    const fail = (e: unknown) => setError(`Couldn't save: ${(e as Error).message}`);
    /** Keeps a plan, in this list and in the browser's storage. */
    const keep = (p: Plan) => {
        current.current = [p, ...current.current.filter((x) => x.id !== p.id)];
        setPlans((ps) => [p, ...(ps ?? []).filter((x) => x.id !== p.id)].sort((a, b) => b.updated - a.updated));
        store.put(p).catch(fail);
    };

    // A shared plan's link-preview picture: drawn and sent again when what it shows changes.
    const drawing = useRef(new Set<string>());
    const updatePicture = useCallback(async (p: Plan) => {
        const key = pictureKey(p);
        if (!p.shared || p.shared.picture === key || drawing.current.has(p.id)) return;
        drawing.current.add(p.id);
        try {
            await sendPicture(p, await tripPicture(p, await shareFontDataUrl().catch(() => undefined)));
            const now = current.current.find((x) => x.id === p.id);
            if (now?.shared) keep({ ...now, shared: { ...now.shared, picture: key } });
        } catch {
            // Not worth bothering anyone over: the link shows the planner's picture until the next try.
        } finally {
            drawing.current.delete(p.id);
        }
    }, []);

    // Syncing shared plans. One sync per plan at a time; an edit during one syncs again after it.
    const running = useRef(new Map<string, boolean>());
    const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
    const runSync = useCallback((p: Plan) => {
        if (!SYNC_URL || !p.shared) return;
        if (running.current.has(p.id)) {
            running.current.set(p.id, true);
            return;
        }
        running.current.set(p.id, false);
        setSyncing((s) => ({ ...s, [p.id]: "syncing" }));
        sync(p).then(
            (result) => {
                const now = current.current.find((x) => x.id === p.id);
                if (now) {
                    const kept = settle(p, now, result);
                    keep(kept);
                    void updatePicture(kept);
                }
                setSyncing((s) => ({ ...s, [p.id]: "ok" }));
            },
            (e: Error) => {
                const now = current.current.find((x) => x.id === p.id);
                if (e instanceof Gone && now?.shared) {
                    // Deleted for everyone on another phone: this one keeps it, as its own.
                    keep({ ...now, shared: undefined });
                    setSyncing((s) => ({ ...s, [p.id]: "ok" }));
                    setNotice(`"${now.title || "untitled trip"}" was deleted for everyone on another phone. It's still on this one, no longer shared.`);
                    return;
                }
                setSyncing((s) => ({ ...s, [p.id]: { error: navigator.onLine ? e.message : "offline" } }));
            }
        ).finally(() => {
            const again = running.current.get(p.id);
            running.current.delete(p.id);
            const now = current.current.find((x) => x.id === p.id);
            if (again && now) runSync(now);
        });
    }, [updatePicture]);
    const syncSoon = (p: Plan) => {
        if (!p.shared) return;
        clearTimeout(timers.current.get(p.id));
        timers.current.set(p.id, setTimeout(() => runSync(current.current.find((x) => x.id === p.id) ?? p), SYNC_AFTER_EDIT));
    };

    // The open plan checks for the others' changes every so often, and when the phone comes back to it.
    const openShared = open && plans?.find((p) => p.id === open)?.shared ? open : undefined;
    useEffect(() => {
        if (!SYNC_URL) return;
        const check = () => {
            if (document.visibilityState !== "visible") return;
            const ps = openShared ? current.current.filter((p) => p.id === openShared) : current.current;
            ps.forEach((p) => runSync(p));
        };
        const timer = openShared ? setInterval(check, SYNC_EVERY) : undefined;
        if (openShared) check();
        document.addEventListener("visibilitychange", check);
        addEventListener("online", check);
        return () => {
            clearInterval(timer);
            document.removeEventListener("visibilitychange", check);
            removeEventListener("online", check);
        };
    }, [openShared]);

    /** Opens a share link ("#join=…"): fetches the plan and shows it. */
    const openJoin = async () => {
        const link = readJoin(location.hash);
        if (!link) return;
        if (!SYNC_URL) return setError("This site can't open shared plans (it has no sync server).");
        try {
            const p = await join(link, current.current);
            keep(p);
            history.replaceState(null, "", `#plan=${p.id}`);
            setOpen(p.id);
        } catch (e) {
            setError(`Couldn't open the shared plan: ${(e as Error).message}`);
        }
    };

    // Undo and redo, per plan, for this visit (see history.ts).
    const histories = useRef(new Map<string, History>());
    const [, setHistoryShown] = useState(0);
    const setHistory = (id: string, h: History) => {
        histories.current.set(id, h);
        setHistoryShown((n) => n + 1);
    };
    const save = (p: Plan) => {
        const next = { ...p, updated: Date.now() };
        keep(next);
        syncSoon(next);
    };
    /** Saves an edit; `group` names the field being typed in, so a burst of typing undoes as one. */
    const edit = (p: Plan, group?: string) => {
        const before = current.current.find((x) => x.id === p.id);
        if (before) setHistory(p.id, record(histories.current.get(p.id) ?? emptyHistory(), before, p, group));
        save(p);
    };
    const travel = (id: string, back: boolean) => {
        const now = current.current.find((x) => x.id === id);
        const h = histories.current.get(id);
        if (!now || !h) return;
        const done = back ? undo(h, now) : redo(h, now);
        if (!done) return setHistory(id, { undo: back ? [] : h.undo, redo: back ? h.redo : [] });
        setHistory(id, done.history);
        save(done.plan);
    };
    const startSharing = async (p: Plan) => {
        if (!p.shared) {
            if (!confirm("Share this trip? Anyone with the link can see it and change it, and changes sync between everyone's phones.")) return;
            try {
                p = settle(p, current.current.find((x) => x.id === p.id) ?? p, await share(p));
                keep(p);
                setSyncing((s) => ({ ...s, [p.id]: "ok" }));
                // Alongside sending the link: it's there before anyone opens it.
                void updatePicture(p);
            } catch (e) {
                return setError(`Couldn't share it: ${navigator.onLine ? (e as Error).message : "you're offline"}`);
            }
        }
        try {
            setNotice((await sendLink(p.title || "Trip plan", shareLink(p))) || undefined);
        } catch {
            setNotice(`Send this link to whoever you're planning with: ${shareLink(p)}`);
        }
    };
    const remove = async (p: Plan) => {
        const name = p.title || "untitled trip";
        if (!confirm(`Delete "${name}" from this phone?`)) return;
        if (p.shared && confirm(`Delete "${name}" for everyone with the link too? Its link stops working.\n\nCancel keeps it for them.`)) {
            try {
                await unshare(p);
            } catch (e) {
                return setError(`Couldn't delete it for everyone: ${navigator.onLine ? (e as Error).message : "you're offline"}. It's still here; try again.`);
            }
        }
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
    const errorBox = error ? (
        <p className="planner-error" onClick={() => setError(undefined)}>
            {error}
        </p>
    ) : (
        notice && (
            <p className="planner-error notice" onClick={() => setNotice(undefined)}>
                {notice}
            </p>
        )
    );

    if (plan) {
        return (
            <>
                {errorBox}
                <PlanEditor
                    key={plan.id}
                    plan={plan}
                    syncing={syncing[plan.id]}
                    onEdit={edit}
                    canUndo={(histories.current.get(plan.id)?.undo.length ?? 0) > 0}
                    canRedo={(histories.current.get(plan.id)?.redo.length ?? 0) > 0}
                    onUndo={() => travel(plan.id, true)}
                    onRedo={() => travel(plan.id, false)}
                    onExport={() => exportPlans([plan])}
                    onShare={SYNC_URL ? () => startSharing(plan) : undefined}
                    onDelete={() => void remove(plan)}
                />
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
                                        {p.shared && " · shared"}
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
    syncing?: SyncState;
    onEdit: (p: Plan, group?: string) => void;
    canUndo: boolean;
    canRedo: boolean;
    onUndo: () => void;
    onRedo: () => void;
    onExport: () => void;
    /** Shares the plan, or sends its link again; unset when the site has no sync server. */
    onShare?: () => void;
    onDelete: () => void;
}

/** "Shared · synced 2 min ago", or why it isn't. */
const syncLine = (p: Plan, s?: SyncState) => {
    if (!p.shared) return "";
    if (s === "syncing") return "Shared · syncing…";
    if (s && typeof s === "object") return s.error === "offline" ? "Shared · offline, syncs when back online" : `Shared · couldn't sync: ${s.error}`;
    return `Shared · synced ${ago(p.shared.synced)}`;
};

/** Where a place is: on day `day`, or in the ideas (`day` -1). */
interface At {
    day: number;
    i: number;
}

const PlanEditor = ({ plan, syncing, onEdit, canUndo, canRedo, onUndo, onRedo, onExport, onShare, onDelete }: EditorProps) => {
    const [focus, setFocus] = useState<number>();
    const [active, setActive] = useState<string>();
    const set = (patch: Partial<Plan>, group?: string) => onEdit({ ...plan, ...patch }, group);
    const root = useRef<HTMLDivElement>(null);
    const mapWrap = useRef<HTMLDivElement>(null);
    const side = useRef<HTMLDivElement>(null);
    const [sheet, showSheet] = useSheet(root, mapWrap, side);
    const [sidebar, toggleSidebar] = useSidebar();

    // Ctrl/Cmd+Z undoes, Shift+Ctrl/Cmd+Z (or Ctrl+Y) redoes, everywhere but the search boxes,
    // which keep the browser's own undo for what's being typed in them.
    const keys = useRef({ onUndo, onRedo });
    keys.current = { onUndo, onRedo };
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
            const k = e.key.toLowerCase();
            const back = k === "z" && !e.shiftKey;
            if (!back && !(k === "z" && e.shiftKey) && !(k === "y" && e.ctrlKey && !e.metaKey)) return;
            if ((e.target as HTMLElement | null)?.closest?.("[data-own-undo]")) return;
            e.preventDefault();
            (back ? keys.current.onUndo : keys.current.onRedo)();
        };
        addEventListener("keydown", onKey);
        return () => removeEventListener("keydown", onKey);
    }, []);

    const list = (day: number) => (day < 0 ? plan.ideas : plan.days[day].places);
    /** The plan with one list of places changed. */
    const withList = (p: Plan, day: number, places: PlanPlace[]): Plan =>
        day < 0 ? { ...p, ideas: places } : { ...p, days: p.days.map((d, j) => (j === day ? { ...d, places } : d)) };
    const editList = (day: number, change: (ps: PlanPlace[]) => PlanPlace[], group?: string) => onEdit(withList(plan, day, change(list(day))), group);
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
        // On a phone with the panel pulled down, bring it back up to show the place.
        if (sheet === "map" && matchMedia(PHONE).matches) showSheet("split");
        requestAnimationFrame(() => document.querySelector(`[data-place="${key}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
    };
    /** The last place with a location before day `day`'s end, to search near. */
    const near = (day: number) => {
        const places = day < 0 ? scheduled(plan).map((s) => s.place) : plan.days.slice(0, day + 1).flatMap((d) => d.places);
        return places.filter((x) => x.lat !== undefined).pop() as { lat: number; lng: number } | undefined;
    };
    // ---- Flights and hotels ----
    const bookings = plan.bookings ?? [];
    /** The plan with its bookings changed; the trip's days grow to cover their dates. */
    const editBookings = (change: (bs: Booking[]) => Booking[], group?: string) => onEdit(coverBookings({ ...plan, bookings: change(bookings) }), group);
    const addBooking = (b: Booking) => {
        editBookings((bs) => [...bs, b]);
        setActive(b.key);
    };
    /** Opens a booking's card from a day or the map, and scrolls to it. */
    const showBooking = (key: string) => {
        setActive(key);
        if (sheet === "map" && matchMedia(PHONE).matches) showSheet("split");
        requestAnimationFrame(() => document.querySelector(`[data-booking="${key}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
    };
    /** Bookings by date, the undated last. */
    const sortedBookings = [...bookings].sort((a, b) => (a.start || "9") .localeCompare(b.start || "9") || a.time.localeCompare(b.time));
    const pinned = (b: Booking, when: "morning" | "flight" | "night", date: string) => (
        <li key={`${when}:${b.key}`} className={`plan-pinned ${b.kind}`}>
            <button onClick={() => showBooking(b.key)} title="Booked: change it in Flights & hotels">
                <span className="num">{b.kind === "hotel" ? <BedIcon /> : <PlaneIcon />}</span>
                <span className="plan-place-text">
                    <span className="name">{bookingTitle(b)}</span>
                    <span className="muted">{pinnedLine(b, when, date)}</span>
                </span>
            </button>
        </li>
    );

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
                    onChange={(patch, field) =>
                        editList(
                            day,
                            (ps) => ps.map((p) => (p.key === x.key ? { ...p, ...patch } : p)),
                            field && `${field}:${x.key}`
                        )
                    }
                    onMove={(by) => editList(day, (ps) => move(ps, i, i + by))}
                    onMoveTo={(to) => moveTo({ day, i }, to)}
                    onRemove={() => editList(day, (ps) => ps.filter((p) => p.key !== x.key))}
                />
            ))}
        </ol>
    );

    return (
        <div className="plan" ref={root} data-sheet={sheet} data-sidebar={sidebar ? "shown" : "hidden"}>
            <div className="plan-map-wrap" ref={mapWrap}>
                <PlanMap plan={plan} focus={focus} active={active} onSelect={(key) => (bookings.some((b) => b.key === key) ? showBooking(key) : select(key))} />
                <button
                    className="plan-side-toggle"
                    onClick={toggleSidebar}
                    aria-expanded={sidebar}
                    aria-label={sidebar ? "Hide the trip panel" : "Show the trip panel"}
                    title={sidebar ? "Hide the trip panel" : "Show the trip panel"}
                >
                    <SidebarIcon />
                    {!sidebar && <span>{plan.title || "Trip"}</span>}
                </button>
                {focus !== undefined && (
                    <button className="plan-map-all" onClick={() => setFocus(undefined)}>
                        All days
                    </button>
                )}
            </div>
            <div className="plan-side" ref={side}>
                <div className="plan-top">
                    <button
                        className="plan-grab"
                        onClick={() => showSheet(sheet === "map" ? "split" : "map")}
                        aria-label={sheet === "map" ? "Show the trip" : "Show more of the map"}
                        aria-expanded={sheet === "split"}
                    />
                    <header className="plan-head">
                        <span className="plan-head-nav">
                            <button className="link" onClick={() => go()}>
                                ‹ Plans
                            </button>
                            <span className="plan-undo">
                                <button className="icon" disabled={!canUndo} onClick={onUndo} aria-label="Undo" title="Undo (Ctrl+Z)">
                                    <UndoIcon />
                                </button>
                                <button className="icon" disabled={!canRedo} onClick={onRedo} aria-label="Redo" title="Redo (Shift+Ctrl+Z)">
                                    <UndoIcon redo />
                                </button>
                            </span>
                        </span>
                        <span className="plan-head-actions">
                            {onShare && <button onClick={onShare}>{plan.shared ? "Share link" : "Share"}</button>}
                            <button className={needsExport(plan) ? "primary" : ""} onClick={onExport}>
                                Export
                            </button>
                        </span>
                    </header>
                </div>
                {plan.shared && <p className={`muted plan-sync${typeof syncing === "object" ? " failed" : ""}`}>{syncLine(plan, syncing)}</p>}
                <input className="plan-title" value={plan.title} placeholder="Trip title" onChange={(e) => set({ title: e.target.value }, "title")} />
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
                        {plan.exported === undefined || plan.updated > plan.exported ? "Not exported since it changed" : "Exported"} · From, to, countries
                    </summary>
                    <div className="plan-fields">
                        <label>
                            From
                            <input list="planner-bases" value={plan.from} placeholder="home, or a place" onChange={(e) => set({ from: e.target.value }, "from")} />
                        </label>
                        <label>
                            To
                            <input list="planner-bases" value={plan.to} placeholder="if not where it started" onChange={(e) => set({ to: e.target.value }, "to")} />
                        </label>
                        <label>
                            Country codes (narrow the search)
                            <input value={plan.country} placeholder="e.g. jp or gb,ie" autoCapitalize="off" onChange={(e) => set({ country: e.target.value }, "country")} />
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

                <section className="plan-day bookings">
                    <h2>
                        <span>Flights &amp; hotels</span>
                        <span className="muted">{bookings.length || ""}</span>
                    </h2>
                    <ol className="plan-places">
                        {sortedBookings.map((b) => (
                            <BookingCard
                                key={b.key}
                                booking={b}
                                open={b.key === active}
                                onOpen={() => setActive(b.key === active ? undefined : b.key)}
                                onChange={(patch, field) => editBookings((bs) => bs.map((x) => (x.key === b.key ? { ...x, ...patch } : x)), field && `${field}:${b.key}`)}
                                onRemove={() => editBookings((bs) => bs.filter((x) => x.key !== b.key))}
                            />
                        ))}
                    </ol>
                    <AddPlace
                        country={plan.country}
                        near={near(-1)}
                        placeholder="Add a hotel"
                        onAdd={(x) => addBooking(newBooking("hotel", { name: x.place, lat: x.lat, lng: x.lng, address: x.address }))}
                    />
                    <button className="plan-add-flight" onClick={() => addBooking(newBooking("flight", { start: plan.start }))}>
                        ＋ Add a flight
                    </button>
                </section>

                <section className="plan-day ideas">
                    <h2>
                        <span>Places to visit</span>
                        <span className="muted">{plan.ideas.length || ""}</span>
                    </h2>
                    {placeList(-1)}
                    <AddPlace country={plan.country} near={near(-1)} placeholder="Add a place you might go" onAdd={(x) => add(-1, x)} />
                </section>

                {plan.days.map((d, day) => {
                    const booked = bookingsOn(plan, day);
                    const date = dayDate(plan, day);
                    // The hotel slept in shows in the morning only on the day you check out.
                    const out = booked.morning.filter((b) => b.end === date);
                    return (
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
                        {(out.length > 0 || booked.flights.length > 0) && (
                            <ol className="plan-places plan-pins">
                                {out.map((b) => pinned(b, "morning", date))}
                                {booked.flights.map((b) => pinned(b, "flight", date))}
                            </ol>
                        )}
                        {placeList(day)}
                        {booked.night.length > 0 && <ol className="plan-places plan-pins">{booked.night.map((b) => pinned(b, "night", date))}</ol>}
                        <AddPlace country={plan.country} near={near(day)} placeholder="Add a place" onAdd={(x) => add(day, x)} />
                    </section>
                    );
                })}
                <button className="plan-add-day" onClick={() => set({ days: [...plan.days, newDay()] })}>
                    + Add a day
                </button>

                {unfinished(plan) > 0 && (
                    <p className="muted plan-hint">The trip has no dates yet. That's fine for now; set the start date before you add it in the studio.</p>
                )}
                <p className="muted plan-hint">
                    Export saves <b>{fileName(plan)}</b>, with a stop for each place (a place on several days in a row is one
                    stop). Open it in the studio with <b>Open a planned trip</b> to add your photos. Places to visit and flights &amp; hotels aren't exported.
                </p>
                <button className="danger plan-delete" onClick={onDelete}>
                    Delete trip
                </button>
            </div>
        </div>
    );
};

/** A window with a panel down its left side. */
const SidebarIcon = () => (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <rect x="3" y="4.5" width="18" height="15" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M9.5 4.5v15" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
);

/** A curved arrow back (or, for redo, forward). */
const UndoIcon = ({ redo }: { redo?: boolean }) => (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" style={redo ? { transform: "scaleX(-1)" } : undefined}>
        <path d="M9 14 4 9l5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

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
    /** `field` is set for typing, so a burst of it undoes as one. */
    onChange: (patch: Partial<PlanPlace>, field?: string) => void;
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
                    onChange={(e) => onChange({ note: e.target.value }, "note")}
                />
                <label>
                    Label on the globe
                    <input value={place.name} placeholder={place.place} onChange={(e) => onChange({ name: e.target.value }, "name")} />
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

/** "BA 7 · LHR → HND", or the hotel's name. */
const bookingTitle = (b: Booking) => {
    if (b.kind === "hotel") return b.name || "Hotel";
    const route = b.from || b.to ? `${b.from || "?"} → ${b.to || "?"}` : "";
    return [b.name, route].filter(Boolean).join(" · ") || "Flight";
};

const nights = (b: Booking) => (b.start && b.end ? daysBetween(b.start, b.end) : 0);

/** What a pinned booking says on a day. */
const pinnedLine = (b: Booking, when: "morning" | "flight" | "night", date: string) => {
    if (when === "flight") return [b.time && `Leaves ${b.time}`, b.arrive && `lands ${b.arrive}${b.end && b.end !== b.start ? ` on ${dayLabel(b.end)}` : ""}`].filter(Boolean).join(", ") || "Flight";
    if (when === "morning") return "Check out";
    const night = daysBetween(b.start, date) + 1;
    return night === 1 ? `Check in · ${count(nights(b), "night")}` : `Night ${night} of ${nights(b)}`;
};

interface BookingProps {
    booking: Booking;
    open: boolean;
    onOpen: () => void;
    onChange: (patch: Partial<Booking>, field?: string) => void;
    onRemove: () => void;
}

/** A flight or hotel in Flights & hotels: what's booked, and when. */
const BookingCard = ({ booking: b, open, onOpen, onChange, onRemove }: BookingProps) => {
    const hotel = b.kind === "hotel";
    const when = hotel
        ? b.start && b.end
            ? `${formatDateRange({ start: b.start, end: b.end })} · ${count(nights(b), "night")}`
            : "Add the dates to put it on the days"
        : [b.start && dayLabel(b.start), b.time].filter(Boolean).join(", ") || "Add the date to put it on its day";
    const text = (field: keyof Booking, label: string, placeholder = "") => (
        <label>
            {label}
            <input value={(b[field] as string) ?? ""} placeholder={placeholder} onChange={(e) => onChange({ [field]: e.target.value }, field)} />
        </label>
    );
    const day = (field: "start" | "end", label: string, min?: string) => (
        <label>
            {label}
            <input type="date" value={b[field]} min={min || undefined} onChange={(e) => onChange({ [field]: e.target.value })} />
        </label>
    );
    const time = (field: "time" | "arrive", label: string) => (
        <label>
            {label}
            <input type="time" value={b[field]} onChange={(e) => onChange({ [field]: e.target.value })} />
        </label>
    );
    return (
        <li className={`plan-place plan-booking ${b.kind}${open ? " open" : ""}`} data-booking={b.key}>
            <button className="plan-place-head" onClick={onOpen}>
                <span className="num">{hotel ? <BedIcon /> : <PlaneIcon />}</span>
                <span className="plan-place-text">
                    <span className="name">{bookingTitle(b)}</span>
                    <span className="muted">{when}</span>
                    {!open && b.note && <span className="note">{b.note}</span>}
                </span>
            </button>
            {open && (
                <div className="plan-place-body">
                    {hotel ? (
                        <>
                            {text("name", "Hotel")}
                            <div className="plan-booking-grid">
                                {day("start", "Check in")}
                                {day("end", "Check out", b.start)}
                            </div>
                            {b.address && <span className="muted">{b.address}</span>}
                        </>
                    ) : (
                        <>
                            {text("name", "Flight", "e.g. BA 7")}
                            <div className="plan-booking-grid">
                                {text("from", "From", "e.g. LHR")}
                                {text("to", "To", "e.g. HND")}
                                {day("start", "Date")}
                                {time("time", "Leaves")}
                                {day("end", "Lands (if another day)", b.start)}
                                {time("arrive", "Lands")}
                            </div>
                        </>
                    )}
                    <textarea
                        value={b.note}
                        placeholder={hotel ? "Booking number, check-in time…" : "Booking number, terminal, seats…"}
                        rows={Math.min(6, b.note.split("\n").length + 1)}
                        onChange={(e) => onChange({ note: e.target.value }, "note")}
                    />
                    <div className="plan-place-foot">
                        <span className="muted plan-booking-hint">{hotel ? "Shows on each day of the stay. The trip grows to fit its dates." : "Shows on its day."}</span>
                        <button className="link danger" onClick={onRemove}>
                            Remove
                        </button>
                    </div>
                </div>
            )}
        </li>
    );
};

const BedIcon = () => (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path d="M3 18V6M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="7" cy="11" r="1.8" fill="currentColor" />
    </svg>
);

const PlaneIcon = () => (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path d="M21 15.5v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0v5l-8 5v2l8-2.5V18l-2 1.5V21l3.5-1 3.5 1v-1.5L13 18v-5z" fill="currentColor" />
    </svg>
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
                data-own-undo
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
