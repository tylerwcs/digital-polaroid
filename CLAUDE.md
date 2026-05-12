# Digital Polaroid (snapwall-ai)

Real-time event photo wall. Guests upload selfies/notes from their phones, which stream onto a large display as Polaroid-style cards with marquee scrolling and a spotlight animation.

## Tech Stack

**Frontend:** React 19 + TypeScript, Vite 6, Tailwind CSS (CDN), Socket.IO Client, react-signature-canvas, qrcode.react, Google Gemini (@google/genai)
**Backend:** Node.js, Express 4, Socket.IO, @napi-rs/canvas (server-side Polaroid PNG rendering), archiver (ZIP exports)
**Fonts:** Caveat (handwriting/marker style), Inter (UI), Noto Color Emoji

## Project Structure

```
├── App.tsx                  # HashRouter: /, /wall, /wall-6, /admin
├── index.tsx                # React entry point
├── index.html               # Tailwind CDN, Google Fonts, custom animations
├── types.ts                 # PhotoEntry interface
├── components/
│   ├── UploadView.tsx       # Mobile camera/upload UI with signature drawing
│   ├── DisplayView.tsx      # 3-col marquee wall with spotlight effect
│   ├── DisplayViewGrid.tsx  # 6-col grid wall variant (no spotlight)
│   ├── AdminView.tsx        # Moderation dashboard, ZIP download
│   └── Polaroid.tsx         # Reusable Polaroid card component
├── services/
│   ├── storageService.ts    # REST API client, Socket.IO subscriptions, image compression
│   └── geminiService.ts     # Gemini 2.0 Flash caption validation (fail-open)
├── context/
│   └── ToastContext.tsx     # Global toast notifications via React Context + portal
├── server/
│   ├── index.js             # Express + Socket.IO server, REST API, file storage
│   ├── polaroidExport.js    # Server-side canvas rendering for PNG export
│   ├── package.json         # Server dependencies (separate from frontend)
│   ├── .env                 # Server config (ENABLE_DISK_CACHE, etc.)
│   └── uploads/             # Stored image files
└── public/                  # Static assets (BG.mp4, logos)
```

## Dev Commands

```bash
npm install              # Frontend dependencies
cd server && npm install # Server dependencies (separate package.json)
npm run dev              # Runs both Vite dev server (5173) and Express (3000) concurrently
npm run build            # Vite production build → dist/
npm run server           # Express server only
```

## Architecture

**Routing:** HashRouter with 4 routes — `/` (upload), `/wall` (3-col display), `/wall-6` (6-col display), `/admin` (moderation).

**State:** React hooks only (useState, useEffect, useRef). No Redux. React Context used only for toast notifications. Real-time sync via Socket.IO (`new_photo`, `delete_photo` events).

**Image pipeline:** User selects photo → client-side canvas compression (max 600px width, JPEG 0.65 quality) → base64 in JSON POST to `/api/photos` → server saves file to `uploads/` → broadcasts via Socket.IO → display walls update in real-time.

**Content moderation:** Gemini 2.0 Flash validates captions for profanity/hate speech/gibberish before upload. Fail-open: if API key missing or request fails, submission proceeds.

**Display animation:** MarqueeColumn uses requestAnimationFrame for continuous vertical scrolling. ResizeObserver handles dynamic content height. Spotlight sequence: new photos scale up with rotation before joining the grid.

**Polaroid export:** Server-side @napi-rs/canvas renders Polaroid PNGs matching browser styling (Caveat font, rotation, signature overlay). Used for admin ZIP download via archiver.

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/photos` | List all photos |
| POST | `/api/photos` | Upload photo (base64 images in JSON body) |
| DELETE | `/api/photos/:id` | Delete photo |
| GET | `/api/photos/download-all` | Download all photos as ZIP of Polaroid PNGs |
| GET | `/uploads/*` | Static image file serving |

## Environment Variables

**Frontend (VITE_ prefix):**
- `VITE_API_URL` — Backend URL (default: `http://{hostname}:3000`)
- `VITE_GEMINI_API_KEY` — Google Gemini API key (optional, fail-open)
- `VITE_MAX_UPLOAD_BYTES` — Max file size (default: 4MB)

**Backend (server/.env):**
- `PORT` — Server port (default: 3000)
- `ENABLE_DISK_CACHE` — Persist photos to photos.json (default: true)
- `MAX_PHOTO_HISTORY` — Max photos kept (default: 150)
- `MAX_CONCURRENT_UPLOADS` — Upload concurrency limit (default: 8)
- `MAX_IMAGE_MB` — Max image size in MB (default: 3)
- `PUBLIC_BASE_URL` — Absolute URL prefix for production image URLs

## Conventions

- Functional components with hooks throughout; no class components
- Tailwind utility classes for all styling; custom CSS only for animations (defined in index.html)
- Dark theme: zinc-950/black backgrounds, white Polaroid cards
- All async operations use try-catch with toast notifications for user feedback
- No test framework configured
