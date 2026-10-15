import { useCallback, useEffect, useRef, useState } from "react";
import type { Media } from "../types";

const url = (path: string) => import.meta.env.BASE_URL + path.split("/").map(encodeURIComponent).join("/");

interface Props {
    media: Media[];
    /** Accessible name for the images, e.g. the place name. */
    label: string;
}

/** Large photo with previous/next, swipe and arrow keys, plus a thumbnail strip. */
export const Gallery = ({ media, label }: Props) => {
    const [index, setIndex] = useState(0);
    const strip = useRef<HTMLDivElement>(null);
    const n = media.length;
    const go = useCallback((delta: number) => setIndex((i) => (i + delta + n) % n), [n]);

    useEffect(() => {
        if (n < 2) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "ArrowRight") go(1);
            else if (e.key === "ArrowLeft") go(-1);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [go, n]);

    // Keep the current thumbnail in view, and warm the cache for the next photo.
    useEffect(() => {
        strip.current?.children[index]?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
        const next = media[(index + 1) % n];
        if (next?.kind === "image") new Image().src = url(next.src);
    }, [index, media, n]);

    const swipeStart = useRef<number | null>(null);
    const onPointerDown = (e: React.PointerEvent) => {
        if (e.pointerType !== "mouse") swipeStart.current = e.clientX;
    };
    const onPointerUp = (e: React.PointerEvent) => {
        if (swipeStart.current === null) return;
        const dx = e.clientX - swipeStart.current;
        swipeStart.current = null;
        if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
    };

    if (!n) {
        return (
            <div className="gallery gallery--empty">
                <img src={url("placeholder.webp")} alt="" width={240} />
                <p>No photos from here yet.</p>
            </div>
        );
    }

    const current = media[Math.min(index, n - 1)];
    return (
        <div className="gallery">
            <div className="gallery__stage" onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
                {current.kind === "video" ? (
                    <video
                        key={current.id}
                        src={url(current.src)}
                        poster={url(current.thumb)}
                        width={current.width}
                        height={current.height}
                        controls
                        autoPlay
                        muted
                        loop
                        playsInline
                    />
                ) : (
                    <img
                        key={current.id}
                        src={url(current.src)}
                        width={current.width}
                        height={current.height}
                        alt={`${label}, photo ${index + 1} of ${n}`}
                        style={{ backgroundImage: `url("${url(current.thumb)}")` }}
                    />
                )}
                {n > 1 && (
                    <>
                        <button type="button" className="gallery__nav gallery__nav--prev" onClick={() => go(-1)} aria-label="Previous photo">‹</button>
                        <button type="button" className="gallery__nav gallery__nav--next" onClick={() => go(1)} aria-label="Next photo">›</button>
                        <span className="gallery__count">{index + 1} / {n}</span>
                    </>
                )}
            </div>
            {n > 1 && (
                <div className="gallery__strip" ref={strip}>
                    {media.map((m, i) => (
                        <button
                            type="button"
                            key={m.id}
                            className="gallery__thumb"
                            aria-current={i === index}
                            aria-label={`Photo ${i + 1}`}
                            onClick={() => setIndex(i)}
                        >
                            <img src={url(m.thumb)} alt="" loading="lazy" />
                            {m.kind === "video" && <span className="gallery__play" aria-hidden="true">▶</span>}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};
