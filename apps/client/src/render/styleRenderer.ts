import {
  DepthTexture,
  FloatType,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  UnsignedByteType,
  Vector2,
  WebGLRenderTarget,
  WebGLRenderer,
  type ShaderMaterial,
  type Texture,
} from "three";
import { PRESETS, lineRadiusFor, pixelRatioFor, type Preset, type PresetId } from "./quality";
import { OVERLAY_DEPTH_RANGE, createStyleMaterial, inverseDepth } from "./stylePass";

export { OVERLAY_DEPTH_RANGE };

export const NEAR = 0.05;
export const FAR = 160;
/** Вертикальный FOV мира и рук (у рук свой, чтобы не тянулись по краям). */
export const WORLD_FOV = 70;
export const HANDS_FOV = 60;

/**
 * Проход света магии (решение Р1): сцены, которые рисуются после стилевого прохода прямо на экран, с ручной
 * проверкой глубины по G-буферу. `world` — камерой мира, `palm` — камерой рук (эффекты у ладоней).
 */
export interface FxLayers {
  world: Scene;
  palm: Scene;
}

/** G-буфер для прохода света: поверхность (тон, чернила, нормаль), глубина и её раскодировка камерой мира. */
export interface GBufferView {
  surface: Texture;
  depth: DepthTexture;
  /** 1 / D = x − y·d для глубины мира; обновляется каждый кадр перед проходом света. */
  invDepth: Vector2;
}

/**
 * Рендер «Тушь и свет»: G-буфер (RGBA8 + глубина float) и один стилевой проход на экран.
 * Второй слой (руки) рисуется в тот же G-буфер со своей камерой и диапазоном глубины [0; OVERLAY_DEPTH_RANGE]:
 * он всегда перед миром и потому не уходит в стену, но сам себя перекрывает правильно. Глубину мира при этом
 * не стираем — она нужна стилевому проходу. Третьим проходом (необязательно) — свет магии поверх кадра.
 */
export class StyleRenderer {
  readonly gl: WebGLRenderer;
  readonly camera = new PerspectiveCamera(WORLD_FOV, 1, NEAR, FAR);
  readonly overlayCamera = new PerspectiveCamera(HANDS_FOV, 1, NEAR, FAR);
  preset: Preset;
  /** Общие объекты G-буфера для материалов прохода света: те же самые на всё время жизни рендера. */
  readonly gbuffer: GBufferView;
  private readonly target: WebGLRenderTarget;
  private readonly post: ShaderMaterial;
  private readonly quad: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly postScene = new Scene();
  private readonly postCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly size = new Vector2();
  private readonly canvas: HTMLCanvasElement;
  /** Последний применённый размер (CSS-пиксели) и pixelRatio: resize с теми же числами ничего не делает. */
  private applied = { w: 0, h: 0, pixelRatio: 0 };

  constructor(canvas: HTMLCanvasElement, preset: PresetId) {
    this.canvas = canvas;
    this.preset = PRESETS[preset];
    this.gl = new WebGLRenderer({ canvas, antialias: false, depth: false, stencil: false, powerPreference: "high-performance" });
    this.gl.autoClear = false;
    this.gl.info.autoReset = false;
    // float-глубина не фильтруется: только NEAREST, иначе текстура неполная и читается нулями
    const depth = new DepthTexture(1, 1, FloatType);
    depth.minFilter = NearestFilter;
    depth.magFilter = NearestFilter;
    this.target = new WebGLRenderTarget(1, 1, {
      type: UnsignedByteType,
      format: RGBAFormat,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      generateMipmaps: false,
      depthBuffer: true,
      stencilBuffer: false,
      depthTexture: depth,
    });
    this.gbuffer = { surface: this.target.texture, depth, invDepth: new Vector2(1, 0) };
    this.post = createStyleMaterial(this.target.texture, depth);
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.post);
    this.quad.frustumCulled = false;
    this.postScene.add(this.quad);
    this.resize();
  }

  setPreset(id: PresetId): void {
    if (this.preset.id === id) return;
    this.preset = PRESETS[id];
    this.resize();
  }

  /**
   * Подгоняет буфер кадра, G-буфер, камеры мира и рук и стилевой проход под размер холста на экране и пресет.
   * Размер на экране задаёт CSS (холст во весь вьюпорт), а рендер стиль холста не трогает: так холст не может
   * разойтись с окном и обрезать низ кадра. Без аргументов берёт размер холста (или окна, пока холст не размечен).
   */
  resize(cssWidth?: number, cssHeight?: number): void {
    const w = Math.max(1, Math.round(cssWidth ?? (this.canvas.clientWidth || window.innerWidth)));
    const h = Math.max(1, Math.round(cssHeight ?? (this.canvas.clientHeight || window.innerHeight)));
    const pixelRatio = pixelRatioFor(this.preset, window.devicePixelRatio);
    if (w === this.applied.w && h === this.applied.h && pixelRatio === this.applied.pixelRatio) return;
    this.applied = { w, h, pixelRatio };
    this.gl.setPixelRatio(pixelRatio);
    this.gl.setSize(w, h, false);
    this.gl.getDrawingBufferSize(this.size);
    this.target.setSize(this.size.x, this.size.y);
    for (const cam of [this.camera, this.overlayCamera]) {
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    }
    const u = this.post.uniforms;
    u.uViewport!.value.copy(this.size);
    // узоры бумаги и сухой кисти — в CSS-пикселях; радиус контура — целые тексели по высоте кадра
    u.uCssPerTexel!.value = 1 / pixelRatio;
    u.uLineRadius!.value = lineRadiusFor(this.size.y);
  }

  /**
   * Следит за размером холста (ResizeObserver: окно, панель, масштаб страницы), за окном и за devicePixelRatio
   * (перенос окна на монитор с другим масштабом) и подгоняет под них всё, что делает resize. Возвращает отписку.
   */
  watchSize(): () => void {
    const onResize = (): void => this.resize();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver((entries) => {
            const box = entries[entries.length - 1]?.contentRect;
            if (box) this.resize(box.width, box.height);
          });
    observer?.observe(this.canvas);
    window.addEventListener("resize", onResize);
    // смена devicePixelRatio при том же CSS-размере не вызывает ни resize, ни ResizeObserver
    let dprQuery: MediaQueryList | null = null;
    const onDpr = (): void => {
      this.resize();
      watchDpr();
    };
    const watchDpr = (): void => {
      dprQuery?.removeEventListener("change", onDpr);
      dprQuery = typeof window.matchMedia === "function" ? window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`) : null;
      dprQuery?.addEventListener("change", onDpr);
    };
    watchDpr();
    this.resize();
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", onResize);
      dprQuery?.removeEventListener("change", onDpr);
    };
  }

  /**
   * Кадр: мир и (необязательно) руки в G-буфер, потом стилевой проход на экран и (необязательно) проход света.
   * У холста нет своего буфера глубины: материалы света сами сверяются с G-буфером (depthTest и depthWrite выключены).
   */
  render(world: Scene, overlay?: Scene, fx?: FxLayers): void {
    const gl = this.gl;
    gl.info.reset();
    gl.setRenderTarget(this.target);
    gl.setClearColor(0x000000, 0);
    gl.clear(true, true, false);
    gl.render(world, this.camera);
    if (overlay) {
      const ctx = gl.getContext();
      ctx.depthRange(0, OVERLAY_DEPTH_RANGE);
      try {
        gl.render(overlay, this.overlayCamera);
      } finally {
        ctx.depthRange(0, 1);
      }
    }
    gl.setRenderTarget(null);
    const u = this.post.uniforms;
    u.uProjInv!.value.copy(this.camera.projectionMatrixInverse);
    u.uCamWorld!.value.copy(this.camera.matrixWorld);
    inverseDepth(this.camera.near, this.camera.far, 1, u.uWorldInvDepth!.value);
    inverseDepth(this.overlayCamera.near, this.overlayCamera.far, OVERLAY_DEPTH_RANGE, u.uOverlayInvDepth!.value);
    gl.render(this.postScene, this.postCamera);
    if (fx) {
      inverseDepth(this.camera.near, this.camera.far, 1, this.gbuffer.invDepth);
      gl.render(fx.world, this.camera);
      gl.render(fx.palm, this.overlayCamera);
    }
  }

  /**
   * Прогрев: компилирует все шейдеры до первого кадра (с тем же целевым буфером, что и в игре, чтобы
   * three не собрал программу заново) и рисует один кадр, чтобы геометрия ушла в видеопамять.
   */
  async warmUp(world: Scene, overlay?: Scene, fx?: FxLayers): Promise<void> {
    this.gl.setRenderTarget(this.target);
    await this.gl.compileAsync(world, this.camera);
    if (overlay) await this.gl.compileAsync(overlay, this.overlayCamera);
    this.gl.setRenderTarget(null);
    await this.gl.compileAsync(this.postScene, this.postCamera);
    // свет магии рисуется прямо на экран — и компилируется под экран, своей камерой у каждого слоя
    if (fx) {
      await this.gl.compileAsync(fx.world, this.camera);
      await this.gl.compileAsync(fx.palm, this.overlayCamera);
    }
    this.render(world, overlay, fx);
  }

  /** Вызовы отрисовки за последний кадр (все проходы). */
  drawCalls(): number {
    return this.gl.info.render.calls;
  }

  /** Освобождает G-буфер (с текстурой глубины), стилевой проход с его квадом и контекст. */
  dispose(): void {
    this.quad.geometry.dispose();
    this.post.dispose();
    this.target.dispose();
    this.gl.dispose();
  }
}
