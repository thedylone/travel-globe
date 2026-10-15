import { useEffect, useRef, useState } from "react";
import { loadCountries } from "../lib/borders";
import { shareFontDataUrl, svgToPng } from "../lib/rasterize";
import { renderShareSvg, SHARE_SIZES, type ShareSize, type ShareTheme } from "../lib/share";
import type { TravelStats } from "../lib/stats";

interface Props {
    stats: TravelStats;
    stops: { lat: number; lng: number; country?: string }[];
    /** The page's theme: the image starts in the same one. */
    theme: ShareTheme;
    /** Some trips are hidden or one is focused: offer to zoom the map to them. */
    filtered: boolean;
    onClose: () => void;
}

/** Published by the deploy (scripts/stats-image.ts); always shows every trip. */
const STATIC_IMAGES: Record<ShareSize, string> = { post: "stats", story: "stats-story", wide: "stats-wide" };
const imageFile = (size: ShareSize, theme: ShareTheme) => `${STATIC_IMAGES[size]}${theme === "light" ? "-light" : ""}.png`;
const siteImage = (size: ShareSize, theme: ShareTheme) => `https://${__SITE_URL__}/${imageFile(size, theme)}`;

/**
 * The image this deploy published, if it's there (it isn't on the dev server).
 * It was built from the same data as this page, so with no trips filtered it's
 * exactly what we'd draw: use it and skip loading borders and fonts.
 */
const deployedImage = async (size: ShareSize, theme: ShareTheme): Promise<Blob | null> => {
    try {
        const res = await fetch(`${import.meta.env.BASE_URL}${imageFile(size, theme)}`);
        const blob = res.ok ? await res.blob() : null;
        return blob?.type === "image/png" ? blob : null;
    } catch {
        return null;
    }
};

export const ShareDialog = ({ stats, stops, theme: pageTheme, filtered, onClose }: Props) => {
    const dialog = useRef<HTMLDialogElement>(null);
    const [size, setSize] = useState<ShareSize>("post");
    const [theme, setTheme] = useState<ShareTheme>(pageTheme);
    const [zoomPref, setZoom] = useState(true);
    const zoom = filtered && zoomPref;
    const [png, setPng] = useState<{ blob: Blob; url: string } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        const d = dialog.current;
        if (d && !d.open) d.showModal();
    }, []);

    useEffect(() => {
        let cancelled = false;
        let made: string | undefined;
        setPng(null);
        setError(null);
        (async () => {
            let blob = filtered ? null : await deployedImage(size, theme);
            if (!blob) {
                // Filtered trips (or no deployed image yet): draw it here.
                const [countries, fontDataUrl] = await Promise.all([loadCountries(), shareFontDataUrl().catch(() => undefined)]);
                const svg = renderShareSvg({ countries, stops, stats, size, theme, zoom, url: __SITE_URL__, fontDataUrl });
                const { width, height } = SHARE_SIZES[size];
                blob = await svgToPng(svg, width, height);
            }
            if (cancelled) return;
            made = URL.createObjectURL(blob);
            setPng({ blob, url: made });
        })().catch((e: Error) => !cancelled && setError(e.message));
        return () => {
            cancelled = true;
            if (made) URL.revokeObjectURL(made);
        };
    }, [size, theme, zoom, filtered, stats, stops]);

    const fileName = `travel-history-${size}${theme === "light" ? "-light" : ""}.png`;
    const file = png ? new File([png.blob], fileName, { type: "image/png" }) : null;
    const canShare = !!file && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(siteImage(size, theme));
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            document.getElementById("share-link")?.focus();
        }
    };

    return (
        <dialog
            ref={dialog}
            className="share"
            onClose={onClose}
            onClick={(e) => e.target === e.currentTarget && dialog.current?.close()}
            aria-labelledby="share-title"
        >
            <div className="share__body">
                <header className="share__header">
                    <h2 id="share-title">Share image</h2>
                    <button type="button" className="place__close" onClick={() => dialog.current?.close()} aria-label="Close">×</button>
                </header>

                <div className="share__sizes" role="radiogroup" aria-label="Image size">
                    {(Object.keys(SHARE_SIZES) as ShareSize[]).map((s) => (
                        <label key={s}>
                            <input type="radio" name="share-size" checked={size === s} onChange={() => setSize(s)} />
                            <span>{SHARE_SIZES[s].label}</span>
                            <small>{SHARE_SIZES[s].hint}</small>
                        </label>
                    ))}
                </div>

                <div className="segmented share__themes" role="radiogroup" aria-label="Image colours">
                    {(["dark", "light"] as const).map((t) => (
                        <label key={t}>
                            <input type="radio" name="share-theme" checked={theme === t} onChange={() => setTheme(t)} />
                            {t === "dark" ? "Dark" : "Light"}
                        </label>
                    ))}
                </div>

                {filtered && (
                    <label className="setting share__zoom">
                        <input type="checkbox" checked={zoomPref} onChange={(e) => setZoom(e.target.checked)} />
                        Zoom the map to these trips
                    </label>
                )}

                <div className="share__preview" style={{ aspectRatio: `${SHARE_SIZES[size].width} / ${SHARE_SIZES[size].height}` }}>
                    {png ? <img src={png.url} alt="Preview of the share image" /> : <p>{error ? `Couldn't make the image: ${error}` : "Drawing…"}</p>}
                </div>

                <div className="share__actions">
                    {canShare && (
                        <button
                            type="button"
                            className="share__primary"
                            onClick={() => navigator.share({ files: [file!], title: "Travel history" }).catch(() => {})}
                        >
                            Share…
                        </button>
                    )}
                    <a
                        className={canShare ? "share__secondary" : "share__primary"}
                        href={png?.url}
                        download={fileName}
                        aria-disabled={!png}
                    >
                        Download PNG
                    </a>
                </div>

                <div className="share__link">
                    <label htmlFor="share-link">Link that always shows the latest image (all trips; updated whenever the site deploys)</label>
                    <div>
                        <input id="share-link" readOnly value={siteImage(size, theme)} onFocus={(e) => e.target.select()} />
                        <button type="button" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
                    </div>
                </div>
            </div>
        </dialog>
    );
};
