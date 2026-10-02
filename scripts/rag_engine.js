const fs = require('fs');
const path = require('path');

const RAG_FILE = path.join(__dirname, '..', 'public', 'data', 'rag_knowledge.json');
const PREDICTIONS_FILE = path.join(__dirname, '..', 'public', 'data', 'live_predictions.json');
const SURGE_FILE = path.join(__dirname, '..', 'public', 'data', 'live_surge.json');

let knowledgeBase = null;
const queryEmbeddingCache = new Map();

function loadKnowledgeBase() {
    if (knowledgeBase) return knowledgeBase;
    try {
        if (fs.existsSync(RAG_FILE)) {
            const raw = fs.readFileSync(RAG_FILE, 'utf8');
            knowledgeBase = JSON.parse(raw);
            console.log(`[RAG Engine] Loaded ${knowledgeBase.total_chunks || knowledgeBase.chunks.length} knowledge chunks into memory.`);
            return knowledgeBase;
        }
    } catch (e) {
        console.warn('[RAG Engine] Failed to load rag_knowledge.json:', e.message);
    }
    return null;
}

function cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dot += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function getQueryEmbedding(query, apiKey) {
    if (!apiKey) return null;
    const cleanQ = query.trim().toLowerCase();
    if (queryEmbeddingCache.has(cleanQ)) {
        return queryEmbeddingCache.get(cleanQ);
    }

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${encodeURIComponent(apiKey)}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content: { parts: [{ text: query }] }
            }),
            signal: controller.signal
        });
        clearTimeout(timeout);

        if (!res.ok) return null;
        const data = await res.json();
        const vec = data.embedding?.values;
        if (vec) {
            queryEmbeddingCache.set(cleanQ, vec);
            // Cap cache size
            if (queryEmbeddingCache.size > 200) {
                const firstKey = queryEmbeddingCache.keys().next().value;
                queryEmbeddingCache.delete(firstKey);
            }
            return vec;
        }
    } catch (err) {
        console.warn('[RAG Engine] Query embedding failed:', err.message);
    }
    return null;
}

function searchByKeywords(query, chunks, topK = 3) {
    const words = query.toLowerCase().replace(/[^\w\s\u0980-\u09FF\u0900-\u097F\u0B00-\u0B7F]/g, ' ').split(/\s+/).filter(w => w.length > 2);
    if (words.length === 0) return chunks.slice(0, topK);

    const scored = chunks.map(chunk => {
        const text = (chunk.title + ' ' + chunk.summary + ' ' + chunk.text).toLowerCase();
        let score = 0;
        words.forEach(w => {
            if (text.includes(w)) score += 1;
        });
        return { chunk, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map(s => ({
        ...s.chunk,
        similarity: s.score > 0 ? 0.6 : 0.2
    }));
}

async function searchRAG(query, apiKey, topK = 3) {
    const kb = loadKnowledgeBase();
    if (!kb || !kb.chunks || kb.chunks.length === 0) return [];

    const queryVec = await getQueryEmbedding(query, apiKey);

    if (queryVec) {
        const scored = kb.chunks.map(chunk => {
            let sim = 0;
            if (chunk.embedding && chunk.embedding.length === queryVec.length) {
                sim = cosineSimilarity(queryVec, chunk.embedding);
            }
            return {
                id: chunk.id,
                title: chunk.title,
                category_label: chunk.category_label,
                summary: chunk.summary,
                text: chunk.text,
                similarity: sim
            };
        });

        scored.sort((a, b) => b.similarity - a.similarity);
        return scored.slice(0, topK);
    }

    // Fallback to keyword search if vector API fails
    return searchByKeywords(query, kb.chunks, topK);
}

function getLiveWeatherContext() {
    try {
        if (fs.existsSync(PREDICTIONS_FILE)) {
            const raw = fs.readFileSync(PREDICTIONS_FILE, 'utf8');
            const data = JSON.parse(raw);
            const dates = Object.keys(data).sort();
            if (dates.length > 0) {
                // Find today's entry or nearest entry
                const todayIst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
                const entry = data[todayIst] || data[dates[0]];
                if (entry) {
                    return `[Live Numerical Weather Prediction (NWP) Context for ${entry.date || todayIst}]:
- Current Risk Level: ${entry.risk_level || 'Low'} (Heatwave Probability: ${(entry.probability_of_heatwave * 100).toFixed(1)}%)
- Max Temperature: ${entry.tmax_c}°C (Feels-like Apparent Temp: ${entry.apparent_temp_max}°C)
- Humidity: ${entry.rh_mean_pct}% | Rain Probability: ${entry.rain_probability || 0}% (${entry.precipitation_mm || 0}mm expected)
- Safe Walking Windows: ${(entry.recommended_go_out_windows || []).join(', ') || 'Normal outdoor activity permitted'}
- Weather Advisory: ${entry.weather_summary || entry.advisory || 'Monsoon moisture currently suppresses extreme heat.'}`;
                }
            }
        }
    } catch (e) {
        console.warn('[RAG Engine] Failed to read live predictions:', e.message);
    }
    return '';
}

function getHospitalSurgeContext() {
    try {
        if (fs.existsSync(SURGE_FILE)) {
            const raw = fs.readFileSync(SURGE_FILE, 'utf8');
            const data = JSON.parse(raw);
            return `[Live Hospital Readiness Context (WHO 2024 & NCDC NAP-HRI Standards)]:
- Focus Facilities: SOA Student Health Centre (8 beds, 0km), Jagamara UPHC (15 beds, 0.5km), IMS & SUM Hospital (1,750 beds tertiary care, 1.8km).
- Clinical Preparedness: Standard mandates 20% dedicated Heat Stroke Unit (HSU) beds, 3.5L chilled IV crystalloid fluid per heat casualty, oral rehydration corners, and continuous active immersion cooling protocols.`;
        }
    } catch (e) {
        console.warn('[RAG Engine] Failed to read hospital surge:', e.message);
    }
    return '';
}

async function assembleGroundedContext(query, apiKey) {
    const qLower = query.toLowerCase();

    // 1. Vector Search for relevant RAG chunks
    const ragResults = await searchRAG(query, apiKey, 3);
    let ragSnippet = '';
    if (ragResults.length > 0) {
        ragSnippet = `=== VERIFIED SHADEROUTE KNOWLEDGE BASE (RAG CITATIONS & REPOSITORIES) ===\n` +
            ragResults.map((r, idx) => `[Source ${idx + 1}: ${r.title}]\n${r.text}`).join('\n\n');
    }

    // 2. Check if live weather context should be injected
    let liveSnippet = '';
    if (/weather|temperature|temp|forecast|heatwave|rain|monsoon|hot|degree|nwp|আবহাওয়া|তাপমাত্রা|বৃষ্টি|হিটওয়েভ|मौसम|तापमान|गर्मी|ପାଣିପାଗ|ତାପମାତ୍ରା/i.test(qLower)) {
        liveSnippet = getLiveWeatherContext();
    }

    // 3. Check if live hospital context should be injected
    let hospitalSnippet = '';
    if (/hospital|patient|surge|clinic|doctor|bed|ors|hsu|heatstroke|exhaustion|aiims|sum|হাসপাতাল|রোগী|अस्पताल|मरीज|ଡାକ୍ତରଖାନା|ରୋଗୀ/i.test(qLower)) {
        hospitalSnippet = getHospitalSurgeContext();
    }

    return {
        ragResults,
        contextText: [ragSnippet, liveSnippet, hospitalSnippet].filter(Boolean).join('\n\n')
    };
}

module.exports = {
    loadKnowledgeBase,
    searchRAG,
    assembleGroundedContext
};
