import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LatLng } from "../lib/geo";
import { api, type Base } from "./api";
import type { Draft } from "./draft";
import { layoutMap, type Lookup, lookupKey, type MapLayout, type Pin, roundAt } from "./mapdata";

interface Props {
    layout: MapLayout;
    /** The stop being edited, by key. */
    active?: number;
    /** The stop the next click on the map places, by key. */
    placing?: number;
    onSelect: (key: number) => void;
    onPlace: (key: number | undefined) => void;
    onMove: (key: number, at: LatLng) => void;
}

const SOURCE: Record<Pin["source"], string> = {
    set: "lat/lng on the stop",
    saved: "from the place name",
    lookup: "looked up from the place name, not saved yet: check it",
};

/**
 * The map for a draft, looking up the place names it needs a moment after typing stops,
 * one at a time (the geocoder allows one a second). `reset` forgets the lookups, e.g. once
 * a save has added them to data/places.json.
 */
export const useMapLayout = (draft: Draft | undefined, bases: Base[]) => {
    const [found, setFound] = useState(() => new Map<string, Lookup>());
    const layout = useMemo(() => (draft ? layoutMap(draft, bases, found) : undefined), [draft, bases, found]);
    const asked = useRef(new Set<string>());
    const want = (layout?.queries ?? []).filter((q) => !asked.current.has(lookupKey(q.q, q.country)));
    const wanted = want.map((q) => lookupKey(q.q, q.country)).join("\n");
    useEffect(() => {
        if (!want.length) return;
        let live = true;
        const timer = setTimeout(async () => {
            for (const q of want) {
                if (!live) return;
                const key = lookupKey(q.q, q.country);
                asked.current.add(key);
                const r: Lookup = await api
                    .place(q.q, q.country)
                    .catch((e: Error) => ({ at: null, saved: false, error: e.message }));
                setFound((m) => new Map(m).set(key, r));
            }
        }, 700);
        return () => {
            live = false;
            clearTimeout(timer);
        };
    }, [wanted]);
    const reset = () => {
        asked.current.clear();
        setFound(new Map());
    };
    return [layout, reset] as const;
};

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** The trip's stops on a street map: drag a pin, or pick a stop and click the map, to set its lat/lng. */
export const StopMap = ({ layout, active, placing, onSelect, onPlace, onMove }: Props) => {
    const box = useRef<HTMLDivElement>(null);
    const map = useRef<L.Map>(undefined);
    const layers = useRef<L.LayerGroup>(undefined);
    const fitted = useRef(false);
    // The map's handlers outlive renders, so they read the latest props from here.
    const latest = useRef({ placing, onSelect, onPlace, onMove });
    latest.current = { placing, onSelect, onPlace, onMove };

    useEffect(() => {
        const m = L.map(box.current!, { worldCopyJump: true, zoomSnap: 0.5 }).setView([30, 0], 2);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(m);
        layers.current = L.layerGroup().addTo(m);
        fitted.current = false;
        m.on("click", (e) => {
            const { placing, onMove, onPlace } = latest.current;
            if (placing === undefined) return;
            onMove(placing, roundAt(e.latlng));
            onPlace(undefined);
        });
        map.current = m;
        // The pane can change size as the editor lays out.
        const resize = new ResizeObserver(() => m.invalidateSize());
        resize.observe(box.current!);
        return () => {
            resize.disconnect();
            m.remove();
        };
    }, []);

    useEffect(() => {
        if (placing === undefined) return;
        const onKey = (e: KeyboardEvent) => e.key === "Escape" && latest.current.onPlace(undefined);
        addEventListener("keydown", onKey);
        return () => removeEventListener("keydown", onKey);
    }, [placing]);

    const fit = (animate = true) => {
        const points = [...layout.pins.map((p) => p.at), ...(layout.from ? [layout.from] : []), ...(layout.to ? [layout.to] : [])];
        if (!map.current || !points.length) return;
        const pins = layout.pins.length ? layout.pins.map((p) => p.at) : points;
        if (pins.length === 1) map.current.setView(pins[0], 11, { animate });
        else map.current.fitBounds(L.latLngBounds(pins), { padding: [32, 32], maxZoom: 13, animate });
    };

    useEffect(() => {
        const group = layers.current;
        if (!group) return;
        group.clearLayers();
        for (const leg of layout.legs) {
            L.polyline(leg, { className: `map-leg${leg.side ? " side" : ""}`, interactive: false }).addTo(group);
        }
        for (const [at, label] of [[layout.from, "Start"], [layout.to, "End"]] as const) {
            if (!at) continue;
            L.circleMarker(at, { radius: 6, className: "map-end" }).bindTooltip(label).addTo(group);
        }
        for (const p of layout.pins) {
            const classes = ["map-pin", p.source, p.side && "side", p.key === active && "active"].filter(Boolean).join(" ");
            const marker = L.marker(p.at, {
                draggable: true,
                autoPan: true,
                zIndexOffset: p.key === active ? 1000 : 0,
                icon: L.divIcon({ className: classes, html: `<span>${p.index + 1}</span>`, iconSize: [26, 26] }),
            });
            const tip = [`<b>${escape(p.label)}</b>`, p.date && escape(p.date), SOURCE[p.source]].filter(Boolean).join("<br>");
            marker
                .bindTooltip(tip, { direction: "top", offset: [0, -14] })
                .on("click", () => latest.current.onSelect(p.key))
                .on("dragend", () => latest.current.onMove(p.key, roundAt(marker.getLatLng())))
                .addTo(group);
        }
        // Once, when the first lookups are back, so the view takes in every stop it can.
        if (!fitted.current && layout.pins.length && !layout.queries.length) {
            fitted.current = true;
            fit(false);
        }
    }, [layout, active]);

    // Bring the stop being edited into view.
    useEffect(() => {
        const pin = layout.pins.find((p) => p.key === active);
        if (pin && map.current && !map.current.getBounds().contains(pin.at)) map.current.panTo(pin.at);
        // Only when another stop is picked, not on every edit.
    }, [active]);

    const placingLabel = layout.pins.find((p) => p.key === placing)?.label ?? layout.unplaced.find((u) => u.key === placing)?.label;

    return (
        <div className={`stop-map${placing !== undefined ? " placing" : ""}`}>
            {/* Leaflet owns this element's classes, so React mustn't change them. */}
            <div className="stop-map-box" ref={box} />
            {placing !== undefined && (
                <div className="stop-map-banner">
                    Click the map to place <b>{placingLabel}</b>
                    <button onClick={() => onPlace(undefined)}>Cancel</button>
                </div>
            )}
            <button className="stop-map-fit" title="Zoom to the whole trip" onClick={() => fit()}>
                Fit trip
            </button>
            <div className="stop-map-info">
                <p className="muted">
                    Drag a pin to move a stop, or pick <b>Place on map</b> on a stop and click where it goes. Either sets its lat/lng.{" "}
                    <span className="key lookup" /> = looked up and not saved yet, so check it.
                </p>
                {layout.unplaced.length > 0 && (
                    <ul className="stop-map-unplaced">
                        {layout.unplaced.map((u) => (
                            <li key={u.key}>
                                <button className="link" onClick={() => onSelect(u.key)}>
                                    {u.index + 1}. {u.label}
                                </button>{" "}
                                <span className="muted">{u.why}</span>{" "}
                                <button className="link" onClick={() => onPlace(u.key)}>
                                    Place on map
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
};
