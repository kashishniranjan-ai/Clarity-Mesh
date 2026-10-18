/**
 * Clarity Mesh Forensics Companion — Content Script
 * Injected on demand to inspect visible DOM media elements.
 */

(() => {
  // Listen for messages from popup or background service worker
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "scan_media") {
      const images = Array.from(document.querySelectorAll("img")).filter(
        (img) => img.offsetWidth > 64 && img.offsetHeight > 64
      );
      const videos = Array.from(document.querySelectorAll("video")).filter(
        (v) => v.offsetWidth > 64 && v.offsetHeight > 64
      );

      // Attach lightweight forensic hover badges
      attachForensicBadges(images, videos);

      sendResponse({
        imagesCount: images.length,
        videosCount: videos.length,
      });
      return true;
    }

    if (request.action === "extract_element") {
      const target = document.querySelector(request.selector);
      if (target) {
        // Extract src or snapshot
        sendResponse({ src: target.currentSrc || target.src });
      } else {
        sendResponse({ error: "Element not found" });
      }
      return true;
    }
  });

  function attachForensicBadges(images, videos) {
    const all = [...images, ...videos];
    all.forEach((el) => {
      if (el.dataset.clarityMeshTagged) return;
      el.dataset.clarityMeshTagged = "true";

      // Lightweight outline on hover
      el.addEventListener("mouseenter", () => {
        el.style.outline = "2px dashed #06b6d4";
        el.style.outlineOffset = "2px";
      });

      el.addEventListener("mouseleave", () => {
        el.style.outline = "";
        el.style.outlineOffset = "";
      });
    });
  }
})();
