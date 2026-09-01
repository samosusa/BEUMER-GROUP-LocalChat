/// <reference types="vite/client" />

/** Baked in by Vite. True when the renderer should boot the in-process mock service. */
declare const __USE_MOCKS__: boolean;

/**
 * The only surface the renderer has onto the host. Injected by the Electron preload
 * (apps/desktop/src/preload); absent when running in a plain browser, which is exactly
 * how the UI degrades in the Docker preview.
 */
interface LocalChatBridge {
  readonly platform: 'win32' | 'darwin' | 'linux';
  readonly appVersion: string;
  /** Base URL of the local RAG service, resolved by the main process. */
  readonly serviceUrl: string;
  /** Opens the OS file picker and returns absolute paths. Empty when cancelled. */
  pickDocuments(): Promise<string[]>;
  pickFolder(): Promise<string | null>;
  /** Reveals a source document in Explorer/Finder. */
  revealInFolder(path: string): Promise<void>;
  window: {
    minimize(): void;
    toggleMaximize(): void;
    hide(): void;
  };
  /** Hands a question from the quick-ask strip to the main window. */
  submitQuickAsk?(question: string): void;
  /** Fires when the quick-ask window hands a question to the main window. */
  onQuickAsk(listener: (question: string) => void): () => void;
}

interface Window {
  readonly localchat?: LocalChatBridge;
}
