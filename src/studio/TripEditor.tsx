import { useEffect, useState } from "react";
import { ApiError, api, type Base, siteUrl, type TripView } from "./api";
import {
    type Draft,
    type DraftStop,
    emptyDraft,
    emptyStop,
    fromDraft,
    mergeIntoPrevious,
    movePhoto,
    moveStop,
    removePhoto,
    toDraft,
} from "./draft";

interface Props {
    /** The trip to edit; none = a new trip. */
    id?: string;
    bases: Base[];
    onDirty: (dirty: boolean) => void;
    onChanged: (id?: string) => void;
}

type Status = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string; errors: string[] };

const DRAG_TYPE = "application/x-studio-photo";

export const TripEditor = ({ id, bases, onDirty, onChanged }: Props) => {
    const [view, setView] = useState<TripView>();
    const [draft, setDraft] = useState<Draft | undefined>(id ? undefined : emptyDraft());
    const [dirty, setDirtyState] = useState(false);
    const [status, setStatus] = useState<Status>({ kind: "idle" });
    const [loadError, setLoadError] = useState<string>();

    useEffect(() => {
        if (!id) return;
        api.trip(id).then(
            (v) => {
                setView(v);
                setDraft(toDraft(v));
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

    if (loadError) return <p className="studio-error">Couldn't open {id}: {loadError}</p>;
    if (!draft) return <p className="muted">Loading…</p>;

    const save = async () => {
        setStatus({ kind: "saving" });
        try {
            const v = id ? await api.save(id, fromDraft(draft)) : await api.create(fromDraft(draft));
            setDirty(false);
            setStatus({ kind: "saved" });
            if (!id) return onChanged(v.id);
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
        if (!id || !confirm(`Delete data/trips/${id}.yaml? Its photos stay in photos/ and public/photos/.`)) return;
        await api.remove(id);
        setDirty(false);
        onChanged();
    };

    const problems = status.kind === "error" ? status.errors : (view?.errors ?? []);
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
                    {id && (
                        <button className="danger" onClick={remove}>
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

            <ol className="stops">
                {draft.stops.map((s, i) => (
                    <StopCard
                        key={s.key}
                        stop={s}
                        index={i}
                        count={draft.stops.length}
                        onChange={(patch) => editStop(i, patch)}
                        onMove={(by) => editStops((st) => moveStop(st, i, by))}
                        onMerge={() => editStops((st) => mergeIntoPrevious(st, i))}
                        onDelete={() => {
                            if (s.media.length && !confirm(`Remove this stop? Its ${s.media.length} photo(s) stay on disk.`)) return;
                            editStops((st) => st.filter((_, j) => j !== i));
                        }}
                        onDropPhoto={(photo, from) => editStops((st) => movePhoto(st, photo, from, i))}
                        onRemovePhoto={(photo) => editStops((st) => removePhoto(st, photo, i))}
                    />
                ))}
            </ol>
            <button onClick={() => editStops((st) => [...st, emptyStop()])}>Add a stop</button>
        </div>
    );
};

interface StopProps {
    stop: DraftStop;
    index: number;
    count: number;
    onChange: (patch: Partial<DraftStop>) => void;
    onMove: (by: -1 | 1) => void;
    onMerge: () => void;
    onDelete: () => void;
    onDropPhoto: (photo: string, from: number) => void;
    onRemovePhoto: (photo: string) => void;
}

const StopCard = ({ stop, index, count, onChange, onMove, onMerge, onDelete, onDropPhoto, onRemovePhoto }: StopProps) => {
    const [over, setOver] = useState(false);
    const hasAt = stop.lat.trim() !== "" && stop.lng.trim() !== "";
    return (
        <li
            className={`stop ${over ? "drop" : ""}`}
            onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
                e.preventDefault();
                setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
                setOver(false);
                const data = e.dataTransfer.getData(DRAG_TYPE);
                if (!data) return;
                const { photo, from } = JSON.parse(data) as { photo: string; from: number };
                onDropPhoto(photo, from);
            }}
        >
            <div className="stop-head">
                <span className="stop-n">{index + 1}</span>
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
                {hasAt && (
                    <a
                        className="stop-map"
                        href={`https://www.openstreetmap.org/?mlat=${stop.lat}&mlon=${stop.lng}#map=12/${stop.lat}/${stop.lng}`}
                        target="_blank"
                        rel="noreferrer"
                    >
                        Map ↗
                    </a>
                )}
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
                {stop.media.map((m) => (
                    <figure
                        key={m.id}
                        draggable
                        title={`${m.id} · drag to another stop`}
                        onDragStart={(e) => e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ photo: m.id, from: index }))}
                    >
                        <img src={siteUrl(m.thumb)} alt={m.id} loading="lazy" />
                        {m.kind === "video" && <span className="video">▶</span>}
                        <button title="Remove from this stop" onClick={() => onRemovePhoto(m.id)}>✕</button>
                    </figure>
                ))}
                {!stop.media.length && <p className="muted">No photos. Drag some here from another stop.</p>}
            </div>
        </li>
    );
};
