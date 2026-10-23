import { useCallback, useEffect, useState } from "react";
import { formatDateRange } from "../lib/dates";
import { api, type Base, type TripSummary } from "./api";
import { type Draft, draftFromFile } from "./draft";
import { ImportView } from "./ImportView";
import { TripEditor } from "./TripEditor";

/** What the main pane shows, kept in the URL hash so a reload stays put. */
type View = { kind: "trip"; id: string } | { kind: "new" } | { kind: "import" } | { kind: "none" };

const readHash = (): View => {
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get("trip")) return { kind: "trip", id: h.get("trip")! };
    if (h.has("new")) return { kind: "new" };
    if (h.has("import")) return { kind: "import" };
    return { kind: "none" };
};
const hashFor = (v: View) =>
    v.kind === "trip" ? `#trip=${encodeURIComponent(v.id)}` : v.kind === "none" ? "#" : `#${v.kind}`;

export const Studio = () => {
    const [view, setView] = useState<View>(readHash);
    const [trips, setTrips] = useState<TripSummary[]>();
    const [bases, setBases] = useState<Base[]>([]);
    const [error, setError] = useState<string>();
    const [dirty, setDirty] = useState(false);
    /** A trip file opened with "Open a planned trip", shown as a new trip until it's created. */
    const [planned, setPlanned] = useState<{ draft: Draft; n: number }>();

    const refresh = useCallback(() => {
        api.trips().then(setTrips, (e: Error) => setError(`Couldn't load trips: ${e.message}`));
    }, []);
    useEffect(() => {
        refresh();
        api.bases().then(setBases, () => setBases([]));
    }, [refresh]);
    useEffect(() => {
        const onHash = () => setView(readHash());
        addEventListener("hashchange", onHash);
        return () => removeEventListener("hashchange", onHash);
    }, []);

    const go = (v: View) => {
        if (dirty && !confirm("Discard unsaved changes?")) return;
        setDirty(false);
        setPlanned(undefined);
        history.pushState(null, "", hashFor(v));
        setView(v);
    };
    const openPlanned = async (file: File) => {
        if (dirty && !confirm("Discard unsaved changes?")) return;
        try {
            const draft = draftFromFile(await file.text());
            setError(undefined);
            setDirty(true);
            setPlanned((p) => ({ draft, n: (p?.n ?? 0) + 1 }));
            history.pushState(null, "", hashFor({ kind: "new" }));
            setView({ kind: "new" });
        } catch (e) {
            setError(`Couldn't open ${file.name}: ${(e as Error).message}`);
        }
    };
    // Called once a trip has been saved, created, imported or deleted.
    const changed = (id?: string) => {
        setDirty(false);
        setPlanned(undefined);
        refresh();
        const v: View = id ? { kind: "trip", id } : { kind: "none" };
        history.replaceState(null, "", hashFor(v));
        setView(v);
    };

    return (
        <div className="studio">
            <aside className="studio-side">
                <header>
                    <h1>Studio</h1>
                    <a href={import.meta.env.BASE_URL} target="_blank" rel="noreferrer">
                        Globe ↗
                    </a>
                </header>
                <div className="studio-actions">
                    <button className="primary" onClick={() => go({ kind: "import" })}>
                        Import photos
                    </button>
                    <button onClick={() => go({ kind: "new" })}>New trip</button>
                    <label className="button" title="A trip file from the trip planner on your phone">
                        Open a planned trip
                        <input
                            type="file"
                            hidden
                            accept=".yaml,.yml"
                            onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) void openPlanned(f);
                                e.target.value = "";
                            }}
                        />
                    </label>
                </div>
                {error && <p className="studio-error">{error}</p>}
                <ul className="studio-trips">
                    {trips?.map((t) => (
                        <li key={t.id}>
                            <button
                                className={view.kind === "trip" && view.id === t.id ? "active" : ""}
                                onClick={() => go({ kind: "trip", id: t.id })}
                            >
                                <span className="title">
                                    {t.title}
                                    {t.errors > 0 && (
                                        <span className="badge" title={`${t.errors} problem(s)`}>
                                            {t.errors}
                                        </span>
                                    )}
                                </span>
                                <span className="muted">
                                    {t.start ? formatDateRange({ start: t.start, end: t.end ?? t.start }) : "no dates yet"} · {t.stops}{" "}
                                    {t.stops === 1 ? "stop" : "stops"}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            </aside>
            <main className="studio-main">
                {view.kind === "trip" && (
                    <TripEditor key={view.id} id={view.id} bases={bases} onDirty={setDirty} onChanged={changed} />
                )}
                {view.kind === "new" && (
                    <TripEditor
                        key={`new-${planned?.n ?? 0}`}
                        initial={planned?.draft}
                        bases={bases}
                        onDirty={setDirty}
                        onChanged={changed}
                    />
                )}
                {view.kind === "import" && <ImportView bases={bases} onImported={changed} />}
                {view.kind === "none" && (
                    <div className="studio-empty">
                        <h2>Add a trip</h2>
                        <p>
                            <b>Import photos</b> makes a draft trip from a trip's photos: it reads where and when each
                            was taken, groups them into stops and names them. <b>New trip</b> starts an empty one.
                            Or pick a trip on the left to edit it.
                        </p>
                        <p>
                            <b>Open a planned trip</b> opens a trip exported from the{" "}
                            <a href={`${import.meta.env.BASE_URL}planner/`} target="_blank" rel="noreferrer">
                                trip planner
                            </a>
                            , so you can check its places, create it, then add its photos.
                        </p>
                        <p className="muted">
                            Changes are saved to the trip files in your data folder. Commit and push them to publish.
                        </p>
                    </div>
                )}
            </main>
        </div>
    );
};
