# 🌡️ CoolPath: Climate-Resilient Navigation System

[![FastAPI Backend](https://img.shields.io/badge/Backend-FastAPI-009688?style=flat-square&logo=fastapi)](coolpath/backend)
[![React Native Mobile](https://img.shields.io/badge/Mobile-React_Native_Expo_51-20232A?style=flat-square&logo=react)](coolpath/mobile)
[![Vite Web Frontend](https://img.shields.io/badge/Web-Vite_React_TS-646CFF?style=flat-square&logo=vite)](coolpath/frontend)
[![AI Engine](https://img.shields.io/badge/AI_Agent-Gemini_2.0-8E75B2?style=flat-square&logo=google)](coolpath/backend)
[![Spatial Microclimates](https://img.shields.io/badge/Spatial-FortyGuard_tOS_API-34D399?style=flat-square)](fortyguard)

**CoolPath** is a state-of-the-art, heat-aware microclimate navigation engine designed to combat extreme urban heat island risks. Powered by high-resolution thermal rasters from **FortyGuard**, AI mission planning via **Google Gemini 2.0**, and human thermodynamic physiological modeling, CoolPath routes pedestrians, runners, and cyclists away from scorching sun-exposed asphalt and into shade-rich, microclimate-cooled pathways.

---

## 📸 Key Features & Technical Highlights

- 🌳 **Multi-Objective Heat & Shade Optimization**: Multi-objective Pareto routing solver (Fastest vs. Shaded vs. Balanced) combining OpenStreetMap topological street networks with FortyGuard spatial heat rasters.
- ⚡ **Sub-Millisecond Spatial Indexing**: Utilizes Shapely `STRtree` point-in-polygon bounding box search for instant spatial microclimate lookups across thousands of grid tiles.
- 🧬 **Human Thermodynamic Differential Heat Model**: Real-time simulation of traveler core body temperature ($T_{\text{core}}$), metabolic energy expenditure (METs), convective wind cooling, and humidity evaporative limits ($Q_E$).
- 🤖 **AI Assistant & Voice Briefings**: Gemini 2.0 agent parses natural language intent ("Find me a shaded 5km running path with minimal heat") and generates audio briefings via AWS Polly.
- 📈 **Online Machine Learning Feedback**: Online `SGDClassifier` adapts route recommendations dynamically based on user Thumbs Up / Down ratings.
- 🗺️ **Multi-Layer Map Renderer**: Toggle between **Theme (Default)**, **Satellite Imagery**, and **Outdoors (Scenic Terrain)** layers with persistent user preferences.

---

## 🏗️ Engineering Architecture & System Flow

```
  ┌────────────────────────────────────────────────────────┐
  │         Mobile (React Native) / Web (Vite)             │
  └───────┬───────────────────▲─────────────────▲──────────┘
          │                   │                 │
    (1)   │ POST /api/mission │ (8) JSON        │ (9) MP3 voice
    Route │ Request           │ Route Data      │ playback
    Query │                   │                 │
          ▼                   │                 │
  ┌───────────────────────────┴─────────────────┴──────────┐
  │                 FastAPI Spatial Backend                │
  │              (Uvicorn ASGI Server / Python)            │
  └───────┬─────────────────────────────────────────────┬──┘
          │                                             │
      (2) │ Parse Intent                                │ (6) Synthesize voice
          ▼                                             ▼
  ┌───────────────┐                             ┌───────────────┐
  │  Gemini 2.0   │                             │ Amazon Polly  │
  │  Agent System │                             │  Speech (TTS) │
  └───────┬───────┘                             └───────▲───────┘
      (3) │ JSON Parameters                             │ (7) Audio
          ▼                                             │ Payload
  ┌───────────────┐                             │
  │  Routing &    ├─────────────────────────────┘
  │  Optimization │ (5) Generate AI Briefings
  └───────┬───────┘
          │
      (4) │ Query Microclimates
          ▼
  ┌───────────────┐
  │ Environmental │ ◄──► Open-Meteo & FortyGuard APIs
  │ Data Adapters │
  └───────────────┘
```

---

## 📁 Repository Directory Structure

```
temperature-api-quickstart/
├── coolpath/
│   ├── backend/                 # Python FastAPI Microclimate & AI Backend
│   │   ├── app/
│   │   │   ├── agent/           # Gemini 2.0 Intent Parser & Prompt Logic
│   │   │   ├── api/             # REST Endpoints (/api/mission, /health, /bundle)
│   │   │   ├── data/            # OSM Topology & Microclimate Cache
│   │   │   ├── ml/              # Online SGD Preference Learning Model
│   │   │   ├── models/          # Pydantic Request/Response Schemas
│   │   │   └── services/        # FortyGuard, NetworkX Solver, AWS Polly
│   │   ├── static/              # Serves OTA Android Bundle & Static Assets
│   │   ├── Dockerfile           # Docker container build specification
│   │   ├── render.yaml          # Render 1-Click Infrastructure Blueprint
│   │   └── requirements.txt     # Python Dependencies
│   ├── mobile/                  # Cross-Platform React Native Expo Application
│   │   ├── android/             # Standalone Android Native Gradle Project
│   │   ├── assets/              # App Icons, Fonts & Splash Screen Assets
│   │   ├── src/
│   │   │   ├── components/      # MobileMap, VoiceAssistant, RouteAnalytics
│   │   │   ├── services/        # API Client & Backend Auto-Discovery
│   │   │   └── types/           # TypeScript Types & Interfaces
│   │   ├── App.tsx              # Main Application View & Simulator State
│   │   ├── app.json             # Expo App Manifest Configuration
│   │   └── package.json         # Mobile Dependencies
│   ├── frontend/                # React + Vite + TypeScript Web Application
│   │   ├── src/                 # Web Map & Dashboard Components
│   │   ├── index.html           # HTML Entry
│   │   └── vite.config.ts       # Vite Development Server Configuration
│   └── .gitignore               # Unified CoolPath Git Exclusion Rules
├── fortyguard/                  # SDK Client Package for FortyGuard tOS API
├── notebooks/                   # Jupyter Analytical Notebooks & Use-Cases
├── docs/                        # Engineering Specifications & Formulas
├── start.py                     # Universal 1-Command Developer Launcher
├── update_bundle.py             # Compiles & Publishes JS Bundle for OTA
└── watch_bundle.py              # File Watcher for Auto OTA Re-compilation
```

---

## 🚀 Quickstart: 1-Command Boot

To launch both the **FastAPI Backend** and the **Vite Web Frontend** automatically with port conflict resolution and `.env.local` auto-configuration:

```bash
python start.py
```

*The launcher automatically detects available ports, boots Uvicorn, configures the frontend API endpoint, and opens the Vite dev server.*

---

## ⚙️ Setting Up Individual Components

### 1. Backend Setup (`coolpath/backend`)

The backend is built on **Python 3.10+** and **FastAPI**.

#### Prerequisite Installation:
```bash
cd coolpath/backend

# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

#### Configuration (`coolpath/backend/.env`):
Create a `.env` file inside `coolpath/backend/`:
```env
GEMINI_API_KEY=your_google_gemini_api_key
FORTYGUARD_API_KEY=your_fortyguard_api_key
AWS_ACCESS_KEY_ID=your_aws_key_optional
AWS_SECRET_ACCESS_KEY=your_aws_secret_optional
DEMO_MODE=False
```

#### Running the Backend:
```bash
# Option A: Standalone Uvicorn
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# Option B: Health Check Verification
curl http://localhost:8000/health
# Expected Output: {"status": "ok", "demo_mode": false}
```

---

### 2. Mobile App Setup (`coolpath/mobile`)

The mobile application is built with **React Native (Expo SDK 51)** and **TypeScript**.

#### Installation:
```bash
cd coolpath/mobile

# Install node dependencies
npm install
```

#### Configuration (`coolpath/mobile/.env`):
Create a `.env` file inside `coolpath/mobile/`:
```env
EXPO_PUBLIC_MAPBOX_TOKEN=your_mapbox_public_access_token
EXPO_PUBLIC_NGROK_BACKEND_URL=https://your-ngrok-tunnel-url.ngrok-free.dev
```

#### Running Development Server:
```bash
# Start Metro bundler for Expo Go or Emulator
npx expo start
```

#### Building Standalone Android Release APK:
```bash
# Navigate to native android folder
cd coolpath/mobile/android

# Build production Release APK
./gradlew assembleRelease

# Output APK path:
# coolpath/mobile/android/app/build/outputs/apk/release/app-release.apk
```

---

### 3. Web Frontend Setup (`coolpath/frontend`)

The web dashboard is built with **React**, **Vite**, and **TypeScript**.

#### Installation & Development:
```bash
cd coolpath/frontend

# Install dependencies
npm install

# Configure backend API URL in .env.local
echo "VITE_API_URL=http://localhost:8000" > .env.local

# Run Vite dev server
npm run dev
```

#### Building Web Production Assets:
```bash
npm run build
```

---

## 🧮 Thermodynamic Physics & Math Reference

During route simulation, CoolPath computes core body temperature $T_{\text{core}}$ using the human stored thermal heat equation:

$$T_{\text{core}}(t+\Delta t) = T_{\text{core}}(t) + \frac{Q_{\text{stored}}}{m \cdot c} \Delta t$$

Where:
- $Q_{\text{stored}} = Q_{\text{metabolic}} - Q_{\text{work}} - Q_C - Q_R - Q_E$
- **Metabolic Rate ($Q_{\text{metabolic}}$)**: $\text{MET} \times 58.15 \times A_{\text{DuBois}}$
- **Stefan-Boltzmann Radiation ($Q_R$)**: Accounts for pavement $T^4$ thermal emission. Shade tree canopy routing cuts $Q_R$ direct solar flux by up to **85%**.
- **Convective Loss ($Q_C$)**: $h_c \cdot (T_{\text{skin}} - T_{\text{ambient}}) \cdot A_{\text{DuBois}}$ where $h_c = 8.3 \sqrt{v_{\text{wind}}}$.

---

## ☁️ Deployment

### Deploying Backend to Render (render.com)
1. Push this repository to GitHub.
2. Go to [dashboard.render.com](https://dashboard.render.com/) and click **New +** $\rightarrow$ **Blueprint**.
3. Select your repository. Render will automatically process `coolpath/backend/render.yaml`.
4. Enter your environment variables (`GEMINI_API_KEY`, `FORTYGUARD_API_KEY`) in the Render Dashboard and click **Apply**.

---

## 📄 License

This project is licensed under the Apache 2.0 License. See [`LICENSE`](LICENSE) for details.
