// The page a share link opens: link-preview tags for chat apps (which don't run scripts), then
// straight on to the planner with the plan's "#join=…". Chat apps read the tags when the link is
// pasted, so the preview names the trip; nobody without the link can see it.
import { describePlan, type PreviewPlan } from "../../src/planner/summary";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

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
