// Set this to your deployed backend URL when hosting on GitHub Pages, e.g.:
// window.SERVER_URL = 'https://your-service.onrender.com';
// Leave empty string for local development (same-origin)

// Try to detect if we're on GitHub Pages and use appropriate server
if (window.location.hostname === 'davidbugayov.github.io') {
  window.SERVER_URL = 'https://bilateralbound.onrender.com';
} else {
  // Local development - use same origin
  window.SERVER_URL = '';
}


