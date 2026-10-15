import { useEffect, useRef, useState } from "react";
import type { ThemePref } from "../lib/theme";
import type { GlobeSettings } from "./GlobeView";

interface Props {
    settings: GlobeSettings;
    setSettings: (next: GlobeSettings) => void;
    themePref: ThemePref;
    setThemePref: (next: ThemePref) => void;
}

const STYLES: { value: GlobeSettings["style"]; label: string }[] = [
    { value: "satellite", label: "Satellite" },
    { value: "map", label: "Map" },
];

type Toggle = "borders" | "night" | "rotate";
const TOGGLES: { key: Toggle; label: string; shortcut: string; satelliteOnly?: boolean }[] = [
    { key: "borders", label: "Country borders", shortcut: "B", satelliteOnly: true },
    { key: "night", label: "Night", shortcut: "D", satelliteOnly: true },
    { key: "rotate", label: "Rotate", shortcut: "R" },
];

const THEMES: { value: ThemePref; label: string }[] = [
    { value: "auto", label: "Auto" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
];

/** Stacked squares, the usual "layers" symbol. */
const LayersIcon = () => (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" d="M12 3 2 8.5 12 14l10-5.5L12 3Z" />
        <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" d="m2 13 10 5.5L22 13" />
        <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" d="m2 17.5 10 5.5 10-5.5" opacity="0.5" />
    </svg>
);

/** Map type, overlays and theme, behind one button (like the layers control on map apps). */
export const LayersMenu = ({ settings, setSettings, themePref, setThemePref }: Props) => {
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null);

    // Close on a click elsewhere or Escape.
    useEffect(() => {
        if (!open) return;
        const onDown = (e: PointerEvent) => {
            if (!root.current?.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.stopPropagation();
                setOpen(false);
            }
        };
        document.addEventListener("pointerdown", onDown);
        window.addEventListener("keydown", onKey, true);
        return () => {
            document.removeEventListener("pointerdown", onDown);
            window.removeEventListener("keydown", onKey, true);
        };
    }, [open]);

    return (
        <div className="layers" ref={root}>
            <button
                type="button"
                className="toolbar__button"
                aria-expanded={open}
                aria-controls="layers-menu"
                onClick={() => setOpen((o) => !o)}
                title="Layers"
            >
                <LayersIcon />
                <span className="visually-hidden">Layers</span>
            </button>
            {open && (
                <div id="layers-menu" className="layers__menu" role="dialog" aria-label="Layers">
                    <h2>Map type <kbd>M</kbd></h2>
                    <div className="layers__types" role="radiogroup" aria-label="Map type">
                        {STYLES.map(({ value, label }) => (
                            <label key={value} className={`layers__type layers__type--${value}`}>
                                <input
                                    type="radio"
                                    name="globe-style"
                                    checked={settings.style === value}
                                    onChange={() => setSettings({ ...settings, style: value })}
                                />
                                <span className="layers__thumb" aria-hidden="true" />
                                {label}
                            </label>
                        ))}
                    </div>

                    <h2>Details</h2>
                    {TOGGLES.map(({ key, label, shortcut, satelliteOnly }) => {
                        const disabled = satelliteOnly && settings.style !== "satellite";
                        return (
                            <label className="setting" key={key} data-disabled={disabled} title={disabled ? "Satellite only" : undefined}>
                                <input
                                    type="checkbox"
                                    checked={settings[key]}
                                    disabled={disabled}
                                    onChange={(e) => setSettings({ ...settings, [key]: e.target.checked })}
                                />
                                {label}
                                <kbd>{shortcut}</kbd>
                            </label>
                        );
                    })}

                    <h2>Theme</h2>
                    <div className="segmented" role="radiogroup" aria-label="Theme">
                        {THEMES.map(({ value, label }) => (
                            <label key={value} title={value === "auto" ? "Follow your device" : undefined}>
                                <input type="radio" name="theme" checked={themePref === value} onChange={() => setThemePref(value)} />
                                {label}
                            </label>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
