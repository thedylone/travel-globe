import { type Ref, useEffect, useMemo, useRef, useState } from "react";
import { formatDateRange } from "../lib/dates";
import { daysAway, monthStarts, timelineRows } from "../lib/timeline";
import type { Trip } from "../types";

const MONTHS = "JFMAMJJASOND".split("");

interface Props {
    ref?: Ref<HTMLElement>;
    open: boolean;
    /** Left edge on wide screens (beside the panel). */
    left: number;
    trips: Trip[];
    hidden: ReadonlySet<string>;
    focus?: string;
    colors: Map<string, string>;
    playing: boolean;
    onPlay: (playing: boolean) => void;
    onFocus: (tripId: string) => void;
    onClose: () => void;
}

/** Calendar of trips: a row per year, January to December, a bar per trip. */
export const Timeline = ({ ref, open, left, trips, hidden, focus, colors, playing, onPlay, onFocus, onClose }: Props) => {
    const rows = useMemo(() => timelineRows(trips), [trips]);
    const shown = useMemo(() => trips.filter((t) => !hidden.has(t.id)), [trips, hidden]);
    const days = useMemo(() => daysAway(shown), [shown]);
    const grid = useRef<HTMLDivElement>(null);
    // The trip under the pointer (or keyboard focus), described in the header.
    const [hover, setHover] = useState<Trip | undefined>();
    const ticks = monthStarts(2023).map((d) => (d / 365) * 100);

    // Keep the focused trip in view (the grid scrolls sideways on phones).
    useEffect(() => {
        if (!open || !focus) return;
        grid.current
            ?.querySelector(`[data-trip="${CSS.escape(focus)}"]`)
            ?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    }, [open, focus]);

    return (
        <section
            ref={ref}
            className="timeline"
            data-open={open}
            aria-label="Timeline"
            inert={!open}
            style={{ "--left": `${left}px` } as React.CSSProperties}
        >
            <header className="timeline__header">
                <h2>Timeline</h2>
                <span className="timeline__stats" aria-live="polite">
                    {hover
                        ? `${hover.title} · ${formatDateRange(hover)}${hover.stops.length > 1 ? ` · ${hover.stops.length} stops` : ""}`
                        : `${shown.length} trip${shown.length === 1 ? "" : "s"} · ${days} day${days === 1 ? "" : "s"} away`}
                </span>
                <button
                    type="button"
                    className="timeline__play"
                    onClick={() => onPlay(!playing)}
                    aria-pressed={playing}
                    title="Fly through the trips in order (P)"
                >
                    {playing ? "❚❚ Pause" : "▶ Play"}
                </button>
                <button type="button" className="timeline__close" onClick={onClose} aria-label="Close timeline">×</button>
            </header>
            <div className="timeline__scroll" ref={grid}>
                <div className="timeline__grid">
                    <div className="timeline__row timeline__row--months" aria-hidden="true">
                        <span />
                        <div className="timeline__track">
                            {MONTHS.map((m, i) => (
                                <span key={i} className="timeline__month" style={{ left: `${ticks[i]}%` }}>{m}</span>
                            ))}
                        </div>
                    </div>
                    {rows.map((row) => (
                        <div className="timeline__row" key={row.year} style={{ "--lanes": row.lanes } as React.CSSProperties}>
                            <span className="timeline__year">{row.year}</span>
                            <div className="timeline__track">
                                {monthStarts(row.year).slice(1).map((d) => (
                                    <span key={d} className="timeline__tick" style={{ left: `${(d / row.days) * 100}%` }} />
                                ))}
                                {row.segments.map((s) => {
                                    const t = s.trip;
                                    const label = `${t.title}, ${formatDateRange(t)}`;
                                    return (
                                        <button
                                            type="button"
                                            key={t.id}
                                            data-trip={t.id}
                                            className="timeline__bar"
                                            data-hidden={hidden.has(t.id)}
                                            data-from-prev={s.fromPrevYear}
                                            data-into-next={s.intoNextYear}
                                            aria-current={focus === t.id}
                                            aria-label={label}
                                            onPointerEnter={() => setHover(t)}
                                            onPointerLeave={() => setHover(undefined)}
                                            onFocus={() => setHover(t)}
                                            onBlur={() => setHover(undefined)}
                                            style={{
                                                "--swatch": colors.get(t.id),
                                                "--lane": s.lane,
                                                left: `${(s.startDay / row.days) * 100}%`,
                                                width: `${((s.endDay - s.startDay + 1) / row.days) * 100}%`,
                                            } as React.CSSProperties}
                                            onClick={() => onFocus(t.id)}
                                        />
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
};
