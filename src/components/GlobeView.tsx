import { type Ref, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import { type Cluster, clusterPlaces, clusterRadiusDeg, MIN_ALTITUDE, zoomIntoCluster } from "../lib/cluster";
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
    hd: boolean;
}

const tex = (name: string) => `${import.meta.env.BASE_URL}textures/${name}`;
const TEXTURES = {
    day: { sd: tex("earth-blue-marble.jpg"), hd: tex("earth-day-hd.jpg") },
    night: { sd: tex("earth-night.jpg"), hd: tex("earth-night-hd.jpg") },
    sky: { sd: tex("night-sky.png"), hd: tex("stars-hd.jpg") },
    bump: tex("earth-topology.png"),
};

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

export const GlobeView = ({ ref, trips, places, bases, colors, settings, initialView, paused, highlight, onOpen }: Props) => {
    const globe = useRef<GlobeMethods | undefined>(undefined);
    const { width, height } = useWindowSize();

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

    // Scrolling over a pin should still zoom the globe.
    const onWheel = (e: React.WheelEvent) => {
        const canvas = (e.currentTarget as HTMLElement).querySelector("canvas");
        if (canvas && e.target !== canvas) canvas.dispatchEvent(new WheelEvent("wheel", e.nativeEvent));
    };

    const res = settings.hd ? "hd" : "sd";
    return (
        <div className={`globe${radius < 1 ? " globe--labels" : ""}`} onWheel={onWheel}>
            <Globe
                ref={globe}
                width={width}
                height={height}
                globeImageUrl={TEXTURES[settings.night ? "night" : "day"][res]}
                bumpImageUrl={TEXTURES.bump}
                backgroundImageUrl={TEXTURES.sky[res]}
                onZoom={onZoom}
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
        </div>
    );
};
