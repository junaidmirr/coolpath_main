# 🚀 Deploying CoolPath Backend to Render (render.com)

This guide walks you through deploying the CoolPath Python FastAPI backend to **Render** in 3 easy steps.

---

## 📁 Files Included for Render:

- `render.yaml`: Render Blueprint Infrastructure-as-Code file.
- `requirements.txt`: Python package requirements (`fastapi`, `uvicorn`, `networkx`, `shapely`, `rtree`, `google-genai`).
- `Dockerfile`: Production container build file with C-level spatial index libraries (`libspatialindex-dev`).
- `Procfile`: Command process definitions.

---

## ⚙️ Step-by-Step Render Setup:

### Method A: 1-Click Render Blueprint (Recommended)

1. Push your project to **GitHub**.
2. Go to [dashboard.render.com](https://dashboard.render.com/) and click **New +** $\rightarrow$ **Blueprint**.
3. Connect your GitHub Repository.
4. Render will automatically read `coolpath/backend/render.yaml` and configure the Web Service.
5. In the Render Dashboard under **Environment**, add your secret keys:
   - `GEMINI_API_KEY` = `your-gemini-api-key`
   - `FORTYGUARD_API_KEY` = `your-fortyguard-api-key`
6. Click **Apply**. Render will build and deploy!

---

### Method B: Manual Web Service Setup

1. Go to [dashboard.render.com](https://dashboard.render.com/) and click **New +** $\rightarrow$ **Web Service**.
2. Connect your GitHub Repository.
3. Set the following parameters:
   - **Name**: `coolpath-backend`
   - **Root Directory**: `coolpath/backend`
   - **Environment**: `Python 3` (or `Docker`)
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
4. Under **Environment Variables**, add:
   - `GEMINI_API_KEY`
   - `FORTYGUARD_API_KEY`
5. Click **Create Web Service**.

---

## 📱 Mobile App Connection:

Once deployed, Render gives you a public URL (e.g. `https://coolpath-backend.onrender.com`).
The React Native mobile app (`coolpath/mobile/src/services/api.ts`) automatically probes this URL so your mobile app seamlessly routes through your live cloud backend!
