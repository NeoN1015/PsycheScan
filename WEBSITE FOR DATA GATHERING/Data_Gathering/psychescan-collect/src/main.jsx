import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Self-hosted (bundled) fonts: Atkinson Hyperlegible, designed for legibility.
import "@fontsource-variable/atkinson-hyperlegible-next/wght.css";
import "@fontsource-variable/atkinson-hyperlegible-mono/wght.css";
import "./index.css";
import App from "./App.jsx";
import { SessionProvider } from "./state/SessionContext.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <SessionProvider>
      <App />
    </SessionProvider>
  </StrictMode>
);
