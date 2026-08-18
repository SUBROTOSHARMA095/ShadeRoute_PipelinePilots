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

        console.log(
            "Priority cells:",
            priorityData.length
        );

        console.log(
            "Tree recommendations:",
            treeRecommendationData.length
        );

        addPriorityGrid();

        addGridClickInteraction();

        createTreeScenarioControl();

    })
    .catch(error => {

        console.error(
            "Could not load ML grid data:",
            error
        );

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

    if (map.getSource('priority-grid')) {
        return;
    }

    const features =
        priorityData.map((cell, index) => {

            return {
                type: 'Feature',

                geometry: {
                    type: 'Point',

                    coordinates: [
                        Number(cell.longitude),
                        Number(cell.latitude)
                    ]
                },

                properties: {
                    index: index,

                    longitude:
                        Number(cell.longitude),

                    latitude:
                        Number(cell.latitude),

                    NDVI:
                        Number(cell.NDVI),

                    NDBI:
                        Number(cell.NDBI),

                    BSI:
                        Number(cell.BSI),

                    NDWI:
                        Number(cell.NDWI),

                    LST:
                        Number(cell.LST),

                    vegetation_fraction:
                        Number(
                            cell.vegetation_fraction
                        ),

                    priority_score:
                        Number(
                            cell.priority_score
                        ),

                    priority_class:
                        cell.priority_class,

                    recommendation:
                        cell.recommendation
                }
            };

        });

    map.addSource(
        'priority-grid',
        {
            type: 'geojson',

            data: {
                type: 'FeatureCollection',
                features: features
            }
        }
    );

    map.addLayer({

        id: 'priority-grid',

        type: 'circle',

        source: 'priority-grid',

        paint: {

            'circle-radius': 5,

            'circle-color': [

                'interpolate',

                ['linear'],

                ['get', 'priority_score'],

                0,
                '#22c55e',

                40,
                '#eab308',

                60,
                '#f97316',

                80,
                '#ef4444'
            ],

            'circle-opacity': 0.45,

            'circle-stroke-width': 0.5,

            'circle-stroke-color':
                '#ffffff'

        }
    });
}

// ============================================================
// GRID CLICK INTERACTION
// ============================================================

function addGridClickInteraction() {

    map.on(
        'click',
        'priority-grid',
        function (event) {

            if (
                !event.features ||
                !event.features.length
            ) {
                return;
            }

            const cell =
                event.features[0].properties;

            selectedGridCell = cell;

            showGridInformation(cell);

        }
    );


    map.on(
        'mouseenter',
        'priority-grid',
        function () {

            map.getCanvas()
                .style.cursor = 'pointer';

        }
    );


    map.on(
        'mouseleave',
        'priority-grid',
        function () {

            map.getCanvas()
                .style.cursor = '';

        }
    );
}

// ============================================================
// GRID INFORMATION PANEL
// ============================================================

function showGridInformation(cell) {

    let panel =
        document.getElementById(
            'gridInfoPanel'
        );

    if (!panel) {

        panel =
            document.createElement('div');

        panel.id =
            'gridInfoPanel';

        panel.style.position =
            'fixed';

        panel.style.right =
            '20px';

        panel.style.top =
            '20px';

        panel.style.zIndex =
            '200';

        panel.style.width =
            '280px';

        panel.style.padding =
            '18px';

        panel.style.borderRadius =
            '14px';

        panel.style.background =
            'rgba(7,17,15,.96)';

        panel.style.border =
            '1px solid rgba(255,255,255,.12)';

        panel.style.color =
            '#edf7f2';

        panel.style.fontSize =
            '12px';

        panel.style.boxShadow =
            '0 15px 40px rgba(0,0,0,.4)';

        document.body.appendChild(panel);
    }

    const vegetationPercent =
        (
            Number(
                cell.vegetation_fraction
            ) * 100
        ).toFixed(1);

    panel.innerHTML = `

        <div style="
            display:flex;
            justify-content:space-between;
            align-items:center;
            margin-bottom:12px;
        ">

            <strong style="font-size:15px;">
                Grid Cell
            </strong>

            <button
                id="closeGridInfo"
                style="
                    background:none;
                    border:none;
                    color:white;
                    cursor:pointer;
                    font-size:18px;
                "
            >
                ×
            </button>

        </div>

        <div style="margin-bottom:12px;">
            <strong>
                Priority:
                ${Number(cell.priority_score).toFixed(1)}/100
            </strong>

            <div style="margin-top:4px;">
                ${cell.priority_class}
            </div>
        </div>

        <hr style="
            border:none;
            border-top:
                1px solid rgba(255,255,255,.1);
        ">

        <div>
            Vegetation:
            <strong>${vegetationPercent}%</strong>
        </div>

        <div>
            LST:
            <strong>${Number(cell.LST).toFixed(2)}°C</strong>
        </div>

        <div>
            NDVI:
            <strong>${Number(cell.NDVI).toFixed(3)}</strong>
        </div>

        <div>
            NDWI:
            <strong>${Number(cell.NDWI).toFixed(3)}</strong>
        </div>

        <div>
            NDBI:
            <strong>${Number(cell.NDBI).toFixed(3)}</strong>
        </div>

        <div>
            BSI:
            <strong>${Number(cell.BSI).toFixed(3)}</strong>
        </div>

        <hr style="
            border:none;
            border-top:
                1px solid rgba(255,255,255,.1);
        ">

        <div style="
            line-height:1.5;
        ">
            <strong>Recommendation</strong>

            <p>
                ${cell.recommendation}
            </p>
        </div>

    `;

    document
        .getElementById('closeGridInfo')
        .addEventListener(
            'click',
            function () {

                panel.remove();

            }
        );
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

    const count =
        parseInt(
            document.getElementById(
                'treeCount'
            ).value
        );

    if (
        !count ||
        count <= 0
    ) {

        showMessage(
            'Enter a valid number of trees'
        );

        return;
    }


    const recommendations =
        priorityData
            .slice()
            .sort(
                (a, b) =>
                    Number(
                        b.priority_score
                    )
                    -
                    Number(
                        a.priority_score
                    )
            )
            .slice(
                0,
                count
            );


    const features =
        recommendations.map(
            (cell, index) => {

                return {

                    type: 'Feature',

                    geometry: {

                        type: 'Point',

                        coordinates: [
                            Number(
                                cell.longitude
                            ),
                            Number(
                                cell.latitude
                            )
                        ]

                    },

                    properties: {

                        planting_rank:
                            index + 1,

                        priority_score:
                            Number(
                                cell.priority_score
                            )

                    }

                };

            }
        );


    const geojson = {

        type: 'FeatureCollection',

        features: features

    };


    if (
        map.getSource(
            'tree-recommendations'
        )
    ) {

        map.getSource(
            'tree-recommendations'
        ).setData(
            geojson
        );

    } else {

        map.addSource(
            'tree-recommendations',
            {
                type: 'geojson',
                data: geojson
            }
        );


        map.addLayer({

            id:
                'tree-recommendations',

            type:
                'circle',

            source:
                'tree-recommendations',

            paint: {

                'circle-radius':
                    7,

                'circle-color':
                    '#00ff88',

                'circle-opacity':
                    0.9,

                'circle-stroke-color':
                    '#ffffff',

                'circle-stroke-width':
                    1.5

            }

        });

    }


    showMessage(
        `${recommendations.length} planting locations recommended`
    );

}