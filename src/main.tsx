import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/newsreader";
import App from "./App";
import "./styles/global.css";

const root = document.getElementById("root");
if (!root) throw new Error("Application root was not found.");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
