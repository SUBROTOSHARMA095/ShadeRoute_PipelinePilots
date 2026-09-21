# ShadeRoute

**Campus Climate & Cooling Intelligence for heat-resilient campuses**

ShadeRoute is an interactive urban-microclimate digital twin for the SOA ITER campus in Bhubaneswar. It combines satellite-derived surface indicators, live Numerical Weather Prediction (NWP) data, heat-risk modeling, and intervention planning to help campus teams identify dangerous heat zones and evaluate practical cooling actions.

> **Status:** Active prototype / pilot application. Forecasts and cooling estimates are decision-support outputs and should be validated by qualified climate, facilities, and health professionals before operational use.

## What it does

- **Explore campus heat risk** on an interactive MapLibre map.
- **Monitor 10 m × 10 m micro-zones** using satellite-informed heat and vegetation indicators.
- **Plan cooling interventions** by placing shade trees and mist sprayers on priority areas.
- **Compare estimated cooling impact** before and after proposed interventions.
- **Review heat-stress alerts** across historical and forecast periods.
- **Track live forecast data** from NWP sources, with cached fallbacks for resilient deployment.
- **Estimate healthcare readiness needs** during heat events, including patient surge, cooling beds, and ORS requirements.
- **Ask Ira (इरा)**, the built-in multilingual climate and campus guide, for explanations and an interactive product tour.
- **Browse scientific documentation and citations** from the application interface.

## Architecture

```text
Satellite / weather data
          │
          ▼
Python preprocessing and ML pipeline
          │
          ├── Heat-risk and heatwave predictions
          ├── Spatial cooling-priority engine
          ├── Hospital surge and clinical-readiness estimates
          └── Timeline and forecast JSON outputs
          │
          ▼
Express API server
          │
          ▼
MapLibre web application + Ira AI assistant
```

### Main components

| Path | Purpose |
| --- | --- |
| `public/` | Frontend application, map interface, styles, assets, tutorial, and assistant UI |
| `server.js` | Express server, static file hosting, REST endpoints, forecast refresh, and Ira assistant integration |
| `ml/` | Python data-processing, modeling, forecasting, spatial-priority, and healthcare-readiness scripts |
| `data/` | Source datasets used by the analytical pipeline |
| `public/data/` | JSON data consumed by the frontend, including predictions, weather, surge, and timeline outputs |
| `scripts/` | Utility scripts for campus and geospatial data preparation |
| `hourly_risk.png` | Hourly risk visualization |
| `model_performance.png` | Model performance visualization |

## Machine-learning pipeline

The `ml/` directory contains modules for:

- Satellite and raster preprocessing
- Heat-risk and multi-horizon heatwave prediction
- Live NWP forecast ingestion
- Spatial cross-validation and model training
- Vegetation and cooling-priority analysis
- Tree and mist-sprayer intervention planning
- Patient-surge and clinical-readiness estimation
- Dynamic heat-risk timeline generation

The pipeline is designed to combine campus-scale spatial data with weather conditions, thermal history, vegetation context, and operational indicators. Model outputs should be interpreted as planning guidance rather than medical advice or an emergency warning system.

## Prerequisites

- Node.js 18 or newer
- Python 3.10 or newer
- A modern browser
- Optional: a Google Gemini API key for live Ira responses

Python dependencies are listed in [`ml/requirements.txt`](ml/requirements.txt).

## Local setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/SUBROTOSHARMA095/ShadeRoute_PipelinePilots.git
   cd ShadeRoute_PipelinePilots
   ```

2. **Install the Node.js server dependency**

   ```bash
   npm install express
   ```

3. **Create and activate a Python virtual environment**

   ```bash
   python -m venv .venv
   ```

   macOS/Linux:

   ```bash
   source .venv/bin/activate
   ```

   Windows PowerShell:

   ```powershell
   .venv\Scripts\Activate.ps1
   ```

4. **Install Python dependencies**

   ```bash
   pip install -r ml/requirements.txt
   ```

5. **Configure environment variables**

   Copy `.env.example` to `.env` and add values for the services you want to use:

   ```dotenv
   GEMINI_API_KEY=your_gemini_api_key_here
   PORT=3000
   ```

   The application also accepts `GOOGLE_API_KEY` as an alternative Gemini key. Never commit `.env` or secret credentials.

6. **Start the application**

   ```bash
   node server.js
   ```

7. Open [http://localhost:3000](http://localhost:3000).

> The server serves the frontend from `public/`. Live forecast refreshes require a local Python environment and the required input data. In serverless environments such as Vercel, the application uses committed or previously generated data when Python execution is unavailable.

## API endpoints

### Forecasts and weather

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/predictions` | Baseline daily predictions |
| `GET` | `/api/predictions/hourly` | Baseline hourly predictions |
| `GET` | `/api/predictions/live` | Live predictions with cached fallback |
| `GET` | `/api/predictions/hourly/live` | Live hourly forecast with cached fallback |
| `GET` | `/api/weather/current` | Current weather snapshot |
| `POST` | `/api/run-live-forecast` | Trigger a live NWP forecast refresh |
| `POST` | `/api/timeline/sync` | Synchronize the satellite/NWP heat-risk timeline |

### Ira assistant

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/assistant/config` | Assistant availability, supported languages, and quota status |
| `POST` | `/api/assistant/chat` | Send a prompt to Ira |

Example request:

```bash
curl -X POST http://localhost:3000/api/assistant/chat \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Which areas need cooling first?","language":"en"}'
```

Ira supports English, Bengali, Hindi, Odia, Spanish, and French. If Gemini is unavailable or rate-limited, the server returns a deterministic ShadeRoute fallback response.

## Using the web application

1. Open the **Cooling Simulation** mode to plan interventions.
2. Choose a tree or mist-sprayer quantity using the presets or sliders.
3. Select **Place Trees on Map** or **Place Sprayers on Map**.
4. Review the estimated before/after cooling impact.
5. Switch to **Heat Stress Alerts** to inspect risk zones and timeline dates.
6. Select a zone for additional details.
7. Use **Ask Ira** or **Web Tour** for guided explanations.
8. Open **Citations** to review scientific and institutional sources.

## Deployment

The repository includes a `vercel.json` configuration for deploying the Express server as a Vercel Node function.

For production deployments:

- Configure `GEMINI_API_KEY` as a platform secret.
- Do not expose API keys in frontend code.
- Confirm that generated files in `public/data/` are current.
- Use a scheduled external pipeline or GitHub Actions job to refresh forecast data where serverless Python execution is unavailable.
- Review rate limits and monitoring before enabling live assistant traffic.

## Data and responsible use

ShadeRoute uses satellite, weather, geospatial, and campus planning data to support heat-resilience decisions. Data freshness, spatial resolution, model performance, and local conditions can affect results. Patient-surge values are planning estimates, not diagnoses, treatment recommendations, or substitutes for public-health guidance.

Do not use the application as the sole basis for emergency response, medical decisions, infrastructure placement, or public alerts.

## Contributing

Contributions are welcome. When submitting a change:

1. Explain the problem and the proposed solution.
2. Keep generated datasets and secrets out of commits unless intentionally versioned.
3. Document changes to API responses, model inputs, and frontend behavior.
4. Validate both local and serverless fallback behavior where applicable.
5. Include reproducible steps for testing the change.

## License

No license file is currently included. All rights remain with the repository owner unless a license is added.

## Team

Built by **Team Pipeline Pilots**.
