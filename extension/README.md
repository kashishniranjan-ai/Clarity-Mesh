# Clarity Mesh — Web Companion Extension Scaffold

Industrial deepfake and synthetic media forensics companion for in-browser media verification.

---

## 1. Architecture Overview (Manifest V3)

The Clarity Mesh Extension Companion bridges everyday web browsing with the Clarity Mesh Forensics Workstation. It allows forensic investigators, journalists, and security analysts to inspect suspicious media directly within web pages and dispatch assets to the local forensic engine for neural verification.

### File Manifest:
- `manifest.json`: Manifest V3 specification with scoped permissions.
- `popup.html` & `popup.js`: Sleek dark-mode forensic HUD displaying server connectivity, quick DOM media scanner, and deep links to the workstation.
- `content.js`: In-page inspector highlighting suspect media (`<img>`, `<video>`) on demand.
- `background.js`: Service worker managing the `"Inspect with Clarity Mesh Forensics"` context menu.

---

## 2. Permissions Rationale

In strict accordance with enterprise security practices, permissions are minimal and strictly scoped:

| Permission | Purpose |
| :--- | :--- |
| `activeTab` | Grants temporary, user-initiated access to the currently active tab when the analyst clicks the extension popup or context menu. Never runs continuously in the background. |
| `storage` | Stores analyst configuration (custom backend URL, preferred sampling rate, authentication token) in local browser storage. |
| `contextMenus` | Registers right-click menu entry (`"Inspect with Clarity Mesh Forensics"`) on images and videos. |
| `host_permissions` | Restricted strictly to `http://localhost:8000/*` and `http://127.0.0.1:8000/*` for local communication with the Clarity Mesh API. |

---

## 3. Privacy & Zero-Knowledge Guarantee

- **No Passive Tracking**: The content script does not scan or record DOM content in the background. Media queries execute **only** when the user clicks "Inspect Media on Active Tab" or triggers a context menu action.
- **No Remote Telemetry**: All analysis requests are routed strictly to the analyst's local (or configured private on-prem) Clarity Mesh backend. No external third-party servers or telemetry collectors are contacted.

---

## 4. Technical Roadmap: Client-Side Inference (ONNX Runtime Web)

### Why Server-Assisted Today?
Clarity Mesh’s primary detection stack comprises:
- **EfficientNet-B7** visual deepfake classifier (~270 MB weights)
- **wav2vec2** audio deepfake classifier (~360 MB)
- **CLIP ViT-L/14** AI-image detector (~900 MB)

Loading 1.5+ GB of PyTorch weights directly into a browser tab causes tab freezing, high memory consumption, and potential browser crashes on standard hardware.

### Future Client-Side Triage:
As part of the enterprise roadmap, we plan to incorporate **ONNX Runtime Web (Wasm/WebGPU)**:
1. **Lightweight Triage Model**: Quantized MobileNetV4 (~12 MB INT8) embedded inside the extension for client-side screening.
2. **Hybrid Pipeline**: Clean media is cleared in <50ms with zero network traffic; flagged media (score > 0.40) is escalated with one click to the full Clarity Mesh Workstation for multi-spectral and Grad-CAM explainability analysis.

---

## 5. Installation (Developer Mode)

1. Open Chrome/Brave/Edge and navigate to `chrome://extensions/`.
2. Toggle on **Developer mode** in the top-right corner.
3. Click **Load unpacked**.
4. Select this directory (`extension/`).
5. Ensure the Clarity Mesh backend is running on `http://127.0.0.1:8000`.
