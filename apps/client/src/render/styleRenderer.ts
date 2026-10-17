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
 * Рендер «Тушь и свет»: G-буфер (RGBA8 + глубина float) и один стилевой проход на экран.
 * Второй слой (руки) рисуется в тот же G-буфер со своей камерой и диапазоном глубины [0; OVERLAY_DEPTH_RANGE]:
 * он всегда перед миром и потому не уходит в стену, но сам себя перекрывает правильно. Глубину мира при этом
 * не стираем — она нужна стилевому проходу.
 */
export class StyleRenderer {
  readonly gl: WebGLRenderer;
  readonly camera = new PerspectiveCamera(WORLD_FOV, 1, NEAR, FAR);
  readonly overlayCamera = new PerspectiveCamera(HANDS_FOV, 1, NEAR, FAR);
  preset: Preset;
  private readonly target: WebGLRenderTarget;
  private readonly post: ShaderMaterial;
  private readonly quad: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly postScene = new Scene();
  private readonly postCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly size = new Vector2();

  constructor(canvas: HTMLCanvasElement, preset: PresetId) {
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

  /** Подгоняет холст, G-буфер и камеры под окно и пресет. Вызывать на `resize`. */
  resize(): void {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    const pixelRatio = pixelRatioFor(this.preset, window.devicePixelRatio);
    this.gl.setPixelRatio(pixelRatio);
    this.gl.setSize(w, h, true);
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

  /** Кадр: мир и (необязательно) руки в G-буфер, потом стилевой проход на экран. */
  render(world: Scene, overlay?: Scene): void {
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
  }

  /**
   * Прогрев: компилирует все шейдеры до первого кадра (с тем же целевым буфером, что и в игре, чтобы
   * three не собрал программу заново) и рисует один кадр, чтобы геометрия ушла в видеопамять.
   */
  async warmUp(world: Scene, overlay?: Scene): Promise<void> {
    this.gl.setRenderTarget(this.target);
    await this.gl.compileAsync(world, this.camera);
    if (overlay) await this.gl.compileAsync(overlay, this.overlayCamera);
    this.gl.setRenderTarget(null);
    await this.gl.compileAsync(this.postScene, this.postCamera);
    this.render(world, overlay);
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
