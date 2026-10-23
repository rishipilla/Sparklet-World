# Sparklet World

An interactive third-person 3D world featuring Sparklet, a playful robot companion, built with React, TypeScript, Three.js, Vite, and Tailwind CSS.

## Requirements

- Node.js 20.19+ or 22.12+
- npm

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite (usually `http://localhost:5173`).

## Build for production

```bash
npm run build
npm run preview
```

## Connect RoboAI

Open the in-app Settings and enter your current HTTPS API base URL and Bearer token. The API should expose `GET /health` and `POST /chat` (`{"message":"..."}` → `{"reply":"..."}`). The backend must allow the exact frontend origin in CORS.

**Security:** never commit API tokens, `.env` files containing secrets, or private credentials. This frontend sends the token from the settings UI to the configured API. Browser-based apps cannot keep a shared token truly secret from the person using the browser; for a public deployment, put authenticated model access behind a server-side proxy. The token is kept in `sessionStorage` for this project and is cleared when the browser tab session ends.

## Notes

- The project uses the included asset in `src/assets/`.
- The RoboAI backend and its checkpoint are not included in this repository. Keep model files private unless you intentionally want to publish them.
- Colab runtimes and temporary HTTPS tunnel URLs can expire; update the API URL in Settings when that happens.
