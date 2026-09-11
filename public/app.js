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
}

function updateMapLayersForMode() {
    if (typeof map === 'undefined' || !map.isStyleLoaded()) return;

    const isIntervention = currentMode === 'intervention';
    const isHeatStress = currentMode === 'heatstress';

    // Priority Grid Layers (Intervention Mode)
    if (map.getLayer('priority-grid')) {
        map.setLayoutProperty('priority-grid', 'visibility', isIntervention ? 'visible' : 'none');
    }
    if (map.getLayer('priority-grid-highlight')) {
        map.setLayoutProperty('priority-grid-highlight', 'visibility', isIntervention ? 'visible' : 'none');
    }

    // Recommended Map Markers (Intervention Mode)
    if (typeof treeMarkers !== 'undefined') {
        treeMarkers.forEach(marker => {
            const el = marker.getElement();
            if (el) el.style.display = isIntervention ? 'block' : 'none';
        });
    }
    if (typeof mistMarkers !== 'undefined') {
        mistMarkers.forEach(marker => {
            const el = marker.getElement();
            if (el) el.style.display = isIntervention ? 'block' : 'none';
        });
    }

    // Heat Risk Polygon Layers (Heat Stress Mode)
    if (map.getLayer('heat-risk-zones-fill')) {
        map.setLayoutProperty('heat-risk-zones-fill', 'visibility', isHeatStress ? 'visible' : 'none');
    }
    if (map.getLayer('heat-risk-zones-outline')) {
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
        if (cell.intervention_type === 'Mist Sprayer') { badgeBg = '#0284c7'; }
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
function buildHeatZoneDatePicker() {
    if (!heatZoneManifest || !heatZoneManifest.dates || !heatZoneManifest.dates.length) return;

    let select = document.getElementById('heatZoneDateSelect');
    if (!select) {
        select = document.createElement('select');
        select.id = 'heatZoneDateSelect';
        select.style.cssText = `
            font-family: Inter, sans-serif;
            font-weight: 700;
            font-size: 11px;
            padding: 4px 8px;
            border: 1px solid var(--border);
            border-radius: 6px;
            background: rgba(0, 0, 0, 0.4);
            color: #fff;
            cursor: pointer;
        `;

        const container = document.getElementById('datePickerContainer');
        if (container) {
            container.appendChild(select);
        }

        select.addEventListener('change', () => {
            const entry = heatZoneManifest.dates.find(d => d.date === select.value);
            if (!entry) return;

            fetch(`/data/${entry.file}`)
                .then(res => res.json())
                .then(zonesGeoJSON => {
                    currentHeatZoneDate = entry.date;
                    if (map.getSource('heat-risk-zones')) {
                        map.getSource('heat-risk-zones').setData(zonesGeoJSON);
                    }
                    showMessage(`Showing thermal stress for ${entry.date}`);
                })
                .catch(error => console.error(`Could not load heat risk data for ${entry.date}:`, error));
        });
    }

    select.innerHTML = heatZoneManifest.dates.map(d => {
        const label = d.date === heatZoneManifest.today ? `${d.date} (Today)` : d.date;
        return `<option value="${d.date}">${label}</option>`;
    }).join('');
    select.value = currentHeatZoneDate || heatZoneManifest.today;
}

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
// FLOATING RIGHT PREDICTION WIDGET
// ============================================================

let predictionsSummaryData = null;
let predictionsRecommendationsData = null;
let activePredictionDate = "2026-05-13";

function switchPredictionDate(dateStr) {
    activePredictionDate = dateStr;
    renderPredictionWidget();
}
window.switchPredictionDate = switchPredictionDate;

document.addEventListener("DOMContentLoaded", () => {
    loadRightPredictionWidget();
});

function loadRightPredictionWidget() {
    Promise.all([
        fetch('/data/predictions_may2026.json').then(res => res.json()).catch(() => null),
        fetch('/data/hourly_predictions_may2026.json').then(res => res.json()).catch(() => null)
    ])
    .then(([summary, hourlyData]) => {
        if (!summary || !hourlyData) return;
        predictionsSummaryData = summary;
        predictionsRecommendationsData = hourlyData;

        renderPredictionWidget();
    })
    .catch(err => console.error("Error loading prediction datasets:", err));
}


let isPredictionWidgetCollapsed = false;

/* ─── Public helpers exposed to window ─────────────────────── */
function togglePredictionWidget() {
    isPredictionWidgetCollapsed = !isPredictionWidgetCollapsed;
    renderPredictionWidget();
}
window.togglePredictionWidget = togglePredictionWidget;

function switchPredictionDate(dateStr) {
    activePredictionDate = dateStr;
    renderPredictionWidget();
}
window.switchPredictionDate = switchPredictionDate;

/* ─── Main render function ──────────────────────────────────── */
function renderPredictionWidget() {
    const card = document.getElementById('rightPredictionCard');
    if (!card) return;

    const availableDates = Object.keys(predictionsSummaryData || {}).sort();
    if (!availableDates.length) return;

    if (!availableDates.includes(activePredictionDate)) {
        activePredictionDate = availableDates[0];
    }

    const summary = predictionsSummaryData[activePredictionDate] || {};
    const rec     = predictionsRecommendationsData[activePredictionDate] || {};

    const isHeatwave  = (summary.prediction || '').toUpperCase() === 'HEATWAVE';
    const badgeColor  = isHeatwave ? '#dc2626' : '#059669';
    const badgeBg     = isHeatwave ? '#fef2f2' : '#ecfdf5';
    const badgeBorder = isHeatwave ? '#fecaca' : '#a7f3d0';
    const probPct     = ((rec.heatwave_probability || summary.probability_of_heatwave || 0) * 100).toFixed(0);

    /* ── Reset card styles ── */
    card.style.cssText = '';
    card.className = 'floating-prediction-card';
    // Remove any old delegated listener so we don't stack them
    if (card._delegatedListener) {
        card.removeEventListener('click', card._delegatedListener);
        card._delegatedListener = null;
    }

    /* ─────────────────────────────────────────────────────────────
       COLLAPSED STATE — a slim pill the user clicks to expand
    ───────────────────────────────────────────────────────────── */
    if (isPredictionWidgetCollapsed) {
        card.style.cssText = `
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
        card.innerHTML = `
            <span style="font-size:15px;">🔥</span>
            <span style="font-size:12px;font-weight:700;color:#0f172a;">Heatwave Forecast</span>
            <span style="background:${badgeBg};color:${badgeColor};border:1px solid ${badgeBorder};font-weight:800;font-size:10px;padding:2px 7px;border-radius:999px;">
                ${summary.prediction || 'NORMAL'}
            </span>
            <span data-action="expand" style="font-size:11px;color:#64748b;font-weight:600;margin-left:auto;white-space:nowrap;">↑ Expand</span>
        `;
        // Single delegated listener — clicking anywhere on collapsed card expands
        card._delegatedListener = () => { isPredictionWidgetCollapsed = false; renderPredictionWidget(); };
        card.addEventListener('click', card._delegatedListener);
        return;
    }

    /* ─────────────────────────────────────────────────────────────
       EXPANDED STATE — full widget
    ───────────────────────────────────────────────────────────── */
    card.style.cssText = `
        position: fixed;
        top: 88px;
        right: 16px;
        width: 330px;
        max-width: calc(100vw - 32px);
        z-index: 30;
        background: rgba(255,255,255,0.97);
        backdrop-filter: blur(24px) saturate(180%);
        -webkit-backdrop-filter: blur(24px) saturate(180%);
        border: 1px solid rgba(255,255,255,0.65);
        border-radius: 16px;
        padding: 16px;
        color: #0f172a;
        box-shadow: 0 20px 40px -8px rgba(15,23,42,0.14), 0 4px 12px rgba(15,23,42,0.06);
        font-family: 'Plus Jakarta Sans','Inter',sans-serif;
        max-height: calc(100vh - 120px);
        overflow-y: auto;
    `;

    /* Date tabs */
    const tabsHTML = availableDates.map(dateStr => {
        const parts    = dateStr.split('-');
        const dayLabel = (parts[2] || dateStr) + ' May';
        const isActive = dateStr === activePredictionDate;
        return `<button data-action="date" data-date="${dateStr}" style="
            flex:1;padding:6px 0;font-size:11px;font-family:inherit;font-weight:700;
            border-radius:6px;border:none;cursor:pointer;transition:all 0.15s ease;
            background:${isActive ? '#059669' : 'transparent'};
            color:${isActive ? '#fff' : '#64748b'};
            ${isActive ? 'box-shadow:0 1px 4px rgba(5,150,105,0.25);' : ''}
        ">${dayLabel}</button>`;
    }).join('');

    /* Hourly timeline */
    const hourlyEntries  = rec.hourly_status ? Object.entries(rec.hourly_status) : [];
    const hourlyPillsHTML = hourlyEntries.map(([hour, status]) => {
        const pillBg    = status === 'UNSAFE' ? '#dc2626' : status === 'CAUTION' ? '#f59e0b' : '#10b981';
        return `<div title="${hour}:00 — ${status}" style="display:flex;flex-direction:column;align-items:center;gap:3px;">
            <span style="font-size:8.5px;color:#94a3b8;font-weight:600;">${hour}h</span>
            <div style="width:15px;height:15px;border-radius:3px;background:${pillBg};
                display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:800;color:#fff;">
                ${status[0]}
            </div>
        </div>`;
    }).join('');

    /* Safe windows */
    const goOutWindows = (rec.recommended_go_out_windows || []).map(w =>
        `<span style="background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46;padding:2px 7px;border-radius:4px;font-size:10.5px;font-weight:700;">🟢 ${w}</span>`
    ).join(' ');

    card.innerHTML = `
        <!-- Header -->
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <div style="display:flex;align-items:center;gap:6px;">
                <span style="font-size:15px;">🔥</span>
                <span style="font-size:12px;font-weight:800;color:#0f172a;text-transform:uppercase;letter-spacing:0.04em;">Heatwave Forecast</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
                <span style="background:${badgeBg};color:${badgeColor};border:1px solid ${badgeBorder};font-weight:800;font-size:10.5px;padding:2px 8px;border-radius:999px;">
                    ${summary.prediction || 'NORMAL'}
                </span>
                <button data-action="collapse" title="Minimise" style="
                    background:#f1f5f9;border:1.5px solid #cbd5e1;border-radius:6px;
                    width:26px;height:26px;display:flex;align-items:center;justify-content:center;
                    font-size:14px;color:#64748b;cursor:pointer;flex-shrink:0;
                    transition:all 0.15s ease;
                ">−</button>
            </div>
        </div>

        <!-- Date Tabs -->
        <div style="display:flex;gap:3px;background:#f1f5f9;padding:3px;border-radius:8px;margin-bottom:12px;border:1px solid #e2e8f0;">
            ${tabsHTML}
        </div>

        <!-- Stats Grid -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;background:#f8fafc;padding:10px;border-radius:8px;border:1px solid #e2e8f0;">
            <div>
                <div style="font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;">Heatwave Risk</div>
                <div style="font-size:20px;font-weight:800;color:${isHeatwave ? '#dc2626' : '#059669'};margin-top:1px;">${probPct}%</div>
            </div>
            <div>
                <div style="font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;">Unsafe Hours</div>
                <div style="font-size:15px;font-weight:800;color:#0f172a;margin-top:4px;">${rec.expected_unsafe_duration || '0 hrs'}</div>
            </div>
        </div>

        <!-- Danger Window -->
        <div style="margin-bottom:10px;">
            <div style="color:#64748b;font-size:10px;font-weight:700;margin-bottom:3px;text-transform:uppercase;">Peak Danger Window:</div>
            <div style="color:#991b1b;font-weight:700;background:#fef2f2;border:1px solid #fecaca;border-left:3px solid #dc2626;padding:5px 8px;border-radius:5px;font-size:12px;">
                ⚠️ ${rec.danger_window || 'None (Safe Conditions)'}
            </div>
        </div>

        <!-- Safe Windows -->
        <div style="margin-bottom:12px;">
            <div style="color:#64748b;font-size:10px;font-weight:700;margin-bottom:4px;text-transform:uppercase;">Best Outdoor Windows:</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">${goOutWindows}</div>
        </div>

        <!-- Hourly Timeline -->
        <div>
            <div style="color:#64748b;font-size:10px;font-weight:700;margin-bottom:5px;text-transform:uppercase;">Hourly Safety (08:00–20:00):</div>
            <div style="display:flex;justify-content:space-between;background:#f8fafc;padding:8px 10px;border-radius:8px;border:1px solid #e2e8f0;flex-wrap:wrap;gap:4px;">
                ${hourlyPillsHTML}
            </div>
        </div>
    `;

    /* ── Event delegation: one listener handles ALL buttons ── */
    card._delegatedListener = (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        if (action === 'collapse') {
            isPredictionWidgetCollapsed = true;
            renderPredictionWidget();
        } else if (action === 'date') {
            activePredictionDate = btn.dataset.date;
            renderPredictionWidget();
        } else if (action === 'expand') {
            isPredictionWidgetCollapsed = false;
            renderPredictionWidget();
        }
    };
    card.addEventListener('click', card._delegatedListener);
}