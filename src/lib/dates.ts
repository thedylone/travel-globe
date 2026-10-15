const ISO = /^\d{4}-\d{2}-\d{2}$/;

const MONTHS_SHORT = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export interface DateRange {
    start: string;
    end: string;
}

const isRealDate = (iso: string) => {
    const d = new Date(iso + "T00:00:00Z");
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
};

/**
 * Parses a trip date: "2024-03-07" or a range "2024-03-07..2024-03-09".
 * Throws with a readable message on anything else.
 */
export const parseDateRange = (value: string): DateRange => {
    const parts = value.split("..").map((s) => s.trim());
    if (parts.length > 2 || !parts.every((p) => ISO.test(p) && isRealDate(p))) {
        throw new Error(
            `invalid date "${value}" (use YYYY-MM-DD or YYYY-MM-DD..YYYY-MM-DD)`
        );
    }
    const [start, end = start] = parts;
    if (end < start) throw new Error(`date range "${value}" ends before it starts`);
    return { start, end };
};

export const formatDateRange = ({ start, end }: DateRange): string => {
    const [sy, sm, sd] = start.split("-").map(Number);
    const [ey, em, ed] = end.split("-").map(Number);
    const s = `${sd} ${MONTHS_SHORT[sm - 1]}`;
    if (start === end) return `${s} ${sy}`;
    if (sy === ey && sm === em) return `${sd}–${ed} ${MONTHS_SHORT[em - 1]} ${ey}`;
    if (sy === ey) return `${s} – ${ed} ${MONTHS_SHORT[em - 1]} ${ey}`;
    return `${s} ${sy} – ${ed} ${MONTHS_SHORT[em - 1]} ${ey}`;
};

export const yearOf = (iso: string) => Number(iso.slice(0, 4));
