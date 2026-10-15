import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import data from "virtual:travel-data";
import { type GlobeHandle, type GlobeSettings, GlobeView, type View } from "./components/GlobeView";
import { Panel } from "./components/Panel";
import { PlaceDialog } from "./components/PlaceDialog";
import { Timeline } from "./components/Timeline";
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
const DEFAULT_SETTINGS: GlobeSettings = { rotate: true, night: false, style: "satellite", borders: false };
const loadSettings = (): GlobeSettings => {
    try {
        const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
        // Keep only settings that still exist, with the right type.
        const s = { ...DEFAULT_SETTINGS };
        for (const k of ["rotate", "night", "borders"] as const) if (typeof saved[k] === "boolean") s[k] = saved[k];
        if (saved.style === "satellite" || saved.style === "map") s.style = saved.style;
        return s;
    } catch {
        return DEFAULT_SETTINGS;
    }
};

/** How long play mode stays on each trip. */
const playMs = (trip: Trip) => Math.min(8000, 3000 + trip.stops.length * 600);

const OVERVIEW_ALTITUDE = 2.2;
const STOP_ALTITUDE = 0.6;
const NARROW = 900; // px; below this the panel and timeline are sheets over the globe
const PANEL_WIDTH = 300; // keep in sync with --panel-width
const isNarrow = () => window.innerWidth < NARROW;

const useNarrow = () => {
    const [narrow, setNarrow] = useState(isNarrow);
    useEffect(() => {
        const onResize = () => setNarrow(isNarrow());
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);
    return narrow;
};

const useHeight = (el: HTMLElement | null) => {
    const [height, setHeight] = useState(0);
    useEffect(() => {
        if (!el) return;
        const ro = new ResizeObserver(([entry]) => setHeight(entry.borderBoxSize[0]?.blockSize ?? el.offsetHeight));
        ro.observe(el);
        return () => ro.disconnect();
    }, [el]);
    return height;
};

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
    const [timelineOpen, setTimelineOpen] = useState(false);
    const [playing, setPlaying] = useState(false);
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
    const visitedCountries = useMemo(
        () => new Set(visibleTrips.flatMap((t) => t.stops.flatMap((s) => (s.country ? [s.country] : [])))),
        [visibleTrips]
    );
    const stats = useMemo(
        () => ({
            places: places.length,
            countries: visitedCountries.size,
            km: visibleTrips.reduce((km, t) => km + tripKm(t), 0),
        }),
        [places, visibleTrips, visitedCountries]
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
    // Focus changes the user asks for also stop play mode.
    const userFocus = useCallback((tripId: string | undefined) => {
        setPlaying(false);
        setFocus(tripId);
    }, [setFocus]);
    const toggleFocus = (tripId: string) => userFocus(route.focus === tripId ? undefined : tripId);

    // Play mode: fly through the visible trips in date order, then back out.
    useEffect(() => {
        if (!playing) return;
        const order = trips.filter((t) => !hidden.has(t.id));
        const i = order.findIndex((t) => t.id === route.focus);
        const current = order[i];
        const timer = setTimeout(() => {
            const next = order[i + 1];
            if (next) setFocus(next.id);
            else {
                setPlaying(false);
                setFocus(undefined);
            }
        }, current ? playMs(current) : 0);
        return () => clearTimeout(timer);
    }, [playing, route.focus, hidden, setFocus]);
    const play = useCallback((on: boolean) => {
        if (on && route.focus === trips.filter((t) => !hidden.has(t.id)).at(-1)?.id) setFocus(undefined); // restart
        setPlaying(on);
    }, [route.focus, hidden, setFocus]);

    // On phones the panel and timeline share the bottom of the screen: one at a time.
    const narrow = useNarrow();
    const togglePanel = () => {
        if (!panelOpen && isNarrow()) setTimelineOpen(false);
        setPanelOpen(!panelOpen);
    };
    const toggleTimeline = useCallback(() => {
        setTimelineOpen((open) => {
            if (!open && isNarrow()) setPanelOpen(false);
            return !open;
        });
    }, []);
    const [timelineEl, setTimelineEl] = useState<HTMLElement | null>(null);
    const timelineHeight = useHeight(timelineEl);
    const inset = narrow
        ? { left: 0, bottom: 0 }
        : { left: panelOpen ? PANEL_WIDTH : 0, bottom: timelineOpen ? timelineHeight : 0 };

    const openVisit = visitFor(route.stop);
    const dialogList = useMemo(() => {
        if (!openVisit) return [];
        const inList = dialogVisits?.some((v) => v.trip.id === openVisit.trip.id && v.stopIndex === openVisit.stopIndex);
        if (dialogVisits && inList) return dialogVisits;
        return findPlace(allPlaces, openVisit.trip.id, openVisit.stopIndex)?.visits ?? [openVisit];
    }, [openVisit?.trip.id, openVisit?.stopIndex, dialogVisits]); // eslint-disable-line react-hooks/exhaustive-deps

    const select = (v: Visit) => setRoute((r) => ({ ...r, stop: { tripId: v.trip.id, index: v.stopIndex } }));
    const onOpen = useCallback((visits: Visit[], initial: Visit) => {
        setPlaying(false);
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
            else if (key === "m") setSettings((s) => ({ ...s, style: s.style === "map" ? "satellite" : "map" }));
            else if (key === "b") setSettings((s) => ({ ...s, borders: !s.borders }));
            else if (key === "t") toggleTimeline();
            else if (key === "p") play(!playing);
            else if (key === "escape" && route.focus) userFocus(undefined);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [route.focus, userFocus, toggleTimeline, play, playing]);

    return (
        <div className="app" data-panel={panelOpen} data-timeline={timelineOpen}>
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
                visitedCountries={visitedCountries}
                inset={inset}
                onOpen={onOpen}
            />
            <Panel
                open={panelOpen}
                onToggle={togglePanel}
                trips={trips}
                hidden={hidden}
                setHidden={setHidden}
                focus={route.focus}
                onFocus={toggleFocus}
                colors={colors}
                stats={stats}
                settings={settings}
                setSettings={setSettings}
            />
            <button
                type="button"
                className="timeline-toggle"
                onClick={toggleTimeline}
                aria-expanded={timelineOpen}
                title="Timeline (T)"
            >
                <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18">
                    <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M4 7h16M4 12h10M4 17h13" />
                </svg>
                <span className="timeline-toggle__label">Timeline</span>
            </button>
            <Timeline
                ref={setTimelineEl}
                open={timelineOpen}
                trips={trips}
                hidden={hidden}
                focus={route.focus}
                colors={colors}
                playing={playing}
                onPlay={play}
                onFocus={toggleFocus}
                onClose={toggleTimeline}
                left={inset.left}
            />
            {focusTrip && (
                <div className="focus-banner" style={{ "--swatch": colors.get(focusTrip.id) } as React.CSSProperties}>
                    <span className="focus-banner__title">{focusTrip.title}</span>
                    <span className="focus-banner__date">{formatDateRange(focusTrip)}</span>
                    {playing && <span className="focus-banner__playing" aria-label="Playing">▶</span>}
                    <button type="button" onClick={() => userFocus(undefined)}>All trips</button>
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
                        userFocus(id);
                    }}
                    onClose={closeDialog}
                />
            )}
        </div>
    );
};
