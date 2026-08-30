import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS } from '../main/ipc';

/**
 * The bridge.
 *
 * This is the entire surface the renderer has onto the host: five functions and three window
 * controls. Nothing is exposed that takes arbitrary input and hands it to Node — no `invoke`
 * passthrough, no `require`, no `process`. If a new capability is needed, it gets its own
 * named function here and its own validating handler in main/ipc.ts.
 *
 * Keep this file's shape in sync with `LocalChatBridge` in the renderer's vite-env.d.ts.
 */

const bridge = {
  platform: process.platform as 'win32' | 'darwin' | 'linux',
  appVersion: process.env.LOCALCHAT_VERSION ?? '0.4.1',
  serviceUrl: process.env.LOCALCHAT_SERVICE_URL ?? 'http://127.0.0.1:8000',

  pickDocuments: (): Promise<string[]> => ipcRenderer.invoke(CHANNELS.pickDocuments),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke(CHANNELS.pickFolder),
  revealInFolder: (path: string): Promise<void> =>
    ipcRenderer.invoke(CHANNELS.revealInFolder, path),

  window: {
    minimize: () => ipcRenderer.send(CHANNELS.windowMinimize),
    toggleMaximize: () => ipcRenderer.send(CHANNELS.windowToggleMaximize),
    hide: () => ipcRenderer.send(CHANNELS.windowHide),
  },

  submitQuickAsk: (question: string) => ipcRenderer.send(CHANNELS.quickAskSubmit, question),

  /**
   * Subscribes to questions handed over by the quick-ask window.
   *
   * Returns an unsubscribe function, and wraps the listener so the raw `IpcRendererEvent` —
   * which carries a `sender` the renderer has no business touching — never reaches it.
   */
  onQuickAsk: (listener: (question: string) => void): (() => void) => {
    const wrapped = (_event: unknown, question: string) => listener(question);
    ipcRenderer.on('quick-ask:question', wrapped);
    return () => ipcRenderer.removeListener('quick-ask:question', wrapped);
  },
} as const;

contextBridge.exposeInMainWorld('localchat', bridge);

export type Bridge = typeof bridge;
