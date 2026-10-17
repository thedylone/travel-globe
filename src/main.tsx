import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <App />
    </StrictMode>
);

// Dev server: show changes to the data folder (scripts/vite-plugin-travel-data.ts).
import.meta.hot?.on("travel-data:changed", () => location.reload());
