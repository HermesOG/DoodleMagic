import "./style.css";
import { mountNettest } from "./nettest/page";

const app = document.getElementById("app");
if (!app) throw new Error("#app missing");

if (location.pathname.startsWith("/nettest")) {
  mountNettest(app);
} else {
  app.innerHTML = `
    <section class="card">
      <h1>DoodleMagic</h1>
      <p>Магическая арена от первого лица. Скоро.</p>
      <p><a class="btn" href="/nettest?host=1">Я организатор: открыть тест связи</a></p>
      <p><a class="btn secondary" href="/nettest">Меня позвали: пройти тест</a></p>
    </section>`;
}
