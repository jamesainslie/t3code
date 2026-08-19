export interface ZoomState {
  scale: number;
  x: number;
  y: number;
}

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 8;

export function clampScale(scale: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

export function initialZoomState(): ZoomState {
  return { scale: 1, x: 0, y: 0 };
}

export function panBy(state: ZoomState, dx: number, dy: number): ZoomState {
  return { scale: state.scale, x: state.x + dx, y: state.y + dy };
}

/**
 * Scale around a viewport point so the content under (px, py) stays put.
 * The content point under the cursor is (p - t) / s; solving for the new
 * translation with the new scale keeps that point stationary.
 */
export function zoomAtPoint(state: ZoomState, factor: number, px: number, py: number): ZoomState {
  const scale = clampScale(state.scale * factor);
  const ratio = scale / state.scale;
  return {
    scale,
    x: px - (px - state.x) * ratio,
    y: py - (py - state.y) * ratio,
  };
}

/** Scale that fits content inside the viewport with symmetric padding. */
export function fitScale(
  contentWidth: number,
  contentHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  padding: number,
): number {
  if (contentWidth <= 0 || contentHeight <= 0) {
    return 1;
  }
  const availableWidth = Math.max(1, viewportWidth - padding * 2);
  const availableHeight = Math.max(1, viewportHeight - padding * 2);
  return clampScale(Math.min(availableWidth / contentWidth, availableHeight / contentHeight));
}
