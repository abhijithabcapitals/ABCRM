// The Windows app's entry point. See components/DesktopApp.jsx.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./App.css";
import DesktopApp from "./components/DesktopApp";

createRoot(document.getElementById("root")).render(<StrictMode><DesktopApp /></StrictMode>);
