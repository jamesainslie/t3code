export interface DiagramView {
  x: number;
  y: number;
  scale: number;
}
interface Size {
  width: number;
  height: number;
}
interface Point {
  x: number;
  y: number;
}

export function fitDiagram(viewport: Size, diagram: Size): DiagramView {
  return {
    x: 0,
    y: 0,
    scale: Math.min(
      1,
      Math.max(1, viewport.width - 48) / diagram.width,
      Math.max(1, viewport.height - 48) / diagram.height,
    ),
  };
}

export function zoomDiagram(
  view: DiagramView,
  factor: number,
  anchor: Point = { x: 0, y: 0 },
): DiagramView {
  const scale = Math.min(8, Math.max(0.001, view.scale * factor));
  const ratio = scale / view.scale;
  return {
    x: anchor.x - (anchor.x - view.x) * ratio,
    y: anchor.y - (anchor.y - view.y) * ratio,
    scale,
  };
}

/** DOM-only interaction layer, shared by the web viewer and Expo's local DOM view. */
export function mountDiagramViewport(
  canvas: HTMLElement,
  image: HTMLImageElement,
  svg: string,
  onScale: (scale: number) => void,
) {
  const box = svg
    .match(/viewBox=["']([^"']+)["']/)?.[1]
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const size = { width: box?.[2] || 800, height: box?.[3] || 600 };
  let view = fitDiagram(canvas.getBoundingClientRect(), size);
  let fitted = true;
  let frame = 0;
  const pointers = new Map<number, Point>();
  image.style.width = `${size.width}px`;
  image.style.height = `${size.height}px`;
  image.style.maxWidth = "none";
  image.style.maxHeight = "none";
  image.style.position = "absolute";
  image.style.left = "50%";
  image.style.top = "50%";
  image.style.transformOrigin = "center";
  image.style.pointerEvents = "none";
  const draw = () => {
    image.style.transform = `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    onScale(view.scale);
  };
  const redraw = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(draw);
  };
  const fit = () => {
    fitted = true;
    view = fitDiagram(canvas.getBoundingClientRect(), size);
    redraw();
  };
  const center = () => {
    view = { ...view, x: 0, y: 0 };
    redraw();
  };
  const actualSize = () => {
    fitted = false;
    view = { x: 0, y: 0, scale: 1 };
    redraw();
  };
  const zoom = (factor: number) => {
    fitted = false;
    view = zoomDiagram(view, factor);
    redraw();
  };
  const anchor = (point: Point) => {
    const rect = canvas.getBoundingClientRect();
    return { x: point.x - rect.left - rect.width / 2, y: point.y - rect.top - rect.height / 2 };
  };
  const wheel = (event: WheelEvent) => {
    event.preventDefault();
    fitted = false;
    const delta =
      event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1);
    view = zoomDiagram(
      view,
      Math.exp(-Math.max(-100, Math.min(100, delta)) * 0.01),
      anchor({ x: event.clientX, y: event.clientY }),
    );
    redraw();
  };
  const down = (event: PointerEvent) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    canvas.style.cursor = "grabbing";
  };
  const move = (event: PointerEvent) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    fitted = false;
    const next = { x: event.clientX, y: event.clientY };
    const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)?.[1];
    if (other) {
      const before = { x: (previous.x + other.x) / 2, y: (previous.y + other.y) / 2 };
      const after = { x: (next.x + other.x) / 2, y: (next.y + other.y) / 2 };
      const distance = Math.hypot(previous.x - other.x, previous.y - other.y);
      if (distance > 0)
        view = zoomDiagram(
          view,
          Math.hypot(next.x - other.x, next.y - other.y) / distance,
          anchor(before),
        );
      view = { ...view, x: view.x + after.x - before.x, y: view.y + after.y - before.y };
    } else {
      view = { ...view, x: view.x + next.x - previous.x, y: view.y + next.y - previous.y };
    }
    pointers.set(event.pointerId, next);
    redraw();
  };
  const up = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (pointers.size === 0) canvas.style.cursor = "grab";
  };
  const key = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const step = event.shiftKey ? 120 : 40;
    switch (event.key.toLowerCase()) {
      case "+":
      case "=":
        zoom(1.2);
        break;
      case "-":
        zoom(1 / 1.2);
        break;
      case "f":
        fit();
        break;
      case "c":
        center();
        break;
      case "0":
        actualSize();
        break;
      case "arrowleft":
        view.x -= step;
        fitted = false;
        break;
      case "arrowright":
        view.x += step;
        fitted = false;
        break;
      case "arrowup":
        view.y -= step;
        fitted = false;
        break;
      case "arrowdown":
        view.y += step;
        fitted = false;
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    redraw();
  };
  const observer = new ResizeObserver(() => {
    if (fitted) fit();
  });
  observer.observe(canvas);
  canvas.addEventListener("wheel", wheel, { passive: false });
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("lostpointercapture", up);
  canvas.addEventListener("keydown", key);
  draw();
  return {
    fit,
    center,
    actualSize,
    zoom,
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("lostpointercapture", up);
      canvas.removeEventListener("keydown", key);
    },
  };
}
