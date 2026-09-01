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

// Target recipient phone numbers for ADB SMS
const RECIPIENTS = [
    '+919876543210',
    '+919876543211',
    '+919876543212'
];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function sendAdbSms(phone, message) {
    const cleanMsg = message.replace(/"/g, '\\"');
    const cmd = `adb shell service call isms 7 i32 0 s16 "com.android.mms.service" s16 "null" s16 "${phone}" s16 "null" s16 "${cleanMsg}" s16 "null" s16 "null"`;
    return execPromise(cmd);
}

// ============================================================
// REST API ENDPOINTS (Serving files from ROOT/public/data)
// ============================================================

// 1. GET /api/predictions -> public/data/predictions_may2026.json
app.get('/api/predictions', (req, res) => {
    const filePath = path.join(PUBLIC_DATA_DIR, 'predictions_may2026.json');
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) return res.status(500).json({ error: 'Could not find public/data/predictions_may2026.json' });
        res.json(JSON.parse(data));
    });
});

// 2. GET /api/predictions/hourly -> public/data/hourly_predictions_may2026.json
app.get('/api/predictions/hourly', (req, res) => {
    const filePath = path.join(PUBLIC_DATA_DIR, 'hourly_predictions_may2026.json');
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) return res.status(500).json({ error: 'Could not find public/data/hourly_predictions_may2026.json' });
        res.json(JSON.parse(data));
    });
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
});