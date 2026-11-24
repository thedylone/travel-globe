/**
 * Groups a stop's photos by day, then into "moments": runs of photos taken close together
 * in time and place, such as one viewpoint or one meal. Works from each photo's time and
 * GPS position (read from the originals' EXIF; see readPhotoInfo in scripts/lib/importer.ts).
 *
 * Used by the studio to show a stop's photos in groups, and meant for anything that wants
 * variety across a stop, e.g. picking at most one photo per moment.
 */
import { centroid, distanceKm, type LatLng } from "./geo.ts";

export interface PhotoWhen {
    id: string;
    /** Local time taken, "YYYY-MM-DD HH:MM:SS". */
    time?: string;
    at?: LatLng;
}

export interface Moment {
    /** Photo ids, in time order. */
    ids: string[];
    /** First and last time, "YYYY-MM-DD HH:MM:SS". */
    start?: string;
    end?: string;
    /** Centre of the moment's located photos. */
    at?: LatLng;
}

export interface PhotoDay {
    /** "YYYY-MM-DD"; missing for the group of photos with no time at all. */
    day?: string;
    moments: Moment[];
}

export interface MomentOptions {
    /** A gap longer than this starts a new moment. */
    minutes?: number;
    /** So does moving further than this from the previous photo... */
    km?: number;
    /** ...or from where the moment started (a slow walk away from it). */
    driftKm?: number;
    /** Photos before this hour count as the day before, so a late night stays one day. */
    dayStartsAt?: number;
}

export const MOMENT_DEFAULTS: Required<MomentOptions> = { minutes: 45, km: 1, driftKm: 2, dayStartsAt: 4 };

const ms = (time: string) => Date.parse(time.replace(" ", "T") + "Z");

/** The day a photo counts towards: its date, or the day before for one taken in the small hours. */
export const dayOf = (time: string, dayStartsAt = MOMENT_DEFAULTS.dayStartsAt) =>
    new Date(ms(time) - dayStartsAt * 36e5).toISOString().slice(0, 10);

const finish = (photos: PhotoWhen[]): Moment => {
    const times = photos.flatMap((p) => (p.time ? [p.time] : [])).sort();
    const located = photos.flatMap((p) => (p.at ? [p.at] : []));
    return {
        ids: photos.map((p) => p.id),
        ...(times.length ? { start: times[0], end: times[times.length - 1] } : {}),
        ...(located.length ? { at: centroid(located) } : {}),
    };
};

/**
 * Groups photos, given in the stop's order, into days and moments, both in time order.
 * A photo without a time goes with the timed photo before it in the stop's order (imports
 * number files in time order), or after it if it comes first. If none has a time, they all
 * come back as one moment in a day without a date, in the order given.
 */
export const groupPhotos = (photos: PhotoWhen[], options: MomentOptions = {}): PhotoDay[] => {
    const o = { ...MOMENT_DEFAULTS, ...options };
    if (!photos.length) return [];
    if (!photos.some((p) => p.time)) return [{ moments: [finish(photos)] }];

    // Untimed photos ride along with a timed neighbour.
    const riders = new Map<string, PhotoWhen[]>();
    let lead = photos.find((p) => p.time)!;
    for (const p of photos) {
        if (p.time) lead = p;
        else riders.set(lead.id, [...(riders.get(lead.id) ?? []), p]);
    }

    const timed = photos.filter((p) => p.time).sort((a, b) => a.time!.localeCompare(b.time!));
    const days: PhotoDay[] = [];
    let run: PhotoWhen[] = [];
    let runDay = "";
    let last: PhotoWhen | undefined;
    /** The last and first located photos of the current moment. */
    let lastAt: LatLng | undefined;
    let firstAt: LatLng | undefined;
    const close = () => {
        if (!run.length) return;
        const moment = finish(run);
        const d = days[days.length - 1];
        if (d?.day === runDay) d.moments.push(moment);
        else days.push({ day: runDay, moments: [moment] });
        run = [];
        lastAt = firstAt = undefined;
    };
    for (const p of timed) {
        const day = dayOf(p.time!, o.dayStartsAt);
        const split =
            !last ||
            day !== runDay ||
            ms(p.time!) - ms(last.time!) > o.minutes * 6e4 ||
            (p.at && lastAt && distanceKm(p.at, lastAt) > o.km) ||
            (p.at && firstAt && distanceKm(p.at, firstAt) > o.driftKm);
        if (split) {
            close();
            runDay = day;
        }
        run.push(p, ...(riders.get(p.id) ?? []));
        if (p.at) {
            lastAt = p.at;
            firstAt ??= p.at;
        }
        last = p;
    }
    close();
    return days;
};

/** Just the moments, each a list of photo ids: the shape a picker needs. */
export const momentIds = (days: PhotoDay[]): string[][] => days.flatMap((d) => d.moments.map((m) => m.ids));
