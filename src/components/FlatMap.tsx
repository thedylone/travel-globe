import { geoEqualEarth, geoPath } from "d3-geo";
import type { FeatureCollection, LineString } from "geojson";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type CountryFeature, loadCountries, splitCountries, visitedParts } from "../lib/borders";
import type { LatLng } from "../lib/geo";
import type { Place, Visit } from "../lib/places";
import { countryLabel, percent, plural, type TravelStats } from "../lib/stats";
import type { Trip } from "../types";

interface Props {
    trips: Trip[];
    places: Place[];
    colors: Map<string, string>;
    focusTrip?: Trip;
    stats: TravelStats;
    inset: { left: number; bottom: number };
    onOpen: (visits: Visit[], initial: Visit) => void;
    onShare: () => void;
}

interface View {
    k: number;
    x: number;
    y: number;
}

const MIN_K = 1;
const MAX_K = 60;
/** Focusing a trip zooms no closer than this, so a city break still shows its surroundings. */
const FOCUS_MAX_K = 16;
const MARGIN = 24;
const NARROW = 900;
const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k));

const useWindowSize = () => {
    const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
    useEffect(() => {
        const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);
    return size;
};

/** Fits the compact continent bars. */
const SHORT_CONTINENT: Record<string, string> = { "North America": "N. America", "South America": "S. America" };

const routeOf = (trip: Trip): LatLng[] => [...(trip.from ? [trip.from] : []), ...trip.stops, ...(trip.to ? [trip.to] : [])];

/** A flat world map (Equal Earth) with visited countries shaded, your places, and the headline numbers. */
export const FlatMap = ({ trips, places, colors, focusTrip, stats, inset, onOpen, onShare }: Props) => {
    const win = useWindowSize();
    const width = Math.max(1, win.width - inset.left);
    const height = Math.max(1, win.height - inset.bottom);

    const [countries, setCountries] = useState<CountryFeature[]>([]);
    useEffect(() => {
        loadCountries().then(setCountries, () => setCountries([]));
    }, []);
    const parts = useMemo(() => splitCountries(countries.filter((c) => c.properties.name !== "Antarctica")), [countries]);
    const stops = useMemo(() => trips.flatMap((t) => t.stops), [trips]);
    const visited = useMemo(() => visitedParts(parts, stops), [parts, stops]);

    // Fit the world into the space the stats card leaves: below it on phones, above it otherwise.
    const card = useRef<HTMLElement>(null);
    const [cardBox, setCardBox] = useState({ top: 0, bottom: 0 });
    useEffect(() => {
        const el = card.current;
        if (!el) return;
        const ro = new ResizeObserver(() => setCardBox({ top: el.offsetTop, bottom: el.offsetTop + el.offsetHeight }));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    const narrow = win.width < NARROW;
    const mapTop = narrow ? cardBox.bottom + 12 : MARGIN + 56;
    const mapBottom = narrow ? height - 96 : (cardBox.top || height) - MARGIN;

    const projection = useMemo(() => {
        const fc: FeatureCollection = { type: "FeatureCollection", features: parts };
        const p = geoEqualEarth();
        return parts.length && mapBottom > mapTop
            ? p.fitExtent([[MARGIN, mapTop], [width - MARGIN, mapBottom]], fc)
            : p;
    }, [parts, width, mapTop, mapBottom]);
    const shapes = useMemo(() => {
        const path = geoPath(projection).digits(1);
        return parts.map((p) => ({ id: p.properties.id, name: p.properties.name, d: path(p) ?? "" }));
    }, [parts, projection]);

    // --- pan and zoom ---
    const [view, setView] = useState<View>({ k: 1, x: 0, y: 0 });
    const svg = useRef<SVGSVGElement>(null);
    const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
        setView((v) => {
            const k = clampK(v.k * factor);
            return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
        });
    }, []);
    useEffect(() => {
        const el = svg.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const r = el.getBoundingClientRect();
            zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, [zoomAt]);

    // Drag to pan, two fingers to pinch. A drag isn't a click.
    const pointers = useRef(new Map<number, { x: number; y: number }>());
    const downAt = useRef({ x: 0, y: 0 });
    const dragged = useRef(false);
    const onPointerDown = (e: React.PointerEvent) => {
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        downAt.current = { x: e.clientX, y: e.clientY };
        dragged.current = false;
    };
    const onPointerMove = (e: React.PointerEvent) => {
        const all = pointers.current;
        const prev = all.get(e.pointerId);
        if (!prev) return;
        const next = { x: e.clientX, y: e.clientY };
        if (all.size >= 2) {
            // Pinch: zoom by how much the two fingers spread, around their midpoint.
            const other = [...all.entries()].find(([id]) => id !== e.pointerId)![1];
            const before = Math.hypot(prev.x - other.x, prev.y - other.y);
            const after = Math.hypot(next.x - other.x, next.y - other.y);
            const r = svg.current!.getBoundingClientRect();
            if (before > 0) zoomAt(after / before, (next.x + other.x) / 2 - r.left, (next.y + other.y) / 2 - r.top);
            dragged.current = true;
        } else {
            // Ignore the small wobble of a click before treating it as a drag.
            if (!dragged.current && Math.hypot(next.x - downAt.current.x, next.y - downAt.current.y) < 4) return;
            dragged.current = true;
            setView((v) => ({ ...v, x: v.x + next.x - prev.x, y: v.y + next.y - prev.y }));
        }
        all.set(e.pointerId, next);
    };
    const onPointerUp = (e: React.PointerEvent) => pointers.current.delete(e.pointerId);

    // Fly to the focused trip (or back out).
    useEffect(() => {
        if (!parts.length) return;
        if (!focusTrip) return setView({ k: 1, x: 0, y: 0 });
        const pts = focusTrip.stops.map((s) => projection([s.lng, s.lat])).filter((p): p is [number, number] => !!p);
        if (!pts.length) return;
        const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
        const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
        const boxH = mapBottom - mapTop;
        const k = Math.min(FOCUS_MAX_K, clampK(Math.min(width / Math.max(x1 - x0, 20), boxH / Math.max(y1 - y0, 20)) * 0.6));
        setView({ k, x: width / 2 - ((x0 + x1) / 2) * k, y: (mapTop + mapBottom) / 2 - ((y0 + y1) / 2) * k });
    }, [focusTrip, parts.length, projection, width, mapTop, mapBottom]);

    // --- hover ---
    const [hover, setHover] = useState<{ name: string; x: number; y: number } | null>(null);
    const tripsIn = useMemo(() => {
        const m = new Map<string, number>();
        for (const t of trips) for (const c of new Set(t.stops.map((s) => s.country))) if (c) m.set(c, (m.get(c) ?? 0) + 1);
        return m;
    }, [trips]);

    const dot = (p: Place) => {
        const xy = projection([p.lng, p.lat]);
        if (!xy) return null;
        const tripIds = [...new Set(p.visits.map((v) => v.trip.id))];
        const color = tripIds.length === 1 ? colors.get(tripIds[0]) : "#fff";
        return (
            <circle
                key={p.id}
                className="flat__place"
                cx={xy[0]}
                cy={xy[1]}
                r={5 / view.k} // same size on screen at any zoom
                fill={color}
                onClick={(e) => {
                    e.stopPropagation();
                    if (!dragged.current) onOpen(p.visits, p.visits[p.visits.length - 1]);
                }}
                onPointerEnter={(e) => setHover({ name: `${p.name}${p.visits.length > 1 ? ` · ${p.visits.length} visits` : ""}`, x: e.clientX, y: e.clientY })}
                onPointerLeave={() => setHover(null)}
            >
                <title>{p.name}</title>
            </circle>
        );
    };

    const route = focusTrip && routeOf(focusTrip).length > 1
        ? geoPath(projection)({ type: "LineString", coordinates: routeOf(focusTrip).map((p) => [p.lng, p.lat]) } as LineString)
        : null;

    return (
        <div className="flat" style={{ left: inset.left, width, height }}>
            <svg
                ref={svg}
                width={width}
                height={height}
                className="flat__map"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onDoubleClick={(e) => {
                    const r = svg.current!.getBoundingClientRect();
                    zoomAt(2, e.clientX - r.left, e.clientY - r.top);
                }}
                role="img"
                aria-label={`World map: ${stats.countries.map(countryLabel).join(", ")} visited`}
            >
                <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
                    <g
                        className="flat__countries"
                        onPointerMove={(e) => {
                            const name = (e.target as SVGElement).dataset.name;
                            if (!name) return setHover(null);
                            const n = tripsIn.get(name);
                            setHover({ name: `${countryLabel(name)}${n ? ` · ${plural(n, "trip")}` : ""}`, x: e.clientX, y: e.clientY });
                        }}
                        onPointerLeave={() => setHover(null)}
                    >
                        {shapes.map((s) => (
                            <path key={s.id} d={s.d} data-name={s.name} data-visited={visited.has(s.id)} vectorEffect="non-scaling-stroke" />
                        ))}
                    </g>
                    {route && (
                        <path d={route} className="flat__route" stroke={colors.get(focusTrip!.id)} vectorEffect="non-scaling-stroke" />
                    )}
                    <g className="flat__places">{places.map(dot)}</g>
                </g>
            </svg>

            {hover && (
                <div className="flat__tip" style={{ left: hover.x - inset.left, top: hover.y }}>{hover.name}</div>
            )}

            <div className="flat__zoom">
                <button type="button" onClick={() => zoomAt(1.6, width / 2, height / 2)} aria-label="Zoom in">+</button>
                <button type="button" onClick={() => zoomAt(1 / 1.6, width / 2, height / 2)} aria-label="Zoom out">−</button>
                <button type="button" onClick={() => setView({ k: 1, x: 0, y: 0 })} aria-label="Show the whole world">⤢</button>
            </div>

            <section className="flat__card" aria-label="Stats" ref={card}>
                <div>
                    <p className="flat__headline">
                        <strong>{stats.countries.length}</strong> {stats.countries.length === 1 ? "country" : "countries"}
                    </p>
                    <p className="flat__share-line">
                        <strong>{percent(stats.worldShare)}</strong> of the world's countries
                    </p>
                </div>
                <dl className="flat__numbers">
                    <div><dt>Trips</dt><dd>{stats.trips}</dd></div>
                    <div><dt>Places</dt><dd>{stats.places}</dd></div>
                    <div><dt>Days away</dt><dd>{stats.days}</dd></div>
                    <div><dt>Km</dt><dd>{Math.round(stats.km).toLocaleString("en-GB")}</dd></div>
                </dl>
                <ul className="flat__continents" aria-label="Countries visited by continent">
                    {stats.continents.map((c) => (
                        <li key={c.name}>
                            <span className="flat__continent-name" title={c.name}>{SHORT_CONTINENT[c.name] ?? c.name}</span>
                            <span className="flat__continent-count">
                                <strong>{c.visited}</strong> / {c.total}
                            </span>
                            <span className="flat__bar" aria-hidden="true">
                                <span style={{ width: `${c.total ? (c.visited / c.total) * 100 : 0}%` }} />
                            </span>
                        </li>
                    ))}
                </ul>
                <button type="button" className="flat__share" onClick={onShare}>Share image</button>
            </section>
        </div>
    );
};
