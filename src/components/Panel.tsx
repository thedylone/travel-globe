import { useEffect, useRef } from "react";
import { formatDateRange, yearOf } from "../lib/dates";
import type { Trip } from "../types";
import type { GlobeSettings } from "./GlobeView";

interface Props {
    open: boolean;
    onToggle: () => void;
    trips: Trip[];
    hidden: ReadonlySet<string>;
    setHidden: (next: Set<string>) => void;
    focus?: string;
    onFocus: (tripId: string) => void;
    colors: Map<string, string>;
    stats: { places: number; countries: number; km: number };
    settings: GlobeSettings;
    setSettings: (next: GlobeSettings) => void;
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const Checkbox = ({ checked, indeterminate, onChange, label }: {
    checked: boolean;
    indeterminate?: boolean;
    onChange: (checked: boolean) => void;
    label: string;
}) => {
    const ref = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (ref.current) ref.current.indeterminate = !!indeterminate;
    }, [indeterminate]);
    return <input ref={ref} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />;
};

type Toggle = "rotate" | "night" | "borders";
const TOGGLES: { key: Toggle; label: string; shortcut: string; satelliteOnly?: boolean }[] = [
    { key: "rotate", label: "Rotate", shortcut: "R" },
    { key: "night", label: "Night", shortcut: "D", satelliteOnly: true },
    { key: "borders", label: "Country borders", shortcut: "B", satelliteOnly: true },
];

export const Panel = (props: Props) => {
    const { open, onToggle, trips, hidden, setHidden, focus, onFocus, colors, stats, settings, setSettings } = props;

    const years = new Map<number, Trip[]>();
    for (const t of [...trips].reverse()) {
        const y = yearOf(t.start);
        years.set(y, [...(years.get(y) ?? []), t]);
    }
    const setVisible = (ids: string[], visible: boolean) => {
        const next = new Set(hidden);
        for (const id of ids) {
            if (visible) next.delete(id);
            else next.add(id);
        }
        setHidden(next);
    };
    const shown = trips.length - hidden.size;

    return (
        <>
            <button
                type="button"
                className="panel-toggle"
                onClick={onToggle}
                aria-expanded={open}
                aria-controls="panel"
            >
                {open ? "×" : "☰"}
                <span className="visually-hidden">{open ? "Close" : "Open"} trip list</span>
            </button>
            <aside id="panel" className="panel" data-open={open} aria-label="Trips and settings">
                <header className="panel__header">
                    <h1>Travel History</h1>
                    <p className="panel__stats">
                        {count(shown, "trip")} · {count(stats.countries, "country", "countries")} ·{" "}
                        {count(stats.places, "place")} · {Math.round(stats.km).toLocaleString()} km
                    </p>
                </header>

                <section className="panel__section panel__trips">
                    <div className="panel__row">
                        <h2>Trips</h2>
                        <span className="panel__actions">
                            <button type="button" onClick={() => setHidden(new Set())}>Show all</button>
                            <button type="button" onClick={() => setHidden(new Set(trips.map((t) => t.id)))}>Hide all</button>
                        </span>
                    </div>
                    {[...years].map(([year, ts]) => {
                        const visible = ts.filter((t) => !hidden.has(t.id)).length;
                        return (
                            <div className="year" key={year}>
                                <label className="year__label">
                                    <Checkbox
                                        checked={visible > 0}
                                        indeterminate={visible > 0 && visible < ts.length}
                                        onChange={(v) => setVisible(ts.map((t) => t.id), v)}
                                        label={`Show trips from ${year}`}
                                    />
                                    {year}
                                </label>
                                <ul>
                                    {ts.map((t) => (
                                        <li key={t.id} className="trip" aria-current={focus === t.id}>
                                            <Checkbox
                                                checked={!hidden.has(t.id)}
                                                onChange={(v) => setVisible([t.id], v)}
                                                label={`Show ${t.title}`}
                                            />
                                            <button
                                                type="button"
                                                className="trip__name"
                                                style={{ "--swatch": colors.get(t.id) } as React.CSSProperties}
                                                onClick={() => onFocus(t.id)}
                                            >
                                                <span className="trip__title">{t.title}</span>
                                                <span className="trip__date">
                                                    {formatDateRange(t)}
                                                    {t.stops.length > 1 ? ` · ${t.stops.length} stops` : ""}
                                                </span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        );
                    })}
                </section>

                <section className="panel__section">
                    <h2>Globe</h2>
                    <div className="segmented" role="radiogroup" aria-label="Globe style">
                        {(["satellite", "map"] as const).map((style) => (
                            <label key={style}>
                                <input
                                    type="radio"
                                    name="globe-style"
                                    checked={settings.style === style}
                                    onChange={() => setSettings({ ...settings, style })}
                                />
                                {style === "satellite" ? "Satellite" : "Map"}
                            </label>
                        ))}
                        <kbd>M</kbd>
                    </div>
                    {TOGGLES.map(({ key, label, shortcut, satelliteOnly }) => {
                        const disabled = satelliteOnly && settings.style !== "satellite";
                        return (
                            <label className="setting" key={key} data-disabled={disabled}>
                                <input
                                    type="checkbox"
                                    checked={settings[key]}
                                    disabled={disabled}
                                    onChange={(e) => setSettings({ ...settings, [key]: e.target.checked })}
                                />
                                {label}
                                <kbd>{shortcut}</kbd>
                            </label>
                        );
                    })}
                </section>
            </aside>
        </>
    );
};
