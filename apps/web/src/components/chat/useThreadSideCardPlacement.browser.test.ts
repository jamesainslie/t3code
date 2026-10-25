import { expect, it, vi } from "vite-plus/test";

import { measureThreadSideCard } from "./useThreadSideCardPlacement";

function box(
  attributes: Record<string, string>,
  rect: { top: number; right: number; bottom: number },
  parent: Element = document.body,
) {
  const element = document.createElement("div");
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    ...rect,
    left: rect.right - 280,
    width: 280,
    height: rect.bottom - rect.top,
    x: rect.right - 280,
    y: rect.top,
    toJSON: () => ({}),
  });
  parent.append(element);
  return element;
}

/** A chat view with its header and canvas, removed with its mocks on dispose. */
function chatView(): Disposable {
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(1000);
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(1600);
  const view = box({}, { top: 0, right: 1600, bottom: 1000 });
  box({ "data-chat-header": "" }, { top: 0, right: 1580, bottom: 48 }, view);
  box(
    { "data-chat-canvas": "", "data-details-column": "" },
    { top: 48, right: 1600, bottom: 1000 },
    view,
  );
  return {
    [Symbol.dispose]: () => {
      document.body.replaceChildren();
      vi.restoreAllMocks();
    },
  };
}

const detailsCard = (parent: Element = document.body) =>
  box({ "data-thread-details-card": "" }, { top: 60, right: 1588, bottom: 300 }, parent);

it("stacks a card under the open cards above it", () => {
  using _view = chatView();
  detailsCard();
  box({ "data-thread-side-card": "iris" }, { top: 308, right: 1588, bottom: 508 });
  expect(measureThreadSideCard("roadmap")).toMatchObject({ mode: "inline", top: 516 });
});

it("ignores the cards below it", () => {
  using _view = chatView();
  detailsCard();
  box({ "data-thread-side-card": "roadmap" }, { top: 308, right: 1588, bottom: 908 });
  expect(measureThreadSideCard("iris")).toMatchObject({ mode: "inline", top: 308 });
});

it("takes the top slot when the cards above it are closed", () => {
  using _view = chatView();
  detailsCard();
  expect(measureThreadSideCard("roadmap")).toMatchObject({ mode: "inline", top: 308 });
});

it("matches the details card's width and how far it can be dragged", () => {
  using _view = chatView();
  const aside = box({ "data-max-width": "300" }, { top: 60, right: 1588, bottom: 300 });
  detailsCard(aside);
  expect(measureThreadSideCard("roadmap")).toMatchObject({
    left: 1588 - 280,
    width: 280,
    maxWidth: 300,
  });
});
