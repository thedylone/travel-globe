import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import { dayColor, type Plan } from "./plan";

interface Props {
    plan: Plan;
    /** The day the map is showing, or every day. */
    focus?: number;
    /** The place picked in the list, by key. */
    active?: string;
    onSelect: (key: string) => void;
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Every place in the plan on a street map: numbered within its day, a colour and a route per day. */
export const PlanMap = ({ plan, focus, active, onSelect }: Props) => {
    const box = useRef<HTMLDivElement>(null);
    const map = useRef<L.Map>(undefined);
    const layers = useRef<L.LayerGroup>(undefined);
    const latest = useRef(onSelect);
    latest.current = onSelect;
    /** What the view was last fitted to, so it only moves when that changes, not on every edit. */
    const fitted = useRef("");

    useEffect(() => {
        const m = L.map(box.current!, { zoomControl: false, worldCopyJump: true, zoomSnap: 0.5 }).setView([25, 10], 1.5);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(m);
        L.control.zoom({ position: "bottomright" }).addTo(m);
        layers.current = L.layerGroup().addTo(m);
        map.current = m;
        const resize = new ResizeObserver(() => m.invalidateSize());
        resize.observe(box.current!);
        return () => {
            resize.disconnect();
            m.remove();
        };
    }, []);

    useEffect(() => {
        const group = layers.current;
        const m = map.current;
        if (!group || !m) return;
        group.clearLayers();
        const shown: L.LatLngExpression[] = [];
        const pin = (at: L.LatLngTuple, label: string, color: string, key: string, title: string, dim: boolean) => {
            const classes = ["plan-pin", key === active && "active", dim && "dim"].filter(Boolean).join(" ");
            L.marker(at, {
                zIndexOffset: key === active ? 1000 : dim ? -500 : 0,
                icon: L.divIcon({ className: classes, html: `<span style="background:${color}">${label}</span>`, iconSize: [28, 28] }),
            })
                .bindTooltip(escape(title), { direction: "top", offset: [0, -14] })
                .on("click", () => latest.current(key))
                .addTo(group);
        };
        plan.days.forEach((d, day) => {
            const color = dayColor(day);
            const dim = focus !== undefined && focus !== day;
            const route: L.LatLngTuple[] = [];
            d.places.forEach((x, i) => {
                if (x.lat === undefined || x.lng === undefined) return;
                const at: L.LatLngTuple = [x.lat, x.lng];
                route.push(at);
                if (!dim) shown.push(at);
                pin(at, String(i + 1), color, x.key, x.name || x.place, dim);
            });
            if (route.length > 1) {
                L.polyline(route, { color, weight: 3, opacity: dim ? 0.25 : 0.85, dashArray: "1 7", lineCap: "round", interactive: false }).addTo(group);
            }
        });
        for (const x of plan.ideas) {
            if (x.lat === undefined || x.lng === undefined) continue;
            pin([x.lat, x.lng], "", "var(--idea)", x.key, `${x.name || x.place} (not on a day yet)`, focus !== undefined);
            if (focus === undefined) shown.push([x.lat, x.lng]);
        }
        // Fit the view when what's shown gains or loses places, or another day is picked.
        const what = `${focus}|${shown.map(String).join(";")}`;
        if (what !== fitted.current && shown.length) {
            fitted.current = what;
            if (shown.length === 1) m.setView(shown[0], 13);
            else m.fitBounds(L.latLngBounds(shown), { padding: [36, 36], maxZoom: 14 });
        }
    }, [plan, focus, active]);

    // Bring the picked place into view.
    useEffect(() => {
        const x = [...plan.days.flatMap((d) => d.places), ...plan.ideas].find((p) => p.key === active);
        const m = map.current;
        if (x?.lat !== undefined && x.lng !== undefined && m && !m.getBounds().contains([x.lat, x.lng])) {
            m.panTo([x.lat, x.lng]);
        }
    }, [active]);

    // Leaflet owns this element's classes, so React mustn't change them.
    return <div className="plan-map" ref={box} />;
};
