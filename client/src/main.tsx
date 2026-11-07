import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const root = document.getElementById("root")!;
root.classList.remove("prerendered");
createRoot(root).render(<App />);
