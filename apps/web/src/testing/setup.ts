import "@testing-library/jest-dom/vitest";
import "@testing-library/svelte/vitest";

// jsdom 沒有 matchMedia；圖表（layerchart 透過 svelte/reactivity 的 MediaQuery）載入時會呼叫。
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// jsdom 沒有 ResizeObserver；圖表容器量測尺寸時使用。
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
