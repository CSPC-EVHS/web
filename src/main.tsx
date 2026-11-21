import React from "react";
import ReactDOM from "react-dom/client";
import { createGlobalStyle } from "styled-components";
import "katex/dist/katex.min.css";
import "sweetalert2/dist/sweetalert2.min.css";
import App from "./App";

const Global = createGlobalStyle`
  * { box-sizing: border-box; }
  html, body, #root { margin: 0; min-height: 100%; }
  body {
    background: #f3eee4;
    color: #1c1915;
    font-family: Georgia, "Iowan Old Style", Palatino, serif;
  }
  button, input { font: inherit; }
  button { cursor: pointer; }
`;

const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <Global />
      <App />
    </React.StrictMode>,
  );
}
