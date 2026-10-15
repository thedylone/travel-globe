import { useEffect, useRef } from "react";
import { formatDateRange, yearOf } from "../lib/dates";
import type { TravelStats } from "../lib/stats";
import type { Trip } from "../types";

interface Props {
    open: boolean;
    onToggle: () => void;
    trips: Trip[];
    hidden: ReadonlySet<string>;
    setHidden: (next: Set<string>) => void;
    focus?: string;
    onFocus: (tripId: string) => void;
    colors: Map<string, string>;
    stats: TravelStats;
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

export const Panel = (props: Props) => {
    const { open, onToggle, trips, hidden, setHidden, focus, onFocus, colors, stats } = props;

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
                    <h1>{__SITE_TITLE__}</h1>
                    <p className="panel__stats">
                        {count(shown, "trip")} · {count(stats.countries.length, "country", "countries")} ·{" "}
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
            </aside>
        </>
    );
};
