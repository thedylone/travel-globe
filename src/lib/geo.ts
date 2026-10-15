export interface LatLng {
    lat: number;
    lng: number;
}

const R_KM = 6371;
const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance in kilometres. */
export const distanceKm = (a: LatLng, b: LatLng): number => {
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
};

/** Great-circle distance in degrees of arc. */
export const distanceDeg = (a: LatLng, b: LatLng) => deg(distanceKm(a, b) / R_KM);

/** Centre of a set of points (averaged on the unit sphere, so it works across the antimeridian). */
export const centroid = (points: LatLng[]): LatLng => {
    let x = 0, y = 0, z = 0;
    for (const p of points) {
        const la = rad(p.lat), ln = rad(p.lng);
        x += Math.cos(la) * Math.cos(ln);
        y += Math.cos(la) * Math.sin(ln);
        z += Math.sin(la);
    }
    const n = points.length || 1;
    x /= n; y /= n; z /= n;
    return { lat: deg(Math.atan2(z, Math.hypot(x, y))), lng: deg(Math.atan2(y, x)) };
};

/** Largest distance (degrees) from the centre to any point. */
export const spreadDeg = (points: LatLng[], centre = centroid(points)) =>
    points.reduce((m, p) => Math.max(m, distanceDeg(centre, p)), 0);
