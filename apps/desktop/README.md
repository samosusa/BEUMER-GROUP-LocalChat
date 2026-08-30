# Desktop shell

Electron main process, preload bridge, tray and quick-ask window.

## Security posture

| Measure                                                             | Where                        | Why                                                                                                       |
| ------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` | `windows.ts`                 | The renderer runs untrusted model output. It gets no Node.                                                |
| CSP response header                                                 | `security.ts`                | Authoritative over the `<meta>` CSP, which injected markup could otherwise sit above.                     |
| Request filter                                                      | `security.ts`                | Anything that is not the bundle or `127.0.0.1:8000` is cancelled, so "offline" is enforced, not promised. |
| Permission deny-all                                                 | `security.ts`                | No camera, microphone, geolocation or notifications — now or by accident later.                           |
| Navigation + window-open guards                                     | `security.ts`                | A link in an answer opens in the user's browser, never inside the app.                                    |
| Named IPC channels only                                             | `ipc.ts`, `preload/index.ts` | No generic `invoke` passthrough. Every handler validates its own arguments.                               |
| `app://` custom scheme                                              | `index.ts`                   | A real origin with normal CSP and fetch semantics, instead of `file://` special cases.                    |
| Single-instance lock                                                | `security.ts`                | Two copies would fight over the index and the model file.                                                 |

## Building

```bash
npm run build:desktop   # renderer + main + preload
npm run package         # Windows NSIS installer into apps/desktop/release
```

The Electron binary is skipped in CI and in Docker via `ELECTRON_SKIP_BINARY_DOWNLOAD=1`;
a local `npm install` downloads it.
