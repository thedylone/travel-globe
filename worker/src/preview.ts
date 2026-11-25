// The page a share link opens: link-preview tags for chat apps (which don't run scripts), then
// straight on to the planner with the plan's "#join=…". Chat apps read the tags when the link is
// pasted, so the preview names the trip; nobody without the link can see it.

/** The bits of a plan a preview uses. The planner checks the rest. */
export interface PreviewPlan {
    title?: unknown;
    start?: unknown;
    country?: unknown;
    days?: unknown;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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

const placeNames = (days: unknown[]): string[] => {
    const names: string[] = [];
    for (const day of days) {
        const places = (day as { places?: unknown })?.places;
        if (!Array.isArray(places)) continue;
        for (const p of places as { name?: unknown; place?: unknown;}[]) {
            const name = (typeof p?.name === "string" && p.name.trim()) || (typeof p?.place === "string" && p.place.split(",")[0].trim()) || "";
            if (name && !names.includes(name)) names.push(name);
        }
    }
    return names;
};

const list = (names: string[], max = 3) => {
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

/**
 * The share link's page. `planner` is where it goes (with the "#join=…"); `image` is the picture
 * chat apps show (the planner's, made with the site).
 */
export const previewPage = ({ plan, url, planner, image }: { plan?: PreviewPlan; url: string; planner: string; image: string }) => {
    const { title, description } = describePlan(plan);
    // As JSON in a script: "<" escaped so nothing in it can close the tag.
    const target = JSON.stringify(planner).replace(/</g, "\\u003c");
    const meta = [
        ["property", "og:title", title],
        ["property", "og:description", description],
        ["property", "og:type", "website"],
        ["property", "og:url", url],
        ["property", "og:site_name", "Trip planner"],
        ["property", "og:image", image],
        ["property", "og:image:width", "1200"],
        ["property", "og:image:height", "630"],
        ["name", "twitter:card", "summary_large_image"],
        ["name", "twitter:title", title],
        ["name", "twitter:description", description],
        ["name", "twitter:image", image],
        ["name", "description", description],
        ["name", "robots", "noindex"],
    ]
        .map(([attr, key, value]) => `<meta ${attr}="${key}" content="${esc(value)}" />`)
        .join("\n    ");
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="no-referrer" />
    <title>${esc(title)}</title>
    ${meta}
    <script>location.replace(${target});</script>
    <style>body{font:16px/1.5 system-ui,sans-serif;background:#efe7d9;color:#3d3630;display:grid;place-items:center;min-height:90vh;margin:0 16px}a{color:#c4674a}</style>
  </head>
  <body>
    <p>Opening <a href="${esc(planner)}">${esc(title)}</a> in the trip planner…</p>
  </body>
</html>
`;
};
