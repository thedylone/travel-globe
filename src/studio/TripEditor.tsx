import { useEffect, useState } from "react";
import type { LatLng } from "../lib/geo";
import { ApiError, api, type Base, type PhotoFlag, siteUrl, type TripView, uploadAll } from "./api";
import {
    type Draft,
    type DraftStop,
    emptyDraft,
    emptyStop,
    fromDraft,
    makeCover,
    mergeIntoPrevious,
    movePhoto,
    moveStop,
    removePhoto,
    removable,
    removePhotos,
    toDraft,
} from "./draft";
import { HEIC, MEDIA } from "./ImportView";
import { StopMap, useMapLayout } from "./StopMap";

interface Props {
    /** The trip to edit; none = a new trip. */
    id?: string;
    bases: Base[];
    onDirty: (dirty: boolean) => void;
    onChanged: (id?: string) => void;
}

type Status =
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "saved" }
    | { kind: "adding"; done: number; of: number }
    | { kind: "added"; message: string }
    | { kind: "error"; message: string; errors: string[] };

const DRAG_PHOTO = "application/x-studio-photo";
const DRAG_STOP = "application/x-studio-stop";

/** Each stop's photos to check for blur and repeats; videos are skipped. */
const reviewIds = (stops: DraftStop[]) => stops.map((s) => s.media.filter((m) => m.kind === "image").map((m) => m.id));

export const TripEditor = ({ id, bases, onDirty, onChanged }: Props) => {
    const [view, setView] = useState<TripView>();
    const [draft, setDraft] = useState<Draft | undefined>(id ? undefined : emptyDraft());
    const [dirty, setDirtyState] = useState(false);
    const [status, setStatus] = useState<Status>({ kind: "idle" });
    const [loadError, setLoadError] = useState<string>();
    /** The stop being edited, and the one the next click on the map places (by key). */
    const [active, setActive] = useState<number>();
    const [placing, setPlacing] = useState<number>();
    const [layout, resetLookups] = useMapLayout(draft, bases);
    /** Photos that look blurry or repeat another, from the last check; dropped from here when you keep one. */
    const [flags, setFlags] = useState<Record<string, PhotoFlag>>();
    const [checking, setChecking] = useState(false);
    const check = (stops: DraftStop[]) => {
        setChecking(true);
        api.review(reviewIds(stops))
            .then(setFlags, () => setFlags(undefined))
            .finally(() => setChecking(false));
    };

    useEffect(() => {
        if (!id) return;
        api.trip(id).then(
            (v) => {
                setView(v);
                const d = toDraft(v);
                setDraft(d);
                check(d.stops);
            },
            (e: Error) => setLoadError(e.message)
        );
    }, [id]);

    const setDirty = (d: boolean) => {
        setDirtyState(d);
        onDirty(d);
    };
    const edit = (change: (d: Draft) => Draft) => {
        setDraft((d) => (d ? change(d) : d));
        setDirty(true);
        if (status.kind === "saved") setStatus({ kind: "idle" });
    };
    const editStops = (change: (s: DraftStop[]) => DraftStop[]) => edit((d) => ({ ...d, stops: change(d.stops) }));
    const editStop = (i: number, patch: Partial<DraftStop>) =>
        editStops((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    const placeStop = (key: number, at: LatLng) =>
        editStops((s) => s.map((x) => (x.key === key ? { ...x, lat: String(at.lat), lng: String(at.lng) } : x)));
    // From the map: show that stop's card.
    const selectStop = (key: number) => {
        setActive(key);
        document.querySelector(`[data-stop="${key}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    };

    if (loadError) return <p className="studio-error">Couldn't open {id}: {loadError}</p>;
    if (!draft || !layout) return <p className="muted">Loading…</p>;

    const save = async () => {
        setStatus({ kind: "saving" });
        try {
            const v = id ? await api.save(id, fromDraft(draft)) : await api.create(fromDraft(draft));
            setDirty(false);
            setStatus({ kind: "saved" });
            if (!id) return onChanged(v.id);
            // Saving put any new places in data/places.json.
            resetLookups();
            setView(v);
            setDraft(toDraft(v));
            onChanged(v.id);
        } catch (e) {
            setStatus({
                kind: "error",
                message: (e as Error).message,
                errors: e instanceof ApiError ? (e.body.errors ?? []) : [],
            });
        }
    };
    const remove = async () => {
        const photos = new Set(draft.stops.flatMap((s) => s.media.map((m) => m.id))).size;
        const what = photos ? ` and its ${photos} photo(s) (from photos/, public/photos/ and data/photos.json; ones another trip shows are kept)` : "";
        if (!id || !confirm(`Delete data/trips/${id}.yaml${what}? This can't be undone.`)) return;
        try {
            await api.remove(id);
        } catch (e) {
            return setStatus({ kind: "error", message: `Couldn't delete: ${(e as Error).message}`, errors: [] });
        }
        setDirty(false);
        onChanged();
    };
    /** Uploads more photos and adds them to the stops they were taken at (or new stops). */
    const addPhotos = async (picked: File[]) => {
        if (!id) return;
        const heic = picked.filter((f) => HEIC.test(f.name));
        if (heic.length) {
            return setStatus({
                kind: "error",
                message: `${heic.length} HEIC photo(s) can't be read yet. Export them as JPEG and pick them again.`,
                errors: [],
            });
        }
        const files = picked.filter((f) => MEDIA.test(f.name) && !f.name.startsWith("."));
        if (!files.length) return;
        const batch = crypto.randomUUID();
        try {
            setStatus({ kind: "adding", done: 0, of: files.length });
            await uploadAll(batch, files, (done) => setStatus({ kind: "adding", done, of: files.length }));
            setStatus({ kind: "adding", done: files.length, of: files.length });
            const r = await api.addPhotos(id, { batch, km: 15 });
            resetLookups();
            setView(r.view);
            const d = toDraft(r.view);
            setDraft(d);
            check(d.stops);
            const parts = [
                r.added ? `added ${r.added} photo(s)` : "no new photos",
                r.newStops ? `${r.newStops} new stop(s)` : "",
                r.unplaced ? `${r.unplaced} without a date or place left in unsorted/` : "",
                r.skipped ? `${r.skipped} already in the trip` : "",
            ].filter(Boolean);
            setStatus({ kind: "added", message: parts.join(", ") });
            onChanged(id);
        } catch (e) {
            setStatus({
                kind: "error",
                message: `Couldn't add the photos: ${(e as Error).message}`,
                errors: e instanceof ApiError ? (e.body.log ?? []) : [],
            });
        }
    };

    const problems = status.kind === "error" ? status.errors : (view?.errors ?? []);
    const flagged = removable(draft.stops, flags ?? {});
    const keep = (photo: string) =>
        setFlags((f) => {
            const { [photo]: _, ...rest } = f ?? {};
            return rest;
        });
    const baseList = bases.map((b) => b.key);

    return (
        <div className="editor">
            <div className="editor-head">
                <input
                    className="editor-title"
                    value={draft.title}
                    placeholder="Trip title"
                    onChange={(e) => edit((d) => ({ ...d, title: e.target.value }))}
                />
                <div className="editor-buttons">
                    {id && (
                        <a className="button" href={`${siteUrl("")}#trip=${encodeURIComponent(id)}`} target="_blank" rel="noreferrer">
                            On the globe ↗
                        </a>
                    )}
                    {id &&
                        (dirty || status.kind === "adding" ? (
                            <button disabled title={dirty ? "Save your changes first" : undefined}>
                                {status.kind === "adding"
                                    ? status.done < status.of
                                        ? `Copying ${status.done}/${status.of}…`
                                        : "Adding…"
                                    : "Add photos"}
                            </button>
                        ) : (
                            <label className="button" title="Each joins the stop it was taken at; the rest make new stops">
                                Add photos
                                <input
                                    type="file"
                                    hidden
                                    multiple
                                    accept="image/*,video/*"
                                    onChange={(e) => {
                                        addPhotos([...(e.target.files ?? [])]);
                                        e.target.value = "";
                                    }}
                                />
                            </label>
                        ))}
                    {id && (
                        <button className="danger" disabled={status.kind === "adding"} onClick={remove}>
                            Delete
                        </button>
                    )}
                    <button className="primary" disabled={(!dirty && !!id) || status.kind === "saving"} onClick={save}>
                        {status.kind === "saving" ? "Saving…" : id ? "Save" : "Create"}
                    </button>
                </div>
            </div>
            <p className="muted editor-file">
                {id ? `data/trips/${id}.yaml` : "Saved as data/trips/<year-month>-<title>.yaml"}
                {status.kind === "saved" && " · saved"}
                {status.kind === "added" && ` · ${status.message}`}
                {dirty && " · unsaved changes"}
            </p>

            <div className="editor-fields">
                <label>
                    From
                    <input list="studio-bases" value={draft.from} placeholder="home, or a place" onChange={(e) => edit((d) => ({ ...d, from: e.target.value }))} />
                </label>
                <label>
                    To
                    <input list="studio-bases" value={draft.to} placeholder="if not where it started" onChange={(e) => edit((d) => ({ ...d, to: e.target.value }))} />
                </label>
                <label>
                    Country codes
                    <input value={draft.country} placeholder="e.g. jp or gb,ie" onChange={(e) => edit((d) => ({ ...d, country: e.target.value }))} />
                </label>
                <datalist id="studio-bases">
                    {baseList.map((b) => (
                        <option key={b} value={b} />
                    ))}
                </datalist>
            </div>

            {status.kind === "error" && <p className="studio-error">{status.message}</p>}
            {problems.length > 0 && (
                <ul className="editor-problems">
                    {problems.map((p) => (
                        <li key={p}>{p}</li>
                    ))}
                </ul>
            )}
            {status.kind !== "error" && (view?.warnings.length ?? 0) > 0 && (
                <ul className="editor-warnings">
                    {view!.warnings.map((w) => (
                        <li key={w}>{w}</li>
                    ))}
                </ul>
            )}

            {flags && (
                <div className="editor-review">
                    {flagged.size ? (
                        <>
                            <span>
                                {flagged.size} photo{flagged.size === 1 ? " looks" : "s look"} blurry or repeat{flagged.size === 1 ? "s" : ""} another;
                                they're marked below. Click a mark to keep that photo.
                            </span>
                            <button onClick={() => editStops((st) => removePhotos(st, flagged))}>Remove {flagged.size === 1 ? "it" : `all ${flagged.size}`}</button>
                        </>
                    ) : (
                        <span className="muted">No blurry or repeated photos {Object.keys(flags).length ? "left" : "found"}.</span>
                    )}
                    <button className="link" disabled={checking} onClick={() => check(draft.stops)}>
                        {checking ? "Checking…" : "Check again"}
                    </button>
                </div>
            )}

            <div className="editor-body">
                <div>
                    <ol className="stops">
                        {draft.stops.map((s, i) => (
                            <StopCard
                                key={s.key}
                                stop={s}
                                active={s.key === active}
                                placing={s.key === placing}
                                onFocus={() => setActive(s.key)}
                                onPlace={() => setPlacing(placing === s.key ? undefined : s.key)}
                                index={i}
                                count={draft.stops.length}
                                base={draft.stops.slice(0, i).findLast((x) => !x.side)?.place}
                                onChange={(patch) => editStop(i, patch)}
                                onMove={(by) => editStops((st) => moveStop(st, i, i + by))}
                                onDropStop={(from) => editStops((st) => moveStop(st, from, i))}
                                onMerge={() => editStops((st) => mergeIntoPrevious(st, i))}
                                onDelete={() => {
                                    if (s.media.length && !confirm(`Remove this stop? Its ${s.media.length} photo(s) stay on disk.`)) return;
                                    editStops((st) => st.filter((_, j) => j !== i));
                                }}
                                onDropPhoto={(photo, from) => editStops((st) => movePhoto(st, photo, from, i))}
                                onRemovePhoto={(photo) => editStops((st) => removePhoto(st, photo, i))}
                                onCover={(photo) => {
                                    editStops((st) => makeCover(st, photo, i));
                                    keep(photo);
                                }}
                                flags={flags}
                                onKeep={keep}
                            />
                        ))}
                    </ol>
                    <button onClick={() => editStops((st) => [...st, emptyStop()])}>Add a stop</button>
                </div>
                <StopMap layout={layout} active={active} placing={placing} onSelect={selectStop} onPlace={setPlacing} onMove={placeStop} />
            </div>
        </div>
    );
};

interface StopProps {
    stop: DraftStop;
    index: number;
    count: number;
    active: boolean;
    /** Waiting for a click on the map to place it. */
    placing: boolean;
    onFocus: () => void;
    onPlace: () => void;
    /** The main stop a side trip goes out from. */
    base?: string;
    onChange: (patch: Partial<DraftStop>) => void;
    onDropStop: (from: number) => void;
    onMove: (by: -1 | 1) => void;
    onMerge: () => void;
    onDelete: () => void;
    onDropPhoto: (photo: string, from: number) => void;
    onRemovePhoto: (photo: string) => void;
    /** Make this photo the stop's first, the one its photos open on. */
    onCover: (photo: string) => void;
    flags?: Record<string, PhotoFlag>;
    /** Drop a photo's blurry or repeat mark. */
    onKeep: (photo: string) => void;
}

const StopCard = ({ stop, index, count, active, placing, onFocus, onPlace, base, onChange, onMove, onDropStop, onMerge, onDelete, onDropPhoto, onRemovePhoto, onCover, flags, onKeep }: StopProps) => {
    const [over, setOver] = useState(false);
    const hasAt = stop.lat.trim() !== "" && stop.lng.trim() !== "";
    return (
        <li
            data-stop={stop.key}
            className={`stop ${stop.side ? "side" : ""} ${over ? "drop" : ""} ${active ? "active" : ""}`}
            onFocus={onFocus}
            onClick={onFocus}
            onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(DRAG_PHOTO) && !e.dataTransfer.types.includes(DRAG_STOP)) return;
                e.preventDefault();
                setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
                setOver(false);
                const stopFrom = e.dataTransfer.getData(DRAG_STOP);
                if (stopFrom) return onDropStop(Number(stopFrom));
                const data = e.dataTransfer.getData(DRAG_PHOTO);
                if (!data) return;
                const { photo, from } = JSON.parse(data) as { photo: string; from: number };
                onDropPhoto(photo, from);
            }}
        >
            <div className="stop-head">
                <span
                    className="stop-n"
                    draggable
                    title="Drag to reorder"
                    onDragStart={(e) => {
                        e.dataTransfer.setData(DRAG_STOP, String(index));
                        e.dataTransfer.effectAllowed = "move";
                        const card = e.currentTarget.closest("li");
                        if (card) e.dataTransfer.setDragImage(card, 20, 20);
                    }}
                >
                    {index + 1}
                </span>
                <input
                    className="stop-place"
                    value={stop.place}
                    placeholder="Place, e.g. Kraków"
                    onChange={(e) => onChange({ place: e.target.value })}
                />
                <div className="stop-tools">
                    <button title="Move up" disabled={index === 0} onClick={() => onMove(-1)}>↑</button>
                    <button title="Move down" disabled={index === count - 1} onClick={() => onMove(1)}>↓</button>
                    <button title="Merge into the stop above" disabled={index === 0} onClick={onMerge}>Merge up</button>
                    <button title="Remove this stop" className="danger" onClick={onDelete}>✕</button>
                </div>
            </div>
            <div className="stop-fields">
                <label>
                    Date
                    <input value={stop.date} placeholder="2024-03-07 or 2024-03-07..2024-03-09" onChange={(e) => onChange({ date: e.target.value })} />
                </label>
                <label className="check" title="Out from the stop before it and back again, e.g. a day trip">
                    <input type="checkbox" checked={stop.side} disabled={index === 0} onChange={(e) => onChange({ side: e.target.checked })} />
                    {stop.side && base ? `Side trip from ${base}` : "Side trip"}
                </label>
                <label>
                    Label
                    <input value={stop.name} placeholder="if different from the place" onChange={(e) => onChange({ name: e.target.value })} />
                </label>
                <label className="narrow">
                    Lat
                    <input value={stop.lat} inputMode="decimal" placeholder="looked up" onChange={(e) => onChange({ lat: e.target.value })} />
                </label>
                <label className="narrow">
                    Lng
                    <input value={stop.lng} inputMode="decimal" placeholder="looked up" onChange={(e) => onChange({ lng: e.target.value })} />
                </label>
                <button className="link" title="Then click the map where this stop is" onClick={onPlace}>
                    {placing ? "Click the map…" : "Place on map"}
                </button>
                {hasAt && (
                    <button className="link" title="Clear lat/lng so the place name is looked up instead" onClick={() => onChange({ lat: "", lng: "" })}>
                        Look up by name
                    </button>
                )}
            </div>
            <label className="stop-note">
                Note
                <textarea rows={stop.note ? 2 : 1} value={stop.note} placeholder="Shown with the photos" onChange={(e) => onChange({ note: e.target.value })} />
            </label>
            <div className="photos">
                {stop.media.map((m, n) => {
                    const flag = flags?.[m.id];
                    return (
                        <figure
                            key={m.id}
                            className={`${n === 0 ? "cover" : ""} ${flag ? "flagged" : ""}`}
                            draggable
                            title={`${m.id} · ${n === 0 ? "the cover: shown first" : "click to make it the cover"} · drag to another stop`}
                            onClick={() => onCover(m.id)}
                            onDragStart={(e) => {
                                e.stopPropagation();
                                e.dataTransfer.setData(DRAG_PHOTO, JSON.stringify({ photo: m.id, from: index }));
                            }}
                        >
                            <img src={siteUrl(m.thumb)} alt={m.id} loading="lazy" />
                            {m.kind === "video" && <span className="video">▶</span>}
                            {n === 0 && stop.media.length > 1 && <span className="badge">Cover</span>}
                            {flag && (
                                <button
                                    className="mark"
                                    title={`${flag.blurry ? "Looks blurry" : `Looks like ${flag.similarTo}, which is kept`}. Click to keep this one.`}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onKeep(m.id);
                                    }}
                                >
                                    {flag.blurry ? "Blurry" : "Repeat"}
                                </button>
                            )}
                            <button
                                className="remove"
                                title="Remove from this stop"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onRemovePhoto(m.id);
                                }}
                            >
                                ✕
                            </button>
                        </figure>
                    );
                })}
                {!stop.media.length && <p className="muted">No photos. Drag some here from another stop.</p>}
            </div>
        </li>
    );
};
