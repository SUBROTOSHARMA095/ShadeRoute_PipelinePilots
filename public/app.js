const map = new maplibregl.Map({
    container: 'map',
    style: '/style.json',
    /*center: [85.8015, 20.2475],
    zoom: 15,*/
});

let priorityData = [];
let treeRecommendationData = [];
let selectedGridCell = null;
let gridVisible = true;

map.on('load', () => {

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
            console.log("Bounds:", bounds.toArray());

            map.fitBounds(bounds, {
                padding: 50
            });

            map.setMaxBounds(bounds);
        });

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
    .catch(error => {
        console.error('Error loading roads:', error);
    });


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
    .catch(error => {
        console.error('Error loading paths:', error);
    });

    // ============================================================
    // VEGETATION PRIORITY GRID
    // ============================================================

    Promise.all([
        fetch('/data/SOA_ITER_10m_Planting_Priority_2026.csv')
            .then(response => response.text()),

        fetch('/data/tree_recommendations_250_2026.csv')
            .then(response => response.text())
    ])
    .then(([priorityCSV, treeCSV]) => {

        priorityData = parseCSV(priorityCSV);
        treeRecommendationData = parseCSV(treeCSV);

        addPriorityGrid();
        addGridClickInteraction();
        createTreeScenarioControl();
        createMistSprayerScenarioControl();

    })
    .catch(error => {
        console.error("Could not load ML grid data:", error);
    });

    fetch('/data/missingBuildings.geojson')
    .then(response => response.json())
    .then(data => {

        map.addSource('buildings', {
            type: 'geojson',
            data: data
        });

        // Building fill
        map.addLayer({
            id: 'buildings-fill',
            type: 'fill',
            source: 'buildings',
            paint: {
                'fill-color': '#d9d0c9',
                'fill-opacity': 0.75
            }
        });

        // Building outline
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
});

// ============================================================
// CSV PARSER
// ============================================================

function parseCSV(text) {

    const lines = text
        .trim()
        .split(/\r?\n/);

    const headers = lines[0]
        .split(',')
        .map(header => header.trim());

    return lines
        .slice(1)
        .map(line => {

            const values = line.split(',');

            const row = {};

            headers.forEach((header, index) => {

                row[header] =
                    values[index];

            });

            return row;

        });

}

/*
    S18 - ShadeRoute
    Application Logic
*/
// ===============================
// 1. SIDEBAR OPEN / CLOSE
// ===============================

const menuBtn = document.getElementById("menuButton");
const closeBtn = document.getElementById("closeSidebar");
const sidebar = document.getElementById("sidebar");

menuBtn.addEventListener("click", function () {
    sidebar.classList.remove("collapsed");
});

closeBtn.addEventListener("click", function () {
    sidebar.classList.add("collapsed");
});

// ===============================
// 2. MAP ZOOM CONTROLS
// ===============================

const mapControls = document.querySelectorAll(".map-control");
const northButton = document.getElementById("northButton");
const compassArrow = document.getElementById("compassArrow");

mapControls[0].addEventListener("click", function () {
    map.zoomIn();
    showMessage("Zoom: " + Math.round(map.getZoom()));
});

mapControls[1].addEventListener("click", function () {
    map.zoomOut();
    showMessage("Zoom: " + Math.round(map.getZoom()));
});


// ===============================
// 3. NORTH COMPASS
// ===============================

const mapLocationButton = northButton;

mapLocationButton.addEventListener("click", function () {
    map.resetNorth();
    showMessage("Map reset to north");
});

map.on("rotate", function () {
    compassArrow.style.transform = "rotate(" + (-map.getBearing()) + "deg)";
});


const suggestionAction = document.getElementById("suggestionAction");

suggestionAction.addEventListener("click", function () {
    showMessage("Prioritize native trees near busy walking areas and public spaces");
});


// ===============================
// 4. MAP LAYERS
// ===============================

const layerToggles =
    document.querySelectorAll(".toggle");

const layerNames = [
    "Heat exposure",
    "Air quality"
];

layerToggles.forEach(function (toggle, index) {

    toggle.addEventListener("change", function () {

        if (toggle.checked) {

            showMessage(
                layerNames[index] + " layer ON"
            );

            addMapLayer(index);

        } else {

            showMessage(
                layerNames[index] + " layer OFF"
            );

            removeMapLayer(index);
        }
    });
});


// ===============================
// 5. ENVIRONMENT MAP OVERLAYS
// ===============================

function addMapLayer(index) {

    const map = document.getElementById("map");

    let layer = document.getElementById(
        "layer-" + index
    );

    if (layer) {
        return;
    }

    layer = document.createElement("div");

    layer.id = "layer-" + index;
    layer.style.position = "absolute";
    layer.style.left = "20%";
    layer.style.top = "30%";
    layer.style.width = "55%";
    layer.style.height = "45%";
    layer.style.borderRadius = "50%";
    layer.style.pointerEvents = "none";
    layer.style.opacity = "0.25";
    layer.style.filter = "blur(20px)";

    if (index === 0) {
        layer.style.background = "#ff7043";
    }

    if (index === 1) {
        layer.style.background = "#b36bff";
    }

    map.appendChild(layer);
}


function removeMapLayer(index) {

    const layer = document.getElementById(
        "layer-" + index
    );

    if (layer) {
        layer.remove();
    }
}


// ===============================
// 5. CURRENT CONDITIONS
// ===============================

function updateConditions() {

    const cards =
        document.querySelectorAll(".condition-card");

    if (cards.length < 3) {
        return;
    }

    const temperature =
        Math.floor(31 + Math.random() * 5);

    const aqi =
        Math.floor(60 + Math.random() * 60);

    const shade =
        Math.floor(40 + Math.random() * 40);

    cards[0].querySelector("strong").textContent =
        temperature;

    cards[1].querySelector("strong").textContent =
        aqi;

    cards[2].querySelector("strong").textContent =
        shade + "%";
}


// ===============================
// 6. MESSAGE / NOTIFICATION
// ===============================

function showMessage(message) {

    let notification =
        document.getElementById("appNotification");

    if (!notification) {

        notification = document.createElement("div");

        notification.id = "appNotification";

        notification.style.position = "fixed";
        notification.style.left = "50%";
        notification.style.bottom = "25px";
        notification.style.transform =
            "translateX(-50%)";
        notification.style.zIndex = "100";
        notification.style.padding =
            "10px 16px";
        notification.style.borderRadius =
            "10px";
        notification.style.background =
            "rgba(7,17,15,.95)";
        notification.style.border =
            "1px solid rgba(255,255,255,.1)";
        notification.style.color =
            "#edf7f2";
        notification.style.fontSize =
            "11px";
        notification.style.boxShadow =
            "0 10px 30px rgba(0,0,0,.35)";

        document.body.appendChild(notification);
    }

    notification.textContent = message;

    clearTimeout(notification.timer);

    notification.timer =
        setTimeout(function () {
            notification.remove();
        }, 2000);
}

updateConditions();

// ============================================================
// ADD PRIORITY GRID
// ============================================================

function addPriorityGrid() {
    if (map.getSource('priority-grid')) return;

    const features = priorityData.map((cell, index) => {
        return {
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
        };
    });

    map.addSource('priority-grid', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: features }
    });

    // 1. MAIN GRID LAYER (High-contrast, distinct class colors)
    map.addLayer({
        id: 'priority-grid',
        type: 'circle',
        source: 'priority-grid',
        paint: {
            'circle-radius': 6,
            'circle-color': [
                'case',
                // Mist Sprayer (Neon Cyan)
                ['==', ['get', 'intervention_type'], 'Mist Sprayer'], '#00ffff',

                // Class-based distinct colors for Tree Priorities
                ['match', ['get', 'priority_class'],
                    'Very High', '#dc2626', // Crimson Red
                    'High',      '#f97316', // Bright Orange
                    'Moderate',  '#facc15', // Electric Yellow
                    'Low',       '#10b981', // Emerald Green
                    'Very Low',  '#3b82f6', // Vivid Blue (stands out from green vegetation)
                    '#9ca3af'               // Fallback Gray
                ]
            ],
            'circle-opacity': 0.9,
            'circle-stroke-width': 1,
            'circle-stroke-color': '#000000'
        }
    });

    // 2. SELECTION HIGHLIGHT LAYER (Glowing outer ring around clicked dot)
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
// GRID CLICK INTERACTION
// ============================================================

let activeComicPopup = null;

function addGridClickInteraction() {
    // Hide or remove the old side panel if it exists in the DOM
    const sideInfoBox = document.getElementById('gridInfo') || document.getElementById('grid-info') || document.getElementById('grid-info-box');
    if (sideInfoBox) {
        sideInfoBox.style.display = 'none';
    }

    map.on('click', 'priority-grid', function (event) {
        if (!event.features || !event.features.length) return;

        const clickedFeature = event.features[0];
        const cell = clickedFeature.properties;
        const coordinates = event.lngLat;

        selectedGridCell = cell;

        // Close any existing popup
        if (activeComicPopup) {
            activeComicPopup.remove();
        }

        // Color badge based on intervention or priority level
        let badgeBg = '#facc15';
        if (cell.intervention_type === 'Mist Sprayer') badgeBg = '#00ffff';
        else if (cell.priority_class === 'Very High') badgeBg = '#ff2a2a';
        else if (cell.priority_class === 'High') badgeBg = '#ff8800';
        else if (cell.priority_class === 'Low') badgeBg = '#10b981';
        else if (cell.priority_class === 'Very Low') badgeBg = '#3b82f6';

        // Comic Dialogue Cloud HTML with ALL Grid Metrics
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

                <!-- Complete Grid Cell Indicators Grid -->
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

        // Position highlight ring on selected dot
        if (map.getSource('selected-grid-source')) {
            map.getSource('selected-grid-source').setData({
                type: 'FeatureCollection',
                features: [clickedFeature]
            });
        }
    });

    map.on('mouseenter', 'priority-grid', function () {
        map.getCanvas().style.cursor = 'pointer';
    });

    map.on('mouseleave', 'priority-grid', function () {
        map.getCanvas().style.cursor = '';
    });
}

// ============================================================
// TREE SCENARIO CONTROL
// ============================================================

function createTreeScenarioControl() {

    const control =
        document.createElement('div');

    control.id =
        'treeScenarioControl';

    control.style.position =
        'fixed';

    control.style.left =
        '20px';

    control.style.bottom =
        '25px';

    control.style.zIndex =
        '200';

    control.style.padding =
        '15px';

    control.style.width =
        '220px';

    control.style.borderRadius =
        '14px';

    control.style.background =
        'rgba(7,17,15,.96)';

    control.style.color =
        '#edf7f2';

    control.style.border =
        '1px solid rgba(255,255,255,.12)';

    control.innerHTML = `

        <div style="
            font-weight:bold;
            margin-bottom:8px;
        ">
            Tree Planting Scenario
        </div>

        <div style="
            font-size:11px;
            opacity:.7;
            margin-bottom:8px;
        ">
            Number of recommended
            planting locations
        </div>

        <input
            id="treeCount"
            type="number"
            min="1"
            value="250"
            style="
                width:100%;
                box-sizing:border-box;
                padding:8px;
                margin-bottom:8px;
                border-radius:8px;
                border:1px solid #555;
            "
        >

        <button
            id="recommendTrees"
            style="
                width:100%;
                padding:9px;
                border:none;
                border-radius:8px;
                cursor:pointer;
            "
        >
            Recommend Locations
        </button>

    `;

    document.body.appendChild(control);


    document
        .getElementById('recommendTrees')
        .addEventListener(
            'click',
            recommendTreeLocations
        );
}


// ============================================================
// TREE RECOMMENDATIONS
// ============================================================

function recommendTreeLocations() {
    const count = parseInt(document.getElementById('treeCount').value);

    if (!count || count <= 0) {
        showMessage('Enter a valid number of trees');
        return;
    }

    // STRICTLY FILTER FOR TREE PLANTING CELLS ONLY
    const treeCandidates = priorityData.filter(
        cell => cell.intervention_type === 'Tree Planting'
    );

    const recommendations = treeCandidates
        .slice()
        .sort((a, b) => Number(b.priority_score) - Number(a.priority_score))
        .slice(0, count);

    const features = recommendations.map((cell, index) => ({
        type: 'Feature',
        geometry: {
            type: 'Point',
            coordinates: [Number(cell.longitude), Number(cell.latitude)]
        },
        properties: {
            planting_rank: index + 1,
            priority_score: Number(cell.priority_score)
        }
    }));

    const geojson = { type: 'FeatureCollection', features: features };

    if (map.getSource('tree-recommendations')) {
        map.getSource('tree-recommendations').setData(geojson);
    } else {
        map.addSource('tree-recommendations', {
            type: 'geojson',
            data: geojson
        });

        map.addLayer({
            id: 'tree-recommendations',
            type: 'circle',
            source: 'tree-recommendations',
            paint: {
                'circle-radius': 7,
                'circle-color': '#00ff88',
                'circle-opacity': 0.9,
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 1.5
            }
        });
    }

    showMessage(`${recommendations.length} tree planting locations recommended`);
}

// ============================================================
// SPATIAL DISTANCE HELPERS FOR EVEN DISTRIBUTION
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

// ============================================================
// MIST SPRAYER SCENARIO CONTROL & RECOMMENDATION
// ============================================================

function createMistSprayerScenarioControl() {
    const control = document.createElement('div');
    control.id = 'mistScenarioControl';
    control.style.cssText = `
        position: fixed;
        left: 20px;
        bottom: 160px;
        z-index: 200;
        padding: 15px;
        width: 220px;
        border-radius: 14px;
        background: rgba(7,17,15,.96);
        color: #edf7f2;
        border: 1px solid rgba(0,229,255,.3);
    `;

    control.innerHTML = `
        <div style="font-weight:bold; margin-bottom:8px; color:#00e5ff;">
            Mist Sprayer Scenario
        </div>
        <div style="font-size:11px; opacity:.7; margin-bottom:8px;">
            Number of recommended sprayers on pathways
        </div>
        <input
            id="mistSprayerCount"
            type="number"
            min="1"
            value="50"
            style="width:100%; box-sizing:border-box; padding:8px; margin-bottom:8px; border-radius:8px; border:1px solid #555; background:#111; color:#fff;"
        >
        <button
            id="recommendMistSprayers"
            style="width:100%; padding:9px; border:none; border-radius:8px; cursor:pointer; background:#00e5ff; color:#000; font-weight:bold;"
        >
            Recommend Sprayers
        </button>
    `;

    document.body.appendChild(control);

    document
        .getElementById('recommendMistSprayers')
        .addEventListener('click', recommendMistSprayerLocations);
}

function recommendMistSprayerLocations() {
    const count = parseInt(document.getElementById('mistSprayerCount').value);

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

    const geojson = {
        type: 'FeatureCollection',
        features: recommendations.map((cell, index) => ({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [Number(cell.longitude), Number(cell.latitude)]
            },
            properties: {
                sprayer_rank: index + 1,
                priority_score: Number(cell.priority_score)
            }
        }))
    };

    if (map.getSource('mist-sprayer-recommendations')) {
        map.getSource('mist-sprayer-recommendations').setData(geojson);
    } else {
        map.addSource('mist-sprayer-recommendations', {
            type: 'geojson',
            data: geojson
        });

        map.addLayer({
            id: 'mist-sprayer-recommendations',
            type: 'circle',
            source: 'mist-sprayer-recommendations',
            paint: {
                'circle-radius': 8,
                'circle-color': '#00e5ff',
                'circle-opacity': 0.95,
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2
            }
        });
    }

    showMessage(`${recommendations.length} mist sprayers evenly distributed across walking paths`);
}