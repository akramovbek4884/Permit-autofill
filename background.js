chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});

chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
});

function sendAutofillToFrame(tabId, frameId, data) {
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, { action: "AUTOFILL", data }, { frameId }, response => {
      resolve({ frameId, response, error: chrome.runtime.lastError?.message });
    });
  });
}

async function injectContentScript(tabId, frameId) {
  await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    files: ["content.js"]
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action !== "AUTOFILL_ACTIVE_TAB" || !request.data) return;

  (async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id) throw new Error("Active portal tab was not found.");

    let frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
    if (!frames?.length) frames = [{ frameId: 0 }];

    const results = [];
    for (const frame of frames) {
      let result = await sendAutofillToFrame(tab.id, frame.frameId, request.data);
      if (!result.response) {
        try {
          await injectContentScript(tab.id, frame.frameId);
          result = await sendAutofillToFrame(tab.id, frame.frameId, request.data);
        } catch (error) {
          result = { ...result, error: String(error) };
        }
      }
      results.push(result);
    }

    const successful = results.filter(result => result.response?.status === "ok");
    if (!successful.length) {
      throw new Error("No permit form frame responded. Reload the portal page and try again.");
    }

    const primary = successful[0].response;
    sendResponse({
      status: "ok",
      portal: primary.portal,
      adapter: primary.adapter,
      matchedFields: successful.reduce((total, result) => total + (result.response.matchedFields || 0), 0),
      framesFilled: successful.length
    });
  })().catch(error => {
    console.error("[Permit Autofill] Delivery failed", error);
    sendResponse({ status: "error", error: error.message || String(error) });
  });

  return true;
});
