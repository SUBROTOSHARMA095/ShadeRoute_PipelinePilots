// ============================================================
// GLOBAL STATE & MAP INITIALIZATION
// ============================================================

let priorityData = [];
let treeRecommendationData = [];
let selectedGridCell = null;
let gridVisible = true;
let activeComicPopup = null;

// Track active location pointer markers so we can update/clear them
let treeMarkers = [];
let mistMarkers = [];
let campusBounds = null;

function updateKpiInterventions() {
    const kpi = document.getElementById('kpiInterventions');
    if (!kpi) return;
    const trees = treeMarkers ? treeMarkers.length : 0;
    const mist  = mistMarkers ? mistMarkers.length : 0;
    const total = trees + mist;
    kpi.textContent = `${total} Placed`;

    // Update the Before/After Cooling Impact Banner
    if (typeof window._updateCoolingBanner === 'function') {
        window._updateCoolingBanner(trees, mist);
    }
}

let lastZonesGeoJSON = null;

function updatePeakGroundHeatKpi(zonesGeoJSON, dateStr) {
    if (zonesGeoJSON) lastZonesGeoJSON = zonesGeoJSON;
    const activeGeoJSON = zonesGeoJSON || lastZonesGeoJSON;

    const kpi = document.getElementById('kpiPeakHeat');
    const label = document.getElementById('kpiPeakHeatLabel');
    const sublabel = document.getElementById('kpiPeakHeatSublabel');
    const coolingBefore = document.getElementById('coolingBeforeTemp');

    const isHeatStressMode = (currentMode === 'heatstress');

    // Find the daily peak HHSI (Heat Stress) and baseline LST (Ground Heat)
    let maxLST = 39.4;
    let maxHHSI = 0;
    if (activeGeoJSON && activeGeoJSON.features && activeGeoJSON.features.length) {
        for (let i = 0; i < activeGeoJSON.features.length; i++) {
            const props = activeGeoJSON.features[i].properties;
            if (!props) continue;
            const lst = props.LST;
            if (typeof lst === 'number' && lst > maxLST) {
                maxLST = lst;
            }
            const hhsi = props.HHSI_max || props.HI_IMD;
            if (typeof hhsi === 'number' && hhsi > maxHHSI) {
                maxHHSI = hhsi;
            }
        }
    }

    // Also check manifest for official date hhsi_max_overall
    const curDate = dateStr || currentHeatZoneDate;
    if (heatZoneManifest && heatZoneManifest.dates && curDate) {
        const mEntry = heatZoneManifest.dates.find(d => d.date === curDate);
        if (mEntry && mEntry.hhsi_max_overall) {
            maxHHSI = Math.max(maxHHSI, mEntry.hhsi_max_overall);
        }
    }

    window._currentBaseTemp = maxLST;

    const isToday = !curDate || (heatZoneManifest && curDate === heatZoneManifest.today);
    const dateLabel = isToday ? 'today' : curDate;

    if (isHeatStressMode && maxHHSI > 0) {
        if (label) label.textContent = 'Peak Heat Stress';
        if (kpi) {
            kpi.textContent = `${maxHHSI.toFixed(1)}°C`;
            kpi.className = 'kpi-value ' + (maxHHSI >= 54 ? 'purple' : maxHHSI >= 46 ? 'red' : 'amber');
        }
        if (sublabel) sublabel.textContent = `Hottest spot (${dateLabel})`;
    } else {
        if (label) label.textContent = 'Peak Ground Heat';
        if (kpi) {
            kpi.textContent = `${maxLST.toFixed(1)}°C`;
            kpi.className = 'kpi-value amber';
        }
        if (sublabel) sublabel.textContent = isToday ? 'Summer satellite baseline' : `Satellite baseline (${dateLabel})`;
    }

    if (coolingBefore) {
        coolingBefore.textContent = `${maxLST.toFixed(1)}°C`;
    }

    if (typeof window._updateCoolingBanner === 'function') {
        const trees = (typeof treeMarkers !== 'undefined' && treeMarkers) ? treeMarkers.length : 0;
        const mist  = (typeof mistMarkers !== 'undefined' && mistMarkers) ? mistMarkers.length : 0;
        window._updateCoolingBanner(trees, mist);
    }
}
window.updatePeakGroundHeatKpi = updatePeakGroundHeatKpi;

// --- Heat Risk Zones state ---
let heatZoneLegendData = null;   // parsed heat_zone_legend.json
let heatZonesVisible = false;    // layer starts hidden until user toggles it
let heatZoneManifest = null;     // parsed timeline/manifest.json (list of daily files)
let currentHeatZoneDate = null;  // ISO date string ('YYYY-MM-DD') currently displayed

// Mode State Tracker
let currentMode = 'intervention'; // Default mode: 'intervention' or 'heatstress'

function setAppMode(mode) {
    currentMode = mode;

    // Close zone detail panel on mode switch
    if (typeof closeHeatZoneDetail === 'function') closeHeatZoneDetail();

    // 1. Toggle Active Tab and Panel States
    const interventionBtn = document.getElementById('modeInterventionBtn');
    const heatStressBtn = document.getElementById('modeHeatStressBtn');
    const interventionContent = document.getElementById('interventionModeContent');
    const heatStressContent = document.getElementById('heatStressModeContent');

    if (interventionBtn && heatStressBtn && interventionContent && heatStressContent) {
        if (mode === 'intervention') {
            interventionBtn.classList.add('active');
            heatStressBtn.classList.remove('active');
            interventionContent.classList.add('active');
            heatStressContent.classList.remove('active');
        } else {
            heatStressBtn.classList.add('active');
            interventionBtn.classList.remove('active');
            heatStressContent.classList.add('active');
            interventionContent.classList.remove('active');
        }
    }

    // 2. Remove Open Map Popups
    if (typeof activeComicPopup !== 'undefined' && activeComicPopup) {
        activeComicPopup.remove();
    }

    // 3. Update Visible Layers on Map
    updateMapLayersForMode();

    // 4. Update KPI Card for the Active Mode
    if (typeof updatePeakGroundHeatKpi === 'function') {
        updatePeakGroundHeatKpi(lastZonesGeoJSON, currentHeatZoneDate);
    }
}

function updateMapLayersForMode() {
    if (typeof map === 'undefined') return;

    const isIntervention = currentMode === 'intervention';
    const isHeatStress = currentMode === 'heatstress';

    // Priority Grid Layers (Intervention Mode)
    if (map.getLayer && map.getLayer('priority-grid')) {
        map.setLayoutProperty('priority-grid', 'visibility', isIntervention ? 'visible' : 'none');
    }
    if (map.getLayer && map.getLayer('priority-grid-highlight')) {
        map.setLayoutProperty('priority-grid-highlight', 'visibility', isIntervention ? 'visible' : 'none');
    }

    // Recommended Map Markers (Intervention Mode)
    if (typeof treeMarkers !== 'undefined' && treeMarkers) {
        treeMarkers.forEach(marker => {
            const el = marker.getElement();
            if (el) el.style.display = isIntervention ? 'block' : 'none';
        });
    }
    if (typeof mistMarkers !== 'undefined' && mistMarkers) {
        mistMarkers.forEach(marker => {
            const el = marker.getElement();
            if (el) el.style.display = isIntervention ? 'block' : 'none';
        });
    }

    // Heat Risk Polygon Layers (Heat Stress Mode)
    if (map.getLayer && map.getLayer('heat-risk-zones-fill')) {
        map.setLayoutProperty('heat-risk-zones-fill', 'visibility', isHeatStress ? 'visible' : 'none');
    }
    if (map.getLayer && map.getLayer('heat-risk-zones-outline')) {
        map.setLayoutProperty('heat-risk-zones-outline', 'visibility', isHeatStress ? 'visible' : 'none');
    }
}

// Bind setAppMode directly to window so HTML inline onclick="setAppMode(...)" handlers can execute it
window.setAppMode = setAppMode;

const map = new maplibregl.Map({
    container: 'map',
    style: '/style.json'
});

// ============================================================
// MAP DATA LOADING
// ============================================================

map.on('load', () => {

    // 1. Campus GeoJSON
    fetch('/data/campus.geojson')
        .then(response => response.json())
        .then(data => {
            map.addSource('campus-data', {
                type: 'geojson',
                data: data
            });

            map.addLayer({
                id: 'campus-fill',
                type: 'fill',
                source: 'campus-data',
                paint: {
                    'fill-color': '#2f80ed',
                    'fill-opacity': 0
                }
            });

            map.addLayer({
                id: 'campus-outline',
                type: 'line',
                source: 'campus-data',
                filter: [
                    '==',
                    ['get', 'name'],
                    'SOA ITER CAMPUS 1'
                ],
                paint: {
                    'line-color': '#2f80ed',
                    'line-width': 0
                }
            });

            const bounds = new maplibregl.LngLatBounds();
            data.features.forEach(feature => {
                feature.geometry.coordinates[0].forEach(coordinate => {
                    bounds.extend(coordinate);
                });
            });

            campusBounds = bounds;
            map.fitBounds(bounds, { padding: 60 });
            //map.setMaxBounds(bounds);
        });

    // 2. Vegetation GeoJSON
    fetch('/data/vegetation.geojson')
        .then(response => response.json())
        .then(data => {
            map.addSource('vegetation-data', {
                type: 'geojson',
                data: data
            });

            map.addLayer({
                id: 'vegetation-fill',
                type: 'fill',
                source: 'vegetation-data',
                paint: {
                    'fill-color': '#22c55e',
                    'fill-opacity': 0.35
                }
            });
        });

    // 3. Roads GeoJSON
    fetch('/data/roads.geojson')
        .then(response => response.json())
        .then(data => {
            map.addSource('roads', {
                type: 'geojson',
                data: data
            });

            map.addLayer({
                id: 'roads-layer',
                type: 'line',
                source: 'roads',
                paint: {
                    'line-color': '#4A4E69',
                    'line-width': 3,
                    'line-opacity': 0.9
                }
            });
        })
        .catch(error => console.error('Error loading roads:', error));

    // 4. Paths GeoJSON
    fetch('/data/paths.geojson')
        .then(response => response.json())
        .then(data => {
            map.addSource('paths', {
                type: 'geojson',
                data: data
            });

            map.addLayer({
                id: 'paths-layer',
                type: 'line',
                source: 'paths',
                paint: {
                    'line-color': '#A65E2E',
                    'line-width': 2,
                    'line-opacity': 0.9
                }
            });
        })
        .catch(error => console.error('Error loading paths:', error));

    // 5. Buildings GeoJSON
    fetch('/data/missingBuildings.geojson')
        .then(response => response.json())
        .then(data => {
            map.addSource('buildings', {
                type: 'geojson',
                data: data
            });

            map.addLayer({
                id: 'buildings-fill',
                type: 'fill',
                source: 'buildings',
                paint: {
                    'fill-color': '#d9d0c9',
                    'fill-opacity': 0.75
                }
            });

            map.addLayer({
                id: 'buildings-outline',
                type: 'line',
                source: 'buildings',
                paint: {
                    'line-color': '#cabeb1',
                    'line-width': 1
                }
            });
        });

    // 6. ML Priority Grid CSVs
    Promise.all([
        fetch('/data/SOA_ITER_10m_Planting_Priority_2026.csv').then(res => res.text()),
        fetch('/data/tree_recommendations_250_2026.csv').then(res => res.text())
    ])
    .then(([priorityCSV, treeCSV]) => {
        priorityData = parseCSV(priorityCSV);
        treeRecommendationData = parseCSV(treeCSV);

        addPriorityGrid();
        addGridClickInteraction();
    })
    .catch(error => console.error("Could not load ML grid data:", error));

    // 7. Human WBGT Heat Stress Zones (GeoJSON polygons + legend JSON)
    loadHeatRiskZones();

    // 8. Medical Facility Markers (Campus Clinic & IMS & SUM Hospital)
    if (typeof initMedicalFacilityMarkers === 'function') {
        initMedicalFacilityMarkers();
    }
});

// ============================================================
// UI CONTROLS & EVENT LISTENERS
// ============================================================

document.addEventListener("DOMContentLoaded", function () {
    const menuBtn = document.getElementById("menuButton");
    const closeBtn = document.getElementById("closeSidebar");
    const sidebar = document.getElementById("sidebar");

    if (menuBtn && sidebar) {
        menuBtn.addEventListener("click", () => sidebar.classList.remove("collapsed"));
    }
    if (closeBtn && sidebar) {
        closeBtn.addEventListener("click", () => sidebar.classList.add("collapsed"));
    }

    const treeBtn = document.getElementById("recommendTreesBtn");
    const mistBtn = document.getElementById("recommendMistBtn");

    if (treeBtn) treeBtn.addEventListener("click", recommendTreeLocations);
    if (mistBtn) mistBtn.addEventListener("click", recommendMistSprayerLocations);

    // Clear Buttons
    const clearTreesBtn = document.getElementById("clearTreesBtn");
    const clearMistBtn = document.getElementById("clearMistBtn");
    const clearAllBtn = document.getElementById("clearAllInterventionsBtn");

    if (clearTreesBtn) clearTreesBtn.addEventListener("click", clearTrees);
    if (clearMistBtn) clearMistBtn.addEventListener("click", clearMist);
    if (clearAllBtn) clearAllBtn.addEventListener("click", clearAllInterventions);

    // Recenter Campus Button
    const recenterBtn = document.getElementById("recenterBtn");
    if (recenterBtn) {
        recenterBtn.addEventListener("click", () => {
            if (campusBounds) {
                map.fitBounds(campusBounds, { padding: 80, duration: 1000 });
                showMessage("Centered on SOA ITER Campus");
            } else {
                map.flyTo({ center: [85.8055, 20.2520], zoom: 16.5, duration: 1000 });
            }
        });
    }

    // "How It Works" Modal
    const howBtn = document.getElementById("howItWorksBtn");
    const modal = document.getElementById("howItWorksModal");
    const closeModalBtn = document.getElementById("closeModalBtn");
    const startSimBtn = document.getElementById("startSimModalBtn");

    function openModal() { if (modal) modal.classList.add("open"); }
    function closeModal() { if (modal) modal.classList.remove("open"); }

    if (howBtn) howBtn.addEventListener("click", openModal);
    if (closeModalBtn) closeModalBtn.addEventListener("click", closeModal);
    if (startSimBtn) {
        startSimBtn.addEventListener("click", () => {
            closeModal();
            if (sidebar) sidebar.classList.remove("collapsed");
        });
    }
    if (modal) {
        modal.addEventListener("click", (e) => {
            if (e.target === modal) closeModal();
        });
    }

    // Tree Slider <-> Input Sync
    const treeSlider = document.getElementById("treeSlider");
    const treeCount = document.getElementById("treeCount");
    if (treeSlider && treeCount) {
        treeSlider.addEventListener("input", () => {
            treeCount.value = treeSlider.value;
            syncPresetChips("tree", treeSlider.value);
        });
        treeCount.addEventListener("input", () => {
            treeSlider.value = treeCount.value;
            syncPresetChips("tree", treeCount.value);
        });
    }

    // Mist Slider <-> Input Sync
    const mistSlider = document.getElementById("mistSlider");
    const mistCount = document.getElementById("mistSprayerCount");
    if (mistSlider && mistCount) {
        mistSlider.addEventListener("input", () => {
            mistCount.value = mistSlider.value;
            syncPresetChips("mist", mistSlider.value);
        });
        mistCount.addEventListener("input", () => {
            mistSlider.value = mistCount.value;
            syncPresetChips("mist", mistCount.value);
        });
    }

    // Quick Preset Chips Click Handlers
    document.querySelectorAll("[data-preset]").forEach(chip => {
        chip.addEventListener("click", () => {
            const type = chip.getAttribute("data-preset");
            const val = chip.getAttribute("data-value");
            if (type === "tree" && treeCount && treeSlider) {
                treeCount.value = val;
                treeSlider.value = val;
                syncPresetChips("tree", val);
            } else if (type === "mist" && mistCount && mistSlider) {
                mistCount.value = val;
                mistSlider.value = val;
                syncPresetChips("mist", val);
            }
        });
    });

    function syncPresetChips(type, val) {
        document.querySelectorAll(`[data-preset="${type}"]`).forEach(c => {
            if (c.getAttribute("data-value") === String(val)) {
                c.classList.add("active");
            } else {
                c.classList.remove("active");
            }
        });
    }
});

const mapControls = document.querySelectorAll(".map-control");
if (mapControls.length >= 2) {
    mapControls[0].addEventListener("click", function () {
        map.zoomIn();
        showMessage("Zoom: " + Math.round(map.getZoom()));
    });

    mapControls[1].addEventListener("click", function () {
        map.zoomOut();
        showMessage("Zoom: " + Math.round(map.getZoom()));
    });
}

const northButton = document.getElementById("northButton");
const compassArrow = document.getElementById("compassArrow");

if (northButton) {
    northButton.addEventListener("click", function () {
        map.resetNorth();
        showMessage("Map reset to north");
    });
}

map.on("rotate", function () {
    if (compassArrow) {
        compassArrow.style.transform = "rotate(" + (-map.getBearing()) + "deg)";
    }
});

// ============================================================
// LOCATION PIN CREATOR HELPER
// ============================================================

function createLocationPin(type) {
    const el = document.createElement('div');
    el.className = 'custom-location-pointer';

    const isTree = type === 'tree';
    const pinColor = isTree ? '#059669' : '#0284c7';
    const icon = isTree ? '🌳' : '💧';

    el.innerHTML = `
        <div style="
            position: relative;
            width: 28px;
            height: 34px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            filter: drop-shadow(0px 3px 6px rgba(15, 23, 42, 0.22));
            transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        ">
            <svg width="28" height="34" viewBox="0 0 24 30" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 0C5.37 0 0 5.37 0 12C0 21 12 30 12 30C12 30 24 21 24 12C24 5.37 18.63 0 12 0Z" fill="${pinColor}" stroke="#ffffff" stroke-width="2"/>
                <circle cx="12" cy="11" r="7" fill="#ffffff"/>
            </svg>
            <span style="position: absolute; top: 3.5px; font-size: 10px;">${icon}</span>
        </div>
    `;

    el.addEventListener('mouseenter', () => el.firstElementChild.style.transform = 'scale(1.25) translateY(-2px)');
    el.addEventListener('mouseleave', () => el.firstElementChild.style.transform = 'scale(1) translateY(0)');

    return el;
}

// ============================================================
// CSV PARSER
// ============================================================

function parseCSV(text) {
    const lines = text.trim().split(/\r?\n/);
    const headers = lines[0].split(',').map(header => header.trim());

    return lines.slice(1).map(line => {
        const values = line.split(',');
        const row = {};
        headers.forEach((header, index) => {
            row[header] = values[index];
        });
        return row;
    });
}

// ============================================================
// NOTIFICATION TOAST
// ============================================================

function showMessage(message) {
    let notification = document.getElementById("appNotification");

    if (!notification) {
        notification = document.createElement("div");
        notification.id = "appNotification";
        notification.style.cssText = `
            position: fixed;
            left: 50%;
            bottom: 25px;
            transform: translateX(-50%);
            z-index: 300;
            padding: 10px 16px;
            border-radius: 10px;
            background: rgba(7,17,15,.95);
            border: 1px solid rgba(255,255,255,.1);
            color: #edf7f2;
            font-size: 11px;
            box-shadow: 0 10px 30px rgba(0,0,0,.35);
        `;
        document.body.appendChild(notification);
    }

    notification.textContent = message;
    clearTimeout(notification.timer);
    notification.timer = setTimeout(() => notification.remove(), 2000);
}

// ============================================================
// ADD PRIORITY GRID LAYER
// ============================================================

function addPriorityGrid() {
    if (map.getSource('priority-grid')) return;

    const features = priorityData.map((cell, index) => ({
        type: 'Feature',
        geometry: {
            type: 'Point',
            coordinates: [Number(cell.longitude), Number(cell.latitude)]
        },
        properties: {
            index: index,
            longitude: Number(cell.longitude),
            latitude: Number(cell.latitude),
            NDVI: Number(cell.NDVI),
            NDBI: Number(cell.NDBI),
            BSI: Number(cell.BSI),
            NDWI: Number(cell.NDWI),
            LST: Number(cell.LST),
            vegetation_fraction: Number(cell.vegetation_fraction),
            priority_score: Number(cell.priority_score),
            priority_class: cell.priority_class,
            intervention_type: cell.intervention_type,
            recommendation: cell.recommendation
        }
    }));

    map.addSource('priority-grid', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: features }
    });

    map.addLayer({
        id: 'priority-grid',
        type: 'circle',
        source: 'priority-grid',
        paint: {
            'circle-radius': 6,
            'circle-color': [
                'case',
                ['==', ['get', 'intervention_type'], 'Mist Sprayer'], '#00ffff',
                ['match', ['get', 'priority_class'],
                    'Very High', '#dc2626',
                    'High',      '#f97316',
                    'Moderate',  '#facc15',
                    'Low',       '#10b981',
                    'Very Low',  '#3b82f6',
                    '#9ca3af'
                ]
            ],
            'circle-opacity': 0.9,
            'circle-stroke-width': 1,
            'circle-stroke-color': '#000000'
        }
    });

    map.addSource('selected-grid-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
    });

    map.addLayer({
        id: 'priority-grid-highlight',
        type: 'circle',
        source: 'selected-grid-source',
        paint: {
            'circle-radius': 11,
            'circle-color': 'transparent',
            'circle-stroke-width': 3.5,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-opacity': 1
        }
    });
}

// ============================================================
// GRID INTERACTION & COMIC DIALOGUE CLOUD POPUP
// ============================================================

function addGridClickInteraction() {
    map.on('click', 'priority-grid', function (event) {
        if (!event.features || !event.features.length) return;

        const clickedFeature = event.features[0];
        const cell = clickedFeature.properties;
        const coordinates = event.lngLat;

        selectedGridCell = cell;

        if (activeComicPopup) {
            activeComicPopup.remove();
        }

        let badgeBg = '#f59e0b';
        let badgeColor = '#ffffff';
        if (cell.intervention_type === 'Mist Sprayer') { badgeBg = '#00ffff'; badgeColor = '#0f172a'; }
        else if (cell.priority_class === 'Very High') { badgeBg = '#dc2626'; }
        else if (cell.priority_class === 'High') { badgeBg = '#ea580c'; }
        else if (cell.priority_class === 'Low') { badgeBg = '#059669'; }
        else if (cell.priority_class === 'Very Low') { badgeBg = '#3b82f6'; }

        const popupHTML = `
            <div style="font-family: 'Plus Jakarta Sans', 'Inter', sans-serif; color: #0f172a; line-height: 1.4; padding: 2px;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; padding-right: 18px;">
                    <span style="background: ${badgeBg}; color: ${badgeColor}; font-size: 10.5px; font-weight: 800; padding: 3px 8px; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.04em;">
                        ${cell.intervention_type || cell.priority_class + ' Urgency'}
                    </span>
                    <span style="font-size: 11.5px; font-weight: 800; color: #d97706;">
                        Score: ${Number(cell.priority_score).toFixed(1)} / 100
                    </span>
                </div>

                <div style="font-size: 14px; font-weight: 800; color: #0f172a; margin-bottom: 8px;">
                    ${cell.priority_class} Cooling Urgency
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 8px;">
                    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px 8px;">
                        <div style="font-size: 9.5px; color: #64748b; font-weight: 700; text-transform: uppercase;">Ground Heat (LST)</div>
                        <div style="font-size: 13px; font-weight: 800; color: #dc2626;">${Number(cell.LST).toFixed(1)}°C</div>
                    </div>
                    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px 8px;">
                        <div style="font-size: 9.5px; color: #64748b; font-weight: 700; text-transform: uppercase;">Tree Cover (Veg)</div>
                        <div style="font-size: 13px; font-weight: 800; color: #059669;">${(Number(cell.vegetation_fraction) * 100).toFixed(0)}%</div>
                    </div>
                    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px 8px;">
                        <div style="font-size: 9.5px; color: #64748b; font-weight: 700; text-transform: uppercase;">Plant Health (NDVI)</div>
                        <div style="font-size: 12px; font-weight: 800; color: #0f172a;">${Number(cell.NDVI).toFixed(2)}</div>
                    </div>
                    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px 8px;">
                        <div style="font-size: 9.5px; color: #64748b; font-weight: 700; text-transform: uppercase;">Concrete (NDBI)</div>
                        <div style="font-size: 12px; font-weight: 800; color: #0f172a;">${Number(cell.NDBI).toFixed(2)}</div>
                    </div>
                    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px 8px;">
                        <div style="font-size: 9.5px; color: #64748b; font-weight: 700; text-transform: uppercase;">Bare Soil (BSI)</div>
                        <div style="font-size: 12px; font-weight: 800; color: #0f172a;">${Number(cell.BSI).toFixed(2)}</div>
                    </div>
                    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px 8px;">
                        <div style="font-size: 9.5px; color: #64748b; font-weight: 700; text-transform: uppercase;">Moisture (NDWI)</div>
                        <div style="font-size: 12px; font-weight: 800; color: #0f172a;">${Number(cell.NDWI).toFixed(2)}</div>
                    </div>
                </div>

                <div style="background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; padding: 8px 10px; font-size: 11.5px; color: #065f46; font-weight: 600; line-height: 1.4; margin-bottom: 6px;">
                    💡 <strong>AI Recommendation:</strong> ${cell.recommendation || 'Plant shade trees to lower surface heat absorption.'}
                </div>

                <div style="font-size: 9.5px; color: #94a3b8; text-align: right;">
                    📍 Lat: ${Number(cell.latitude).toFixed(5)}, Lon: ${Number(cell.longitude).toFixed(5)}
                </div>
            </div>
        `;

        const PopupClass = window.maplibregl ? maplibregl.Popup : mapboxgl.Popup;

        activeComicPopup = new PopupClass({
            className: 'comic-popup',
            closeButton: true,
            closeOnClick: false,
            offset: 12
        })
            .setLngLat(coordinates)
            .setHTML(popupHTML)
            .addTo(map);

        if (map.getSource('selected-grid-source')) {
            map.getSource('selected-grid-source').setData({
                type: 'FeatureCollection',
                features: [clickedFeature]
            });
        }
    });

    map.on('mouseenter', 'priority-grid', () => {
        map.getCanvas().style.cursor = 'pointer';
    });

    map.on('mouseleave', 'priority-grid', () => {
        map.getCanvas().style.cursor = '';
    });
}

// ============================================================
// SCENARIO 1: TREE PLANTING RECOMMENDATION (PIN MARKERS)
// ============================================================

function recommendTreeLocations() {
    const input = document.getElementById('treeCount');
    const count = input ? parseInt(input.value) : 250;

    if (!count || count <= 0) {
        showMessage('Enter a valid number of trees');
        return;
    }

    const treeCandidates = priorityData.filter(
        cell => cell.intervention_type === 'Tree Planting'
    );

    const recommendations = treeCandidates
        .slice()
        .sort((a, b) => Number(b.priority_score) - Number(a.priority_score))
        .slice(0, count);

    treeMarkers.forEach(m => m.remove());
    treeMarkers = [];

    recommendations.forEach(cell => {
        const pinEl = createLocationPin('tree');
        const marker = new maplibregl.Marker({ element: pinEl, anchor: 'bottom' })
            .setLngLat([Number(cell.longitude), Number(cell.latitude)])
            .addTo(map);

        treeMarkers.push(marker);
    });

    updateKpiInterventions();
    showMessage(`${recommendations.length} shade trees placed at priority hotspots`);
}

// ============================================================
// SCENARIO 2: MIST SPRAYER RECOMMENDATION (PIN MARKERS)
// ============================================================

function getDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function selectEvenlyDistributedSprayers(candidates, requestedCount) {
    if (candidates.length <= requestedCount) return candidates;

    const sorted = candidates.slice().sort(
        (a, b) => Number(b.priority_score) - Number(a.priority_score)
    );

    let minDistanceMeters = 40;
    let selected = [];

    while (minDistanceMeters > 5 && selected.length < requestedCount) {
        selected = [];
        for (const point of sorted) {
            const isFarEnough = selected.every(p =>
                getDistanceMeters(
                    Number(p.latitude), Number(p.longitude),
                    Number(point.latitude), Number(point.longitude)
                ) >= minDistanceMeters
            );

            if (isFarEnough) {
                selected.push(point);
                if (selected.length === requestedCount) break;
            }
        }
        minDistanceMeters -= 4;
    }

    if (selected.length < requestedCount) {
        for (const point of sorted) {
            if (!selected.includes(point)) {
                selected.push(point);
                if (selected.length === requestedCount) break;
            }
        }
    }

    return selected;
}

function recommendMistSprayerLocations() {
    const input = document.getElementById('mistSprayerCount');
    const count = input ? parseInt(input.value) : 50;

    if (!count || count <= 0) {
        showMessage('Enter a valid number of mist sprayers');
        return;
    }

    const pathCandidates = priorityData.filter(
        cell => cell.intervention_type === 'Mist Sprayer'
    );

    if (pathCandidates.length === 0) {
        showMessage('No path locations found for mist sprayers');
        return;
    }

    const recommendations = selectEvenlyDistributedSprayers(pathCandidates, count);

    mistMarkers.forEach(m => m.remove());
    mistMarkers = [];

    recommendations.forEach(cell => {
        const pinEl = createLocationPin('mist');
        const marker = new maplibregl.Marker({ element: pinEl, anchor: 'bottom' })
            .setLngLat([Number(cell.longitude), Number(cell.latitude)])
            .addTo(map);

        mistMarkers.push(marker);
    });

    updateKpiInterventions();
    showMessage(`${recommendations.length} mist sprayers placed along student walkways`);
}

function clearTrees() {
    treeMarkers.forEach(m => m.remove());
    treeMarkers = [];
    updateKpiInterventions();
    showMessage('Tree pins removed from map');
}

function clearMist() {
    mistMarkers.forEach(m => m.remove());
    mistMarkers = [];
    updateKpiInterventions();
    showMessage('Mist sprayer pins removed from map');
}

function clearAllInterventions() {
    treeMarkers.forEach(m => m.remove());
    treeMarkers = [];
    mistMarkers.forEach(m => m.remove());
    mistMarkers = [];
    updateKpiInterventions();
    showMessage('All simulated items cleared from map');
}

window.clearTrees = clearTrees;
window.clearMist = clearMist;
window.clearAllInterventions = clearAllInterventions;

// ============================================================
// SCENARIO 3: HUMAN THERMAL STRESS (IMD HEAT INDEX ZONES)
// ============================================================

const HEAT_ZONE_COLORS = {
    'Extreme Danger': '#8e44ad',    // Severe Danger (≥ 55°C)
    'Danger': '#e74c3c',            // Heatstroke Likely (46 - 54°C)
    'Extreme Caution': '#e67e22',    // Heat Exhaustion (41 - 45°C)
    'Caution': '#f1c40f',            // Fatigue Warning (35 - 40°C)
    'Normal / Safe': '#2ecc71'       // Safe Conditions (< 35°C)
};

const VULNERABILITY_COLORS = {
    'Low': '#2ecc71',
    'Moderate': '#f1c40f',
    'High': '#e74c3c'
};

const OVERALL_RISK_STYLE = {
    'Critical': { emoji: '🔴', color: '#8e44ad' },
    'High': { emoji: '🟠', color: '#e74c3c' },
    'Moderate': { emoji: '🟡', color: '#f1c40f' },
    'Low': { emoji: '🟢', color: '#2ecc71' }
};

// Fallback metadata so sidebar legend works even if heat_zone_legend.json isn't loaded
const DEFAULT_IMD_LEGEND = {
    zones: {
        'Extreme Danger': {
            summary: 'Heat Index ≥ 55°C. Heatstroke highly likely with continued exposure.',
            advisory: ['Avoid all outdoor exertion', 'Stay in shaded/air-conditioned spaces']
        },
        'Danger': {
            summary: 'Heat Index 46°C – 54°C. Severe heat exhaustion & heat cramps likely.',
            advisory: ['Limit exposure to early morning', 'Maintain high fluid intake']
        },
        'Extreme Caution': {
            summary: 'Heat Index 41°C – 45°C. Heat exhaustion possible with prolonged activity.',
            advisory: ['Take frequent shaded breaks', 'Drink water regularly']
        },
        'Caution': {
            summary: 'Heat Index 35°C – 40°C. Fatigue possible with prolonged exposure.',
            advisory: ['Wear lightweight clothing', 'Stay hydrated']
        },
        'Normal / Safe': {
            summary: 'Heat Index < 35°C. Safe environmental thermal conditions.',
            advisory: ['Standard outdoor thermal comfort']
        }
    }
};

function loadHeatRiskZones() {
    Promise.all([
        fetch('/data/timeline/manifest.json').then(res => res.json()).catch(() => null),
        fetch('/data/heat_zone_legend.json').then(res => res.json()).catch(() => null)
    ])
        .then(([manifest, legendJSON]) => {
            heatZoneLegendData = (legendJSON && legendJSON.zones && legendJSON.zones['Extreme Danger'])
                ? legendJSON
                : DEFAULT_IMD_LEGEND;

            heatZoneManifest = manifest;

            // Default to "today" (May 12) from the manifest. If the manifest
            // itself isn't there (timeline not generated yet), fall back to
            // the plain heat_risk_zones.geojson alias so the layer still works.
            let defaultFile = '/data/heat_risk_zones.geojson';
            let defaultDate = null;
            if (manifest && manifest.dates && manifest.dates.length) {
                defaultDate = manifest.today;
                const entry = manifest.dates.find(d => d.date === defaultDate) || manifest.dates[manifest.dates.length - 1];
                defaultFile = `/data/${entry.file}`;
                defaultDate = entry.date;
            }

            return fetch(defaultFile)
                .then(res => res.json())
                .then(zonesGeoJSON => {
                    currentHeatZoneDate = defaultDate;
                    initHeatZoneLayers(zonesGeoJSON);
                    buildHeatZoneDatePicker();
                    updatePeakGroundHeatKpi(zonesGeoJSON, defaultDate);
                });
        })
        .catch(error => console.error('Could not load heat risk zone data:', error));
}

function initHeatZoneLayers(zonesGeoJSON) {
    if (!map.getSource('heat-risk-zones')) {
        map.addSource('heat-risk-zones', {
            type: 'geojson',
            data: zonesGeoJSON
        });
    } else {
        map.getSource('heat-risk-zones').setData(zonesGeoJSON);
    }

    const isHeatStress = currentMode === 'heatstress';

    if (!map.getLayer('heat-risk-zones-fill')) {
        map.addLayer({
            id: 'heat-risk-zones-fill',
            type: 'fill',
            source: 'heat-risk-zones',
            layout: {
                visibility: isHeatStress ? 'visible' : 'none'
            },
            paint: {
                'fill-color': [
                    'match', ['get', 'hhsi_class'],
                    'Extreme Danger', HEAT_ZONE_COLORS['Extreme Danger'],
                    'Danger', HEAT_ZONE_COLORS['Danger'],
                    'Extreme Caution', HEAT_ZONE_COLORS['Extreme Caution'],
                    'Caution', HEAT_ZONE_COLORS['Caution'],
                    'Normal / Safe', HEAT_ZONE_COLORS['Normal / Safe'],
                    '#9ca3af'
                ],
                'fill-opacity': 0.55
            }
        });

        map.addLayer({
            id: 'heat-risk-zones-outline',
            type: 'line',
            source: 'heat-risk-zones',
            layout: {
                visibility: isHeatStress ? 'visible' : 'none'
            },
            paint: {
                'line-color': '#000000',
                'line-width': 1,
                'line-opacity': 0.3
            }
        });

        addHeatZoneClickInteraction();
    }

    // Force map layer visibility to sync with the current active mode after load
    updateMapLayersForMode();

    heatZonesVisible = true;
    const toggleBtn = document.getElementById('toggleHeatZonesBtn');
    if (toggleBtn) toggleBtn.classList.add('active');

    populateHeatZoneLegendPanel();
}

// Simple date dropdown for the Mar 1 - May 12 2026 timeline. Reads the
// dates straight from manifest.json rather than hardcoding a range, so it
// stays correct if the model is re-run with a different window later.
function switchHeatZoneDate(dateStr) {
    if (!heatZoneManifest || !heatZoneManifest.dates || !heatZoneManifest.dates.length) return;
    const entry = heatZoneManifest.dates.find(d => d.date === dateStr);
    if (!entry) return;

    const select = document.getElementById('heatZoneDateSelect');
    if (select && select.value !== dateStr) {
        select.value = dateStr;
    }

    fetch(`/data/${entry.file}`)
        .then(res => res.json())
        .then(zonesGeoJSON => {
            currentHeatZoneDate = entry.date;
            if (map && map.getSource('heat-risk-zones')) {
                map.getSource('heat-risk-zones').setData(zonesGeoJSON);
            }
            updatePeakGroundHeatKpi(zonesGeoJSON, entry.date);
            if (typeof showMessage === 'function') {
                const hhsiTxt = entry.hhsi_max_overall ? ` (Max HHSI: ${entry.hhsi_max_overall}°C)` : '';
                showMessage(`Showing thermal stress for ${entry.date}${hhsiTxt}`);
            }
        })
        .catch(error => console.error(`Could not load heat risk data for ${entry.date}:`, error));

    // Also sync the floating prediction card if this date is present in predictions
    if (predictionsSummaryData && predictionsSummaryData[dateStr] && activePredictionDate !== dateStr) {
        activePredictionDate = dateStr;
        if (typeof renderPredictionWidget === 'function') {
            renderPredictionWidget();
        }
    }
}
window.switchHeatZoneDate = switchHeatZoneDate;

// Date dropdown for the dynamic satellite-backed timeline.
function buildHeatZoneDatePicker() {
    if (!heatZoneManifest || !heatZoneManifest.dates || !heatZoneManifest.dates.length) return;

    let select = document.getElementById('heatZoneDateSelect');
    if (!select) {
        select = document.createElement('select');
        select.id = 'heatZoneDateSelect';
        select.style.cssText = `
            font-family: 'Plus Jakarta Sans', Inter, sans-serif;
            font-weight: 700;
            font-size: 11px;
            padding: 5px 9px;
            border: 1px solid var(--border);
            border-radius: 6px;
            background: #ffffff;
            color: #0f172a;
            cursor: pointer;
            box-shadow: 0 1px 3px rgba(0,0,0,0.06);
            max-width: 175px;
        `;

        const container = document.getElementById('datePickerContainer');
        if (container) {
            container.innerHTML = '';
            container.appendChild(select);
        }

        select.addEventListener('change', () => {
            switchHeatZoneDate(select.value);
        });
    }

    select.innerHTML = heatZoneManifest.dates.map(d => {
        let label = d.date;
        if (d.date === heatZoneManifest.today) {
            label = `${d.date} (Today / Live)`;
        } else if (d.date > heatZoneManifest.today) {
            const diffDays = Math.round((new Date(d.date) - new Date(heatZoneManifest.today)) / (86400000));
            label = `${d.date} (+${diffDays}d Forecast)`;
        }
        return `<option value="${d.date}">${label}</option>`;
    }).join('');

    select.value = currentHeatZoneDate || heatZoneManifest.today;
}

let isSyncingTimeline = false;
async function triggerTimelineSync() {
    if (isSyncingTimeline) return;
    isSyncingTimeline = true;

    const btns = [
        document.getElementById('syncTimelineBtn'),
        document.getElementById('syncTimelineBtnRight')
    ].filter(Boolean);

    btns.forEach(b => {
        b.dataset.origHtml = b.innerHTML;
        b.innerHTML = '<span>⏳ Syncing...</span>';
        b.disabled = true;
    });

    if (typeof showMessage === 'function') {
        showMessage('📡 Fetching dynamic satellite & NWP data to expand timeline...');
    }

    try {
        const resp = await fetch('/api/timeline/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await resp.json();
        if (!resp.ok || !data.success) {
            throw new Error(data.error || 'Timeline synchronization failed');
        }

        if (typeof showMessage === 'function') {
            showMessage(`✓ Heat risk mapping updated! Total dates: ${data.totalDates} (${data.durationSeconds}s)`);
        }

        // Reload manifest and refresh layers
        const manifestRes = await fetch('/data/timeline/manifest.json?t=' + Date.now());
        if (manifestRes.ok) {
            heatZoneManifest = await manifestRes.json();
            buildHeatZoneDatePicker();
            if (heatZoneManifest.today) {
                switchHeatZoneDate(heatZoneManifest.today);
            }
        }
        // Refresh forecast widget
        if (typeof loadRightPredictionWidget === 'function') {
            await loadRightPredictionWidget();
        }
    } catch (err) {
        console.error('[Timeline Sync Error]:', err);
        alert('Failed to sync timeline: ' + err.message);
    } finally {
        isSyncingTimeline = false;
        btns.forEach(b => {
            if (b.dataset.origHtml) b.innerHTML = b.dataset.origHtml;
            b.disabled = false;
        });
    }
}
window.triggerTimelineSync = triggerTimelineSync;

// Tracks a marker placed on the clicked heat zone
let heatZoneHighlightMarker = null;

function closeHeatZoneDetail() {
    const panel = document.getElementById('heatZoneDetailPanel');
    if (panel) { panel.style.display = 'none'; }
    if (heatZoneHighlightMarker) {
        heatZoneHighlightMarker.remove();
        heatZoneHighlightMarker = null;
    }
    if (activeComicPopup) { activeComicPopup.remove(); activeComicPopup = null; }
    // Restore the prediction widget
    const predCard = document.getElementById('rightPredictionCard');
    if (predCard && predCard.innerHTML.trim() !== '') predCard.style.display = '';
}
window.closeHeatZoneDetail = closeHeatZoneDetail;

function addHeatZoneClickInteraction() {
    map.on('click', 'heat-risk-zones-fill', function (event) {
        if (!event.features || !event.features.length) return;

        const feature = event.features[0];
        const props = feature.properties;
        const coordinates = event.lngLat;

        // Remove any previous popup (we now use the side panel)
        if (activeComicPopup) { activeComicPopup.remove(); activeComicPopup = null; }

        const hhsiClass = props.hhsi_class || 'Normal / Safe';
        const badgeBg = HEAT_ZONE_COLORS[hhsiClass] || '#9ca3af';
        const classInfo = heatZoneLegendData && heatZoneLegendData.zones
            ? heatZoneLegendData.zones[hhsiClass]
            : null;

        const THERMAL_RISK_LABEL = {
            'Extreme Danger': '🔴 Extreme Danger',
            'Danger': '🟠 Danger',
            'Extreme Caution': '🟡 Extreme Caution',
            'Caution': '🟡 Caution',
            'Normal / Safe': '🟢 Safe'
        };
        const thermalRiskLabel = THERMAL_RISK_LABEL[hhsiClass] || hhsiClass;
        const fmt = (v, unit = '', digits = null) =>
            v != null ? `${digits != null ? Number(v).toFixed(digits) : v}${unit}` : 'N/A';

        // ── Place an elegant location pin marker on the clicked point ──
        if (heatZoneHighlightMarker) heatZoneHighlightMarker.remove();
        const markerEl = document.createElement('div');
        markerEl.className = 'zone-location-marker';
        markerEl.innerHTML = `
            <div style="
                width: 28px;
                height: 38px;
                filter: drop-shadow(0 4px 8px rgba(15,23,42,0.3));
                animation: markerDropIn 0.25s cubic-bezier(0.16,1,0.3,1);
                pointer-events: none;
            ">
                <svg width="28" height="38" viewBox="0 0 28 38" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M14 0C6.26801 0 0 6.26801 0 14C0 23.8 12.3 36.8 12.8 37.4C13.4 38 14.6 38 15.2 37.4C15.7 36.8 28 23.8 28 14C28 6.26801 21.732 0 14 0Z" fill="#0f172a"/>
                    <circle cx="14" cy="13.5" r="6.5" fill="#ffffff"/>
                    <circle cx="14" cy="13.5" r="4" fill="${badgeBg}"/>
                </svg>
            </div>
        `;
        const MaplibreMarker = window.maplibregl ? maplibregl.Marker : mapboxgl.Marker;
        heatZoneHighlightMarker = new MaplibreMarker({ element: markerEl, anchor: 'bottom' })
            .setLngLat(coordinates)
            .addTo(map);

        // ── Build the advisory list ──
        const advisoryListHTML = (classInfo && classInfo.advisory)
            ? classInfo.advisory.map(line => `
                <div style="display:flex;align-items:flex-start;gap:7px;font-size:12px;color:#334155;margin-bottom:5px;">
                    <span style="color:#d97706;font-weight:800;flex-shrink:0;margin-top:1px;">⚠</span>
                    <span>${line}</span>
                </div>`).join('')
            : '<div style="color:#64748b;font-size:12px;">No advisory data.</div>';

        // ── Stat card helper ──
        const statCard = (icon, label, value, color) => `
            <div style="
                background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:10px;
                padding:10px 12px;display:flex;flex-direction:column;gap:2px;
            ">
                <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.04em;">${icon} ${label}</div>
                <div style="font-size:15px;font-weight:800;color:${color || '#0f172a'};">${value}</div>
            </div>
        `;

        // ── Populate the panel ──
        const panel = document.getElementById('heatZoneDetailPanel');
        const titleEl = document.getElementById('heatZoneDetailTitle');
        const badgeEl = document.getElementById('heatZoneDetailBadge');
        const bodyEl  = document.getElementById('heatZoneDetailBody');
        if (!panel || !titleEl || !badgeEl || !bodyEl) return;

        titleEl.textContent = `Zone ${props.sector_id || '?'}`;
        badgeEl.innerHTML = `<span style="
            display:inline-block;background:${badgeBg};color:#fff;
            font-size:11px;font-weight:800;padding:3px 10px;
            border-radius:99px;letter-spacing:0.04em;
        ">${(THERMAL_RISK_LABEL[hhsiClass] || hhsiClass).replace(/^[^a-zA-Z]+/, '')}</span>`;

        bodyEl.innerHTML = `
            <!-- Summary -->
            ${ classInfo && classInfo.summary ? `
            <div style="
                background:${badgeBg}18;border-left:3px solid ${badgeBg};
                border-radius:8px;padding:10px 12px;margin-bottom:14px;
                font-size:12px;font-weight:600;color:#334155;line-height:1.5;
            ">${classInfo.summary}</div>` : ''}

            <!-- Stats grid -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;">
                ${statCard('🌡️', 'Ground Heat', fmt(props.LST, '°C') , '#dc2626')}
                ${statCard('🌬️', 'Air Temp', fmt(props.air_temp, '°C'), '#ea580c')}
                ${statCard('💧', 'Humidity', fmt(props.rel_humidity, '%'), '#0284c7')}
                ${statCard('🌿', 'Plant Cover', fmt(props.vegetation_cover_pct, '%'), '#059669')}
                ${statCard('☀️', 'Solar Radiation', fmt(props.solar_rad_W_m2, ' W/m²'), '#d97706')}
                ${statCard('🏥', 'Hospital Dist.', fmt(props.dist_hospital_km, ' km'), '#7c3aed')}
            </div>

            <!-- HHSI Score row -->
            <div style="
                background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:10px;
                padding:10px 12px;margin-bottom:14px;
                display:flex;align-items:center;justify-content:space-between;
            ">
                <div>
                    <div style="font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase;">Heat Stress Score (HHSI)</div>
                    <div style="font-size:20px;font-weight:800;color:${badgeBg};margin-top:2px;">${fmt(props.HHSI_max, '', 1)}</div>
                </div>
                <div style="font-size:11px;color:#64748b;max-width:145px;text-align:right;line-height:1.4;" title="Pedestrian walking heat stress calculated from ground surface heat and tree shade deficit: LST_norm × (1 - NDVI_norm)">
                    Pedestrian exposure: <strong style="color:#0f172a;cursor:help;text-decoration:underline dotted #94a3b8;">${props.outdoor_exposure || 'N/A'}</strong> ℹ️
                </div>
            </div>

            <!-- Precautions -->
            <div style="margin-bottom:10px;">
                <div style="font-weight:800;font-size:11px;color:#92400e;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">
                    Recommended Precautions
                </div>
                ${advisoryListHTML}
            </div>

            <!-- Area tag -->
            <div style="font-size:10.5px;color:#94a3b8;font-weight:600;text-align:right;padding-top:6px;border-top:1px solid #e2e8f0;">
                📐 Zone area: ${props.area_m2 ? Math.round(props.area_m2) + ' m²' : 'N/A'}
            </div>
        `;

        // Show panel with flex layout
        panel.style.display = 'flex';
        // If the heatwave prediction widget is visible, temporarily hide it
        const predCard = document.getElementById('rightPredictionCard');
        if (predCard) predCard.style.display = 'none';
    });

    map.on('mouseenter', 'heat-risk-zones-fill', () => {
        map.getCanvas().style.cursor = 'pointer';
    });

    map.on('mouseleave', 'heat-risk-zones-fill', () => {
        map.getCanvas().style.cursor = '';
    });
}

function populateHeatZoneLegendPanel() {
    const listEl = document.getElementById('heatZoneLegendList');
    if (!listEl || !heatZoneLegendData || !heatZoneLegendData.zones) return;

    const order = ['Extreme Danger', 'Danger', 'Extreme Caution', 'Caution', 'Normal / Safe'];

    listEl.innerHTML = order.map(riskClass => {
        const info = heatZoneLegendData.zones[riskClass];
        if (!info) return '';
        const color = HEAT_ZONE_COLORS[riskClass] || '#9ca3af';
        const emojis = {
            'Extreme Danger': '🔴',
            'Danger': '🟠',
            'Extreme Caution': '🟡',
            'Caution': '🟡',
            'Normal / Safe': '🟢'
        };
        return `
            <div style="
                display:flex;align-items:flex-start;gap:10px;
                margin-bottom:8px;padding:10px 12px;
                border-radius:10px;
                background:${color}14;
                border:1.5px solid ${color}44;
            ">
                <span style="
                    width:13px;height:13px;border-radius:3px;
                    background:${color};margin-top:3px;flex-shrink:0;
                    box-shadow:0 1px 4px ${color}55;
                "></span>
                <div style="min-width:0;">
                    <div style="font-weight:800;font-size:12px;color:#0f172a;">${emojis[riskClass] || ''} ${riskClass}</div>
                    <div style="color:#64748b;font-size:11px;margin-top:2px;line-height:1.4;word-break:break-word;">
                        ${info.summary}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// ============================================================
// FLOATING RIGHT PREDICTION & HOSPITAL SURGE WIDGET
// ============================================================

let predictionsSummaryData = null;
let predictionsRecommendationsData = null;
let hospitalSurgeData = null;
let activePredictionDate = null;
let activePredictionTab = "weather"; // "weather" | "surge"
let activeSurgeFacility = "soa_student_health_centre"; // "soa_student_health_centre" | "jagamara_uphc" | "astang_ayurveda" | "sum_hospital"
let showSurgeCitations = false;
let showSurgeDiurnal = false;
// Initialize collapsed by default on smartphone viewports (<= 640px)
let isPredictionWidgetCollapsed = typeof window !== 'undefined' && window.innerWidth <= 640;

function switchPredictionDate(dateStr) {
    activePredictionDate = dateStr;
    renderPredictionWidget();
}
window.switchPredictionDate = switchPredictionDate;
window.getActivePredictionDate = () => activePredictionDate;

function togglePredictionWidget() {
    isPredictionWidgetCollapsed = !isPredictionWidgetCollapsed;
    renderPredictionWidget();
}
window.togglePredictionWidget = togglePredictionWidget;

window.setPredictionWidgetCollapsed = function(collapsed) {
    isPredictionWidgetCollapsed = Boolean(collapsed);
    renderPredictionWidget();
};

window.setPredictionTab = function(tab) {
    if (tab === 'weather' || tab === 'surge') {
        activePredictionTab = tab;
        isPredictionWidgetCollapsed = false;
        renderPredictionWidget();
    }
};

let medicalFacilityMarkers = {};

function initMedicalFacilityMarkers() {
    if (!hospitalSurgeData || !hospitalSurgeData.facilities || !map) return;

    // Clear existing if any
    Object.values(medicalFacilityMarkers).forEach(m => m.remove());
    medicalFacilityMarkers = {};

    const MaplibreMarker = window.maplibregl ? maplibregl.Marker : mapboxgl.Marker;
    const MaplibrePopup = window.maplibregl ? maplibregl.Popup : mapboxgl.Popup;

    Object.entries(hospitalSurgeData.facilities).forEach(([facilityKey, fac]) => {
        if (!fac.coordinates || !Array.isArray(fac.coordinates)) return;

        const isStudentCenter = facilityKey === 'soa_student_health_centre';
        const isAyurveda = facilityKey === 'astang_ayurveda';
        const isSum = facilityKey === 'sum_hospital';

        let markerClass = 'clinic-marker';
        let iconCircleClass = 'clinic-icon-circle';
        let iconChar = '🩺';
        let badgeLabel = `${fac.capacity_beds} Beds`;

        if (isStudentCenter) {
            markerClass = 'clinic-marker';
            iconCircleClass = 'clinic-icon-circle';
            iconChar = '🩺';
            badgeLabel = 'Free for Students';
        } else if (isAyurveda) {
            markerClass = 'clinic-marker';
            iconCircleClass = 'ambulance-icon-circle';
            iconChar = '🌿';
            badgeLabel = 'Ayurvedic Hospital';
        } else if (isSum) {
            markerClass = 'hospital-marker';
            iconCircleClass = 'hospital-icon-circle';
            iconChar = '🏥';
            badgeLabel = '1,750 Beds • Referral';
        } else {
            markerClass = 'clinic-marker';
            iconCircleClass = 'clinic-icon-circle';
            iconChar = '🏥';
            badgeLabel = 'Govt. UPHC';
        }

        const markerEl = document.createElement('div');
        markerEl.className = `medical-facility-marker ${markerClass}`;
        markerEl.setAttribute('data-facility-key', facilityKey);
        markerEl.title = `Click to inspect ${fac.name}`;

        markerEl.innerHTML = `
            <div class="facility-icon-circle ${iconCircleClass}">
                ${iconChar}
            </div>
            <div class="facility-label-group">
                <span class="facility-name-text">${fac.name}</span>
                <span class="facility-tier-badge">${badgeLabel}</span>
            </div>
        `;

        const popupContent = document.createElement('div');
        popupContent.className = 'facility-popup-content';
        popupContent.innerHTML = `
            <div class="facility-popup-header">
                <div class="facility-icon-circle ${iconCircleClass}" style="width:26px;height:26px;font-size:13px;">
                    ${iconChar}
                </div>
                <div>
                    <div class="facility-popup-title">${fac.name}</div>
                    <div class="facility-popup-subtitle">${fac.tier}</div>
                </div>
            </div>
            ${fac.eligibility ? `
            <div style="background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe;padding:4px 7px;border-radius:5px;font-size:10px;font-weight:700;margin-bottom:8px;">
                ℹ️ ${fac.eligibility}
            </div>` : ''}
            <div style="font-size:10.5px;color:#475569;margin-bottom:8px;line-height:1.4;">
                ${fac.description || fac.location}
            </div>
            <div class="facility-popup-stat-row">
                <span>Location:</span>
                <strong style="text-align:right;max-width:160px;font-size:10px;">${fac.location}</strong>
            </div>
            ${fac.plus_code ? `
            <div class="facility-popup-stat-row">
                <span>Plus Code:</span>
                <strong style="color:#0284c7;font-family:monospace;font-size:10.5px;">${fac.plus_code}</strong>
            </div>` : ''}
            <div class="facility-popup-stat-row">
                <span>Distance from ITER:</span>
                <strong style="color:#b91c1c;">${fac.dist_from_iter_km === 0 ? 'On-Campus (0 km)' : fac.dist_from_iter_km + ' km (~' + fac.drive_time_min + ' min drive)'}</strong>
            </div>
            <div class="facility-popup-stat-row">
                <span>Observation / Inpatient Beds:</span>
                <strong>${fac.capacity_beds} beds</strong>
            </div>
            <div class="facility-popup-stat-row">
                <span>Baseline OPD Load:</span>
                <strong>${fac.baseline_opd.toLocaleString()} / day</strong>
            </div>
            <div class="facility-popup-stat-row">
                <span>Baseline Urgent / ER:</span>
                <strong>${fac.baseline_emergency} / day</strong>
            </div>
            <button class="facility-popup-btn" data-action="popup-view-surge" data-key="${facilityKey}">
                📊 View Patient Surge Forecast
            </button>
            ${isStudentCenter ? `
            <button class="facility-popup-btn" style="background:#dc2626;margin-top:4px;" onclick="focusFacilityInWidget('sum_hospital')">
                🚑 Transfer Route to IMS & SUM Hospital
            </button>` : ''}
        `;

        popupContent.querySelector('[data-action="popup-view-surge"]').addEventListener('click', () => {
            focusFacilityInWidget(facilityKey);
        });

        const popup = new MaplibrePopup({ offset: 25, closeButton: true, maxWidth: '300px' })
            .setDOMContent(popupContent);

        const marker = new MaplibreMarker({ element: markerEl, anchor: 'bottom' })
            .setLngLat(fac.coordinates)
            .setPopup(popup)
            .addTo(map);

        medicalFacilityMarkers[facilityKey] = marker;
    });
}

function focusFacilityInWidget(facilityKey) {
    activePredictionTab = 'surge';
    activeSurgeFacility = facilityKey;
    isPredictionWidgetCollapsed = false;
    renderPredictionWidget();
    focusFacilityOnMap(facilityKey, false);
}
window.focusFacilityInWidget = focusFacilityInWidget;

function switchSurgeFacility(facilityKey) {
    activeSurgeFacility = facilityKey;
    renderPredictionWidget();
    focusFacilityOnMap(facilityKey, true);
}
window.switchSurgeFacility = switchSurgeFacility;

function focusFacilityOnMap(facilityKey, openPopup = true) {
    const fac = hospitalSurgeData && hospitalSurgeData.facilities ? hospitalSurgeData.facilities[facilityKey] : null;
    if (!fac || !fac.coordinates || !map) return;

    let zoomLevel = 17.0;
    if (facilityKey === 'soa_student_health_centre') zoomLevel = 17.8;
    else if (facilityKey === 'sum_hospital') zoomLevel = 16.0;

    map.flyTo({
        center: fac.coordinates,
        zoom: zoomLevel,
        speed: 1.2,
        curve: 1.4,
        essential: true
    });

    if (openPopup && medicalFacilityMarkers[facilityKey]) {
        const m = medicalFacilityMarkers[facilityKey];
        const p = m.getPopup();
        if (p && !p.isOpen()) {
            m.togglePopup();
        }
    }
}
window.focusFacilityOnMap = focusFacilityOnMap;

document.addEventListener("DOMContentLoaded", () => {
    loadRightPredictionWidget();
});

let liveWeatherData = null;
let isRefreshingForecast = false;

function formatForecastDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
    }
    return dateStr;
}

function formatForecastFullDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    }
    return dateStr;
}

async function triggerLiveNwpRefresh(testStorm = false) {
    if (isRefreshingForecast) return;
    isRefreshingForecast = true;
    const btnId = testStorm ? 'stormTestBtn' : 'liveRefreshBtn';
    const btn = document.getElementById(btnId);
    const originalText = btn ? btn.innerHTML : '';
    if (btn) { btn.innerHTML = '⏳ Computing...'; btn.disabled = true; }

    try {
        const resp = await fetch('/api/run-live-forecast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ testStorm })
        });
        const data = await resp.json();
        if (!resp.ok || !data.success) throw new Error(data.error || 'Forecast pipeline returned an error.');
        console.log('[Live NWP Success]:', data);
        await loadRightPredictionWidget();
        showMessage(`✓ ${testStorm ? '⛈️ Storm scenario' : '⚡ Live NWP'} forecast refreshed in ${data.durationSeconds}s`);
    } catch (err) {
        console.error('[Live Refresh Error]:', err);
        showMessage('❌ Forecast refresh failed: ' + err.message.slice(0, 80));
    } finally {
        isRefreshingForecast = false;
        const freshBtn = document.getElementById(btnId);
        if (freshBtn) { freshBtn.innerHTML = originalText; freshBtn.disabled = false; }
    }
}
window.triggerLiveNwpRefresh = triggerLiveNwpRefresh;

function loadRightPredictionWidget() {
    // 1. Fetch live endpoints with fallback
    return Promise.all([
        fetch('/api/predictions/live').then(res => res.ok ? res.json() : null).catch(() => null),
        fetch('/api/predictions/hourly/live').then(res => res.ok ? res.json() : null).catch(() => null),
        fetch('/api/surge/live').then(res => res.ok ? res.json() : null).catch(() => null),
        fetch('/api/weather/current').then(res => res.ok ? res.json() : null).catch(() => null)
    ])
    .then(([summary, hourlyData, surgeData, weatherData]) => {
        if (!summary || !hourlyData) {
            // Secondary fallback to static files
            return Promise.all([
                fetch('/data/live_predictions.json').then(r => r.json()).catch(() => fetch('/data/predictions_may2026.json').then(r => r.json())),
                fetch('/data/live_hourly_forecast.json').then(r => r.json()).catch(() => fetch('/data/hourly_predictions_may2026.json').then(r => r.json())),
                fetch('/data/live_surge.json').then(r => r.json()).catch(() => fetch('/data/hospital_surge_predictions_may2026.json').then(r => r.json())),
                fetch('/data/live_weather.json').then(r => r.json()).catch(() => null)
            ]).then(([s, h, su, w]) => {
                predictionsSummaryData = s;
                predictionsRecommendationsData = h;
                hospitalSurgeData = su;
                liveWeatherData = w;
                renderPredictionWidget();
                initMedicalFacilityMarkers();
            });
        }
        predictionsSummaryData = summary;
        predictionsRecommendationsData = hourlyData;
        hospitalSurgeData = surgeData;
        liveWeatherData = weatherData;

        renderPredictionWidget();
        initMedicalFacilityMarkers();
    })
    .catch(err => console.error("Error loading prediction datasets:", err));
}

// Robust resolver for Current Operational Day in Indian Standard Time (IST)
function getLiveTodayDateStr() {
    if (predictionsSummaryData) {
        const todayKey = Object.keys(predictionsSummaryData).find(d => {
            const item = predictionsSummaryData[d];
            return item && (item.is_today === true || item.horizon === 0);
        });
        if (todayKey) return todayKey;
    }
    if (heatZoneManifest && heatZoneManifest.today) {
        return heatZoneManifest.today;
    }
    try {
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    } catch (e) {
        const nowIst = new Date(Date.now() + (5.5 * 60 * 60 * 1000));
        return nowIst.toISOString().split('T')[0];
    }
}

// Midnight rollover watcher: when day changes in IST, automatically refresh datasets
if (typeof window !== 'undefined') {
    const rolloverTimer = setInterval(() => {
        const currentIstToday = getLiveTodayDateStr();
        const cachedToday = predictionsSummaryData && Object.keys(predictionsSummaryData).find(d => predictionsSummaryData[d] && predictionsSummaryData[d].is_today);
        if (cachedToday && currentIstToday !== cachedToday) {
            console.log(`[ShadeRoute] Midnight rollover detected (${cachedToday} -> ${currentIstToday}). Refreshing forecast...`);
            if (typeof loadRightPredictionWidget === 'function') {
                loadRightPredictionWidget();
            }
        }
    }, 3 * 60 * 1000);
    if (rolloverTimer && typeof rolloverTimer.unref === 'function') {
        rolloverTimer.unref();
    }
}

/* ─── Main render function ──────────────────────────────────── */
function renderPredictionWidget() {
    const card = document.getElementById('rightPredictionCard');
    if (!card) return;

    const availableDates = Object.keys(predictionsSummaryData || {}).sort();
    if (!availableDates.length) return;

    const todayDateStr = getLiveTodayDateStr();

    if (!activePredictionDate || !availableDates.includes(activePredictionDate)) {
        activePredictionDate = availableDates.includes(todayDateStr) ? todayDateStr : availableDates[0];
    }

    const summary = predictionsSummaryData[activePredictionDate] || {};
    const rec     = predictionsRecommendationsData[activePredictionDate] || {};
    const surge   = (hospitalSurgeData && hospitalSurgeData.daily_forecasts) 
                    ? hospitalSurgeData.daily_forecasts[activePredictionDate] : null;

    const isHeatwave  = (summary.prediction || '').toUpperCase() === 'HEATWAVE';
    const badgeColor  = isHeatwave ? '#dc2626' : '#059669';
    const badgeBg     = isHeatwave ? '#fef2f2' : '#ecfdf5';
    const badgeBorder = isHeatwave ? '#fecaca' : '#a7f3d0';
    const rawProbability = rec.heatwave_probability ?? summary.probability_of_heatwave;
    const hasForecastProbability = Number.isFinite(rawProbability);
    const probPct = hasForecastProbability
        ? (rawProbability * 100 < 1 && rawProbability > 0
            ? (rawProbability * 100).toFixed(1)
            : (rawProbability * 100).toFixed(0))
        : null;

    /* ── Reset card styles ── */
    card.style.cssText = '';
    card.className = 'floating-prediction-card';
    if (card._delegatedListener) {
        card.removeEventListener('click', card._delegatedListener);
        card._delegatedListener = null;
    }

    /* ─────────────────────────────────────────────────────────────
       COLLAPSED STATE — a slim pill the user clicks to expand
    ───────────────────────────────────────────────────────────── */
    if (isPredictionWidgetCollapsed) {
        const isMobile = window.innerWidth <= 640;
        card.style.cssText = isMobile ? `
            position: fixed;
            bottom: 14px;
            right: 8px;
            top: auto;
            left: auto;
            z-index: 25;
            background: rgba(255,255,255,0.95);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border: 1.5px solid rgba(255,255,255,0.9);
            border-radius: 999px;
            padding: 4px 10px;
            color: #0f172a;
            box-shadow: 0 4px 16px rgba(15,23,42,0.14);
            font-family: 'Plus Jakarta Sans','Inter',sans-serif;
            display: flex;
            align-items: center;
            gap: 5px;
            cursor: pointer;
            max-width: 44vw;
        ` : `
            position: fixed;
            top: 88px;
            right: 16px;
            z-index: 30;
            background: rgba(255,255,255,0.95);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border: 1px solid rgba(255,255,255,0.6);
            border-radius: 12px;
            padding: 8px 14px;
            color: #0f172a;
            box-shadow: 0 8px 24px rgba(15,23,42,0.10);
            font-family: 'Plus Jakarta Sans','Inter',sans-serif;
            display: flex;
            align-items: center;
            gap: 10px;
            cursor: pointer;
        `;
        const collapseIcon = activePredictionTab === 'surge' ? '🏥' : '🔥';
        const collapseLabel = activePredictionTab === 'surge' ? 'Patient Surge' : 'Heat Forecast';
        const collapseBadge = activePredictionTab === 'surge' && surge
            ? `+${surge.surge_percent}%`
            : (summary.prediction || 'NORMAL');
        const collapseBadgeColor = activePredictionTab === 'surge' && surge
            ? (surge.surge_percent >= 20 ? '#dc2626' : surge.surge_percent >= 10 ? '#f59e0b' : '#059669')
            : badgeColor;
        const collapseBadgeBg = activePredictionTab === 'surge' && surge
            ? (surge.surge_percent >= 20 ? '#fef2f2' : surge.surge_percent >= 10 ? '#fffbeb' : '#ecfdf5')
            : badgeBg;

        if (isMobile) {
            card.innerHTML = `
                <div style="display:flex;align-items:center;gap:4px;min-width:0;overflow:hidden;">
                    <span style="font-size:12px;flex-shrink:0;">${collapseIcon}</span>
                    <span style="font-size:9.5px;font-weight:800;color:${collapseBadgeColor};background:${collapseBadgeBg};border:1px solid ${badgeBorder};padding:1.5px 5px;border-radius:999px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${collapseBadge}</span>
                </div>
                <span data-action="expand" style="font-size:9.5px;color:#0284c7;font-weight:750;white-space:nowrap;flex-shrink:0;">▾</span>
            `;
        } else {
            card.innerHTML = `
                <div style="display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden;">
                    <span style="font-size:14px;flex-shrink:0;">${collapseIcon}</span>
                    <span style="font-size:11.5px;font-weight:750;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                        ${collapseLabel} (${formatForecastDate(activePredictionDate)})
                    </span>
                    <span style="background:${collapseBadgeBg};color:${collapseBadgeColor};border:1px solid ${badgeBorder};font-weight:800;font-size:9.5px;padding:2px 6px;border-radius:999px;flex-shrink:0;">
                        ${collapseBadge}
                    </span>
                </div>
                <span data-action="expand" style="font-size:11px;color:#0284c7;font-weight:700;white-space:nowrap;flex-shrink:0;">Expand ▾</span>
            `;
        }
        card._delegatedListener = () => { isPredictionWidgetCollapsed = false; renderPredictionWidget(); };
        card.addEventListener('click', card._delegatedListener);
        return;
    }

    /* ─────────────────────────────────────────────────────────────
       EXPANDED STATE — full widget
    ───────────────────────────────────────────────────────────── */
    const isMobile = window.innerWidth <= 640;
    card.style.cssText = isMobile ? `
        position: fixed;
        bottom: 10px;
        left: 10px;
        right: 10px;
        max-height: 56vh;
        z-index: 35;
        background: rgba(255,255,255,0.98);
        backdrop-filter: blur(24px) saturate(180%);
        -webkit-backdrop-filter: blur(24px) saturate(180%);
        border: 1px solid rgba(226,232,240,0.8);
        border-radius: 20px;
        padding: 12px;
        color: #0f172a;
        box-shadow: 0 20px 40px -8px rgba(15,23,42,0.22);
        font-family: 'Plus Jakarta Sans','Inter',sans-serif;
        overflow-y: auto;
    ` : `
        position: fixed;
        top: 88px;
        right: 16px;
        width: 350px;
        max-width: calc(100vw - 32px);
        z-index: 30;
        background: rgba(255,255,255,0.98);
        backdrop-filter: blur(24px) saturate(180%);
        -webkit-backdrop-filter: blur(24px) saturate(180%);
        border: 1px solid rgba(226,232,240,0.8);
        border-radius: 16px;
        padding: 14px;
        color: #0f172a;
        box-shadow: 0 20px 40px -8px rgba(15,23,42,0.16), 0 4px 12px rgba(15,23,42,0.06);
        font-family: 'Plus Jakarta Sans','Inter',sans-serif;
        max-height: calc(100vh - 105px);
        overflow-y: auto;
    `;

    /* Sub-navigation tabs: Heat Hazard vs Patient Surge */
    const subNavHTML = `
        <div class="surge-nav-toggle">
            <button data-action="tab-weather" class="surge-nav-btn ${activePredictionTab === 'weather' ? 'active' : ''}">
                🔥 Heat Hazard
            </button>
            <button data-action="tab-surge" class="surge-nav-btn ${activePredictionTab === 'surge' ? 'active' : ''}">
                🏥 Patient Surge
            </button>
        </div>
    `;

    /* Dynamic Date tabs */
    // Filter to an operational 5-day horizon window centered on Today (Yesterday, Today, +1d, +2d, +3d)
    let displayDates = availableDates.filter(d => {
        const item = predictionsSummaryData[d];
        if (item && typeof item.horizon === 'number') {
            return item.horizon >= -1 && item.horizon <= 3;
        }
        const diffDays = Math.round((new Date(d + 'T00:00:00') - new Date(todayDateStr + 'T00:00:00')) / 86400000);
        return diffDays >= -1 && diffDays <= 3;
    });

    if (!displayDates.length) {
        displayDates = availableDates.slice(-5);
    }

    // Ensure currently selected activePredictionDate is visible if selected from historical timeline
    if (activePredictionDate && !displayDates.includes(activePredictionDate) && availableDates.includes(activePredictionDate)) {
        displayDates.push(activePredictionDate);
        displayDates.sort();
    }

    const tabsHTML = displayDates.map(dateStr => {
        const isActive = dateStr === activePredictionDate;
        const isToday = dateStr === todayDateStr;
        const daySum = predictionsSummaryData[dateStr] || {};
        
        // Calculate horizon offset
        const horizon = typeof daySum.horizon === 'number'
            ? daySum.horizon
            : Math.round((new Date(dateStr + 'T00:00:00') - new Date(todayDateStr + 'T00:00:00')) / 86400000);

        // Warning state
        const warnClass = daySum.warning ? daySum.warning.class : 'safe';
        const hasWarning = warnClass && warnClass !== 'safe';
        const warnColor = warnClass === 'critical' ? '#dc2626' : '#f59e0b';

        // Horizon badge label
        let horizonLabel = '';
        if (isToday || horizon === 0) {
            horizonLabel = 'TODAY';
        } else if (horizon === -1 || daySum.is_historical) {
            horizonLabel = 'YDAY';
        } else if (horizon === 1) {
            horizonLabel = '+1d TOM';
        } else if (horizon > 1) {
            horizonLabel = `+${horizon}d`;
        } else {
            horizonLabel = `${horizon}d`;
        }

        // Calendar label e.g. "15 Sep"
        const parts = dateStr.split('-');
        let shortDateStr = dateStr;
        if (parts.length === 3) {
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const m = months[parseInt(parts[1], 10) - 1] || '';
            const dayNum = parseInt(parts[2], 10);
            shortDateStr = `${dayNum} ${m}`;
        }

        const themeClass = activePredictionTab === 'surge' ? 'surge-theme' : 'weather-theme';

        return `
            <button 
                data-action="date" 
                data-date="${dateStr}" 
                class="date-horizon-btn ${isActive ? 'active ' + themeClass : ''} ${isToday ? 'is-today' : ''}"
                title="${dateStr}: ${horizonLabel} (${daySum.prediction || 'Normal'})"
            >
                <span class="date-horizon-badge">
                    ${isToday ? '<span class="horizon-live-dot"></span>' : ''}${horizonLabel}
                </span>
                <span class="date-horizon-day">
                    ${shortDateStr}
                </span>
                ${hasWarning ? `<span class="date-horizon-warning-dot" style="background:${warnColor};"></span>` : ''}
            </button>
        `;
    }).join('');

    let tabBodyHTML = '';

    /* ─────────────────────────────────────────────────────────────
       TAB 1: WEATHER & HEAT HAZARD
    ───────────────────────────────────────────────────────────── */
    if (activePredictionTab === 'weather') {
        const hourlyEntries   = rec.hourly_status ? Object.entries(rec.hourly_status) : [];
        const hourlyPillsHTML = hourlyEntries.map(([hour, status]) => {
            const pillBg = status === 'UNSAFE' ? '#dc2626' : status === 'CAUTION' ? '#f59e0b' : '#10b981';
            return `<div title="${hour}:00 — ${status}" style="display:flex;flex-direction:column;align-items:center;gap:3px;">
                <span style="font-size:8.5px;color:#94a3b8;font-weight:600;">${hour}h</span>
                <div style="width:15px;height:15px;border-radius:3px;background:${pillBg};
                    display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:800;color:#fff;">
                    ${status[0]}
                </div>
            </div>`;
        }).join('');

        const goOutWindows = (rec.recommended_go_out_windows || []).map(w =>
            `<span style="background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46;padding:2px 7px;border-radius:4px;font-size:10.5px;font-weight:700;">🟢 ${w}</span>`
        ).join(' ');

        // Manifest entry lookup for activePredictionDate
        const manifestEntry = (heatZoneManifest && heatZoneManifest.dates)
            ? heatZoneManifest.dates.find(d => d.date === activePredictionDate)
            : null;
        const campusDangerSectors = manifestEntry ? manifestEntry.danger_or_worse_sectors : (isHeatwave ? 'High' : 0);
        const campusMaxHhsi = (manifestEntry && manifestEntry.hhsi_max_overall) ? `${manifestEntry.hhsi_max_overall}°C` : '--';

        // Early warning
        const warningObj = summary.warning || {};
        const warnLevel = warningObj.level || (isHeatwave ? 'Heat Warning' : 'Normal');
        const warnClass = warningObj.class || (isHeatwave ? 'warning' : 'safe');
        const warnReasons = warningObj.reasons || ['Standard seasonal conditions'];
        const confidenceVal = summary.confidence || 'Medium';

        // Atmospheric Advisory
        const advisoryText = summary.advisory || rec.advisory || null;

        // Subtitle indicator
        let dateSubtitleTag = '';
        if (summary.is_today || activePredictionDate === todayDateStr) {
            dateSubtitleTag = ' (Today)';
        } else if (summary.is_historical || (typeof summary.horizon === 'number' && summary.horizon < 0)) {
            dateSubtitleTag = ' (Observed)';
        } else if (typeof summary.horizon === 'number' && summary.horizon > 0) {
            dateSubtitleTag = ` (+${summary.horizon}d Forecast)`;
        }

        tabBodyHTML = `
            <!-- NWP Source & Dynamic Date Pill -->
            <div class="nwp-badge-wrapper">
                <div class="nwp-source-badge" style="${summary.is_historical ? 'background:#f1f5f9;border-color:#cbd5e1;color:#475569;' : ''}">
                    <span class="nwp-live-dot" style="${summary.is_historical ? 'background:#94a3b8;box-shadow:none;' : ''}"></span>
                    ${summary.is_historical ? '⏪ Historical record' : '● Live NWP forecast (Open-Meteo)'}
                </div>
                <div style="text-align:right;">
                    ${summary.seasonal_context ? `<div style="font-size:10px;font-weight:800;color:${summary.monsoon_suppression ? '#0d9488' : '#64748b'};">${summary.seasonal_context}</div>` : ''}
                    <div style="font-size:9px;color:#94a3b8;font-weight:600;">
                        ${formatForecastFullDate(activePredictionDate)}${dateSubtitleTag}
                    </div>
                </div>
            </div>

            <!-- Date Horizon Tabs Segmented Control -->
            <div class="date-horizon-segment" style="grid-template-columns: repeat(${displayDates.length}, minmax(0, 1fr));">
                ${tabsHTML}
            </div>

            <!-- Heatwave Probability & Campus Spatial Risk -->
            <div class="heatwave-summary-card">
                <div class="heatwave-metric-col" style="border-right: 1px solid #e2e8f0; padding-right: 8px;">
                    <div style="font-size:9.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.3px;">${summary.is_today ? 'Today Heatwave Risk' : 'Heatwave Risk'}</div>
                    <div style="font-size:24px;font-weight:800;color:${badgeColor};margin-top:2px;letter-spacing:-0.03em;">${hasForecastProbability ? `${probPct}%` : 'Now'}</div>
                    ${hasForecastProbability ? `<div style="height:5px;background:#e2e8f0;border-radius:999px;overflow:hidden;margin:6px 0 4px;width:100%;"><div style="height:100%;width:${Math.max(Number(probPct), 2)}%;background:${isHeatwave ? 'linear-gradient(90deg, #f59e0b, #dc2626)' : 'linear-gradient(90deg, #34d399, #059669)'};border-radius:999px;transition:width 0.6s ease;"></div></div>` : `<div style="font-size:8.5px;color:#64748b;line-height:1.25;margin:5px 0 4px;">Live observation stream updating...</div>`}
                    <div style="display:inline-flex;align-items:center;margin-top:2px;padding:2.5px 8px;border-radius:999px;font-size:9.5px;font-weight:800;background:${badgeBg};color:${badgeColor};border:1px solid ${badgeBorder};">
                        ${summary.prediction || (isHeatwave ? 'HEATWAVE' : 'NO HEATWAVE')}
                    </div>
                </div>

                <div class="heatwave-metric-col" style="padding-left: 8px;">
                    <div style="font-size:9.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.3px;">Campus Sector Risk</div>
                    <div style="font-size:13px;font-weight:800;color:#0f172a;margin-top:2px;">
                        🏛️ ${campusDangerSectors} <span style="font-size:10px;color:#64748b;font-weight:600;">/ 3,213</span>
                    </div>
                    <div style="font-size:10.5px;color:#475569;margin-top:3px;font-weight:600;">
                        Peak HHSI: <strong style="color:${parseFloat(campusMaxHhsi) >= 46 ? '#dc2626' : '#ea580c'};">${campusMaxHhsi}</strong>
                    </div>
                </div>
            </div>

            <!-- Monsoon / Weather Suppression Banner -->
            ${summary.monsoon_suppression ? `
            <div style="background:linear-gradient(135deg,#ecfdf5,#f0f9ff);border:1.5px solid #6ee7b7;border-left:4px solid #0d9488;border-radius:8px;padding:9px 12px;margin-bottom:10px;display:flex;gap:8px;align-items:flex-start;">
                <span style="font-size:16px;flex-shrink:0;line-height:1;">\ud83c\udf27\ufe0f</span>
                <div>
                    <div style="font-size:10px;font-weight:800;color:#0f766e;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:2px;">Monsoon Suppression Active</div>
                    <div style="font-size:11px;color:#134e4a;line-height:1.45;">${summary.weather_summary || 'High humidity and active rainfall are suppressing heatwave risk. Muggy conditions persist.'}</div>
                </div>
            </div>` : (summary.weather_summary ? `
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-left:3px solid #94a3b8;border-radius:8px;padding:8px 10px;margin-bottom:10px;font-size:11px;color:#334155;line-height:1.4;">
                ${summary.weather_summary}
            </div>` : '')}

            <!-- Rain Probability, Precipitation & Feels-Like Row -->
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:10px;">
                <div style="background:${(summary.rain_probability||0) >= 40 ? '#eff6ff' : '#f8fafc'};border:1px solid ${(summary.rain_probability||0) >= 40 ? '#bfdbfe' : '#e2e8f0'};border-radius:8px;padding:7px 8px;text-align:center;cursor:help;" title="${summary.rain_probability_note || `Peak hourly precipitation probability: ${summary.rain_probability_peak_pct || summary.rain_probability}% around ${summary.rain_probability_peak_hour || '15:00'} IST.`}">
                    <div style="font-size:8.5px;color:${(summary.rain_probability||0) >= 40 ? '#1d4ed8' : '#64748b'};font-weight:700;text-transform:uppercase;letter-spacing:0.03em;margin-bottom:3px;">🌧️ Peak Hourly PoP</div>
                    <div style="font-size:16px;font-weight:800;color:${(summary.rain_probability||0) >= 40 ? '#1e40af' : '#0f172a'};"> ${summary.rain_probability !== undefined ? Math.round(summary.rain_probability) + '%' : '--'}</div>
                    ${summary.rain_probability_peak_pct ? `<div style="font-size:8px;color:#64748b;font-weight:600;margin-top:2px;">Peak ${Math.round(summary.rain_probability_peak_pct)}% (${(summary.rain_probability_peak_hour || '15:00').replace(':00','h')})</div>` : ''}
                </div>
                <div style="background:${(summary.precipitation_mm||0) > 10 ? '#f0f9ff' : '#f8fafc'};border:1px solid ${(summary.precipitation_mm||0) > 10 ? '#bae6fd' : '#e2e8f0'};border-radius:8px;padding:7px 8px;text-align:center;">
                    <div style="font-size:8.5px;color:${(summary.precipitation_mm||0) > 10 ? '#0369a1' : '#64748b'};font-weight:700;text-transform:uppercase;letter-spacing:0.03em;margin-bottom:3px;">\ud83d\udca7 Precip</div>
                    <div style="font-size:16px;font-weight:800;color:${(summary.precipitation_mm||0) > 10 ? '#0284c7' : '#0f172a'};"> ${summary.precipitation_mm !== undefined ? summary.precipitation_mm + ' mm' : '--'}</div>
                </div>
                <div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:8px;padding:7px 8px;text-align:center;">
                    <div style="font-size:8.5px;color:#7c3aed;font-weight:700;text-transform:uppercase;letter-spacing:0.03em;margin-bottom:3px;">\ud83c\udf21\ufe0f Feels Like</div>
                    <div style="font-size:16px;font-weight:800;color:#7c3aed;"> ${summary.apparent_temp_max !== undefined ? summary.apparent_temp_max + '\u00b0C' : '--'}</div>
                </div>
            </div>

            <!-- Humidity Discomfort Tag -->
            ${summary.humidity_discomfort ? `
            <div style="background:#fefce8;border:1px solid #fef08a;border-radius:6px;padding:5px 10px;margin-bottom:10px;font-size:10.5px;color:#713f12;font-weight:600;display:flex;align-items:center;gap:6px;">
                <span>\ud83c\udf21\ufe0f Discomfort:</span>
                <span>${summary.humidity_discomfort}</span>
            </div>` : ''}

            <!-- Early Warning Box -->
            <div class="early-warning-box ${warnClass}">
                <div class="early-warning-title">
                    <span>🛡️ ${warnLevel}</span>
                    <span style="font-size:9.5px;font-weight:700;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,0.75);">${confidenceVal} Confidence</span>
                </div>
                <div class="warning-factors-list">
                    ${warnReasons.map(r => `<span class="warning-factor-tag">${r}</span>`).join('')}
                </div>
            </div>

            <!-- Storm / Rain Convective Suppression Advisory Banner -->
            ${advisoryText ? `
            <div class="pressure-advisory-banner">
                <span style="font-size:14px;flex-shrink:0;">⚡</span>
                <div>
                    <strong style="color:#0f766e;">Storm / Rain Convective Suppression:</strong><br/>
                    ${advisoryText}
                </div>
            </div>` : ''}

            <!-- Danger Window -->
            <div style="margin-bottom:10px;background:#fef2f2;border:1px solid #fecaca;border-left:3px solid #dc2626;padding:8px 10px;border-radius:6px;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span style="color:#991b1b;font-size:10px;font-weight:800;text-transform:uppercase;">Peak Danger Window</span>
                    <span style="font-size:10px;font-weight:700;color:#dc2626;background:#fee2e2;padding:1px 5px;border-radius:3px;">${rec.expected_unsafe_duration || '0 hrs'}</span>
                </div>
                <div style="color:#7f1d1d;font-weight:700;font-size:12px;margin-top:3px;">
                    ⚠️ ${rec.danger_window || 'None (Safe Thermal Conditions)'}
                </div>
            </div>

            <!-- Safe Windows -->
            <div style="margin-bottom:10px;">
                <div style="color:#64748b;font-size:10px;font-weight:700;margin-bottom:4px;text-transform:uppercase;">Best Outdoor Windows:</div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;">${goOutWindows}</div>
            </div>

            <!-- Hourly Thermal-Stress Timeline -->
            <div>
                <div style="color:#64748b;font-size:10px;font-weight:700;margin-bottom:5px;text-transform:uppercase;">Direct Hourly Thermal-Stress (08:00–20:00):</div>
                <div style="display:flex;justify-content:space-between;background:#f8fafc;padding:8px 10px;border-radius:8px;border:1px solid #e2e8f0;flex-wrap:wrap;gap:4px;">
                    ${hourlyPillsHTML}
                </div>
            </div>

            <!-- Interactive NWP Live Controls -->
            <div class="live-controls-row">
                <button id="syncTimelineBtnRight" onclick="triggerTimelineSync()" class="live-control-btn" title="Sync live satellite & NWP data to dynamically expand daily heat risk mapping">
                    🔄 Sync Satellite Data
                </button>
                <button id="liveRefreshBtn" onclick="triggerLiveNwpRefresh(false)" class="live-control-btn" title="Re-query Open-Meteo ECMWF NWP forecast and run V2 model">
                    ⚡ Run Live NWP
                </button>
                <button id="stormTestBtn" onclick="triggerLiveNwpRefresh(true)" class="live-control-btn storm-test" title="Simulate low-pressure storm scenario with rain suppression">
                    ⛈️ Test Storm
                </button>
            </div>
        `;
    } 
    /* ─────────────────────────────────────────────────────────────
       TAB 2: HOSPITAL PATIENT SURGE
    ───────────────────────────────────────────────────────────── */
    else {
        const facData = surge && surge.facility_projections ? surge.facility_projections[activeSurgeFacility] : null;
        const facMeta = hospitalSurgeData && hospitalSurgeData.facilities ? hospitalSurgeData.facilities[activeSurgeFacility] : null;

        if (!facData || !facMeta) {
            tabBodyHTML = `<div style="padding:15px;text-align:center;color:#64748b;font-size:12px;">Surge predictions loading...</div>`;
        } else {
            const sb = facData.syndromic_breakdown;
            const res = facData.resource_readiness_requirements;
            const isRedAlert = (surge.alert_level || '').includes('Red');
            const isOrangeAlert = (surge.alert_level || '').includes('Orange');
            const bannerBg = isRedAlert ? '#fef2f2' : (isOrangeAlert ? '#fffbeb' : '#f0fdf4');
            const bannerBorder = isRedAlert ? '#fecaca' : (isOrangeAlert ? '#fde68a' : '#bbf7d0');
            const bannerColor = isRedAlert ? '#991b1b' : (isOrangeAlert ? '#92400e' : '#166534');

            /* Academic references HTML with official document links & DOIs */
            const referencesHTML = (hospitalSurgeData.metadata.academic_references || []).map(ref => `
                <div style="border-left:3px solid #0284c7;padding:6px 9px;margin-bottom:8px;background:#f8fafc;border-radius:0 6px 6px 0;border:1px solid #e2e8f0;border-left:3px solid #0284c7;">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;">
                        <div style="font-size:10px;font-weight:800;color:#0f172a;">${ref.authority}</div>
                        ${ref.url ? `<a href="${ref.url}" target="_blank" rel="noopener noreferrer" style="font-size:9px;color:#0284c7;font-weight:700;text-decoration:none;white-space:nowrap;background:#e0f2fe;padding:2px 6px;border-radius:4px;border:1px solid #bae6fd;">↗ ${ref.url_label || 'Official Doc'}</a>` : ''}
                    </div>
                    <div style="font-size:9.5px;color:#334155;font-style:italic;margin-top:2px;">${ref.title}</div>
                    <div style="font-size:9px;color:#64748b;margin-top:3px;line-height:1.35;">${ref.summary}</div>
                    ${ref.apa ? `
                    <div style="margin-top:5px;display:flex;justify-content:space-between;align-items:center;">
                        <span style="font-size:8.5px;color:#94a3b8;font-family:monospace;">APA Citation</span>
                        <button type="button" onclick="copyCitationText('${ref.apa.replace(/'/g, "\\'")}', this)" style="background:#ffffff;border:1px solid #cbd5e1;font-size:9px;font-weight:700;padding:2px 7px;border-radius:4px;cursor:pointer;color:#334155;transition:all 0.15s ease;">📋 Copy</button>
                    </div>` : ''}
                </div>
            `).join('') + `
                <button type="button" onclick="openCitationsModal('clinical_epidemiology')" style="width:100%;margin-top:4px;background:#f0f9ff;border:1.5px dashed #0284c7;border-radius:6px;padding:7px 10px;font-size:10.5px;font-weight:700;color:#0284c7;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">
                    <span>📚 Open Full Scientific Bibliography & DOIs</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                </button>
            `;

            // Build facility select options and quick switch pills
            const studyAreaClinics = ['soa_student_health_centre', 'jagamara_uphc', 'astang_ayurveda'];
            const referralHubs = ['sum_hospital'];
            const allSurgeFacilityKeys = ['soa_student_health_centre', 'jagamara_uphc', 'astang_ayurveda', 'sum_hospital'];

            const facilityPillsHTML = allSurgeFacilityKeys.map(fKey => {
                const f = hospitalSurgeData.facilities[fKey];
                if (!f) return '';
                const isActive = fKey === activeSurgeFacility;
                let shortLabel = '🏥 Clinic';
                if (fKey === 'soa_student_health_centre') shortLabel = '🩺 Student Clinic';
                else if (fKey === 'jagamara_uphc') shortLabel = '🏥 Jagamara UPHC';
                else if (fKey === 'astang_ayurveda') shortLabel = '🌿 Astang Ayurveda';
                else if (fKey === 'sum_hospital') shortLabel = '🏥 IMS & SUM';

                return `<button data-action="facility" data-facility="${fKey}" class="facility-pill-btn ${isActive ? 'active' : ''}">
                    ${shortLabel}
                </button>`;
            }).join('');

            const allFacilitiesOptionsHTML = `
                <optgroup label="Local Study Area (3 km² Catchment)">
                    ${studyAreaClinics.map(fKey => {
                        const f = hospitalSurgeData.facilities[fKey];
                        if (!f) return '';
                        return `<option value="${fKey}" ${fKey === activeSurgeFacility ? 'selected' : ''}>${f.name} (${f.dist_from_iter_km === 0 ? 'Inside Campus' : f.dist_from_iter_km + ' km'})</option>`;
                    }).join('')}
                </optgroup>
                <optgroup label="Quaternary Referral Hub (IMS & SUM)">
                    ${referralHubs.map(fKey => {
                        const f = hospitalSurgeData.facilities[fKey];
                        if (!f) return '';
                        return `<option value="${fKey}" ${fKey === activeSurgeFacility ? 'selected' : ''}>${f.name} (1,750 beds • ${f.drive_time_min} min Ambulance)</option>`;
                    }).join('')}
                </optgroup>
            `;

            let facilityBannerHTML = '';
            if (activeSurgeFacility === 'soa_student_health_centre') {
                facilityBannerHTML = `
                    <div class="transit-info-pill" style="border-left:3px solid #0284c7;flex-direction:column;align-items:flex-start;gap:4px;">
                        <div style="display:flex;justify-content:space-between;width:100%;align-items:center;">
                            <span style="font-size:10.5px;font-weight:700;color:#0369a1;">🎓 SOA ITER Student Health Centre (7Q2X+6X)</span>
                            <a href="javascript:void(0)" onclick="focusFacilityOnMap('soa_student_health_centre', true)" style="color:#0284c7;font-weight:700;text-decoration:none;font-size:10px;">✈️ Pan Map</a>
                        </div>
                        <div style="font-size:9.5px;color:#334155;line-height:1.35;">
                            Available <strong>free of cost exclusively for ITER students & faculty</strong>. Serious emergencies are transferred via on-campus ambulance to <strong>IMS & SUM Hospital</strong>.
                        </div>
                    </div>
                `;
            } else if (activeSurgeFacility === 'sum_hospital') {
                facilityBannerHTML = `
                    <div class="transit-info-pill" style="border-left:3px solid #dc2626;flex-direction:column;align-items:flex-start;gap:4px;">
                        <div style="display:flex;justify-content:space-between;width:100%;align-items:center;">
                            <span style="font-size:10.5px;font-weight:700;color:#991b1b;">🏥 IMS & SUM Hospital (7QM9+7W)</span>
                            <a href="javascript:void(0)" onclick="focusFacilityOnMap('sum_hospital', true)" style="color:#0284c7;font-weight:700;text-decoration:none;font-size:10px;">✈️ Pan Map</a>
                        </div>
                        <div style="font-size:9.5px;color:#334155;line-height:1.35;">
                            🚑 <strong>~11 min ambulance drive</strong> (4.8 km). Receives severe ITER student heatstroke cases. <em>Modeled with wider referral catchment variance as an emergency quaternary hospital.</em>
                        </div>
                    </div>
                `;
            } else if (activeSurgeFacility === 'jagamara_uphc') {
                facilityBannerHTML = `
                    <div class="transit-info-pill" style="border-left:3px solid #16a34a;flex-direction:column;align-items:flex-start;gap:4px;">
                        <div style="display:flex;justify-content:space-between;width:100%;align-items:center;">
                            <span style="font-size:10.5px;font-weight:700;color:#15803d;">🏥 Jagamara UPHC (6RX2+99)</span>
                            <a href="javascript:void(0)" onclick="focusFacilityOnMap('jagamara_uphc', true)" style="color:#0284c7;font-weight:700;text-decoration:none;font-size:10px;">✈️ Pan Map</a>
                        </div>
                        <div style="font-size:9.5px;color:#334155;line-height:1.35;">
                            Govt Urban Primary Health Centre on Jagamara Main Rd (0.5 km / 2 min). Primary walk-in triage and ORS corner for the 3 km² neighborhood catchment.
                        </div>
                    </div>
                `;
            } else { // astang_ayurveda
                facilityBannerHTML = `
                    <div class="transit-info-pill" style="border-left:3px solid #d97706;flex-direction:column;align-items:flex-start;gap:4px;">
                        <div style="display:flex;justify-content:space-between;width:100%;align-items:center;">
                            <span style="font-size:10.5px;font-weight:700;color:#b45309;">🌿 Astang Ayurveda Hospital (6RV2+RM)</span>
                            <a href="javascript:void(0)" onclick="focusFacilityOnMap('astang_ayurveda', true)" style="color:#0284c7;font-weight:700;text-decoration:none;font-size:10px;">✈️ Pan Map</a>
                        </div>
                        <div style="font-size:9.5px;color:#334155;line-height:1.35;">
                            Ayurvedic hospital in Gandamunda (0.8 km / 3 min). Handles outpatient herbal rehydration, heat fatigue recovery, and community cooling therapy within the 3 km² zone.
                        </div>
                    </div>
                `;
            }

            tabBodyHTML = `
                <!-- Facility Switcher -->
                <div style="margin-bottom:6px;">
                    <div style="font-size:9.5px;font-weight:700;color:#64748b;text-transform:uppercase;margin-bottom:4px;letter-spacing:0.04em;">
                        Healthcare Facility (Study Area & Referral Hub):
                    </div>
                    <select class="facility-select-dropdown" onchange="window.switchSurgeFacility(this.value)">
                        ${allFacilitiesOptionsHTML}
                    </select>
                    <div class="facility-switch-bar" style="margin-bottom:6px;">
                        ${facilityPillsHTML}
                    </div>
                </div>

                <!-- Operational / Transit Context Banner -->
                ${facilityBannerHTML}

                <!-- Population Catchment Boundary Note -->
                <div style="font-size:9px;color:#64748b;background:#f8fafc;border:1px dashed #cbd5e1;padding:5px 8px;border-radius:6px;margin-bottom:8px;line-height:1.35;">
                    ℹ️ <em>Catchment Scope: AIIMS BBSR & AMRI are excluded because their pan-India/state-level draw exceeds our local 3 km² population raster.</em>
                </div>

                <!-- Date Horizon Tabs Segmented Control -->
                <div class="date-horizon-segment" style="grid-template-columns: repeat(${displayDates.length}, minmax(0, 1fr));">
                    ${tabsHTML}
                </div>

                <!-- Alert Level Banner with Planning Interval -->
                <div class="surge-alert-banner" style="background:${bannerBg};border:1px solid ${bannerBorder};color:${bannerColor};">
                    <div>
                        <span style="font-size:13px;">${isRedAlert ? '🔴' : isOrangeAlert ? '🟠' : ((surge.alert_level || '').includes('Yellow') ? '🟡' : '🟢')}</span>
                        <span style="font-weight:800;margin-left:4px;">${surge.alert_level}</span>
                    </div>
                    <div style="text-align:right;">
                        <span style="background:${surge.alert_color};color:#fff;font-size:10px;font-weight:800;padding:2px 7px;border-radius:99px;display:inline-block;">
                            +${surge.surge_percent}% Surge
                        </span>
                        ${surge.planning_range_percent ? `
                        <div style="font-size:8.5px;font-weight:600;color:${bannerColor};margin-top:2px;">
                            Range: ${surge.planning_range_percent[0]}%–${surge.planning_range_percent[1]}%
                        </div>` : ''}
                    </div>
                </div>

                <!-- Facility Capacity Pressure & Action Trigger Box -->
                ${facData.capacity_action_command ? `
                <div style="margin-bottom:8px;padding:6px 9px;border-radius:6px;background:${facData.capacity_pressure_ratio >= 0.75 ? '#fef2f2' : facData.capacity_pressure_ratio >= 0.20 ? '#fffbeb' : '#f0fdf4'};border:1px solid ${facData.capacity_pressure_ratio >= 0.75 ? '#fca5a5' : facData.capacity_pressure_ratio >= 0.20 ? '#fde68a' : '#bbf7d0'};color:#0f172a;line-height:1.35;">
                    <div style="display:flex;justify-content:space-between;align-items:center;font-size:9.5px;font-weight:700;margin-bottom:2px;">
                        <span>🏥 Bed Saturation Pressure:</span>
                        <span style="color:${facData.capacity_pressure_ratio >= 0.75 ? '#dc2626' : '#0369a1'};font-weight:800;">
                            ${(facData.capacity_pressure_ratio * 100).toFixed(0)}% of Beds (+${facData.excess_emergency_patients}/${facData.capacity_beds})
                        </span>
                    </div>
                    <div style="font-size:9px;color:#334155;">
                        ${facData.capacity_action_command}
                    </div>
                </div>` : ''}

                <!-- Clinical Advisory Notice -->
                <div style="font-size:10px;color:#475569;background:#f8fafc;border:1px solid #e2e8f0;padding:6px 8px;border-radius:6px;margin-bottom:10px;line-height:1.35;">
                    <span style="font-weight:700;color:#0f172a;">Operational Protocol:</span> ${surge.clinical_advisory}
                </div>

                <!-- Metrics Grid: Emergency & OPD -->
                <div class="surge-metric-grid">
                    <div class="surge-stat-card">
                        <div class="surge-stat-label">🚨 Projected Emergency</div>
                        <div class="surge-stat-val" style="color:#b91c1c;">${facData.projected_emergency} <span style="font-size:11px;color:#64748b;font-weight:500;">/day</span></div>
                        <div class="surge-stat-sub" style="color:#dc2626;font-weight:700;">+${facData.excess_emergency_patients} excess (base: ${facData.baseline_emergency})</div>
                    </div>
                    <div class="surge-stat-card">
                        <div class="surge-stat-label">🩺 Total OPD Load</div>
                        <div class="surge-stat-val" style="color:#0284c7;">${facData.projected_opd.toLocaleString()} <span style="font-size:11px;color:#64748b;font-weight:500;">/day</span></div>
                        <div class="surge-stat-sub">+${facData.excess_opd_patients} excess (base: ${facData.baseline_opd.toLocaleString()})</div>
                    </div>
                </div>

                <!-- Syndromic Breakdown (Excess Cases) -->
                <div style="margin-top:8px;">
                    <div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;margin-bottom:5px;letter-spacing:0.04em;">
                        Syndromic Influx Distribution (ICD-10):
                    </div>
                    
                    <div class="syndromic-card">
                        <div>
                            <div class="syndromic-title">Direct Heat Illness (Sunstroke, T67)</div>
                            <div style="font-size:9.5px;color:#94a3b8;">Exhaustion, syncope, heat cramps</div>
                        </div>
                        <span class="syndromic-badge" style="background:#fee2e2;color:#b91c1c;border:1px solid #fca5a5;">
                            +${sb.direct_heat_illness.projected_excess_cases}
                        </span>
                    </div>

                    <div class="syndromic-card">
                        <div>
                            <div class="syndromic-title">Cardiovascular / Stroke (I20-I64)</div>
                            <div style="font-size:9.5px;color:#94a3b8;">Ischemic overload, arrhythmias</div>
                        </div>
                        <span class="syndromic-badge" style="background:#ffedd5;color:#c2410c;border:1px solid #fdba74;">
                            +${sb.cardiovascular_cerebrovascular.projected_excess_cases}
                        </span>
                    </div>

                    <div class="syndromic-card">
                        <div>
                            <div class="syndromic-title">Renal & Dehydration (N17 / E86)</div>
                            <div style="font-size:9.5px;color:#94a3b8;">Acute Kidney Injury, electrolyte deficit</div>
                        </div>
                        <span class="syndromic-badge" style="background:#e0f2fe;color:#0369a1;border:1px solid #7dd3fc;">
                            +${sb.renal_metabolic.projected_excess_cases}
                        </span>
                    </div>

                    <div class="syndromic-card">
                        <div>
                            <div class="syndromic-title">Respiratory Decompensation (J44-45)</div>
                            <div style="font-size:9.5px;color:#94a3b8;">Ozone/PM & thermal hyperventilation</div>
                        </div>
                        <span class="syndromic-badge" style="background:#f1f5f9;color:#475569;border:1px solid #cbd5e1;">
                            +${sb.respiratory_other.projected_excess_cases}
                        </span>
                    </div>
                </div>

                <!-- AIIMS / WHO Readiness Deployment Box -->
                <div class="resource-box">
                    <div class="resource-box-title">
                        <span>🛡️</span> AIIMS & WHO Facility Readiness Protocol
                    </div>
                    <div class="resource-item">
                        <span>Dedicated Heat Stroke Units (HSU):</span>
                        <strong style="color:#15803d;">${res.dedicated_hsu_beds} Beds</strong>
                    </div>
                    <div class="resource-item">
                        <span>Emergency IV Fluid (0.9% NS / Ringer's):</span>
                        <strong style="color:#15803d;">${res.emergency_iv_fluid_litres} Litres</strong>
                    </div>
                    <div class="resource-item">
                        <span>Active Evaporative Cooling Units:</span>
                        <strong style="color:#15803d;">${res.rapid_cooling_stations} Units</strong>
                    </div>
                </div>

                <!-- Diurnal Casualty Arrival Waves & Nursing Shift Accordion -->
                ${facData.diurnal_casualty_arrival_waves ? `
                <div style="margin-top:6px;">
                    <button data-action="toggle-diurnal" style="
                        width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;
                        padding:6px 10px;font-size:10.5px;font-weight:700;color:#0369a1;
                        display:flex;align-items:center;justify-content:space-between;cursor:pointer;
                    ">
                        <span>🕒 Diurnal Casualty Influx & Shift Staffing</span>
                        <span>${showSurgeDiurnal ? '▲' : '▼'}</span>
                    </button>
                    ${showSurgeDiurnal ? `
                        <div style="background:#ffffff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 6px 6px;padding:8px;font-size:9.5px;">
                            ${Object.entries(facData.diurnal_casualty_arrival_waves).map(([k, wave]) => `
                                <div style="margin-bottom:6px;padding-bottom:6px;border-bottom:1px dashed #e2e8f0;">
                                    <div style="display:flex;justify-content:space-between;font-weight:700;color:#0f172a;">
                                        <span>⏰ ${wave.time_window}</span>
                                        <span style="color:#b91c1c;">~${wave.expected_excess_cases} Cases (${wave.share_percent}%)</span>
                                    </div>
                                    <div style="color:#64748b;font-size:9px;margin-top:1px;">${wave.clinical_mechanism}</div>
                                    <div style="color:#0369a1;font-weight:600;font-size:9px;margin-top:2px;">👨‍⚕️ <em>${wave.shift_recommendation}</em></div>
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>` : ''}

                <!-- Scientific Evidence & Guidelines Accordion -->
                <div style="margin-top:6px;">
                    <button data-action="toggle-citations" style="
                        width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;
                        padding:6px 10px;font-size:10.5px;font-weight:700;color:#0284c7;
                        display:flex;align-items:center;justify-content:space-between;cursor:pointer;
                    ">
                        <span>📚 Evidence Base (WHO, AIIMS, IMD, Lancet)</span>
                        <span>${showSurgeCitations ? '▲' : '▼'}</span>
                    </button>
                    ${showSurgeCitations ? `
                        <div style="background:#ffffff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 6px 6px;padding:8px;max-height:160px;overflow-y:auto;">
                            ${referencesHTML}
                        </div>
                    ` : ''}
                </div>
            `;
        }
    }

    /* Outer Card Assembly */
    const headerTitle = activePredictionTab === 'surge' ? 'Patient Surge Prediction' : 'Heatwave Forecast';
    const headerBadge = activePredictionTab === 'surge' && surge
        ? `<span style="background:${surge.alert_color}18;color:${surge.alert_color};border:1px solid ${surge.alert_color}40;font-weight:800;font-size:10.5px;padding:2px 8px;border-radius:999px;">+${surge.surge_percent}% Surge</span>`
        : `<span style="background:${badgeBg};color:${badgeColor};border:1px solid ${badgeBorder};font-weight:800;font-size:10.5px;padding:2px 8px;border-radius:999px;">${summary.prediction || 'NORMAL'}</span>`;

    card.innerHTML = `
        <!-- Header -->
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <div style="display:flex;align-items:center;gap:6px;">
                <span style="font-size:15px;">${activePredictionTab === 'surge' ? '🏥' : '🔥'}</span>
                <span style="font-size:12px;font-weight:800;color:#0f172a;text-transform:uppercase;letter-spacing:0.04em;">${headerTitle}</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
                ${headerBadge}
                <button data-action="collapse" title="Minimise" style="
                    background:#f1f5f9;border:1.5px solid #cbd5e1;border-radius:6px;
                    width:26px;height:26px;display:flex;align-items:center;justify-content:center;
                    font-size:14px;color:#64748b;cursor:pointer;flex-shrink:0;
                    transition:all 0.15s ease;
                ">−</button>
            </div>
        </div>

        <!-- Sub-navigation: Heat Hazard vs Patient Surge -->
        ${subNavHTML}

        <!-- Tab Body Content -->
        ${tabBodyHTML}
    `;

    /* ── Event delegation: one listener handles ALL buttons ── */
    card._delegatedListener = (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        if (action === 'collapse') {
            isPredictionWidgetCollapsed = true;
            renderPredictionWidget();
        } else if (action === 'expand') {
            isPredictionWidgetCollapsed = false;
            renderPredictionWidget();
        } else if (action === 'tab-weather') {
            activePredictionTab = 'weather';
            renderPredictionWidget();
        } else if (action === 'tab-surge') {
            activePredictionTab = 'surge';
            renderPredictionWidget();
        } else if (action === 'date') {
            activePredictionDate = btn.dataset.date;
            if (typeof switchHeatZoneDate === 'function') {
                switchHeatZoneDate(activePredictionDate);
            }
            renderPredictionWidget();
        } else if (action === 'facility') {
            activeSurgeFacility = btn.dataset.facility;
            renderPredictionWidget();
            focusFacilityOnMap(activeSurgeFacility, true);
        } else if (action === 'toggle-citations') {
            showSurgeCitations = !showSurgeCitations;
            renderPredictionWidget();
        } else if (action === 'toggle-diurnal') {
            showSurgeDiurnal = !showSurgeDiurnal;
            renderPredictionWidget();
        }
    };
    card.addEventListener('click', card._delegatedListener);
}

/* ─────────────────────────────────────────────────────────────
   SCIENTIFIC CITATIONS & METHODOLOGY MODULE
   ───────────────────────────────────────────────────────────── */
let scientificCitationsData = null;
let activeCitationCategory = 'all';
let citationSearchQuery = '';

document.addEventListener("DOMContentLoaded", () => {
    loadScientificCitations();
});

function loadScientificCitations() {
    fetch('/data/scientific_citations.json')
        .then(res => res.json())
        .then(data => {
            scientificCitationsData = data;
            initCitationsUI();
        })
        .catch(err => console.error("Could not load scientific citations:", err));
}

function initCitationsUI() {
    const citationsBtn = document.getElementById('citationsBtn');
    const modal = document.getElementById('citationsModal');
    const closeBtn = document.getElementById('closeCitationsModalBtn');
    const footerCloseBtn = document.getElementById('closeCitationsFooterBtn');
    const searchInput = document.getElementById('citationsSearchInput');

    if (citationsBtn) {
        citationsBtn.addEventListener('click', () => openCitationsModal('all'));
    }
    if (closeBtn) {
        closeBtn.addEventListener('click', () => closeCitationsModal());
    }
    if (footerCloseBtn) {
        footerCloseBtn.addEventListener('click', () => closeCitationsModal());
    }
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeCitationsModal();
        });
    }
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            citationSearchQuery = e.target.value.toLowerCase().trim();
            renderCitationsList();
        });
    }

    renderCitationCategoryPills();
    renderCitationsList();
}

function openCitationsModal(categoryOrId = 'all') {
    const modal = document.getElementById('citationsModal');
    if (!modal) return;

    if (scientificCitationsData && scientificCitationsData.citations) {
        // Check if categoryOrId matches a citation id directly
        const matchedItem = scientificCitationsData.citations.find(c => c.id === categoryOrId);
        if (matchedItem) {
            activeCitationCategory = matchedItem.category;
            citationSearchQuery = matchedItem.title.toLowerCase().slice(0, 20);
            const searchInput = document.getElementById('citationsSearchInput');
            if (searchInput) searchInput.value = matchedItem.title.slice(0, 25);
        } else {
            activeCitationCategory = categoryOrId;
            citationSearchQuery = '';
            const searchInput = document.getElementById('citationsSearchInput');
            if (searchInput) searchInput.value = '';
        }
    }

    renderCitationCategoryPills();
    renderCitationsList();
    modal.classList.add('open');

    const listEl = document.getElementById('citationsListContainer');
    if (listEl) listEl.scrollTop = 0;
}
window.openCitationsModal = openCitationsModal;

function closeCitationsModal() {
    const modal = document.getElementById('citationsModal');
    if (modal) modal.classList.remove('open');
}
window.closeCitationsModal = closeCitationsModal;

function renderCitationCategoryPills() {
    const pillsContainer = document.getElementById('citationsCategoryPills');
    if (!pillsContainer || !scientificCitationsData || !scientificCitationsData.metadata) return;

    const cats = scientificCitationsData.metadata.categories || [];
    pillsContainer.innerHTML = cats.map(cat => {
        const isActive = cat.key === activeCitationCategory;
        const count = cat.key === 'all' 
            ? scientificCitationsData.citations.length 
            : scientificCitationsData.citations.filter(c => c.category === cat.key).length;

        return `<button type="button" class="citations-category-pill ${isActive ? 'active' : ''}" onclick="filterCitationCategory('${cat.key}')">
            <span>${cat.icon}</span>
            <span>${cat.label}</span>
            <span class="pill-count-badge">${count}</span>
        </button>`;
    }).join('');
}

function filterCitationCategory(catKey) {
    activeCitationCategory = catKey;
    renderCitationCategoryPills();
    renderCitationsList();
}
window.filterCitationCategory = filterCitationCategory;

function renderCitationsList() {
    const container = document.getElementById('citationsListContainer');
    const countLabel = document.getElementById('citationsCountLabel');
    if (!container || !scientificCitationsData) return;

    let items = scientificCitationsData.citations || [];

    if (activeCitationCategory !== 'all') {
        items = items.filter(c => c.category === activeCitationCategory);
    }

    if (citationSearchQuery) {
        items = items.filter(c => 
            c.title.toLowerCase().includes(citationSearchQuery) ||
            c.authors.toLowerCase().includes(citationSearchQuery) ||
            c.venue.toLowerCase().includes(citationSearchQuery) ||
            (c.formula_mapping && c.formula_mapping.toLowerCase().includes(citationSearchQuery)) ||
            (c.implementation_role && c.implementation_role.toLowerCase().includes(citationSearchQuery))
        );
    }

    if (countLabel) countLabel.textContent = items.length;

    if (!items.length) {
        container.innerHTML = `
            <div style="padding:40px 20px;text-align:center;color:#64748b;">
                <div style="font-size:32px;margin-bottom:8px;">🔍</div>
                <div style="font-weight:700;font-size:14px;color:#0f172a;">No citations matched your search.</div>
                <div style="font-size:12px;margin-top:4px;">Try searching for terms like "Landsat", "WHO", "NDVI", "BSI", or "Surge".</div>
            </div>
        `;
        return;
    }

    container.innerHTML = items.map(c => `
        <div class="citation-card" id="cite-${c.id}">
            <div class="citation-card-top">
                <span class="citation-badge">
                    <span>${c.category_icon}</span>
                    <span>${c.category_label}</span>
                </span>
                <span class="citation-year-badge">${c.year}</span>
            </div>

            <h3 class="citation-title">${c.title}</h3>

            <div class="citation-authors">
                <strong>Authors / Agency:</strong> ${c.authors}
            </div>

            <div class="citation-venue">
                <em>${c.venue}</em>
            </div>

            <div class="citation-role-box">
                <div class="citation-role-title">⚙️ ShadeRoute Analytical Implementation:</div>
                <div class="citation-role-desc">${c.implementation_role}</div>
                ${c.formula_mapping ? `<div class="citation-formula-code"><code>${c.formula_mapping}</code></div>` : ''}
            </div>

            <div class="citation-card-actions">
                ${c.doi_or_url ? `
                <a href="${c.doi_or_url}" target="_blank" rel="noopener noreferrer" class="citation-link-btn" title="Open persistent DOI or official documentation in new tab">
                    <span>🔗 ${c.url_type || 'Official Documentation'}</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                </a>` : ''}

                <button type="button" class="citation-copy-btn" onclick="copyCitationText('${c.apa_citation.replace(/'/g, "\\'")}', this)" title="Copy APA formatted citation to clipboard">
                    <span>📋</span>
                    <span>Copy Citation (APA)</span>
                </button>
            </div>
        </div>
    `).join('');
}

function copyCitationText(text, btnEl) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            if (btnEl) {
                const originalHTML = btnEl.innerHTML;
                btnEl.innerHTML = '<span>✓ Copied!</span>';
                btnEl.style.background = '#ecfdf5';
                btnEl.style.borderColor = '#10b981';
                btnEl.style.color = '#065f46';
                setTimeout(() => {
                    btnEl.innerHTML = originalHTML;
                    btnEl.style.background = '';
                    btnEl.style.borderColor = '';
                    btnEl.style.color = '';
                }, 2000);
            }
            showMessage('✓ APA Citation copied to clipboard!');
        }).catch(() => {
            fallbackCopy(text);
        });
    } else {
        fallbackCopy(text);
    }
}
window.copyCitationText = copyCitationText;

function fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
        showMessage('✓ APA Citation copied to clipboard!');
    } catch (e) {
        showMessage('Could not copy to clipboard.');
    }
    document.body.removeChild(textarea);
}
