import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function App() {
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">ON THURSDAYS WE WATCH FOOTBALL</p>
        <h1>On Thursdays<br />We Fantasy</h1>
        <p className="subtitle">The Officially Unofficial League Record Book</p>
        <div className="cards">
          <article><span>2026</span><strong>Season</strong></article>
          <article><span>998599827</span><strong>ESPN League ID</strong></article>
          <article><span>Coming soon</span><strong>League history</strong></article>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
