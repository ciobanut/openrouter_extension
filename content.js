(() => {
  // Content script - just signals that we're on openrouter.ai
  // All API calls use cookies, no token interception needed
  chrome.runtime.sendMessage({ type: 'ready' });
})();
