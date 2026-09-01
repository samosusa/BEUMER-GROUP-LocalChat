import '@testing-library/jest-dom/vitest';

// The build-time mock switch is defined by Vite; tests always run against mocks.
(globalThis as unknown as { __USE_MOCKS__: boolean }).__USE_MOCKS__ = true;

// jsdom implements neither, and both are used by the virtualised lists and the composer.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

globalThis.scrollTo ??= (() => {}) as typeof globalThis.scrollTo;
Element.prototype.scrollIntoView ??= function scrollIntoView() {};
