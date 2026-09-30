/* Where the AgencyDesk API lives.
   ''  → same origin: /api is served by the Node server itself, or proxied by Vercel (see vercel.json). Recommended.
   'https://agencydesk-api.onrender.com' → call Render directly (then add your Vercel URL to ALLOWED_ORIGINS on Render).
   If no API answers, the app runs as a browser-only demo. */
window.AGENCYDESK_API = '';
