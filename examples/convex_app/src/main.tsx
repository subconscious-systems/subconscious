/**
 * App entry point.
 * Sets up the Convex client and renders the app.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import App from "./App";
import "./index.css";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <ConvexProvider client={convex}>
            <App />
        </ConvexProvider>
    </StrictMode>
);
