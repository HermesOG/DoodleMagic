import "./style.css";
import { mountNettest } from "./nettest/page";

const app = document.getElementById("app");
if (!app) throw new Error("#app missing");

// three.js, арена и симуляция грузятся отдельными чанками: /nettest остаётся лёгким
const failed = (what: string) => (err: unknown) => {
  app.textContent = `Не удалось загрузить ${what}: ${err instanceof Error ? err.message : String(err)}`;
  console.error(err);
};

if (location.pathname.startsWith("/nettest")) {
  mountNettest(app);
} else if (location.pathname.startsWith("/render-test")) {
  import("./render/testPage").then((m) => m.mountRenderTest(app)).catch(failed("рендер"));
} else if (location.pathname.startsWith("/fx-test")) {
  import("./fx/fxTestPage").then((m) => m.mountFxTest(app)).catch(failed("эффекты"));
} else {
  import("./sandbox/page").then((m) => m.mountSandbox(app)).catch(failed("игру"));
}
