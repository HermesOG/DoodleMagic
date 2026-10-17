import "./style.css";
import { mountNettest } from "./nettest/page";

const app = document.getElementById("app");
if (!app) throw new Error("#app missing");

if (location.pathname.startsWith("/nettest")) {
  mountNettest(app);
} else if (location.pathname.startsWith("/render-test")) {
  // three.js грузится отдельным чанком только для игровых страниц
  import("./render/testPage")
    .then((m) => m.mountRenderTest(app))
    .catch((err: unknown) => {
      app.textContent = `Не удалось загрузить рендер: ${err instanceof Error ? err.message : String(err)}`;
      console.error(err);
    });
} else {
  app.innerHTML = `
    <section class="card">
      <h1>DoodleMagic</h1>
      <p>Магическая арена от первого лица. Скоро.</p>
      <p><a class="btn" href="/nettest?host=1">Я организатор: открыть тест связи</a></p>
      <p><a class="btn secondary" href="/nettest">Меня позвали: пройти тест</a></p>
    </section>`;
}
