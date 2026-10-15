import { useEffect, useRef } from "react";
import { formatDateRange, yearOf } from "../lib/dates";
import type { Visit } from "../lib/places";
import { Gallery } from "./Gallery";

interface Props {
    /** Everything shown in this dialog: one place's visits, or several places that can't be told apart on the globe. */
    visits: Visit[];
    current: Visit;
    colors: Map<string, string>;
    onSelect: (visit: Visit) => void;
    onFocusTrip: (tripId: string) => void;
    onClose: () => void;
}

const sameVisit = (a: Visit, b: Visit) => a.trip.id === b.trip.id && a.stopIndex === b.stopIndex;

export const PlaceDialog = ({ visits, current, colors, onSelect, onFocusTrip, onClose }: Props) => {
    const dialog = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        const d = dialog.current;
        if (d && !d.open) d.showModal();
    }, []);

    const { trip, stop } = current;
    const onePlace = visits.every((v) => v.stop.name === visits[0].stop.name);
    const tabLabel = (v: Visit) => (onePlace ? `${v.trip.title} · ${yearOf(v.stop.start)}` : v.stop.name);

    return (
        <dialog
            ref={dialog}
            className="place"
            onClose={onClose}
            // Clicking the backdrop (the dialog element itself, outside its content) closes it.
            onClick={(e) => e.target === e.currentTarget && dialog.current?.close()}
            aria-labelledby="place-title"
        >
            <div className="place__body">
                <header className="place__header">
                    <h2 id="place-title">{stop.name}</h2>
                    <button type="button" className="place__close" onClick={() => dialog.current?.close()} aria-label="Close">×</button>
                    {visits.length > 1 && (
                        <div className="place__tabs" role="tablist" aria-label={onePlace ? "Visits" : "Places here"}>
                            {visits.map((v) => (
                                <button
                                    key={`${v.trip.id}:${v.stopIndex}`}
                                    type="button"
                                    role="tab"
                                    aria-selected={sameVisit(v, current)}
                                    style={{ "--swatch": colors.get(v.trip.id) } as React.CSSProperties}
                                    onClick={() => onSelect(v)}
                                >
                                    {tabLabel(v)}
                                </button>
                            ))}
                        </div>
                    )}
                    <p className="place__meta">
                        <button
                            type="button"
                            className="place__trip"
                            style={{ "--swatch": colors.get(trip.id) } as React.CSSProperties}
                            onClick={() => onFocusTrip(trip.id)}
                            title="Show this trip on the globe"
                        >
                            {trip.title}
                        </button>
                        <span> · {formatDateRange(stop)}</span>
                    </p>
                    {stop.note && <p className="place__note">{stop.note}</p>}
                </header>
                <Gallery key={`${trip.id}:${current.stopIndex}`} media={stop.media} label={stop.name} />
            </div>
        </dialog>
    );
};
