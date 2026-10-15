import { type Ref, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import { MeshPhongMaterial, type Object3D } from "three";
import { borderLines, type CountryFeature, loadCountries, shadeCountries, type ShadedCountry } from "../lib/borders";
import { altitudeFor, type Cluster, clusterPlaces, clusterRadiusDeg, MIN_ALTITUDE, zoomIntoCluster } from "../lib/cluster";
import { withAlpha } from "../lib/colors";
import type { LatLng } from "../lib/geo";
import type { Place, Visit } from "../lib/places";
import type { Base, Trip } from "../types";
import { baseElement, clusterElement } from "./pins";

export interface View extends LatLng {
    altitude: number;
}

export interface GlobeHandle {
    flyTo: (view: View, ms?: number) => void;
    /** Rise to at least `altitude` without moving sideways. */
    zoomOut: (altitude: number) => void;
}

export interface GlobeSettings {
    rotate: boolean;
    night: boolean;
    /** Satellite photos, or a flat map of countries. */
    style: "satellite" | "map";
    /** Country borders over the satellite view. */
    borders: boolean;
}

const STARS = `${import.meta.env.BASE_URL}textures/stars.jpg`;

/**
 * Satellite imagery as map tiles: the globe loads sharper tiles as you zoom in,
 * instead of stretching one big texture. Both sources are free and need no key.
 */
const IMAGERY = {
    // Sentinel-2 cloudless by EOX, ~10 m per pixel; free for non-commercial use with attribution.
    day: {
        url: (x: number, y: number, l: number) =>
            `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/${l}/${y}/${x}.jpg`,
        maxLevel: 15,
        credit: "Sentinel-2 cloudless 2024 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2024)",
        link: "https://s2maps.eu",
    },
    // NASA city lights via GIBS (public domain); JPEG, so ~4x lighter than the Black Marble PNGs.
    // Only goes to level 8 (~600 m per pixel).
    night: {
        url: (x: number, y: number, l: number) =>
            `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_CityLights_2012/default/default/GoogleMapsCompatible_Level8/${l}/${y}/${x}.jpg`,
        maxLevel: 8,
        credit: "NASA Earth Observatory City Lights 2012, via NASA GIBS",
        link: "https://earthdata.nasa.gov/gibs",
    },
};

const MAP_OCEAN = new MeshPhongMaterial({ color: "#0b1a33", shininess: 4 });
const MAP_LAND = "#253149";
const MAP_VISITED = "#4c7aad"; // opaque: transparent fills cost a lot more to draw

/** Seconds of no interaction before auto-rotate resumes. */
const RESUME_ROTATE_MS = 8000;

interface Arc {
    startLat: number;
    startLng: number;
    endLat: number;
    endLng: number;
    color: [string, string];
}

type HtmlDatum =
    | { kind: "cluster"; key: string; cluster: Cluster; lat: number; lng: number }
    | { kind: "base"; key: string; base: Base; lat: number; lng: number };

interface Props {
    ref: Ref<GlobeHandle>;
    trips: Trip[];
    places: Place[];
    bases: Base[];
    colors: Map<string, string>;
    settings: GlobeSettings;
    initialView: View;
    /** Stop auto-rotating (e.g. while a dialog is open). */
    paused: boolean;
    highlight?: LatLng;
    /** Space taken by the panel and timeline, so the globe centres in what's left. */
    inset: { left: number; bottom: number };
    /** False while the 2D map is showing: hide the globe and stop rendering it. */
    active: boolean;
    onOpen: (visits: Visit[], initial: Visit) => void;
}

const useWindowSize = () => {
    const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
    useEffect(() => {
        const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);
    return size;
};

const latest = (visits: Visit[]) => visits[visits.length - 1];

export const GlobeView = (props: Props) => {
    const { ref, trips, places, bases, colors, settings, initialView, paused, highlight, inset, active, onOpen } = props;
    const globe = useRef<GlobeMethods | undefined>(undefined);
    const win = useWindowSize();
    const width = Math.max(1, win.width - inset.left);
    const height = Math.max(1, win.height - inset.bottom);

    // --- level of detail: cluster radius follows the camera altitude ---
    const [radius, setRadius] = useState(() => clusterRadiusDeg(initialView.altitude, height));
    const onZoom = useCallback(
        ({ altitude }: { altitude: number }) => setRadius(clusterRadiusDeg(altitude, height)),
        [height]
    );
    const clusters = useMemo(() => clusterPlaces(places, radius), [places, radius]);

    const flyTo = useCallback((view: View, ms = 1200) => globe.current?.pointOfView(view, ms), []);
    useImperativeHandle(ref, () => ({
        flyTo,
        zoomOut: (altitude) => {
            const pov = globe.current?.pointOfView();
            if (pov && pov.altitude < altitude) flyTo({ ...pov, altitude });
        },
    }), [flyTo]);

    useEffect(() => {
        // Only on mount; later moves go through flyTo.
        globe.current?.pointOfView(initialView, 0);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const onClusterClick = useRef<(c: Cluster) => void>(() => {});
    onClusterClick.current = (cluster) => {
        const visits = cluster.places.flatMap((p) => p.visits);
        if (cluster.places.length === 1) return onOpen(visits, latest(visits));
        const target = zoomIntoCluster(cluster, height);
        const current = globe.current?.pointOfView().altitude ?? Infinity;
        // Can't zoom in far enough to split it: list everything in it instead.
        if (target.altitude <= MIN_ALTITUDE || target.altitude > current * 0.9) {
            const byDate = [...visits].sort((a, b) => a.stop.start.localeCompare(b.stop.start));
            return onOpen(byDate, latest(byDate));
        }
        flyTo(target, 1000);
    };

    // Pins are DOM elements; reuse them while their cluster and colours stay the same.
    const pinCache = useRef(new Map<string, HTMLElement>());
    const htmlData = useMemo<HtmlDatum[]>(() => {
        const next = new Map<string, HTMLElement>();
        const data: HtmlDatum[] = clusters.map((cluster) => {
            const tripsKey = cluster.places.flatMap((p) => p.visits.map((v) => v.trip.id)).join(",");
            const key = `${cluster.id}|${tripsKey}`;
            next.set(key, pinCache.current.get(key) ?? clusterElement(cluster, colors, (c) => onClusterClick.current(c)));
            return { kind: "cluster", key, cluster, lat: cluster.lat, lng: cluster.lng };
        });
        for (const base of bases) {
            const key = `base:${base.id}`;
            next.set(key, pinCache.current.get(key) ?? baseElement(base));
            data.push({ kind: "base", key, base, lat: base.lat, lng: base.lng });
        }
        pinCache.current = next;
        return data;
    }, [clusters, bases, colors]);

    const arcs = useMemo<Arc[]>(
        () =>
            trips.flatMap((trip) => {
                const color = colors.get(trip.id) ?? "#fff";
                const points: LatLng[] = [...(trip.from ? [trip.from] : []), ...trip.stops, ...(trip.to ? [trip.to] : [])];
                return points.slice(1).flatMap((end, i) => {
                    const start = points[i];
                    if (start.lat === end.lat && start.lng === end.lng) return [];
                    return [{ startLat: start.lat, startLng: start.lng, endLat: end.lat, endLng: end.lng, color: [withAlpha(color, 0.35), color] }];
                });
            }),
        [trips, colors]
    );

    // --- auto-rotate, paused while the user is interacting ---
    const [interacting, setInteracting] = useState(false);
    useEffect(() => {
        const controls = globe.current?.controls() as
            | (EventTarget & { autoRotate: boolean; autoRotateSpeed: number })
            | undefined;
        if (!controls) return;
        let timer: ReturnType<typeof setTimeout>;
        const start = () => {
            clearTimeout(timer);
            setInteracting(true);
        };
        const end = () => {
            clearTimeout(timer);
            timer = setTimeout(() => setInteracting(false), RESUME_ROTATE_MS);
        };
        controls.addEventListener("start", start);
        controls.addEventListener("end", end);
        return () => {
            clearTimeout(timer);
            controls.removeEventListener("start", start);
            controls.removeEventListener("end", end);
        };
    }, []);
    useEffect(() => {
        const controls = globe.current?.controls() as { autoRotate: boolean; autoRotateSpeed: number } | undefined;
        if (!controls) return;
        controls.autoRotate = settings.rotate && !paused && !interacting;
        controls.autoRotateSpeed = -0.15;
    }, [settings.rotate, paused, interacting]);

    // --- imagery ---
    const satellite = settings.style === "satellite";
    const imagery = IMAGERY[settings.night ? "night" : "day"];
    useEffect(() => {
        const g = globe.current;
        if (!g || !satellite) return;
        // The tile engine keeps old tiles when its URL changes, and react-globe.gl
        // doesn't pass its settings through, so set them on it directly.
        g.globeTileEngineClearCache();
        g.scene().traverse((o: Object3D) => {
            if (!("clearTiles" in o && "maxLevel" in o)) return;
            const engine = o as unknown as { maxLevel: number; thresholds: number[] };
            engine.maxLevel = imagery.maxLevel;
            // Switch to tile level L once one of its pixels would cover a screen pixel
            // (the default switches later, so imagery looks blocky up close).
            engine.thresholds = Array.from({ length: 30 }, (_, level) => altitudeFor(360 / (256 * 2 ** level), height));
        });
        // The engine only picks tiles when the camera moves: "move" it to where it is.
        g.pointOfView(g.pointOfView());
    }, [satellite, imagery, height]);

    // Map style fills countries (polygons); borders over satellite are just lines (much lighter).
    const showCountries = !satellite || settings.borders;
    const [countries, setCountries] = useState<CountryFeature[]>([]);
    useEffect(() => {
        if (showCountries) loadCountries().then(setCountries, () => setCountries([]));
    }, [showCountries]);
    const lines = useMemo(() => (satellite && settings.borders ? borderLines(countries) : []), [satellite, settings.borders, countries]);
    // Shade the land masses near your stops (not every overseas territory of a visited country).
    const shaded = useMemo(
        () => (satellite || !countries.length ? [] : shadeCountries(countries, trips.flatMap((t) => t.stops))),
        [satellite, countries, trips]
    );
    const capColor = useCallback((d: object) => ((d as ShadedCountry).properties.visited ? MAP_VISITED : MAP_LAND), []);

    useEffect(() => {
        if (active) globe.current?.resumeAnimation();
        else globe.current?.pauseAnimation();
    }, [active]);

    // Scrolling over a pin should still zoom the globe.
    const onWheel = (e: React.WheelEvent) => {
        const canvas = (e.currentTarget as HTMLElement).querySelector("canvas");
        if (canvas && e.target !== canvas) canvas.dispatchEvent(new WheelEvent("wheel", e.nativeEvent));
    };

    return (
        <div
            className={`globe${radius < 1 ? " globe--labels" : ""}`}
            style={{ left: inset.left, width, height, visibility: active ? undefined : "hidden" }}
            onWheel={onWheel}
        >
            <Globe
                ref={globe}
                width={width}
                height={height}
                globeImageUrl={null}
                globeTileEngineUrl={satellite ? imagery.url : null}
                globeMaterial={MAP_OCEAN}
                backgroundImageUrl={STARS}
                onZoom={onZoom}
                polygonsData={shaded}
                polygonCapColor={capColor}
                // No side walls: a falsy colour skips building them.
                polygonSideColor={() => ""}
                polygonStrokeColor={() => "rgba(160, 180, 215, 0.6)"}
                polygonAltitude={0.002}
                polygonLabel={(d: object) => (d as CountryFeature).properties.name}
                polygonsTransitionDuration={0}
                pathsData={lines}
                pathPointLat={(p: unknown) => (p as number[])[1]}
                pathPointLng={(p: unknown) => (p as number[])[0]}
                pathPointAlt={0.001}
                pathColor={() => "rgba(255, 255, 255, 0.5)"}
                pathTransitionDuration={0}
                htmlElementsData={htmlData}
                htmlElement={(d) => pinCache.current.get((d as HtmlDatum).key)!}
                htmlAltitude={0.005}
                htmlTransitionDuration={0}
                arcsData={arcs}
                arcColor="color"
                // Stroke is in degrees on the globe: keep it thin when zoomed in.
                arcStroke={Math.min(0.35, radius * 0.06)}
                arcDashLength={0.5}
                arcDashGap={0.2}
                arcDashAnimateTime={6000}
                arcsTransitionDuration={0}
                ringsData={highlight ? [highlight] : []}
                ringColor={() => (t: number) => `rgba(255,255,255,${1 - t})`}
                ringMaxRadius={Math.min(3, Math.max(0.05, radius * 0.5))}
                ringPropagationSpeed={1.5}
                ringRepeatPeriod={900}
            />
            <p className="credit">
                {satellite ? (
                    <>
                        Imagery: <a href={imagery.link} target="_blank" rel="noreferrer">{imagery.credit}</a>
                        {settings.borders && " · Borders: Natural Earth"}
                    </>
                ) : (
                    <>Borders: <a href="https://www.naturalearthdata.com" target="_blank" rel="noreferrer">Natural Earth</a></>
                )}
            </p>
        </div>
    );
};
