/**
 * FPS для отладочного угла по окнам подряд (не скользящим): кадры копятся, пока не наберётся `windowMs`,
 * тогда показывается среднее за это окно, и следующее окно начинается с нуля. До первого полного окна — 0.
 */
export interface FpsMeter {
  push(frameMs: number): void;
  readonly fps: number;
  readonly frameMs: number;
}

export function createFpsMeter(windowMs = 500): FpsMeter {
  let acc = 0;
  let frames = 0;
  let fps = 0;
  let frameMs = 0;
  return {
    push(dt) {
      acc += dt;
      frames++;
      if (acc >= windowMs) {
        frameMs = acc / frames;
        fps = (frames * 1000) / acc;
        acc = 0;
        frames = 0;
      }
    },
    get fps() {
      return fps;
    },
    get frameMs() {
      return frameMs;
    },
  };
}
