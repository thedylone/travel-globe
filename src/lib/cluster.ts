import { centroid, distanceDeg, spreadDeg } from "./geo";
import type { Place } from "./places";

export interface Cluster {
    /** Stable for the same set of places, so pins can be reused between zoom levels. */
    id: string;
    lat: number;
    lng: number;
    places: Place[];
}

/** Pins closer than this on screen are merged. */
export const PIN_SPACING_PX = 34;
const FOV_DEG = 50; // three.js default camera, used by globe.gl
const TAN_HALF_FOV = Math.tan((FOV_DEG / 2) * (Math.PI / 180));
const RAD = 180 / Math.PI;

/**
 * Degrees of arc covered by one screen pixel at the centre of the view, for a camera
 * `altitude` globe-radii above the surface. (Near the horizon it's more; that's fine.)
 */
export const degPerPixel = (altitude: number, viewportHeight: number) =>
    ((2 * altitude * TAN_HALF_FOV) / viewportHeight) * RAD;

/** Altitude at which one pixel covers `deg` degrees: the inverse of degPerPixel. */
export const altitudeFor = (degPerPx: number, viewportHeight: number) =>
    (degPerPx / RAD) * viewportHeight / (2 * TAN_HALF_FOV);

/**
 * The clustering distance for a camera altitude, snapped to steps of a half octave,
 * so clusters only change when the zoom changes noticeably (not on every frame).
 */
export const clusterRadiusDeg = (altitude: number, viewportHeight: number) => {
    const raw = PIN_SPACING_PX * degPerPixel(altitude, viewportHeight);
    return 2 ** (Math.round(Math.log2(raw) * 2) / 2);
};

/**
 * Greedy clustering on the sphere: places with the most visits seed clusters first,
 * and every other place joins the nearest seed within `radiusDeg`.
 */
export const clusterPlaces = (places: Place[], radiusDeg: number): Cluster[] => {
    const order = [...places].sort(
        (a, b) => b.visits.length - a.visits.length || a.id.localeCompare(b.id)
    );
    const groups: { seed: Place; places: Place[] }[] = [];
    for (const p of order) {
        let best: (typeof groups)[number] | undefined;
        let bestD = radiusDeg;
        for (const g of groups) {
            const d = distanceDeg(g.seed, p);
            if (d < bestD) [best, bestD] = [g, d];
        }
        if (best) best.places.push(p);
        else groups.push({ seed: p, places: [p] });
    }
    return groups.map(({ places: ps }) => {
        const c = ps.length === 1 ? ps[0] : centroid(ps);
        return {
            id: ps.map((p) => p.id).sort().join("+"),
            lat: c.lat,
            lng: c.lng,
            places: ps,
        };
    });
};

export const MIN_ALTITUDE = 0.02;

/** Below this drag speed, keep globe.gl's own (it grows with altitude, so close up stays precise). */
const DRAG_KNEE = 0.6;
/** Most a drag may turn the globe: one turn for dragging the full height of the view. */
const DRAG_MAX = 1;

/**
 * OrbitControls' rotateSpeed for a camera altitude. globe.gl uses 0.3 × altitude, which
 * spins the globe many times per drag when zoomed far out; above the overview this eases
 * it toward DRAG_MAX instead (smoothly, so there's no step in feel while zooming).
 */
export const dragSpeedFor = (altitude: number) => {
    const speed = altitude * 0.3;
    if (speed <= DRAG_KNEE) return speed;
    const room = DRAG_MAX - DRAG_KNEE;
    return DRAG_KNEE + room * Math.tanh((speed - DRAG_KNEE) / room);
};

/**
 * Where to fly so a cluster splits up: centred on it, just low enough that its two
 * closest places are more than a pin apart.
 */
export const zoomIntoCluster = (cluster: Cluster, viewportHeight: number) => {
    const ps = cluster.places;
    let closest = Infinity;
    for (let i = 0; i < ps.length; i++)
        for (let j = i + 1; j < ps.length; j++) closest = Math.min(closest, distanceDeg(ps[i], ps[j]));
    // Headroom so the half-octave snapping in clusterRadiusDeg can't keep them merged.
    const altitude = altitudeFor(closest / (PIN_SPACING_PX * 1.5), viewportHeight);
    return { lat: cluster.lat, lng: cluster.lng, altitude: Math.max(MIN_ALTITUDE, altitude) };
};

/** Camera position that shows all the given points. */
export const viewFor = (points: { lat: number; lng: number }[], viewportHeight: number) => {
    const c = centroid(points);
    // Fit the points into ~80% of the screen height, from city level up to a whole hemisphere.
    const spread = spreadDeg(points, c);
    // One place (or several on the same spot): a regional view rather than street level.
    if (spread < 0.01) return { ...c, altitude: 0.2 };
    const altitude = altitudeFor((spread * 2.5) / viewportHeight, viewportHeight);
    return { ...c, altitude: Math.min(2.5, Math.max(0.03, altitude)) };
};
