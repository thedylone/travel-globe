// A plan in a line: its dates and places, for link previews (worker/src/preview.ts, which reads
// plans as the server has them, so nothing here trusts their shape) and the trip's picture.

/** The bits of a plan a preview uses. The planner checks the rest. */
export interface PreviewPlan {
    title?: unknown;
    start?: unknown;
    country?: unknown;
    days?: unknown;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;

const dateLabel = (t: number, withYear: boolean) =>
    new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });

/** "3–9 Apr 2027", "28 Mar – 2 Apr 2027", "30 Dec 2026 – 3 Jan 2027", or "" without dates. */
export const dateRange = (start: string, days: number) => {
    if (!ISO.test(start)) return "";
    const a = Date.parse(`${start}T00:00:00Z`);
    const b = a + Math.max(0, days - 1) * DAY;
    if (a === b) return dateLabel(a, true);
    const [ya, yb] = [new Date(a).getUTCFullYear(), new Date(b).getUTCFullYear()];
    const sameMonth = ya === yb && new Date(a).getUTCMonth() === new Date(b).getUTCMonth();
    if (sameMonth) return `${new Date(a).getUTCDate()}–${dateLabel(b, true)}`;
    return `${dateLabel(a, ya !== yb)} – ${dateLabel(b, true)}`;
};

export const placeNames = (days: unknown[]): string[] => {
    const names: string[] = [];
    for (const day of days) {
        const places = (day as { places?: unknown })?.places;
        if (!Array.isArray(places)) continue;
        for (const p of places as { name?: unknown; place?: unknown }[]) {
            const name = (typeof p?.name === "string" && p.name.trim()) || (typeof p?.place === "string" && p.place.split(",")[0].trim()) || "";
            if (name && !names.includes(name)) names.push(name);
        }
    }
    return names;
};

export const list = (names: string[], max = 3) => {
    if (names.length <= max) return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? "");
    return `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
};

/** The preview's title and description, from the plan (or a plain one without it). */
export const describePlan = (plan?: PreviewPlan) => {
    const title = (typeof plan?.title === "string" && plan.title.trim()) || "A trip plan";
    if (!plan) return { title, description: "A shared trip plan. Open it to plan together." };
    const days = Array.isArray(plan.days) ? plan.days : [];
    const dates = dateRange(typeof plan.start === "string" ? plan.start : "", days.length);
    const length = days.length ? `${days.length} ${days.length === 1 ? "day" : "days"}` : "";
    const places = list(placeNames(days));
    const country = typeof plan.country === "string" ? plan.country.trim() : "";
    const description = [dates || length, places || country].filter(Boolean).join(" · ");
    return { title, description: description ? `${description}. A shared trip plan.` : "A shared trip plan. Open it to plan together." };
};

