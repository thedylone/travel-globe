import type { Cluster } from "../lib/cluster";
import { ringGradient } from "../lib/colors";
import type { Base } from "../types";

const pinPath = "M14,0 C21.732,0 28,5.641 28,12.6 C28,23.963 14,36 14,36 C14,36 0,24.064 0,12.6 C0,5.641 6.268,0 14,0 Z";
const ICONS: Record<Base["icon"], string> = {
    home: `<path fill="currentColor" d="M 14,7 l -8,8 h3 v4 a1 1 0 0 0 1 1 h2 v-4 h4 v4 h2 a1 1 0 0 0 1 -1 v-4 h3 Z"/>`,
    school: `<path fill="currentColor" d="M 14,7 l -8,5 l 8,5 l 7.2,-4.5 v5 h 0.8 v-5.5 Z"/><path fill="currentColor" d="M 14,18 l -4,-2.5 v 2 l 4,2.5 l 4,-2.5 v -2 Z"/>`,
    work: `<path fill="currentColor" d="M14,7 h-2 a1,1,0,0,0,-1,1 v1 h-3 a1,1,0,0,0,-1,1 v2 l7,1 l7,-1 v-2 a1,1,0,0,0,-1,-1 h-8 v-0.5 a0.5,0.5,0,0,1,0.5,-0.5 h3 a0.5,0.5,0,0,1,0.5,0.5 v0.5 h1 v-1 a1,1,0,0,0,-1,-1 z"/><path fill="currentColor" d="M14,14 l-7,-1 v5 a1,1,0,0,0,1,1 h12 a1,1,0,0,0,1,-1 v-5 z"/>`,
};

// globe.gl positions each element with an inline transform, so the styled pin
// sits inside a plain wrapper and keeps its own transforms (hover, anchoring).
const wrap = (inner: HTMLElement) => {
    const el = document.createElement("div");
    el.className = "marker";
    el.append(inner);
    return el;
};

export const baseElement = (base: Base) => {
    const el = document.createElement("div");
    el.className = `base base--${base.icon}`;
    el.title = base.name;
    el.innerHTML = `<svg viewBox="0 0 28 36" aria-hidden="true"><path fill="currentColor" d="${pinPath}"/><circle fill="#000" cx="14" cy="14" r="10"/>${ICONS[base.icon]}</svg>`;
    return wrap(el);
};

const tripIdsOf = (cluster: Cluster) => [
    ...new Set(cluster.places.flatMap((p) => p.visits.map((v) => v.trip.id))),
];

const text = (tag: string, className: string, content: string) => {
    const el = document.createElement(tag);
    el.className = className;
    el.textContent = content;
    return el;
};

/**
 * A pin for one place, or a numbered bubble for several nearby places.
 * The ring shows the colours of the trips it belongs to, so a city visited on
 * three trips has a three-colour ring.
 */
export const clusterElement = (cluster: Cluster, colors: Map<string, string>, onClick: (c: Cluster) => void) => {
    const el = document.createElement("button");
    el.type = "button";
    const ring = ringGradient(tripIdsOf(cluster).map((id) => colors.get(id) ?? "#fff"));
    el.style.setProperty("--ring", ring);
    el.addEventListener("click", (e) => {
        e.stopPropagation();
        onClick(cluster);
    });

    if (cluster.places.length === 1) {
        const [place] = cluster.places;
        const n = place.visits.length;
        el.className = `pin${n > 1 ? " pin--multi" : ""}`;
        el.setAttribute("aria-label", n > 1 ? `${place.name}, ${n} visits` : place.name);
        el.append(text("span", "pin__dot", ""), text("span", "pin__label", n > 1 ? `${place.name} ×${n}` : place.name));
    } else {
        const n = cluster.places.length;
        el.className = "pin pin--cluster";
        el.style.setProperty("--size", `${Math.round(24 + Math.min(18, Math.log2(n) * 5))}px`);
        const names = cluster.places.slice(0, 3).map((p) => p.name).join(", ");
        el.setAttribute("aria-label", `${n} places: ${names}${n > 3 ? "…" : ""}. Zoom in`);
        el.append(
            text("span", "pin__dot", String(n)),
            text("span", "pin__label", n > 3 ? `${names} +${n - 3}` : names)
        );
    }
    return wrap(el);
};
