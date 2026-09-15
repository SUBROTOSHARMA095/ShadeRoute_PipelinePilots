const express = require('express');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const util = require('util');

const execPromise = util.promisify(exec);
const app = express();

app.use(express.json());

// Serve static assets directly from ROOT/public
app.use(express.static(path.join(__dirname, 'public')));

// Path pointing directly to ROOT/public/data
const PUBLIC_DATA_DIR = path.join(__dirname, 'public', 'data');



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
app.get('/api/predictions/live', (req, res) => {
    sendJsonWithFallback(res, 'live_predictions.json', 'predictions_may2026.json');
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
    try {
        const extraArgs = req.body && req.body.testStorm ? '--test-storm' : '';
        const startTime = Date.now();
        const result = await runLiveForecastScript(extraArgs);
        const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
        res.json({
            success: true,
            message: 'Live NWP forecast and patient surge refreshed successfully.',
            durationSeconds: parseFloat(durationSec),
            cachedAt: new Date().toISOString()
        });
    } catch (err) {
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
    try {
        const startTime = Date.now();
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
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

// ============================================================
// REST API ENDPOINT FOR ADB SMS ALERTS
// ============================================================

// app.post('/api/send-alert', async (req, res) => {
//     const { date, probability, dangerWindow } = req.body;
//     const smsText = `HEATWAVE ALERT (${date}): Risk ${(probability * 100).toFixed(0)}%. Danger window: ${dangerWindow}.`;

//     const results = [];
//     const errors = [];

//     for (const phone of RECIPIENTS) {
//         try {
//             await sendAdbSms(phone, smsText);
//             results.push(phone);
//             await sleep(1000); // 1-second delay between dispatches
//         } catch (err) {
//             console.error(`[ADB Error] Failed for ${phone}:`, err.message);
//             errors.push({ phone, error: err.message });
//         }
//     }

//     res.json({
//         success: errors.length === 0,
//         sentCount: results.length,
//         successfulNumbers: results,
//         failedCount: errors.length,
//         failures: errors
//     });
// });

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