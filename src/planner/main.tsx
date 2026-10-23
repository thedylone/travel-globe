import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Planner } from "./Planner";
import "./planner.css";

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <Planner />
    </StrictMode>
);

// Keeps the planner working offline (scripts/vite-plugin-planner.ts writes sw.js on build).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}planner/sw.js`).catch(() => undefined);
}
