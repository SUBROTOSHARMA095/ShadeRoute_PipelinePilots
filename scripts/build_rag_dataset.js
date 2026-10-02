const fs = require('fs');
const path = require('path');

// Zero-dependency .env loader
const envFilePath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFilePath)) {
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
}

const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
if (!apiKey) {
    console.error('ERROR: GEMINI_API_KEY not found in .env');
    process.exit(1);
}

const PUBLIC_DATA_DIR = path.join(__dirname, '..', 'public', 'data');

async function getEmbedding(text) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            content: { parts: [{ text }] }
        })
    });
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Embedding API error ${res.status}: ${errText}`);
    }
    const data = await res.json();
    return data.embedding.values;
}

function buildKnowledgeChunks() {
    const chunks = [];

    // 1. Ingest scientific citations from public/data/scientific_citations.json
    const citationsPath = path.join(PUBLIC_DATA_DIR, 'scientific_citations.json');
    if (fs.existsSync(citationsPath)) {
        try {
            const citData = JSON.parse(fs.readFileSync(citationsPath, 'utf8'));
            if (Array.isArray(citData.citations)) {
                citData.citations.forEach(c => {
                    chunks.push({
                        id: `citation_${c.id}`,
                        title: c.title,
                        category: 'scientific_literature',
                        category_label: c.category_label || 'Scientific Citations',
                        summary: `${c.title} by ${c.authors} (${c.year}). ${c.implementation_role}`,
                        text: `[Scientific Source: ${c.title}]\nCategory: ${c.category_label || c.category}\nAuthors: ${c.authors} (${c.year})\nVenue: ${c.venue}\nRole in ShadeRoute: ${c.implementation_role}\nFormula/Mapping: ${c.formula_mapping || 'N/A'}\nAPA Citation: ${c.apa_citation}`
                    });
                });
            }
        } catch (e) {
            console.warn('Failed to parse scientific_citations.json:', e.message);
        }
    }

    // 2. Ingest healthcare facilities & hospitals from public/data/Hospitals.geojson
    const hospitalsPath = path.join(PUBLIC_DATA_DIR, 'Hospitals.geojson');
    if (fs.existsSync(hospitalsPath)) {
        try {
            const hospData = JSON.parse(fs.readFileSync(hospitalsPath, 'utf8'));
            if (Array.isArray(hospData.features)) {
                hospData.features.forEach(f => {
                    const p = f.properties;
                    if (p && p.name) {
                        chunks.push({
                            id: `hospital_${p.id || p.name.replace(/\s+/g, '_').toLowerCase()}`,
                            title: p.name,
                            category: 'healthcare_facilities',
                            category_label: 'Hospitals & Emergency Health Facilities',
                            summary: `${p.name} (${p.category || p.tier}), ${p.capacity_beds} beds, ${p.dist_from_iter_km} km from SOA ITER. ${p.role}`,
                            text: `[Healthcare Facility: ${p.name}]\nTier & Category: ${p.tier || 'N/A'} - ${p.category || 'N/A'}\nBed Capacity: ${p.capacity_beds} beds\nDistance from SOA ITER: ${p.dist_from_iter_km} km (Approx ${p.drive_time_min} mins drive)\nAddress: ${p.address || 'Bhubaneswar, Odisha'}\nClinical Role during Heatwaves: ${p.role}\nBaselines: OPD ~${p.baseline_opd}/day, Emergency ~${p.baseline_emergency}/day, Heat Illness ~${p.baseline_heat_illness}/day`
                        });
                    }
                });
            }
        } catch (e) {
            console.warn('Failed to parse Hospitals.geojson:', e.message);
        }
    }

    // 3. Core ShadeRoute Machine Learning Pipeline Architecture
    chunks.push({
        id: 'ml_heatwave_ensemble',
        title: 'ShadeRoute V2 Multi-Horizon ML Heatwave Ensemble Model',
        category: 'machine_learning_pipeline',
        category_label: 'ML Architecture',
        summary: 'Soft-voting ensemble of RandomForest and HistGradientBoosting predicting H0 nowcast to H3 lead times.',
        text: `[ShadeRoute Machine Learning: Heatwave Ensemble Model]\nArchitecture: Soft-voting ensemble combining class-weighted RandomForest (350 trees) and HistGradientBoosting (150 trees).\nLead Horizons: Same-day nowcast (H0), 1-day ahead (H1), 2-day ahead (H2), and 3-day ahead (H3) heatwave probability.\nInputs: Live Numerical Weather Prediction (NWP) feeds from ECMWF Integrated Forecasting System (IFS) and Open-Meteo, 7-day lagged biometeorological observation history, diurnal solar geometry, barometric pressure rate of change, and convective storm proxy (CAPE).\nPerformance: ROC-AUC 0.96-0.97, Accuracy ~95%, Brier score < 0.04 across 2025-2026 holdout verification.`
    });

    chunks.push({
        id: 'ml_priority_cooling_engine',
        title: 'Pedestrian Corridors Planting Priority & Misting Engine',
        category: 'cooling_interventions',
        category_label: 'Campus Cooling Interventions',
        summary: 'Priority engine placing up to 400 shade trees and 100 high-pressure mist sprayers along high-heat pedestrian paths.',
        text: `[ShadeRoute Campus Cooling Interventions: Trees & Mist Sprayers]\nScope: 10m x 10m high-resolution walkway grid connecting hostels, lecture halls, auditoriums, and cafeterias across the SOA ITER campus.\nShade Trees Intervention: Up to 400 shade trees placed at critical pedestrian corridors. Tree canopies intercept solar radiation and cool ground surface temperatures by up to ~4°C through natural leaf evapotranspiration.\nMist Sprayers Intervention: Up to 100 high-pressure evaporative mist nozzles placed along student corridors. Flash evaporation of micro-droplets absorbs ambient sensible heat, dropping perceived "feels-like" temperature by up to ~2°C.\nOptimization: Evaluates Land Surface Temperature (LST), Bare Soil Index (BSI), lack of canopy (NDVI deficit), and pedestrian walking density to pinpoint maximum-benefit locations.`
    });

    chunks.push({
        id: 'ml_hospital_surge_model',
        title: 'Hospital Patient Surge & Clinical Resource Readiness Model',
        category: 'clinical_epidemiology',
        category_label: 'Clinical Decision Support',
        summary: 'Evidence-based hospital surge forecasting calibrated to NCDC NAP-HRI 2024 and AIIMS emergency medicine protocols.',
        text: `[Hospital Surge & Clinical Readiness Model]\nMethodology: Epidemiology-grounded deterministic decision support calibrated for 4 healthcare facilities near SOA ITER (SOA Student Health Centre, IMS & SUM Hospital, AIIMS Bhubaneswar, AMRI Hospital).\nStandards: Grounded in NCDC National Action Plan on Heat-Related Illnesses (NAP-HRI 2024), AIIMS Emergency Medicine protocols, WHO heat-health guidance (2024), and Distributed Lag Non-Linear Models (DLNM).\nResource Allocation: Forecasts patient influx, dedicated Heat Stroke Units (HSUs, 20% of excess admissions), ORS solution packets, chilled IV crystalloid fluids (3.5L per patient), and emergency cooling beds.`
    });

    chunks.push({
        id: 'satellite_remote_sensing_specs',
        title: 'Satellite Remote Sensing & Multispectral Indices (10m Spatial Grid)',
        category: 'remote_sensing',
        category_label: 'Satellite Remote Sensing',
        summary: 'Ingests Landsat 8/9, Sentinel-2, and Sentinel-5P via Google Earth Engine for LST, NDVI, NDBI, NDWI, and BSI.',
        text: `[Satellite Remote Sensing Specifications]\nSpatial Grid: 10m x 10m grid covering SOA ITER campus and 3 km² neighborhood.\nSensors: Landsat 8/9 TIRS-2, Sentinel-2 MSI, and Sentinel-5P TROPOMI processed through Google Earth Engine (GEE).\nComputed Indices: Land Surface Temperature (LST), Normalized Difference Vegetation Index (NDVI, tree canopy), Normalized Difference Built-up Index (NDBI, concrete), Normalized Difference Water Index (NDWI, surface moisture), Bare Soil Index (BSI), and continuous vegetation fraction.`
    });

    chunks.push({
        id: 'imd_heat_risk_color_legend',
        title: 'IMD Heat Danger Alert Levels & Visual Map Color Legend',
        category: 'heat_hazard_classification',
        category_label: 'Heat Hazard Legend',
        summary: 'Five-tier IMD heat hazard color code: Red (Urgent Danger), Orange (High Concern), Yellow (Moderate), Green (Safe), Blue (Cool).',
        text: `[Map Colors & IMD Heat Danger Alert Levels]\nRed (🔴 Urgent Danger): Severe heat stress zones lacking tree shade with blistering ground surface heat (>54°C HI). Immediate planting or misting intervention needed.\nOrange (🟠 High Concern / Alert): Elevated thermal risk during afternoon peak hours (47-53°C HI). High risk of dehydration and heat exhaustion.\nYellow (🟡 Moderate Concern / Watch): Noticeable warmth (41-46°C HI); caution and adequate hydration advised.\nGreen (🟢 Safe / Normal): Comfortable ambient conditions (<40°C HI).\nBlue (🔵 Very Cool): Well-shaded canopy corridors, vegetated parks, or active evaporative misting zones.`
    });

    return chunks;
}

async function main() {
    console.log('--- BUILDING SHADEROUTE RAG KNOWLEDGE DATASET ---');
    const chunks = buildKnowledgeChunks();
    console.log(`Generated ${chunks.length} structured knowledge chunks.`);

    console.log('Generating embeddings via gemini-embedding-001...');
    const embeddedDataset = [];

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        process.stdout.write(`Embedding [${i + 1}/${chunks.length}] ${chunk.title.slice(0, 40)}... `);
        try {
            const vector = await getEmbedding(chunk.text);
            chunk.embedding = vector;
            embeddedDataset.push(chunk);
            console.log('✅ OK');
            // Small pause to be gentle on RPM
            await new Promise(r => setTimeout(r, 120));
        } catch (err) {
            console.error(`❌ FAILED: ${err.message}`);
            // Still keep chunk without embedding for keyword fallback
            chunk.embedding = null;
            embeddedDataset.push(chunk);
        }
    }

    const outputPath = path.join(PUBLIC_DATA_DIR, 'rag_knowledge.json');
    fs.writeFileSync(outputPath, JSON.stringify({
        generated_at: new Date().toISOString(),
        total_chunks: embeddedDataset.length,
        embedding_model: 'gemini-embedding-001',
        dimensions: embeddedDataset[0]?.embedding ? embeddedDataset[0].embedding.length : 0,
        chunks: embeddedDataset
    }, null, 2), 'utf8');

    console.log(`\n🎉 Success! RAG dataset saved to: ${outputPath}`);
}

main().catch(err => {
    console.error('Fatal error in build_rag_dataset:', err);
    process.exit(1);
});
