import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import data from "virtual:travel-data";
import { type GlobeHandle, type GlobeSettings, GlobeView, type View } from "./components/GlobeView";
import { Panel } from "./components/Panel";
import { PlaceDialog } from "./components/PlaceDialog";
import { viewFor } from "./lib/cluster";
import { tripColors } from "./lib/colors";
import { formatDateRange } from "./lib/dates";
import { distanceKm, type LatLng } from "./lib/geo";
import { buildPlaces, filterPlaces, findPlace, type Visit } from "./lib/places";
import { parseHash, type Route, toHash } from "./lib/route";
import type { Trip } from "./types";

const { trips, bases } = data;
const tripsById = new Map(trips.map((t) => [t.id, t]));
const colors = tripColors(trips);
const allPlaces = buildPlaces(trips);

const SETTINGS_KEY = "travel-history:settings";
const DEFAULT_SETTINGS: GlobeSettings = { rotate: true, night: false, hd: false };
const loadSettings = (): GlobeSettings => {
    try {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
    } catch {
        return DEFAULT_SETTINGS;
    }
};

const OVERVIEW_ALTITUDE = 2.2;
const STOP_ALTITUDE = 0.6;
const isNarrow = () => window.innerWidth < 900;

const tripPoints = (trip: Trip): LatLng[] => trip.stops;
const tripKm = (trip: Trip) => {
    const pts: LatLng[] = [...(trip.from ? [trip.from] : []), ...trip.stops, ...(trip.to ? [trip.to] : [])];
    return pts.slice(1).reduce((km, p, i) => km + distanceKm(pts[i], p), 0);
};

const visitFor = (ref: Route["stop"]): Visit | undefined => {
    if (!ref) return undefined;
    const trip = tripsById.get(ref.tripId);
    const stop = trip?.stops[ref.index];
    return trip && stop ? { trip, stopIndex: ref.index, stop } : undefined;
};

const initialView = (route: Route): View => {
    const focus = route.focus && tripsById.get(route.focus);
    if (focus) return viewFor(tripPoints(focus), window.innerHeight);
    const open = visitFor(route.stop);
    if (open) return { lat: open.stop.lat, lng: open.stop.lng, altitude: STOP_ALTITUDE };
    const last = trips[trips.length - 1];
    return last ? { ...viewFor(tripPoints(last), window.innerHeight), altitude: OVERVIEW_ALTITUDE } : { lat: 20, lng: 0, altitude: OVERVIEW_ALTITUDE };
};

export const App = () => {
    const [route, setRoute] = useState(() => parseHash(location.hash));
    const [hidden, setHidden] = useState<Set<string>>(() => new Set());
    const [settings, setSettings] = useState(loadSettings);
    const [panelOpen, setPanelOpen] = useState(() => !isNarrow());
    // The visits listed in the open dialog (a place's visits, or a whole tight cluster).
    const [dialogVisits, setDialogVisits] = useState<Visit[] | null>(null);
    const globe = useRef<GlobeHandle>(null);
    const [startView] = useState(() => initialView(route));

    // Keep the URL in sync, and follow links that change it.
    useEffect(() => {
        const hash = toHash(route);
        if (hash !== location.hash) history.replaceState(null, "", hash || location.pathname + location.search);
    }, [route]);
    useEffect(() => {
        // A link to a stop or trip on this page: go there.
        const onHash = () => {
            const next = parseHash(location.hash);
            setRoute(next);
            const trip = next.focus && tripsById.get(next.focus);
            const visit = visitFor(next.stop);
            if (visit) globe.current?.flyTo({ lat: visit.stop.lat, lng: visit.stop.lng, altitude: STOP_ALTITUDE });
            else if (trip) globe.current?.flyTo(viewFor(tripPoints(trip), window.innerHeight));
        };
        window.addEventListener("hashchange", onHash);
        return () => window.removeEventListener("hashchange", onHash);
    }, []);

    useEffect(() => {
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        } catch {
            // Private mode etc.: settings just won't be remembered.
        }
    }, [settings]);

    const focusTrip = route.focus ? tripsById.get(route.focus) : undefined;
    const visibleTrips = useMemo(
        () => (focusTrip ? [focusTrip] : trips.filter((t) => !hidden.has(t.id))),
        [focusTrip, hidden]
    );
    const places = useMemo(() => filterPlaces(allPlaces, new Set(visibleTrips.map((t) => t.id))), [visibleTrips]);
    const stats = useMemo(
        () => ({ places: places.length, km: visibleTrips.reduce((km, t) => km + tripKm(t), 0) }),
        [places, visibleTrips]
    );

    const setFocus = useCallback((tripId: string | undefined) => {
        setRoute((r) => ({ ...r, focus: tripId }));
        const trip = tripId && tripsById.get(tripId);
        if (trip) {
            globe.current?.flyTo(viewFor(tripPoints(trip), window.innerHeight));
            if (isNarrow()) setPanelOpen(false);
        } else {
            globe.current?.zoomOut(OVERVIEW_ALTITUDE);
        }
    }, []);

    const openVisit = visitFor(route.stop);
    const dialogList = useMemo(() => {
        if (!openVisit) return [];
        const inList = dialogVisits?.some((v) => v.trip.id === openVisit.trip.id && v.stopIndex === openVisit.stopIndex);
        if (dialogVisits && inList) return dialogVisits;
        return findPlace(allPlaces, openVisit.trip.id, openVisit.stopIndex)?.visits ?? [openVisit];
    }, [openVisit?.trip.id, openVisit?.stopIndex, dialogVisits]); // eslint-disable-line react-hooks/exhaustive-deps

    const select = (v: Visit) => setRoute((r) => ({ ...r, stop: { tripId: v.trip.id, index: v.stopIndex } }));
    const onOpen = useCallback((visits: Visit[], initial: Visit) => {
        setDialogVisits(visits);
        setRoute((r) => ({ ...r, stop: { tripId: initial.trip.id, index: initial.stopIndex } }));
    }, []);
    const closeDialog = useCallback(() => {
        setDialogVisits(null);
        setRoute((r) => ({ ...r, stop: undefined }));
    }, []);

    // Keyboard shortcuts (ignored while typing or when a dialog has focus).
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.ctrlKey || e.metaKey || e.altKey || e.target instanceof HTMLInputElement) return;
            if (document.querySelector("dialog[open]")) return;
            const key = e.key.toLowerCase();
            if (key === "r") setSettings((s) => ({ ...s, rotate: !s.rotate }));
            else if (key === "d") setSettings((s) => ({ ...s, night: !s.night }));
            else if (key === "h") setSettings((s) => ({ ...s, hd: !s.hd }));
            else if (key === "escape" && route.focus) setFocus(undefined);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [route.focus, setFocus]);

    return (
        <>
            <GlobeView
                ref={globe}
                trips={visibleTrips}
                places={places}
                bases={bases}
                colors={colors}
                settings={settings}
                initialView={startView}
                paused={!!openVisit || !!focusTrip}
                highlight={openVisit?.stop}
                onOpen={onOpen}
            />
            <Panel
                open={panelOpen}
                onToggle={() => setPanelOpen((o) => !o)}
                trips={trips}
                hidden={hidden}
                setHidden={setHidden}
                focus={route.focus}
                onFocus={(id) => setFocus(route.focus === id ? undefined : id)}
                colors={colors}
                stats={stats}
                settings={settings}
                setSettings={setSettings}
            />
            {focusTrip && (
                <div className="focus-banner" style={{ "--swatch": colors.get(focusTrip.id) } as React.CSSProperties}>
                    <span className="focus-banner__title">{focusTrip.title}</span>
                    <span className="focus-banner__date">{formatDateRange(focusTrip)}</span>
                    <button type="button" onClick={() => setFocus(undefined)}>All trips</button>
                </div>
            )}
            {openVisit && (
                <PlaceDialog
                    visits={dialogList}
                    current={openVisit}
                    colors={colors}
                    onSelect={select}
                    onFocusTrip={(id) => {
                        closeDialog();
                        setFocus(id);
                    }}
                    onClose={closeDialog}
                />
            )}
        </>
    );
};
