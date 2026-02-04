/**
 * App entry point.
 * Sets up the Convex client and renders the app.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import App from "./App";
import "./index.css";

const convexUrl = import.meta.env.VITE_CONVEX_URL as string;

if (!convexUrl) {
    const errorMsg = "VITE_CONVEX_URL is not set. Please create .env.local with your Convex URL.";
    console.error(errorMsg);
    document.body.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: center; height: 100vh; font-family: system-ui;">
      <div style="text-align: center; padding: 2rem; border: 2px solid #ef4444; border-radius: 8px; max-width: 500px;">
        <h1 style="color: #ef4444; margin: 0 0 1rem 0;">Configuration Error</h1>
        <p style="color: #666; margin: 0 0 1rem 0;">${errorMsg}</p>
        <p style="color: #666; margin: 0; font-size: 0.9rem;">Check the README for setup instructions.</p>
      </div>
    </div>
  `;
} else {
    const convex = new ConvexReactClient(convexUrl);

    createRoot(document.getElementById("root")!).render(
        <StrictMode>
            <ConvexProvider client={convex}>
                <App />
            </ConvexProvider>
        </StrictMode>
    );
}
