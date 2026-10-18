/**
 * Clarity Mesh Forensics Companion — Popup Controller
 */

const BACKEND_URL = "http://127.0.0.1:8000";
const FRONTEND_URL = "http://localhost:5173";

document.addEventListener("DOMContentLoaded", async () => {
  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");
  const btnScanPage = document.getElementById("btnScanPage");
  const btnOpenStudio = document.getElementById("btnOpenStudio");
  const resultsArea = document.getElementById("resultsArea");
  const resultsContent = document.getElementById("resultsContent");
  const linkWebapp = document.getElementById("linkWebapp");

  // Check backend liveness
  try {
    const res = await fetch(`${BACKEND_URL}/api/health`, { method: "GET" });
    if (res.ok) {
      const data = await res.json();
      statusDot.className = "status-dot online";
      statusText.textContent = `Online (${data.version || "v0.2"})`;
    } else {
      statusDot.className = "status-dot offline";
      statusText.textContent = "API Error";
    }
  } catch (_) {
    statusDot.className = "status-dot offline";
    statusText.textContent = "Offline (Port 8000)";
  }

  // Open Full Workstation button
  btnOpenStudio.addEventListener("click", () => {
    chrome.tabs.create({ url: `${FRONTEND_URL}/studio` });
  });

  linkWebapp.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: FRONTEND_URL });
  });

  // Scan Active Tab Media
  btnScanPage.addEventListener("click", async () => {
    btnScanPage.disabled = true;
    btnScanPage.textContent = "Scanning Page Elements…";
    resultsArea.style.display = "block";
    resultsContent.innerHTML = "Querying DOM media assets…";

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) {
        resultsContent.textContent = "Cannot access active tab.";
        btnScanPage.disabled = false;
        btnScanPage.textContent = "Inspect Media on Active Tab";
        return;
      }

      chrome.tabs.sendMessage(tab.id, { action: "scan_media" }, (response) => {
        btnScanPage.disabled = false;
        btnScanPage.textContent = "Inspect Media on Active Tab";

        if (chrome.runtime.lastError || !response) {
          resultsContent.textContent = "No responsive media detected or script injection restricted on this page.";
          return;
        }

        const { imagesCount, videosCount } = response;
        resultsContent.innerHTML = `
          <div style="margin-bottom: 6px;">Found <strong>${imagesCount}</strong> images and <strong>${videosCount}</strong> video elements.</div>
          <div style="font-size: 11px; color: #94a3b8;">
            Hover over elements on the page to trigger forensic overlay or right-click to send directly to Clarity Mesh.
          </div>
        `;
      });
    } catch (err) {
      resultsContent.textContent = `Error: ${err.message}`;
      btnScanPage.disabled = false;
      btnScanPage.textContent = "Inspect Media on Active Tab";
    }
  });
});
