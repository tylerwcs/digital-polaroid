<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1Jwon7IcdiSxeTEk_Z7RliXr-BsgLm8_I

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:  
   `npm install`
2. Create a `.env.local` file in the project root and add your Gemini key:  
   `VITE_GEMINI_API_KEY=your_api_key_here`
3. Run the app:  
   `npm run dev`

## Deploying to Render (recommended)

- **Backend (Node / Socket.IO)**  
  - Create a new **Web Service** in Render.  
  - Root directory: `server`  
  - Build command: `npm install`  
  - Start command: `npm start`  
  - Render will give you a backend URL (e.g. `https://snapwall-backend.onrender.com`).

- **Frontend (Vite static site)**  
  - Create a new **Static Site** in Render.  
  - Root directory: project root  
  - Build command: `npm install && npm run build`  
  - Publish directory: `dist`  
  - Environment variables:
    - `VITE_API_URL=https://snapwall-backend.onrender.com` (replace with your backend URL)  
    - `VITE_GEMINI_API_KEY=your_api_key_here`  
    - Optional: `VITE_UPLOAD_URL=https://snapwall.onrender.com` (or whatever URL you want encoded in the QR code).
