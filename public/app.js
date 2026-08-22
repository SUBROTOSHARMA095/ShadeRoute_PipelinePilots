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

// --- Heat Risk Zones state ---
let heatZoneLegendData = null;   // parsed heat_zone_legend.json
let heatZonesVisible = false;    // layer starts hidden until user toggles it

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

            map.fitBounds(bounds, { padding: 50 });
            map.setMaxBounds(bounds);
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

    // 7. Human Heat Index Zones (GeoJSON polygons + legend JSON)
    loadHeatRiskZones();
});

// ============================================================
// UI CONTROLS & EVENT LISTENERS
// ============================================================

document.addEventListener("DOMContentLoaded", function () {
    // Sidebar Open / Close
    const menuBtn = document.getElementById("menuButton");
    const closeBtn = document.getElementById("closeSidebar");
    const sidebar = document.getElementById("sidebar");

    if (menuBtn && sidebar) {
        menuBtn.addEventListener("click", () => sidebar.classList.remove("collapsed"));
    }
    if (closeBtn && sidebar) {
        closeBtn.addEventListener("click", () => sidebar.classList.add("collapsed"));
    }

    // Sidebar Scenario Buttons
    const treeBtn = document.getElementById("recommendTreesBtn");
    const mistBtn = document.getElementById("recommendMistBtn");

    if (treeBtn) treeBtn.addEventListener("click", recommendTreeLocations);
    if (mistBtn) mistBtn.addEventListener("click", recommendMistSprayerLocations);

    // Suggestion action button
    const suggestionAction = document.getElementById("suggestionAction");
    if (suggestionAction) {
        suggestionAction.addEventListener("click", function () {
            showMessage("Prioritize native trees near busy walking areas and public spaces");
        });
    }

    // Heat Risk Zones toggle + sidebar legend get built once the sidebar exists
    buildHeatZoneSidebarSection();
});

// Map Zoom Controls
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

// North Compass Reset
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
    const pinColor = isTree ? '#10b981' : '#00e5ff';
    const icon = isTree ? '🌳' : '💧';

    el.innerHTML = `
        <div style="
            position: relative;
            width: 26px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            filter: drop-shadow(0px 3px 6px rgba(0,0,0,0.65));
            transition: transform 0.2s ease;
        ">
            <svg width="26" height="32" viewBox="0 0 24 30" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 0C5.37 0 0 5.37 0 12C0 21 12 30 12 30C12 30 24 21 24 12C24 5.37 18.63 0 12 0Z" fill="${pinColor}" stroke="#000000" stroke-width="1.5"/>
                <circle cx="12" cy="11" r="7.5" fill="#ffffff" stroke="#000000" stroke-width="1"/>
            </svg>
            <span style="position: absolute; top: 3px; font-size: 10px;">${icon}</span>
        </div>
    `;

    el.addEventListener('mouseenter', () => el.firstElementChild.style.transform = 'scale(1.3)');
    el.addEventListener('mouseleave', () => el.firstElementChild.style.transform = 'scale(1)');

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

        let badgeBg = '#facc15';
        if (cell.intervention_type === 'Mist Sprayer') badgeBg = '#00ffff';
        else if (cell.priority_class === 'Very High') badgeBg = '#ff2a2a';
        else if (cell.priority_class === 'High') badgeBg = '#ff8800';
        else if (cell.priority_class === 'Low') badgeBg = '#10b981';
        else if (cell.priority_class === 'Very Low') badgeBg = '#3b82f6';

        const popupHTML = `
            <div style="line-height:1.35; font-family: 'Comic Sans MS', 'Chalkboard SE', sans-serif;">
                <div class="comic-badge" style="background:${badgeBg};">
                    ${cell.intervention_type || 'Priority Grid'}
                </div>

                <div style="font-weight:900; font-size:16px; text-transform:uppercase; margin-bottom:2px;">
                    ${cell.priority_class} Priority
                </div>

                <div style="font-weight:bold; font-size:13px; color:#111; margin-bottom:8px; border-bottom:2px dashed #000; padding-bottom:4px;">
                    Priority Score: <span style="font-size:16px; font-weight:900; color:#d97706;">${Number(cell.priority_score).toFixed(1)}</span> / 100
                </div>

                <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 4px; font-size:11px; font-weight:700; background:#f8fafc; padding:6px; border:2px solid #000; border-radius:8px; margin-bottom:6px;">
                    <div>🌡️ LST: <b>${Number(cell.LST).toFixed(1)}°C</b></div>
                    <div>🌿 Veg: <b>${(Number(cell.vegetation_fraction) * 100).toFixed(0)}%</b></div>
                    <div>🟢 NDVI: <b>${Number(cell.NDVI).toFixed(2)}</b></div>
                    <div>🏗️ NDBI: <b>${Number(cell.NDBI).toFixed(2)}</b></div>
                    <div>⏳ BSI: <b>${Number(cell.BSI).toFixed(2)}</b></div>
                    <div>💧 NDWI: <b>${Number(cell.NDWI).toFixed(2)}</b></div>
                </div>

                <div style="font-size:10px; font-weight:bold; color:#475569; margin-bottom:6px;">
                    📍 Coords: ${Number(cell.latitude).toFixed(5)}, ${Number(cell.longitude).toFixed(5)}
                </div>

                <div style="font-size:10.5px; font-weight:700; background:#fff7ed; padding:6px; border:2px solid #000; border-radius:6px; margin-top:4px;">
                    💡 <i>"${cell.recommendation || 'No recommendation provided.'}"</i>
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

    // Remove existing tree pin markers
    treeMarkers.forEach(m => m.remove());
    treeMarkers = [];

    // Add high-visibility location pointer pin markers
    recommendations.forEach(cell => {
        const pinEl = createLocationPin('tree');
        const marker = new maplibregl.Marker({ element: pinEl, anchor: 'bottom' })
            .setLngLat([Number(cell.longitude), Number(cell.latitude)])
            .addTo(map);

        treeMarkers.push(marker);
    });

    showMessage(`${recommendations.length} tree planting locations pinned on map`);
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

    // Remove existing mist pin markers
    mistMarkers.forEach(m => m.remove());
    mistMarkers = [];

    // Add high-visibility location pointer pin markers
    recommendations.forEach(cell => {
        const pinEl = createLocationPin('mist');
        const marker = new maplibregl.Marker({ element: pinEl, anchor: 'bottom' })
            .setLngLat([Number(cell.longitude), Number(cell.latitude)])
            .addTo(map);

        mistMarkers.push(marker);
    });

    showMessage(`${recommendations.length} mist sprayers pinned across walking paths`);
}

// ============================================================
// SCENARIO 3: HUMAN HEAT INDEX ZONES
// ============================================================
// Data source: heat_risk_classification.py output
//   /data/heat_risk_zones.geojson  -> zone polygons (Low/Moderate/High risk)
//   /data/heat_zone_legend.json    -> per-class advisory text for the sidebar

const HEAT_ZONE_COLORS = {
    'Low Risk': '#16a34a',
    'Moderate Risk': '#f59e0b',
    'High Risk': '#b91c1c'
};

function loadHeatRiskZones() {
    Promise.all([
        fetch('/data/heat_risk_zones.geojson').then(res => res.json()),
        fetch('/data/heat_zone_legend.json').then(res => res.json())
    ])
        .then(([zonesGeoJSON, legendJSON]) => {
            heatZoneLegendData = legendJSON;

            map.addSource('heat-risk-zones', {
                type: 'geojson',
                data: zonesGeoJSON
            });

            map.addLayer({
                id: 'heat-risk-zones-fill',
                type: 'fill',
                source: 'heat-risk-zones',
                layout: {
                    // hidden by default; toggled on from the sidebar
                    visibility: 'none'
                },
                paint: {
                    'fill-color': [
                        'match', ['get', 'risk_class'],
                        'Low Risk', HEAT_ZONE_COLORS['Low Risk'],
                        'Moderate Risk', HEAT_ZONE_COLORS['Moderate Risk'],
                        'High Risk', HEAT_ZONE_COLORS['High Risk'],
                        '#9ca3af'
                    ],
                    'fill-opacity': 0.45
                }
            });

            map.addLayer({
                id: 'heat-risk-zones-outline',
                type: 'line',
                source: 'heat-risk-zones',
                layout: {
                    visibility: 'none'
                },
                paint: {
                    'line-color': [
                        'match', ['get', 'risk_class'],
                        'Low Risk', HEAT_ZONE_COLORS['Low Risk'],
                        'Moderate Risk', HEAT_ZONE_COLORS['Moderate Risk'],
                        'High Risk', HEAT_ZONE_COLORS['High Risk'],
                        '#6b7280'
                    ],
                    'line-width': 1.5,
                    'line-opacity': 0.9
                }
            });

            addHeatZoneClickInteraction();
            populateHeatZoneLegendPanel();
        })
        .catch(error => console.error('Could not load heat risk zone data:', error));
}

function toggleHeatZonesLayer() {
    if (!map.getLayer('heat-risk-zones-fill')) {
        showMessage('Heat zone data not loaded yet');
        return;
    }

    heatZonesVisible = !heatZonesVisible;
    const visibility = heatZonesVisible ? 'visible' : 'none';

    map.setLayoutProperty('heat-risk-zones-fill', 'visibility', visibility);
    map.setLayoutProperty('heat-risk-zones-outline', 'visibility', visibility);

    const toggleBtn = document.getElementById('toggleHeatZonesBtn');
    if (toggleBtn) {
        toggleBtn.classList.toggle('active', heatZonesVisible);
    }

    showMessage(heatZonesVisible ? 'Heat risk zones shown' : 'Heat risk zones hidden');
}

function addHeatZoneClickInteraction() {
    map.on('click', 'heat-risk-zones-fill', function (event) {
        if (!event.features || !event.features.length) return;

        const feature = event.features[0];
        const props = feature.properties;
        const coordinates = event.lngLat;

        if (activeComicPopup) {
            activeComicPopup.remove();
        }

        const riskClass = props.risk_class;
        const badgeBg = HEAT_ZONE_COLORS[riskClass] || '#9ca3af';
        const classInfo = heatZoneLegendData && heatZoneLegendData.zones
            ? heatZoneLegendData.zones[riskClass]
            : null;

        const advisoryListHTML = classInfo
            ? classInfo.advisory.map(line => `<li>${line}</li>`).join('')
            : '<li>No advisory data available.</li>';

        const popupHTML = `
            <div style="line-height:1.35; font-family: 'Comic Sans MS', 'Chalkboard SE', sans-serif;">
                <div class="comic-badge" style="background:${badgeBg};">
                    🌡️ ${riskClass}
                </div>

                <div style="font-weight:900; font-size:15px; margin-bottom:4px;">
                    ${props.zone_name || 'Heat Zone'}
                </div>

                <div style="font-size:11px; font-weight:700; color:#111; margin-bottom:8px;">
                    ${classInfo ? classInfo.summary : ''}
                </div>

                <div style="font-size:10.5px; font-weight:700; background:#fff7ed; padding:6px; border:2px solid #000; border-radius:6px;">
                    <b>Precautions:</b>
                    <ul style="margin:4px 0 0 16px; padding:0;">
                        ${advisoryListHTML}
                    </ul>
                </div>

                <div style="font-size:10px; font-weight:bold; color:#475569; margin-top:6px;">
                    📐 Area: ${props.area_m2 ? Math.round(props.area_m2) + ' m²' : 'N/A'}
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
    });

    map.on('mouseenter', 'heat-risk-zones-fill', () => {
        map.getCanvas().style.cursor = 'pointer';
    });

    map.on('mouseleave', 'heat-risk-zones-fill', () => {
        map.getCanvas().style.cursor = '';
    });
}

// ------------------------------------------------------------
// Sidebar section: legend + toggle button
// ------------------------------------------------------------
// Built dynamically so this feature doesn't depend on you having
// pre-added matching markup in your HTML. If you'd rather hand-place
// this in your sidebar's HTML directly, just move the innerHTML below
// into a <div id="heatZoneSection"></div> in your sidebar and delete
// the injection code — populateHeatZoneLegendPanel() will still work
// as long as that container id exists.

function buildHeatZoneSidebarSection() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar || document.getElementById('heatZoneSection')) return;

    const section = document.createElement('div');
    section.id = 'heatZoneSection';
    section.className = 'sidebar-section';
    section.innerHTML = `
        <h3 style="margin-bottom:6px;">Human Heat Index</h3>
        <button id="toggleHeatZonesBtn" class="sidebar-btn">
            Show Heat Risk Zones
        </button>
        <div id="heatZoneLegendList" style="margin-top:10px; font-size:12px;"></div>
    `;
    sidebar.appendChild(section);

    const toggleBtn = document.getElementById('toggleHeatZonesBtn');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', toggleHeatZonesLayer);
    }

    // If the legend data already arrived before the sidebar was built, render it now
    if (heatZoneLegendData) {
        populateHeatZoneLegendPanel();
    }
}

function populateHeatZoneLegendPanel() {
    const listEl = document.getElementById('heatZoneLegendList');
    if (!listEl || !heatZoneLegendData || !heatZoneLegendData.zones) return;

    const order = ['High Risk', 'Moderate Risk', 'Low Risk'];

    listEl.innerHTML = order.map(riskClass => {
        const info = heatZoneLegendData.zones[riskClass];
        if (!info) return '';
        const color = HEAT_ZONE_COLORS[riskClass] || '#9ca3af';

        return `
            <div class="heat-legend-item" style="
                display:flex;
                align-items:flex-start;
                gap:8px;
                margin-bottom:8px;
                padding:8px;
                border-radius:8px;
                background:rgba(255,255,255,0.04);
            ">
                <span style="
                    width:12px; height:12px; border-radius:3px;
                    background:${color}; margin-top:3px; flex-shrink:0;
                "></span>
                <div>
                    <div style="font-weight:700;">${riskClass}</div>
                    <div style="opacity:0.85; font-size:11px; margin-top:2px;">
                        ${info.summary}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}