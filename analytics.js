// Vercel Web Analytics initialization
// This script initializes Vercel Web Analytics for vanilla HTML/JavaScript projects
// Documentation: https://vercel.com/docs/analytics/quickstart

(function() {
  // Initialize the analytics queue as per official documentation
  window.va = window.va || function() {
    (window.vaq = window.vaq || []).push(arguments);
  };
  
  // Load the analytics script
  var script = document.createElement('script');
  script.defer = true;
  script.src = '/_vercel/insights/script.js';
  
  // Add SDK information for version tracking
  script.setAttribute('data-sdkn', '@vercel/analytics');
  script.setAttribute('data-sdkv', '2.0.1');
  
  // Error handling for debugging
  script.onerror = function() {
    console.log('[Vercel Web Analytics] Failed to load analytics script. Please ensure Web Analytics is enabled in your Vercel project settings.');
  };
  
  // Load event for success confirmation (development mode)
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    script.onload = function() {
      console.log('[Vercel Web Analytics] Analytics script loaded successfully in development mode.');
    };
  }
  
  // Append to head
  if (document.head) {
    document.head.appendChild(script);
  } else {
    // Fallback for older browsers
    document.getElementsByTagName('head')[0].appendChild(script);
  }
})();
