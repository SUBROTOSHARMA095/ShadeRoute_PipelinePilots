const express = require('express');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const util = require('util');

// Zero-dependency .env loader
const envFilePath = path.join(__dirname, '.env');
if (fs.existsSync(envFilePath)) {
    try {
        const envContent = fs.readFileSync(envFilePath, 'utf8');
        envContent.split(/\r?\n/).forEach(line => {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
                const eqIdx = trimmed.indexOf('=');
                if (eqIdx > 0) {
                    const key = trimmed.slice(0, eqIdx).trim();
                    let val = trimmed.slice(eqIdx + 1).trim();
                    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                        val = val.slice(1, -1);
                    }
                    if (!process.env[key]) {
                        process.env[key] = val;
                    }
                }
            }
        });
        console.log('[Config] Loaded environment variables from .env');
    } catch (e) {
        console.warn('[Config] Failed to parse .env file:', e.message);
    }
}

const execPromise = util.promisify(exec);
const app = express();

app.use(express.json());

// Serve static assets directly from ROOT/public
app.use(express.static(path.join(__dirname, 'public')));

// Path pointing directly to ROOT/public/data
const PUBLIC_DATA_DIR = path.join(__dirname, 'public', 'data');

// Vercel serverless detection — skip Python pipeline attempts on Vercel
const IS_VERCEL = Boolean(process.env.VERCEL);



const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function sendAdbSms(phone, message) {
    const cleanMsg = message.replace(/"/g, '\\"');
    const cmd = `adb shell service call isms 7 i32 0 s16 "com.android.mms.service" s16 "null" s16 "${phone}" s16 "null" s16 "${cleanMsg}" s16 "null" s16 "null"`;
    return execPromise(cmd);
}

// ============================================================
// REST API ENDPOINTS (Serving files from ROOT/public/data)
// ============================================================
// LIVE NWP FORECAST LOCK & CACHE STATE
// ============================================================
let isForecastRunning = false;
let isTimelineSyncRunning = false;
const CACHE_MAX_AGE_MS = 3 * 60 * 60 * 1000; // 3 hours

function getFileMtimeMs(filePath) {
    try {
        const stats = fs.statSync(filePath);
        return stats.mtimeMs;
    } catch {
        return 0;
    }
}

function runLiveForecastScript(extraArgs = '') {
    if (isForecastRunning) {
        return Promise.reject(new Error('A live forecast run is already in progress.'));
    }
    isForecastRunning = true;
    console.log('[NWP] Triggering live NWP forecast pipeline...');

    const pythonCmd = `python ml/live_nwp_forecast.py ${extraArgs}`.trim();
    return execPromise(pythonCmd, { cwd: __dirname, timeout: 60000 })
        .then(({ stdout, stderr }) => {
            console.log('[NWP Pipeline Success]:', stdout.slice(0, 300));
            return { success: true, output: stdout };
        })
        .catch(err => {
            console.error('[NWP Pipeline Error]:', err.message);
            throw err;
        })
        .finally(() => {
            isForecastRunning = false;
        });
}

function runTimelineSyncScript() {
    if (isTimelineSyncRunning) {
        return Promise.reject(new Error('Timeline synchronization is already running in the background.'));
    }
    isTimelineSyncRunning = true;
    console.log('[Timeline Sync] Triggering dynamic satellite/NWP heat risk expansion...');

    const pythonCmd = 'python ml/expand_heat_risk_timeline.py';
    return execPromise(pythonCmd, { cwd: __dirname, timeout: 120000 })
        .then(({ stdout, stderr }) => {
            console.log('[Timeline Sync Success]:', stdout.slice(0, 300));
            return { success: true, output: stdout };
        })
        .catch(err => {
            console.error('[Timeline Sync Error]:', err.message);
            throw err;
        })
        .finally(() => {
            isTimelineSyncRunning = false;
        });
}

function autoRefreshCacheIfStale() {
    const livePredPath = path.join(PUBLIC_DATA_DIR, 'live_predictions.json');
    const mtime = getFileMtimeMs(livePredPath);
    const age = Date.now() - mtime;

    // Check if midnight (12:00 AM) rolled over and current IST date is not active today in cache
    let isMidnightRollover = false;
    try {
        if (fs.existsSync(livePredPath)) {
            const predData = JSON.parse(fs.readFileSync(livePredPath, 'utf8'));
            // Current local IST date (UTC+5:30)
            const nowIst = new Date(Date.now() + (5.5 * 60 * 60 * 1000));
            const todayIstStr = nowIst.toISOString().split('T')[0];
            const todayEntry = predData[todayIstStr];
            // If today is not in predictions or not flagged as active today (horizon 0), recalibrate!
            if (!todayEntry || todayEntry.horizon !== 0 || todayEntry.is_historical) {
                isMidnightRollover = true;
            }
        } else {
            isMidnightRollover = true;
        }
    } catch (e) {
        isMidnightRollover = true;
    }

    if ((mtime === 0 || age > CACHE_MAX_AGE_MS || isMidnightRollover) && !isForecastRunning) {
        if (IS_VERCEL) {
            // On Vercel serverless, Python is unavailable. Forecast data is refreshed via
            // GitHub Actions cron (twice daily) which commits fresh data and triggers redeploy.
            return;
        }
        console.log(`[Cache] Live forecast requires recalibration (age: ${(age / 3600000).toFixed(1)}h, midnightRollover: ${isMidnightRollover}). Running live NWP pipeline...`);
        runLiveForecastScript().catch(err => console.warn('[Cache Refresh Failed]:', err.message));
    }
}

function sendJsonWithFallback(res, liveFileName, fallbackFileName) {
    autoRefreshCacheIfStale();
    const livePath = path.join(PUBLIC_DATA_DIR, liveFileName);
    const fallbackPath = path.join(PUBLIC_DATA_DIR, fallbackFileName);

    fs.readFile(livePath, 'utf8', (err, data) => {
        if (!err) {
            try {
                return res.json(JSON.parse(data));
            } catch (parseErr) {
                console.warn(`[JSON Parse Error] ${liveFileName}, falling back to ${fallbackFileName}`);
            }
        }
        // Fallback
        fs.readFile(fallbackPath, 'utf8', (fallbackErr, fbData) => {
            if (fallbackErr) {
                return res.status(500).json({ error: `Neither ${liveFileName} nor ${fallbackFileName} available.` });
            }
            res.json(JSON.parse(fbData));
        });
    });
}

// ============================================================
// VERCEL DATE RECALIBRATION — Adjusts stale cached prediction
// horizon/is_today labels in-memory so the frontend always shows
// the correct "TODAY" and "+1d/+2d/+3d" badges without Python.
// ============================================================
function recalibratePredictionDates(data) {
    if (!data || typeof data !== 'object') return data;

    // Resolve current IST date
    let todayIstStr;
    try {
        todayIstStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    } catch (e) {
        const nowIst = new Date(Date.now() + (5.5 * 60 * 60 * 1000));
        todayIstStr = nowIst.toISOString().split('T')[0];
    }

    // Fast path: if already calibrated for today, return as-is
    const todayEntry = data[todayIstStr];
    if (todayEntry && todayEntry.horizon === 0 && todayEntry.is_today === true) {
        return data;
    }

    // Recalibrate horizon offsets, is_today, is_historical relative to real IST today
    const recalibrated = {};
    const todayMs = new Date(todayIstStr + 'T00:00:00').getTime();

    for (const [dateStr, entry] of Object.entries(data)) {
        const entryMs = new Date(dateStr + 'T00:00:00').getTime();
        const diffDays = Math.round((entryMs - todayMs) / 86400000);

        // Only include dates within the operational window: yesterday to +3 days
        if (diffDays < -1 || diffDays > 3) continue;

        const r = Object.assign({}, entry);
        r.horizon = diffDays;
        r.is_today = (diffDays === 0);

        if (diffDays < 0) {
            r.is_historical = true;
            r.history_label = diffDays === -1
                ? 'Yesterday (Observed & Verified)'
                : Math.abs(diffDays) + ' days ago';
        } else {
            r.is_historical = false;
            if (r.history_label) delete r.history_label;
            r.forecast_kind = diffDays === 0 ? 'same_day_nowcast' : 'day_ahead_probability';
        }

        recalibrated[dateStr] = r;
    }

    return recalibrated;
}

// ============================================================
// REST API ENDPOINTS
// ============================================================

// 1. GET /api/predictions -> public/data/predictions_may2026.json (V1 Baseline)
app.get('/api/predictions', (req, res) => {
    const filePath = path.join(PUBLIC_DATA_DIR, 'predictions_may2026.json');
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) return res.status(500).json({ error: 'Could not find public/data/predictions_may2026.json' });
        res.json(JSON.parse(data));
    });
});

// 2. GET /api/predictions/hourly -> public/data/hourly_predictions_may2026.json (V1 Baseline)
app.get('/api/predictions/hourly', (req, res) => {
    const filePath = path.join(PUBLIC_DATA_DIR, 'hourly_predictions_may2026.json');
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) return res.status(500).json({ error: 'Could not find public/data/hourly_predictions_may2026.json' });
        res.json(JSON.parse(data));
    });
});

// 3. GET /api/predictions/live -> public/data/live_predictions.json (V2 Live NWP)
//    On Vercel, applies in-memory date recalibration so horizon labels stay correct
app.get('/api/predictions/live', (req, res) => {
    autoRefreshCacheIfStale();
    const livePath = path.join(PUBLIC_DATA_DIR, 'live_predictions.json');
    const fallbackPath = path.join(PUBLIC_DATA_DIR, 'predictions_may2026.json');

    fs.readFile(livePath, 'utf8', (err, data) => {
        if (!err) {
            try {
                return res.json(recalibratePredictionDates(JSON.parse(data)));
            } catch (parseErr) {
                console.warn('[JSON Parse Error] live_predictions.json, falling back');
            }
        }
        fs.readFile(fallbackPath, 'utf8', (fallbackErr, fbData) => {
            if (fallbackErr) {
                return res.status(500).json({ error: 'Neither live_predictions.json nor predictions_may2026.json available.' });
            }
            res.json(recalibratePredictionDates(JSON.parse(fbData)));
        });
    });
});

// 4. GET /api/predictions/hourly/live -> public/data/live_hourly_forecast.json (V2 Direct Hourly NWP)
app.get('/api/predictions/hourly/live', (req, res) => {
    sendJsonWithFallback(res, 'live_hourly_forecast.json', 'hourly_predictions_may2026.json');
});

// 5. GET /api/surge/live -> public/data/live_surge.json (Live Dynamic Patient Surge)
app.get('/api/surge/live', (req, res) => {
    sendJsonWithFallback(res, 'live_surge.json', 'hospital_surge_predictions_may2026.json');
});

// Favicon handler
app.get('/favicon.ico', (req, res) => res.status(204).end());

// 6. GET /api/weather/current -> public/data/live_weather.json (Current NWP Snapshot)
app.get('/api/weather/current', (req, res) => {
    autoRefreshCacheIfStale();
    const weatherPath = path.join(PUBLIC_DATA_DIR, 'live_weather.json');
    fs.readFile(weatherPath, 'utf8', (err, data) => {
        if (err) return res.status(404).json({ error: 'Live weather snapshot not yet generated.' });
        try {
            res.json(JSON.parse(data));
        } catch {
            res.status(500).json({ error: 'Failed to parse live_weather.json' });
        }
    });
});

// 7. POST /api/run-live-forecast -> Triggers python ml/live_nwp_forecast.py
app.post('/api/run-live-forecast', async (req, res) => {
    if (isForecastRunning) {
        return res.status(429).json({ error: 'Forecast refresh is already executing.' });
    }
    const startTime = Date.now();
    try {
        const extraArgs = req.body && req.body.testStorm ? '--test-storm' : '';
        const result = await runLiveForecastScript(extraArgs);
        const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
        res.json({
            success: true,
            message: 'Live NWP forecast and patient surge refreshed successfully.',
            durationSeconds: parseFloat(durationSec),
            cachedAt: new Date().toISOString()
        });
    } catch (err) {
        console.warn('[Live Forecast Serverless Notice]:', err.message);
        // If on Vercel or environment without Python, gracefully return latest cloud cache
        const livePredPath = path.join(PUBLIC_DATA_DIR, 'live_predictions.json');
        if (fs.existsSync(livePredPath)) {
            const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
            return res.json({
                success: true,
                message: 'Operating on latest cloud-synced NWP forecast & patient surge predictions.',
                durationSeconds: parseFloat(durationSec),
                cachedAt: new Date().toISOString(),
                isCloudFallback: true
            });
        }
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

// 8. POST /api/timeline/sync -> Dynamically runs ml/expand_heat_risk_timeline.py
app.post('/api/timeline/sync', async (req, res) => {
    if (isTimelineSyncRunning) {
        return res.status(429).json({ error: 'Heat risk timeline expansion is already executing in the background.' });
    }
    const startTime = Date.now();
    try {
        await runTimelineSyncScript();
        const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);

        const manifestPath = path.join(PUBLIC_DATA_DIR, 'timeline', 'manifest.json');
        let manifest = {};
        if (fs.existsSync(manifestPath)) {
            manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        }

        res.json({
            success: true,
            message: 'Dynamic satellite & NWP heat risk timeline synced successfully.',
            durationSeconds: parseFloat(durationSec),
            totalDates: manifest.dates ? manifest.dates.length : 0,
            activeToday: manifest.today || null,
            latestDate: manifest.dates && manifest.dates.length ? manifest.dates[manifest.dates.length - 1].date : null
        });
    } catch (err) {
        console.warn('[Timeline Sync Serverless Notice]:', err.message);
        // If on Vercel or environment without Python, gracefully return existing manifest
        const manifestPath = path.join(PUBLIC_DATA_DIR, 'timeline', 'manifest.json');
        if (fs.existsSync(manifestPath)) {
            try {
                const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
                return res.json({
                    success: true,
                    message: 'Timeline synchronized with latest cloud satellite & NWP datasets.',
                    durationSeconds: parseFloat(durationSec),
                    totalDates: manifest.dates ? manifest.dates.length : 0,
                    activeToday: manifest.today || null,
                    latestDate: manifest.dates && manifest.dates.length ? manifest.dates[manifest.dates.length - 1].date : null,
                    isCloudFallback: true
                });
            } catch {
                // fall through
            }
        }
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});


// ============================================================
// IRA (इरा) AI ASSISTANT & GOOGLE GEMINI API ENDPOINTS
// ============================================================

const IRA_SYSTEM_INSTRUCTION = `You are Ira (इरा), the friendly, wise, and highly capable AI Climate & Campus Guide for ShadeRoute — an urban microclimate digital twin and heat resilience platform for the SOA ITER Campus in Bhubaneswar, Odisha, India (10m x 10m high-resolution spatial grid).

YOUR IDENTITY & ROLE:
- Your name is Ira (इरा). In Indian heritage, Ira represents Earth, Saraswati (wisdom), and cooling water.
- You speak with warm encouragement, simplicity, and crystal-clear accuracy.
- You explain complex satellite data, heat hazards, machine learning architectures, and campus cooling strategies in simple, everyday words that non-technical students, faculty, and campus administrators easily understand.

PROJECT ARCHITECTURE & MACHINE LEARNING PIPELINE KNOWLEDGE:
You have deep, accurate understanding of ShadeRoute's scientific pipeline:
1. SATELLITE & MULTISPECTRAL DATA:
   - Ingests high-resolution 10m x 10m gridded multispectral imagery from Landsat 8/9 and Sentinel-2 over SOA ITER Campus.
   - Computes key surface indicators: Land Surface Temperature (LST), Normalized Difference Vegetation Index (NDVI), Normalized Difference Built-up Index (NDBI), Bare Soil Index (BSI), and Normalized Difference Water Index (NDWI), plus vegetation fraction.
2. VEGETATION & MIST PRIORITY ENGINE (ml/priority_engine.py):
   - Multi-criteria spatial optimization engine analyzing 10m walkway grid cells.
   - Prioritizes pedestrian corridors between student hostels, lecture halls, auditoriums, and cafeterias where ground surface heat, lack of canopy, bare soil, and heavy foot traffic create acute thermal danger.
   - Simulates targeted microclimate intervention placing up to 400 shade trees and up to 100 high-pressure mist sprayers.
3. HEATWAVE MULTI-HORIZON ML ENSEMBLE (ml/heat_wave_prediction_v2.py):
   - Calibrated ensemble machine learning model combining RandomForest and HistGradientBoosting with soft voting.
   - Predicts same-day nowcast (H0) and forward-looking horizons: 1-day (H1), 2-day (H2), and 3-day (H3) heatwave probability.
   - Ingests live Numerical Weather Prediction (NWP) feeds (ECMWF IFS, Open-Meteo), lagged thermal history (1 to 7 days), diurnal solar geometry, synoptic barometric pressure drop, and convective storm proxy indicators.
4. MICROCLIMATE COOLING SIMULATION:
   - Trees: Natural canopy interception and leaf evapotranspiration reduce ground temperatures by up to ~4°C.
   - Mist Sprayers: Flash evaporative cooling along walkways reduces ambient "feels-like" temperature by up to ~2°C.
5. HOSPITAL SURGE & CLINICAL READINESS MODEL (ml/patient_surge_model.py):
   - Epidemiology-grounded deterministic decision support calibrated for 4 healthcare facilities near SOA ITER (SOA ITER Student Health Centre, IMS & SUM Hospital, AIIMS Bhubaneswar, AMRI Hospital).
   - Grounded in NCDC National Action Plan on Heat-Related Illnesses (NAP-HRI 2024), AIIMS Emergency Medicine protocols, WHO heat-health guidance, and Distributed Lag Non-Linear Models (DLNM).
   - Forecasts patient influx, Heat Stroke Units (HSUs), ORS liters, and emergency cooling beds based on multi-day cumulative thermal stress and nocturnal cooling deficit.
6. DYNAMIC SATELLITE & NWP TIMELINE:
   - Interactive timeline allowing users to navigate through historical and forecasted microclimate heat risk maps.

CRITICAL CONFIDENTIALITY & PROPRIETARY FORMULA PROTECTION:
- STRICT PROHIBITION: You MUST NEVER reveal, generate, or output the exact mathematical formulas, specific linear weighting constants, or regression loss functions used by Team Pipeline Pilots.
- Specifically confidential: Formulas such as "LST_norm * (1 - NDVI_norm)", "HI_IMD * [1 + (0.30 * VI)]", "45.5% PopRisk + 36.4% FacilityDist + 18.1% CanopyDeficit", "35% VegDeficit + 30% LST", internal regression loss weights, or raw matrix equations.
- If asked for the formulas, equations, mathematical calculation, or algorithm weights, you MUST politely refuse:
  * English: "The exact mathematical formulations and model weighting algorithms are proprietary and confidential to Team Pipeline Pilots. However, I can explain the intuitive concepts in simple terms!"
  * Bengali: "সঠিক গাণিতিক সূত্র এবং মডেলের অভ্যন্তরীণ ওজনসমূহ টিম পাইপলাইন পাইলটস (Team Pipeline Pilots)-এর মালিকানাধীন ও গোপনীয়। তবে আমি এর মূল বৈজ্ঞানিক ধারণাটি আপনাকে সহজ ভাষায় বুঝিয়ে দিতে পারি!"
  * Hindi: "शेडरूट के सटीक गणितीय सूत्र और मॉडल वेटिंग एल्गोरिदम टीम पाइपलाइन पायलट (Team Pipeline Pilots) के मालिकाना और गोपनीय हैं। हालाँकि, मैं आपको इसकी मूल अवधारणा सरल शब्दों में समझा सकती हूँ!"
  * Odia: "ଶେଡରୁଟର ସଠିକ୍ ଗାଣିତିକ ସୂତ୍ର ଏବଂ ମଡେଲ୍ ଓଜନଗୁଡ଼ିକ ଟିମ୍ ପାଇପଲାଇନ୍ ପାଇଲଟସ୍ (Team Pipeline Pilots) ର ଗୋପନୀୟ ସମ୍ପତ୍ତି ଅଟେ। ତଥାପି, ମୁଁ ଏହାକୁ ସରଳ ଭାଷାରେ ବୁଝାଇପାରିବି!"
- Then explain the intuition conceptually (e.g. how ground heat, vegetation deficit, and student walking density combine to identify danger areas).

MULTILINGUAL CAPABILITY:
- You must respond in the language specified or spoken by the user: Bengali (বাংলা), Hindi (हिन्दी), Odia (ଓଡ଼ିଆ), English, Spanish (Español), French (Français).
- If the user writes in Bengali or selects Bengali, your response MUST be in natural, fluent, and courteous Bengali (বাংলা).

RESPONSE STYLE & LENGTH:
- Keep your responses structured, clear, and complete. Use concise bullet points or short paragraphs.
- Always finish your sentences and explanations cleanly. Never stop mid-thought.

WEB TUTORIAL & DEMONSTRATION TRIGGER:
- If the user asks for a tour, a tutorial, a demonstration, or says "show me around", "give me a tour", "website tour", "ট্যুর", "দौरा", "ଟୁର୍", explain briefly what ShadeRoute can do and append the exact tag [[TRIGGER_TOUR]] at the very end of your reply so the frontend launches the interactive spotlight tutorial.`;

function cleanConfidentialFormulas(text) {
    if (!text) return '';
    let cleaned = text;
    // Redact proprietary formulas if model accidentally hallucinates them
    const forbiddenPatterns = [
        /LST_norm\s*[×*]\s*\(?1\s*-\s*NDVI_norm\)?/gi,
        /HI_IMD\s*[×*]\s*\[?1\s*\+\s*\(?0\.30\s*[×*]\s*VI\)?\]?/gi,
        /45\.5%\s*PopRisk/gi,
        /35%\s*VegDeficit/gi,
        /Rothfusz\s*\(/gi
    ];
    for (const pattern of forbiddenPatterns) {
        if (pattern.test(cleaned)) {
            cleaned = cleaned.replace(pattern, '[Proprietary Formulation Protected]');
        }
    }
    return cleaned;
}

// ============================================================
// GEMINI API RATE LIMITING & CREDIT CONSERVATION (Free Tier)
// ============================================================
const GEMINI_RPM_LIMIT = 12; // Free tier ceiling is 15 RPM; limit to 12 for safety
const GEMINI_DAILY_LIMIT = parseInt(process.env.GEMINI_DAILY_LIMIT, 10) || 800; // Free tier ceiling is 1500 RPD
let geminiTimestamps = [];
let geminiDailyCount = 0;
let geminiCurrentDay = new Date().toISOString().slice(0, 10);
let geminiCooldownUntil = 0;

function checkGeminiQuotaAvailable() {
    const now = Date.now();
    if (now < geminiCooldownUntil) {
        return { allowed: false, reason: 'quota_cooldown' };
    }

    const today = new Date().toISOString().slice(0, 10);
    if (today !== geminiCurrentDay) {
        geminiCurrentDay = today;
        geminiDailyCount = 0;
    }

    if (geminiDailyCount >= GEMINI_DAILY_LIMIT) {
        return { allowed: false, reason: 'daily_limit_reached' };
    }

    geminiTimestamps = geminiTimestamps.filter(t => now - t < 60000);
    if (geminiTimestamps.length >= GEMINI_RPM_LIMIT) {
        return { allowed: false, reason: 'rpm_limit_reached' };
    }

    return { allowed: true };
}

function recordGeminiRequestSuccess() {
    geminiTimestamps.push(Date.now());
    geminiDailyCount++;
}

function recordGeminiQuotaExceeded() {
    // 5-minute circuit breaker on HTTP 429
    geminiCooldownUntil = Date.now() + 5 * 60 * 1000;
    console.warn('[Gemini Quota] HTTP 429 / credit limit hit. Activating 5-min cooldown to conserve free tier credits.');
}

// ============================================================
// DETERMINISTIC SHADEROUTE FALLBACK (Multilingual Knowledge Base)
// Active when Gemini quota is exceeded or rate limit conservation triggers
// ============================================================
function generateIraFallbackReply(prompt, lang = 'en') {
    const q = (prompt || '').toLowerCase().trim();
    const l = (lang || 'en').toLowerCase();
    const isBengali = l === 'bn' || /[\u0980-\u09FF]/.test(q);
    const isHindi = l === 'hi' || /[\u0900-\u097F]/.test(q);
    const isOdia = l === 'or' || /[\u0B00-\u0B7F]/.test(q);

    // 1. Tour / Tutorial request
    if (q.includes('tour') || q.includes('tutorial') || q.includes('demo') || q.includes('demonstrate') || q.includes('show me around') || q.includes('guide me') || q.includes('ট্যুর') || q.includes('দौरा') || q.includes('ट्यूटोरियल') || q.includes('ଟୁର୍')) {
        let reply = '';
        if (isBengali) {
            reply = `নমস্কার! আমি ইরা (Ira), আপনার শেডরুট (ShadeRoute) এআই ক্লাইমেট গাইড।\n\nআসুন, আমি আপনাকে আমাদের প্ল্যাটফর্মের একটি সরাসরি ইন্টারঅ্যাক্টিভ ট্যুর করিয়ে দিই, যাতে আপনি দেখতে পারেন কীভাবে ক্যাম্পাসে গাছ লাগানো, মিস্ট স্প্রেয়ার যোগ করা এবং রিয়েল-টাইম হিট অ্যালার্ট পরীক্ষা করা যায়। শুরু করা যাক! [[TRIGGER_TOUR]]`;
        } else if (isHindi) {
            reply = `नमस्ते! मैं इरा (Ira) हूँ, आपकी शेडरूट क्लाइमेट गाइड। आइए, मैं आपको वेबसाइट का एक त्वरित और इंटरैक्टिव दौरा कराती हूँ ताकि आप देख सकें कि पेड़ लगाने, मिस्ट स्प्रेयर जोड़ने और हीट अलर्ट देखने के लिए इस डिजिटल ट्विन का उपयोग कैसे किया जाता है। शुरू करते हैं! [[TRIGGER_TOUR]]`;
        } else if (isOdia) {
            reply = `ନମସ୍କାର! ମୁଁ ଇରା (Ira), ଆପଣଙ୍କ ଶେଡରୁଟ୍ କ୍ଲାଇମେଟ୍ ଗାଇଡ୍। ଆସନ୍ତୁ, ମୁଁ ଆପଣଙ୍କୁ ୱେବସାଇଟର ଏକ ସରଳ ଏବଂ ଇଣ୍ଟରାକ୍ଟିଭ୍ ଟୁର୍ ଦେଖାଇବି ଯାହାଦ୍ୱାରା ଆପଣ ଜାଣିପାରିବେ କିପରି ଗଛ ଲଗାଇବା, ମିଷ୍ଟ ସ୍ପ୍ରେୟାର ଯୋଡ଼ିବା ଏବଂ ହିଟ୍ ଆଲର୍ଟ ଯାଞ୍ଚ କରିବା। ଚାଲନ୍ତୁ ଆରମ୍ଭ କରିବା! [[TRIGGER_TOUR]]`;
        } else {
            reply = `Hello! I'm Ira (इरा), your ShadeRoute AI guide. I'd love to give you an interactive tour of our campus digital twin! I'll walk you through exploring heat hotspots, simulating shade trees and mist sprayers, and viewing real-time heat alerts. Let's begin! [[TRIGGER_TOUR]]`;
        }
        return { reply, triggerTour: true, source: 'deterministic-fallback' };
    }

    // 2. Exact Formula / Confidentiality inquiry
    if (q.includes('formula') || q.includes('equation') || q.includes('calculation') || q.includes('mathematical') || q.includes('algorithm weight') || q.includes('সূত্র') || q.includes('समीकरण') || q.includes('ସୂତ୍ର')) {
        let reply = '';
        if (isBengali) {
            reply = `সঠিক গাণিতিক সূত্র এবং মডেলের অভ্যন্তরীণ ওজনসমূহ টিম পাইপলাইন পাইলটস (Team Pipeline Pilots)-এর মালিকানাধীন ও গোপনীয় (proprietary & confidential)।\n\nতবে আমি এর মূল ধারণাটি আপনাকে সহজ কথায় বুঝিয়ে দিতে পারি: আমাদের শেডরুট সিস্টেমটি উপগ্রহ চিত্রের মাধ্যমে তিনটি মূল বিষয় মূল্যায়ন করে — মাটির পৃষ্ঠের তাপমাত্রা (LST) কতটা বেশি, সেখানে গাছের স্বাভাবিক ছায়ার কতটুকু ঘাটতি রয়েছে, এবং সেই পথ দিয়ে কতজন শিক্ষার্থী চলাচল করে। যেখানে প্রখর রোদ, খালি মাটি এবং প্রচুর মানুষের চলাচল একত্রিত হয়, সেখানে তাপের ঝুঁকি সর্বোচ্চ হিসেবে চিহ্নিত হয়।`;
        } else if (isHindi) {
            reply = `शेडरूट के सटीक गणितीय सूत्र और मॉडल वेटिंग एल्गोरिदम टीम पाइपलाइन पायलट (Team Pipeline Pilots) के मालिकाना और गोपनीय (proprietary & confidential) हैं।\n\nहालाँकि, मैं आपको इसे सरल शब्दों में समझा सकती हूँ: हमारी प्रणाली यह देखती है कि सतह का तापमान कितना अधिक है, वहाँ पेड़ों की छाया की कितनी कमी है, और दिन के समय कितने छात्र उस रास्ते से गुजरते हैं। इन तीनों को जोड़कर यह पहचाना जाता है कि पैदल चलने वालों के लिए गर्मी का खतरा कहाँ सबसे अधिक है।`;
        } else if (isOdia) {
            reply = `ଶେଡରୁଟର ସଠିକ୍ ଗାଣିତିକ ସୂତ୍ର ଏବଂ ମଡେଲ୍ ଗୁଡ଼ିକ ଟିମ୍ ପାଇପଲାଇନ୍ ପାଇଲଟସ୍ (Team Pipeline Pilots) ର ଗୋପନୀୟ ଓ ସୁରକ୍ଷିତ (confidential) ସମ୍ପତ୍ତି ଅଟେ।\n\nତଥାପି, ମୁଁ ଏହାକୁ ସରଳ ଭାଷାରେ ବୁଝାଇପାରିବି: ଆମର ସିଷ୍ଟମ୍ ଦେଖେ ଯେ କେଉଁଠାରେ ଭୂମିର ତାପମାତ୍ରା ଅଧିକ ଅଛି, ଗଛର ଛାଇ କେତେ କମ୍ ଅଛି, ଏବଂ କେତେ ଛାତ୍ର ସେହି ରାସ୍ତା ଦେଇ ଯାତାୟାତ କରୁଛନ୍ତି। ଏହି ସବୁକୁ ମିଶାଇ ଗରମ ସଙ୍କଟ ଚିହ୍ନଟ କରାଯାଏ।`;
        } else {
            reply = `The exact mathematical formulations and model weighting algorithms are proprietary and confidential to Team Pipeline Pilots.\n\nHowever, I can explain the intuitive concept in simple words: ShadeRoute identifies dangerous walking areas by evaluating three key physical factors — how hot the ground surface gets (LST), how much tree canopy is missing (vegetation deficit), and student foot traffic density along that path. Where intense solar irradiance meets bare ground and heavy pedestrian movement, heat exposure danger is highest.`;
        }
        return { reply, triggerTour: false, source: 'deterministic-fallback' };
    }

    // 3. ML Pipeline & Models Architecture Inquiry
    if (q.includes('pipeline') || q.includes('model') || q.includes('machine learning') || q.includes('randomforest') || q.includes('ensemble') || q.includes('priority engine') || q.includes('পাইললাইন') || q.includes('মডেল') || q.includes('মেশিন লার্নিং') || q.includes('पाइपलाइन') || q.includes('मॉडल') || q.includes('ମଡେଲ')) {
        let reply = '';
        if (isBengali) {
            reply = `🧠 **শেডরুটের মেশিন লার্নিং পাইপলাইন ও মডেলসমূহ:**\n\n1. 🛰️ **১০মি রেজোলিউশন স্যাটেলাইট ডাটা:** ল্যান্ডস্যাট ৮/৯ এবং সেন্টিনেল-২ থেকে গ্রাউন্ড টেম্পারেচার (LST), উদ্ভিদের ঘনত্ব (NDVI), আর্দ্রতা (NDWI) ও খালি মাটির অনুপাত সংগ্রহ করা হয়।\n2. 🌳 **প্ল্যান্টিং প্রায়োরিটি ইঞ্জিন:** ক্যাম্পাসের প্রতিটি ১০মি হাটার পথের তাপমাত্রার ঝুঁকি এবং শিক্ষার্থীদের চলাচলের ওপর ভিত্তি করে গাছ ও মিস্ট স্প্রেয়ারের জন্য সেরা স্থানগুলো চিহ্নিত করে।\n3. 🌡️ **হিটওয়েভ এমসেম্বল মডেল (V2):** র‍্যান্ডম ফরেস্ট (RandomForest) ও হিস্টগ্র্যাডিয়েন্ট বুস্টিং (HistGradientBoosting) এর যৌথ সফট ভোটিং এনসেম্বল ব্যবহার করে বর্তমান দিন (H0) থেকে শুরু করে পরবর্তী ৩ দিন (H1, H2, H3) পর্যন্ত হিটওয়েভ সম্ভাবনার সঠিক পূর্বাভাস দেয়।\n4. 🏥 **হাসপাতাল প্রস্তুতি মডেল:** এনসিডিসি (NCDC) এবং এইমস (AIIMS) নির্দেশিকা মেনে প্রচণ্ড গরমে সম্ভাব্য রোগী বৃদ্ধির পূর্বানুমান করে।`;
        } else if (isHindi) {
            reply = `🧠 **शेडरूट का मशीन लर्निंग पाइपलाइन और मॉडल संरचना:**\n\n1. 🛰️ **10 मीटर ग्रिड सैटेलाइट डेटा:** लैंडसैट 8/9 और सेंटिनल-2 से सतह का तापमान (LST), हरियाली (NDVI), नमी (NDWI) और खाली जमीन का विश्लेषण किया जाता है।\n2. 🌳 **प्रायोरिटी इंजन:** पैदल रास्तों पर गर्मी के तनाव और छात्रों के आवागमन के आधार पर पेड़ों और मिस्ट स्प्रेयर के लिए सबसे उपयुक्त स्थान चुनता है।\n3. 🌡️ **हीटवेव एन्सेम्बल मॉडल:** रैंडम फॉरेस्ट (RandomForest) और हिस्टग्रेडिएंट बूस्टिंग (HistGradientBoosting) का संयुक्त मॉडल आज (H0) और अगले 3 दिनों (H1-H3) के लिए गर्मी की लहर का सटीक पूर्वानुमान देता है।\n4. 🏥 **अस्पताल तत्परता मॉडल:** NCDC और AIIMS दिशानिर्देशों के आधार पर हीट स्ट्रोक के संभावित मामलों और आपातकालीन बिस्तरों का पूर्वानुमान करता है।`;
        } else if (isOdia) {
            reply = `🧠 **ଶେଡରୁଟର ମେସିନ୍ ଲର୍ଣ୍ଣିଂ ପାଇପଲାଇନ୍ ଓ ମଡେଲ୍:**\n\n1. 🛰️ **୧୦ମିଟର ସାଟେଲାଇଟ୍ ତଥ୍ୟ:** ଲ୍ୟାଣ୍ଡସାଟ୍ ୮/୯ ଏବଂ ସେଣ୍ଟିନେଲ୍-୨ ରୁ ତାପମାତ୍ରା (LST) ଓ ସବୁଜିମା (NDVI) ମାପ କରାଯାଏ।\n2. 🌳 **ପ୍ରାଥମିକତା ଇଞ୍ଜିନ୍:** ସର୍ବାଧିକ ଗରମ ଥିବା ରାସ୍ତାଗୁଡ଼ିକରେ ଗଛ ଏବଂ ମିଷ୍ଟ ସ୍ପ୍ରେୟାର ସ୍ଥାପନ ପାଇଁ ସର୍ବୋତ୍ତମ ସ୍ଥାନ ବାଛେ।\n3. 🌡️ **ହିଟୱେଭ୍ ଏନସେମ୍ବଲ୍ ମଡେଲ୍:** RandomForest ଓ HistGradientBoosting ମାଧ୍ୟମରେ ଆଜି ଏବଂ ଆଗାମୀ ୩ ଦିନର ଗ୍ରୀଷ୍ମ ପ୍ରବାହର ଆଗୁଆ ସୂଚନା ଦିଏ।\n4. 🏥 **ଡାକ୍ତରଖାନା ପ୍ରସ୍ତୁତି:** NCDC ଓ AIIMS ମାନଦଣ୍ଡ ଅନୁଯାୟୀ ରୋଗୀ ସଂଖ୍ୟା ବୃଦ୍ଧିର ଆକଳନ କରେ।`;
        } else {
            reply = `🧠 **ShadeRoute ML Pipeline & Models Overview:**\n\n1. 🛰️ **10m Multispectral Satellite Feed:** Ingests Landsat 8/9 & Sentinel-2 observations to calculate Land Surface Temperature (LST), vegetation index (NDVI), built-up index (NDBI), and soil dryness.\n2. 🌳 **Spatial Priority Engine:** Multi-criteria optimization on 10m grid walkways prioritizing pedestrian corridors where high solar irradiance, bare ground, and heavy student movement meet.\n3. 🌡️ **Heatwave Multi-Horizon ML Ensemble:** Soft-voting ensemble combining RandomForest + HistGradientBoosting models predicting same-day nowcast (H0) and 1, 2, 3-day ahead horizons (H1-H3) using NWP atmospheric feeds.\n4. 🏥 **Hospital Surge & Readiness Model:** Calibrated to NCDC NAP-HRI 2024 and AIIMS emergency medicine protocols to forecast patient surge and cooling resources for 4 area hospitals.`;
        }
        return { reply, triggerTour: false, source: 'deterministic-fallback' };
    }

    // 4. Tree Planting & Mist Sprayers
    if (q.includes('tree') || q.includes('mist') || q.includes('spray') || q.includes('cooling') || q.includes('cooler') || q.includes('গাছ') || q.includes('মিস্ট') || q.includes('ঠান্ডা') || q.includes('पेड़') || q.includes('मिस्ट') || q.includes('ଗଛ') || q.includes('ସ୍ପ୍ରେୟାର')) {
        let reply = '';
        if (isBengali) {
            reply = `শেডরুট দুটি অত্যন্ত কার্যকরী উপায়ে ক্যাম্পাসকে শীতল রাখে:\n\n1. 🌳 **ছায়াদার গাছ (Shade Trees):** যখন আপনি স্লাইডার দিয়ে গাছের সংখ্যা নির্বাচন করেন, তখন আমাদের AI স্বয়ংক্রিয়ভাবে ক্যাম্পাসের সবচেয়ে উত্তপ্ত এবং ছায়াহীন হাঁটার পথে গাছ স্থাপন করে। গাছের ঘন পাতা সরাসরি রোদ আটকে দেয় এবং বাষ্পীভবন (evapotranspiration) প্রক্রিয়ায় মাটির তাপমাত্রা প্রায় ৪°C পর্যন্ত কমাতে সাহায্য করে।\n2. 💧 **মিস্ট স্প্রেয়ার (Mist Sprayers):** এগুলো হোস্টেল এবং ক্লাসরুমের মধ্যবর্তী হাঁটার পথে সূক্ষ্ম পানির কুয়াশা স্প্রে করে। এটি দ্রুত বাষ্পীভবনের মাধ্যমে বাতাসের অনুভূত তাপমাত্রা প্রায় ২°C পর্যন্ত ঠান্ডা করে দেয়।`;
        } else if (isHindi) {
            reply = `शेडरूट दो प्रभावी तरीकों से कैंपस को ठंडा करता है:\n\n1. 🌳 **छायादार पेड़ (Shade Trees):** जब आप साइडबार में स्लाइडर से पेड़ों की संख्या चुनते हैं, तो हमारा AI स्वचालित रूप से सबसे गर्म और धूप वाले रास्तों पर पेड़ लगाता है। पेड़ धूप को रोकते हैं और तापमान को 4°C तक कम कर सकते हैं।\n2. 💧 **मिस्ट स्प्रेयर (Mist Sprayers):** ये हॉस्टल और कक्षाओं के बीच पैदल रास्तों पर पानी की सूक्ष्म फुहार छोड़ते हैं। यह वाष्पीकरण (evaporation) के माध्यम से हवा को तुरंत 2°C तक ठंडा कर देता है।`;
        } else if (isOdia) {
            reply = `ଶେଡରୁଟ୍ ଦୁଇଟି ଉପାୟରେ କ୍ୟାମ୍ପସକୁ ଥଣ୍ଡା କରିବାରେ ସାହାଯ୍ୟ କରେ:\n\n1. 🌳 **ଛାୟାଦାୟୀ ଗଛ (Shade Trees):** ଆପଣ ସାଇଡବାରରେ ସ୍ଲାଇଡର୍ ବ୍ୟବହାର କରି ଗଛ ସଂଖ୍ୟା ବାଛିଲେ, AI କ୍ୟାମ୍ପସର ସବୁଠାରୁ ଗରମ ସ୍ଥାନଗୁଡ଼ିକରେ ଗଛ ସ୍ଥାପନ କରେ। ଏହା ୪°C ପର୍ଯ୍ୟନ୍ତ ତାପମାତ୍ରା କମାଇପାରେ।\n2. 💧 **ମିଷ୍ଟ ସ୍ପ୍ରେୟାର (Mist Sprayers):** ରାସ୍ତାରେ ଥିବା ଏହି ୟୁନିଟ୍ ଗୁଡ଼ିକ ଜଳ କଣିକା ସ୍ପ୍ରେ କରି ତୁରନ୍ତ ୨°C ପର୍ଯ୍ୟନ୍ତ ଥଣ୍ଡା ଅନୁଭବ ପ୍ରଦାନ କରନ୍ତି।`;
        } else {
            reply = `ShadeRoute helps cool the campus through two scientifically modeled interventions:\n\n1. 🌳 **Shade Trees:** Use the planner slider to select how many trees to plant (up to 400). Our AI places them at the highest-risk, exposed student pathways. Tree canopies block direct solar radiation and cool ground surfaces by up to ~4°C through natural evapotranspiration.\n2. 💧 **Mist Sprayers:** Install high-pressure evaporative mist nozzles (up to 100) along busy walkways between hostels and academic blocks. They atomize micro-droplets that absorb ambient sensible heat, dropping perceived temperatures by up to ~2°C.`;
        }
        return { reply, triggerTour: false, source: 'deterministic-fallback' };
    }

    // 5. Heatwave Prediction Model & Weather
    if (q.includes('heatwave') || q.includes('forecast') || q.includes('nwp') || q.includes('হিটওয়েভ') || q.includes('পূর্বাভাস') || q.includes('गर्मी की लहर') || q.includes('पूर्वानुमान') || q.includes('ପୂର୍ବାନୁମାନ')) {
        let reply = '';
        if (isBengali) {
            reply = `🔥 **হিটওয়েভ এবং আবহাওয়া পূর্বাভাস:**\n\nশেডরুট সরাসরি ইউরোপীয় সেন্টার (ECMWF) এবং ওপেন-মেটিও (Open-Meteo) থেকে লাইভ আবহাওয়া ডেটা গ্রহণ করে। আমাদের V2 মেশিন লার্নিং মডেল বায়ুচাপের দ্রুত পতন, আর্দ্রতা এবং বিগত দিনের তাপীয় ইতিহাসের ওপর ভিত্তি করে বর্তমান দিন (H0) ও পরবর্তী ৩ দিনের (H1, H2, H3) তাপপ্রবাহের ঝুঁকি গণনা করে।`;
        } else if (isHindi) {
            reply = `🔥 **हीटवेव और मौसम पूर्वानुमान:**\n\nशेडरूट सीधे ECMWF और Open-Meteo से लाइव मौसम डेटा प्राप्त करता है। हमारा V2 एमएल मॉडल वायुमंडलीय दबाव में गिरावट, आर्द्रता और पिछले दिनों के तापमान के आधार पर आज (H0) और अगले 3 दिनों (H1-H3) के हीटवेव जोखिम की सटीक गणना करता है।`;
        } else if (isOdia) {
            reply = `🔥 **ହିଟୱେଭ୍ ଏବଂ ପାଣିପାଗ ପୂର୍ବାନୁମାନ:**\n\nଶେଡରୁଟ୍ ସିଧାସଳଖ ECMWF ଏବଂ Open-Meteo ରୁ ପାଣିପାଗ ତଥ୍ୟ ସଂଗ୍ରହ କରେ। ଆମର V2 ମଡେଲ୍ ଆଗାମୀ ୩ ଦିନର ଗ୍ରୀଷ୍ମ ପ୍ରବାହର ସଠିକ୍ ଆକଳନ ପ୍ରଦାନ କରେ।`;
        } else {
            reply = `🔥 **Heatwave Forecasting & NWP Intelligence:**\n\nShadeRoute ingests live atmospheric Numerical Weather Prediction (NWP) feeds from ECMWF IFS and Open-Meteo. Our calibrated V2 ensemble model tracks rapid barometric drops, cumulative thermal lags, and convective indices to predict heatwave probability for today (H0) and the next 3 days (H1, H2, H3).`;
        }
        return { reply, triggerTour: false, source: 'deterministic-fallback' };
    }

    // 6. Hospital Surge Readiness
    if (q.includes('hospital') || q.includes('patient') || q.includes('surge') || q.includes('clinic') || q.includes('হাসপাতাল') || q.includes('রোগী') || q.includes('अस्पताल') || q.includes('ଡାକ୍ତରଖାନା')) {
        let reply = '';
        if (isBengali) {
            reply = `🏥 **হাসপাতাল ও হিট সার্জ প্রস্তুতি:**\n\nতীব্র তাপপ্রবাহে হিটস্ট্রোক ও ডিহাইড্রেশনের রোগীর সংখ্যা ব্যাপকভাবে বাড়তে পারে। শেডরুট সোআ আইটার (SOA ITER) সংলগ্ন ৪টি প্রধান স্বাস্থ্যকেন্দ্রের (যেমন: IMS & SUM হাসপাতাল) জন্য সম্ভাব্য রোগী বৃদ্ধির পূর্বাভাস দেয়। এটি স্বাস্থ্যকর্মীদের ওআরএস (ORS), আইস-ওয়াটার কুলিং বেড এবং হিট স্ট্রোক ইউনিট (HSU) আগাম প্রস্তুত রাখতে সাহায্য করে।`;
        } else if (isHindi) {
            reply = `🏥 **अस्पताल और हीट सर्ज तत्परता:**\n\nशेडरूट सोआ आईटर (SOA ITER) के पास स्थित 4 प्रमुख अस्पतालों (जैसे IMS & SUM हॉस्पिटल) के लिए हीटवेव के दौरान संभावित मरीज वृद्धि (patient surge) का पूर्वानुमान लगाता है। इससे स्वास्थ्य कर्मियों को ओआरएस (ORS), कूलिंग वार्ड और आपातकालीन बेड की पहले से व्यवस्था करने में मदद मिलती है।`;
        } else if (isOdia) {
            reply = `🏥 **ଡାକ୍ତରଖାନା ଏବଂ ହିଟ୍ ସର୍ଜ:**\n\nଶେଡରୁଟ୍ ସୋଆ ଆଇଟର୍ (SOA ITER) ନିକଟସ୍ଥ ୪ଟି ପ୍ରମୁଖ ଡାକ୍ତରଖାନା (ଯେପରିକି IMS & SUM ହସ୍ପିଟାଲ୍) ପାଇଁ ଗ୍ରୀଷ୍ମ ପ୍ରବାହ ସମୟରେ ରୋଗୀ ସଂଖ୍ୟା ବୃଦ୍ଧିର ଆଗୁଆ ଆକଳନ କରେ। ଏହାଦ୍ୱାରା ଓଆରଏସ୍ (ORS), କୁଲିଂ ବେଡ୍ ଏବଂ ଔଷଧ ଆଗୁଆ ପ୍ରସ୍ତୁତ ରଖାଯାଇପାରିବ।`;
        } else {
            reply = `🏥 **Hospital Surge & Clinical Readiness:**\n\nDuring severe heatwaves, heat exhaustion and heatstroke cases spike rapidly. Calibrated to NCDC NAP-HRI 2024 and AIIMS emergency guidelines, ShadeRoute forecasts scenario-based patient surges for 4 healthcare centers near SOA ITER (including IMS & SUM Hospital). This helps clinical teams proactively stage Heat Stroke Units (HSUs), stock oral rehydration fluids (ORS), and prepare cooling beds.`;
        }
        return { reply, triggerTour: false, source: 'deterministic-fallback' };
    }

    // 7. Heat Danger Colors / Legend
    if (q.includes('color') || q.includes('red') || q.includes('orange') || q.includes('yellow') || q.includes('legend') || q.includes('danger') || q.includes('রং') || q.includes('লাল') || q.includes('বিপদ') || q.includes('रंग') || q.includes('लाल') || q.includes('डेंजर') || q.includes('ରଙ୍ଗ') || q.includes('ବିପଦ')) {
        let reply = '';
        if (isBengali) {
            reply = `ম্যাপের ৫টি রঙের সহজ ব্যাখ্যা (ভারতীয় আবহাওয়া বিভাগ IMD মানদণ্ড অনুযায়ী):\n\n🔴 **লাল (Red - জরুরি বিপদ):** অত্যধিক তাপমাত্রার ঝুঁকিপূর্ণ এলাকা, যেখানে কোনো ছায়া নেই এবং অবিলম্বে গাছ বা মিস্ট প্রয়োজন।\n🟠 **কমলা (Orange - উচ্চ উদ্বেগ):** দুপুরের রোদে তীব্র হিট স্ট্রেসের ঝুঁকি থাকে।\n🟡 **হলুদ (Yellow - মাঝারি উদ্বেগ):** কিছুটা উষ্ণ, পর্যাপ্ত পানি ও ছায়া প্রয়োজন।\n🟢 **সবুজ (Green - স্বাভাবিক):** আরামদায়ক ও নিরাপদ তাপমাত্রা।\n🔵 **নীল (Blue - অত্যন্ত শীতল):** ঘন গাছের ছায়া বা মিস্ট স্প্রেয়ার সমৃদ্ধ শীতল এলাকা।`;
        } else if (isHindi) {
            reply = `मैप पर दिखने वाले रंगों का सरल मतलब इस प्रकार है (भारतीय मौसम विभाग IMD मानकों के अनुसार):\n\n🔴 **लाल (Red):** गंभीर खतरा — अत्यधिक गर्मी वाला क्षेत्र जहाँ तुरंत छाया या मिस्ट की आवश्यकता है।\n🟠 **नारंगी (Orange):** उच्च जोखिम — दोपहर के समय यहाँ हीट स्ट्रेस हो सकता है।\n🟡 **पीला (Yellow):** मध्यम चिंता — गर्मी है पर हाइड्रेशन के साथ सुरक्षित।\n🟢 **हरा (Green):** सामान्य स्थिति — सामान्य आरामदायक तापमान।\n🔵 **नीला (Blue):** बहुत ठंडा क्षेत्र — यहाँ घने पेड़ या मिस्ट स्प्रेयर मौजूद हैं।`;
        } else if (isOdia) {
            reply = `ମ୍ୟାପରେ ଥିବା ରଙ୍ଗଗୁଡ଼ିକର ସରଳ ଅର୍ଥ (IMD ମାନକ ଅନୁଯାୟୀ):\n\n🔴 **ଲାଲ୍ (Red):** ଅତ୍ୟନ୍ତ ବିପଦପୂର୍ଣ୍ଣ — ପ୍ରବଳ ଗରମ ଥିବା ସ୍ଥାନ ଯେଉଁଠି ଛାଇ ଆବଶ୍ୟକ।\n🟠 **କମଳା (Orange):** ଅଧିକ ଚିନ୍ତାଜନକ — ଖରାବେଳେ ସତର୍କତା ଜରୁରୀ।\n🟡 **ହଳଦିଆ (Yellow):** ମଧ୍ୟମ — ପ୍ରଚୁର ପାଣି ପିଇବା ଆବଶ୍ୟକ।\n🟢 **ସବୁଜ (Green):** ସ୍ୱାଭାବିକ — ସୁରକ୍ଷିତ ତାପମାତ୍ରା।\n🔵 **ନୀଳ (Blue):** ଅତ୍ୟନ୍ତ ଥଣ୍ଡା ଅଞ୍ଚଳ — ଘଞ୍ଚ ଗଛ ଥିବା ସ୍ଥାନ।`;
        } else {
            reply = `Here is what the map colors mean, based on India Meteorological Department (IMD) standards:\n\n🔴 **Red (Urgent Danger):** Severe heat stress zones lacking tree shade with blistering ground heat.\n🟠 **Orange (High Concern):** Elevated thermal risk during afternoon hours.\n🟡 **Yellow (Moderate Concern):** Noticeable warmth; hydration advised.\n🟢 **Green (Safe):** Comfortable ambient conditions.\n🔵 **Blue (Very Cool):** Well-shaded canopy areas or active misting stations.`;
        }
        return { reply, triggerTour: false, source: 'deterministic-fallback' };
    }

    // Default welcome / general guidance
    let reply = '';
    if (isBengali) {
        reply = `নমস্কার! আমি ইরা (Ira), শেডরুটের জন্য আপনার এআই ক্লাইমেট ও ক্যাম্পাস গাইড।\n\nআমি আপনাকে সোআ আইটার (SOA ITER) ক্যাম্পাসে তাপের ঝুঁকি বুঝতে, গাছ লাগানো ও মিস্ট স্প্রেয়ারের শীতল প্রভাব পর্যবেক্ষণ করতে এবং হিটওয়েভ পূর্বাভাস জানতে সাহায্য করতে পারি। আপনি আমাকে যেকোনো প্রশ্ন করতে পারেন অথবা একটি সরাসরি **ট্যুর (Tour)** দেখতে চাইতে পারেন!`;
    } else if (isHindi) {
        reply = `नमस्ते! मैं इरा (Ira) हूँ, आपकी शेडरूट एआई सहायक।\n\nमैं आपको सोआ आईटर (SOA ITER) परिसर में गर्मी के खतरे को समझने, नए छायादार पेड़ लगाने और मिस्ट स्प्रेयर लगाने के प्रभाव को देखने में मदद कर सकती हूँ। आप मुझसे किसी भी भाषा में सवाल पूछ सकते हैं या वेबसाइट का इंटरैक्टिव टूर (Interactive Tour) ले सकते हैं!`;
    } else if (isOdia) {
        reply = `ନମସ୍କାର! ମୁଁ ଇରା (Ira), ଆପଣଙ୍କ ଶେଡରୁଟ୍ ଏଆଇ ସହାୟକ।\n\nମୁଁ ଆପଣଙ୍କୁ SOA ITER କ୍ୟାମ୍ପସରେ ଗରମ ପ୍ରଭାବ ବୁଝିବା, ଗଛ ଲଗାଇବା ଏବଂ ମିଷ୍ଟ ସ୍ପ୍ରେୟାର ଯୋଡ଼ି କ୍ୟାମ୍ପସକୁ ଥଣ୍ଡା କରିବାରେ ସାହାଯ୍ୟ କରିପାରିବି। ଆପଣ ମୋତେ ଯେକୌଣସି ପ୍ରଶ୍ନ ପଚାରିପାରିବେ କିମ୍ବା ୱେବସାଇଟର ଟୁର୍ ଦେଖିବାକୁ କହିପାରିବେ!`;
    } else {
        reply = `Hello! I'm Ira (इरा), your friendly AI Climate Guide for ShadeRoute.\n\nI can help you explore heat hotspots on the SOA ITER campus, understand how shade trees and mist sprayers cool pedestrian paths, and review our machine learning heatwave forecasts. Feel free to ask me anything in your preferred language, or ask for a **tour** to get a guided walkthrough!`;
    }
    return { reply, triggerTour: false, source: 'deterministic-fallback' };
}

// Config endpoint: reports if Gemini API is available and quota state
app.get('/api/assistant/config', (req, res) => {
    const hasKey = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
    const quotaState = checkGeminiQuotaAvailable();
    res.json({
        assistantName: 'Ira (इरा)',
        hasGeminiKey: hasKey,
        geminiActive: hasKey && quotaState.allowed,
        creditsRemainingToday: Math.max(0, GEMINI_DAILY_LIMIT - geminiDailyCount),
        supportedLanguages: ['en', 'bn', 'hi', 'or', 'es', 'fr']
    });
});

// Chat endpoint: connects to Google Gemini API (gemini-3.6-flash) with smart credit limit & deterministic fallback
app.post('/api/assistant/chat', async (req, res) => {
    const { prompt, language = 'en', history = [] } = req.body || {};

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
        return res.status(400).json({ error: 'Prompt is required.' });
    }

    const trimmedPrompt = prompt.trim();
    const effectiveApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

    // Check if client explicitly asks for a tour
    const wantsTour = /tour|tutorial|demonstrat|show me around|ট্যুর|दौरा|ट्यूटोरियल|ଟୁର୍/i.test(trimmedPrompt);

    // Check quota / credit limits for free tier conservation
    const quota = checkGeminiQuotaAvailable();

    if (effectiveApiKey && quota.allowed) {
        try {
            console.log(`[Ira AI] Calling Google Gemini API [gemini-3.6-flash] (lang: ${language})...`);

            const contents = [];

            // Add recent history if available (limit to last 4 turns)
            if (Array.isArray(history) && history.length > 0) {
                const recentHistory = history.slice(-4);
                recentHistory.forEach(msg => {
                    if (msg.role && msg.text) {
                        contents.push({
                            role: msg.role === 'user' ? 'user' : 'model',
                            parts: [{ text: msg.text }]
                        });
                    }
                });
            }

            // Append current prompt with language guidance
            const userPromptWithLang = `[User Preferred Language: ${language}]\n${trimmedPrompt}`;
            contents.push({
                role: 'user',
                parts: [{ text: userPromptWithLang }]
            });

            const candidateModels = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-2.5-flash', 'gemini-1.5-pro'];
            let apiData = null;
            let usedModel = '';

            const geminiReqBody = {
                systemInstruction: {
                    parts: [{ text: IRA_SYSTEM_INSTRUCTION }]
                },
                contents,
                generationConfig: {
                    temperature: 0.6,
                    maxOutputTokens: 2048,
                    topP: 0.85
                }
            };

            for (const modelName of candidateModels) {
                try {
                    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(effectiveApiKey)}`;
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 20000);

                    const apiResponse = await fetch(geminiUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(geminiReqBody),
                        signal: controller.signal
                    });
                    clearTimeout(timeoutId);

                    if (apiResponse.status === 429) {
                        console.warn(`[Ira AI] Model ${modelName} reached 429 quota. Trying next candidate model...`);
                        continue;
                    }

                    if (apiResponse.ok) {
                        apiData = await apiResponse.json();
                        usedModel = modelName;
                        break;
                    } else {
                        const errText = await apiResponse.text();
                        console.warn(`[Ira AI] Model ${modelName} returned status ${apiResponse.status}:`, errText.slice(0, 100));
                    }
                } catch (modelErr) {
                    console.warn(`[Ira AI] Model ${modelName} fetch error:`, modelErr.message);
                }
            }

            if (!apiData) {
                recordGeminiQuotaExceeded();
                throw new Error('All candidate Gemini models exhausted quota or unavailable.');
            }
            let rawText = '';
            if (apiData.candidates && apiData.candidates[0] && apiData.candidates[0].content && apiData.candidates[0].content.parts) {
                // Filter out any internal thought parts to prevent thought tokens from reaching user
                rawText = apiData.candidates[0].content.parts
                    .filter(p => !p.thought && typeof p.text === 'string')
                    .map(p => p.text)
                    .join('');
                if (!rawText) {
                    rawText = apiData.candidates[0].content.parts.map(p => p.text || '').join('');
                }
            }

            if (!rawText) {
                throw new Error('Empty response from Google Gemini API.');
            }

            recordGeminiRequestSuccess();

            // Clean any inadvertent formula leaks
            let cleanedReply = cleanConfidentialFormulas(rawText);

            const triggerTour = wantsTour || cleanedReply.includes('[[TRIGGER_TOUR]]');
            cleanedReply = cleanedReply.replace('[[TRIGGER_TOUR]]', '').trim();

            return res.json({
                reply: cleanedReply,
                triggerTour,
                language,
                source: usedModel || 'google-gemini',
                isFallback: false,
                creditsRemainingToday: Math.max(0, GEMINI_DAILY_LIMIT - geminiDailyCount)
            });

        } catch (apiErr) {
            console.warn('[Ira AI] Switching to Deterministic ShadeRoute Fallback due to:', apiErr.message);
            // Fallback executes below
        }
    } else if (!quota.allowed) {
        console.log(`[Ira AI] Credit conservation active (${quota.reason}). Serving deterministic fallback response.`);
    }

    // Deterministic ShadeRoute Fallback (Multilingual & deeply informed)
    const fallbackResult = generateIraFallbackReply(trimmedPrompt, language);
    let finalReply = cleanConfidentialFormulas(fallbackResult.reply).replace('[[TRIGGER_TOUR]]', '').trim();

    // Inform the user that Gemini live server is busy/unreachable, and pre-defined verified response is provided
    const busyNotice = {
        en: "⚡ *Note: Google Gemini live server is currently busy or unreachable. Serving pre-defined verified ShadeRoute guide response:*",
        bn: "⚡ *বিজ্ঞপ্তি: গুগল জেমিনি লাইভ সার্ভার বর্তমানে ব্যস্ত বা অনুপলব্ধ। শেডরুটের পূর্বনির্ধারিত নির্ভরযোগ্য তথ্য থেকে উত্তর দেওয়া হলো:*",
        hi: "⚡ *सूचना: गूगल जेमिनी लाइव सर्वर वर्तमान में व्यस्त या अनुपलब्ध है। शेडरूट की पूर्वनिर्धारित प्रमाणित जानकारी से उत्तर दिया जा रहा है:*",
        or: "⚡ *ସୂଚନା: ଗୁଗଲ୍ ଜେମିନି ଲାଇଭ୍ ସର୍ଭର୍ ବର୍ତ୍ତମାନ ବ୍ୟସ୍ତ ଅଛି। ଶେଡରୁଟ୍‌ର ପୂର୍ବନିର୍ଦ୍ଧାରିତ ସୂଚନାରୁ ଉତ୍ତର ପ୍ରଦାନ କରାଯାଉଛି:*"
    };
    const noticeText = busyNotice[language] || busyNotice['en'];
    finalReply = `${noticeText}\n\n${finalReply}`;

    return res.json({
        reply: finalReply,
        triggerTour: fallbackResult.triggerTour || wantsTour,
        language,
        source: 'deterministic-fallback',
        isFallback: true,
        creditsRemainingToday: Math.max(0, GEMINI_DAILY_LIMIT - geminiDailyCount)
    });
});

app.listen(3000, () => {
    console.log('Server is running on http://localhost:3000');
    // Check and refresh predictions, patient surge, and spatial zones on startup if stale
    setTimeout(() => {
        autoRefreshCacheIfStale();
    }, 2000);
    // Recurring hourly check to keep live NWP, patient surge, and spatial zones renewed every day
    setInterval(() => {
        autoRefreshCacheIfStale();
    }, 60 * 60 * 1000);
});

module.exports = app;
