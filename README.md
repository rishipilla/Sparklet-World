# ✦ Sparklet World

**Meet Sparklet — a tiny robot companion in a playful 3D world.**

Sparklet World is an interactive browser game built with React, TypeScript, Three.js, Vite, and Tailwind CSS. Explore a cozy sci-fi garden, collect crystals, discover the world, and chat with Sparklet.

> **Want to try it?** Open the live demo link in the repository's **About** section (if one is configured), or run the project locally using the steps below.

## What you can do

- Explore the 3D island and central plaza.
- Walk, look around, jump, and run.
- Find and collect five pastel crystals.
- Meet Sparklet, talk to the robot, and ask questions in the chat.
- Ask Sparklet to follow you.
- Play on desktop; mobile controls are provided, and VR support depends on your browser and headset.

## Controls

| Action | Desktop | Mobile |
|---|---|---|
| Move | W, A, S, D | Left joystick |
| Look around | Drag the mouse | Drag with the right joystick |
| Jump | Space | Jump button |
| Run | Shift | Run button |
| Talk to Sparklet | E when nearby, or use TALK | TALK button |
| Open chat | Use the on-screen TALK/chat controls | TALK button |

Tip: click **ENTER WORLD** and follow the on-screen tutorial. Find Sparklet around the central plaza.

## Chatting with Sparklet

Sparklet can show local fallback replies even when no AI server is connected. To use model-generated replies, the app needs a reachable RoboAI-compatible API.

1. Open **Settings** in Sparklet World.
2. Enter the API base URL for your deployed backend, for example `https://your-api.example.com` (do not include `/chat` at the end).
3. Enter a personal API token only if your backend requires one.
4. Choose **SAVE & CHECK** or **TEST** to check the API connection.
5. Open the chat, type a message, and press **Enter** or **SEND**.

### Expected API contract

The current frontend expects this backend interface:

- `GET /health` — returns a successful HTTP status when the service is ready.
- `POST /chat` — accepts JSON `{"message":"Hello, Sparklet!"}` and returns JSON `{"reply":"Hello!"}`.
- If authentication is enabled, requests use `Authorization: Bearer YOUR_TOKEN`.
- The backend must allow the exact deployed website origin through CORS.

**Important:** a Gemini, OpenRouter, or other provider key cannot automatically be pasted into this RoboAI field. Those providers have different request formats. Use a compatible backend/proxy that implements the API contract above.

## Run locally

### Requirements

- Node.js 20.19+ or 22.12+
- npm

### Install and start

```bash
npm install
npm run dev
```

Open the local URL printed by Vite (usually `http://localhost:5173`).

### Production build

```bash
npm run build
npm run preview
```

## Deploy it so others can play

You can deploy this Vite app to a static hosting provider such as Vercel or Netlify:

1. Push the project to GitHub.
2. Import the repository into your hosting provider.
3. Set the build command to `npm run build`.
4. Set the output directory to `dist`.
5. Deploy and share the generated HTTPS website URL.

**For everyone to use AI chat**, the API must also be hosted and reachable online. A local address such as `http://127.0.0.1:8010`, a Colab runtime address, or an expired temporary tunnel will not work for other visitors. Configure CORS on the API to allow your deployed website's origin.

## Security and public access

- **Never commit API keys, bearer tokens, passwords, or secret `.env` files to GitHub.**
- Do not put a shared provider secret in frontend code or ask every visitor to use your private token.
- Browser-based apps cannot keep a token entered by a visitor secret from that visitor. The current settings UI stores the API URL in browser `localStorage` and the token in `sessionStorage`; the token is cleared when that tab session ends.
- For a public site, the recommended setup is a server-side API proxy that stores provider credentials in hosting environment variables, applies rate limits, and exposes only the endpoints the app needs.
- If you use a temporary tunnel, its URL can change or expire. Update the API URL in Settings when that happens.

## Tech stack

- React + TypeScript
- Three.js
- Vite
- Tailwind CSS

## Project notes

- The reference image used by the app is included in `src/assets/`.
- The RoboAI backend and model checkpoint are not included in this repository.
- Local fallback replies do not mean the hosted AI API is connected; check the API status in the chat/settings UI.

## Contributing

Issues and pull requests are welcome. Please avoid committing generated secrets, private model checkpoints, or other credentials.

---

Made with ✦ for curious explorers. Say hello to Sparklet!
