import { useEffect, useState } from "react";

export type ThemePref = "auto" | "light" | "dark";
export type Theme = "light" | "dark";

export const THEME_KEY = "travel-history:theme";
/** What new visitors get. "auto" would follow their device instead. */
export const DEFAULT_THEME: ThemePref = "dark";

const prefersDark = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;

export const loadThemePref = (): ThemePref => {
    try {
        const t = localStorage.getItem(THEME_KEY);
        return t === "auto" || t === "light" || t === "dark" ? t : DEFAULT_THEME;
    } catch {
        return DEFAULT_THEME;
    }
};

/** Resolves the preference (following the device for "auto") and applies it to <html data-theme>. */
export const useTheme = (pref: ThemePref): Theme => {
    const [systemDark, setSystemDark] = useState(prefersDark);
    useEffect(() => {
        const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
        if (!mq) return;
        const onChange = () => setSystemDark(mq.matches);
        mq.addEventListener("change", onChange);
        return () => mq.removeEventListener("change", onChange);
    }, []);
    const theme: Theme = pref === "auto" ? (systemDark ? "dark" : "light") : pref;
    useEffect(() => {
        document.documentElement.dataset.theme = theme;
        document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#040e20" : "#eef2f7");
        try {
            localStorage.setItem(THEME_KEY, pref);
        } catch {
            // Not remembered; fine.
        }
    }, [theme, pref]);
    return theme;
};
