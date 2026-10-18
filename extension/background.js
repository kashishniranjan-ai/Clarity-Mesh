/**
 * Clarity Mesh Forensics Companion — Background Service Worker (Manifest V3)
 */

chrome.runtime.onInstalled.addListener(() => {
  // Create context menu item for inspecting images/videos
  chrome.contextMenus.create({
    id: "clarity-mesh-inspect-media",
    title: "Inspect with Clarity Mesh Forensics",
    contexts: ["image", "video"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "clarity-mesh-inspect-media") {
    const mediaUrl = info.srcUrl || info.linkUrl;
    if (mediaUrl) {
      // Open Clarity Mesh studio with query parameter or focus workstation tab
      const workstationUrl = `http://localhost:5173/studio?inspect_url=${encodeURIComponent(mediaUrl)}`;
      chrome.tabs.create({ url: workstationUrl });
    }
  }
});
