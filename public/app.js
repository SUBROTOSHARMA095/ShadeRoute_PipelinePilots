const map = new maplibregl.Map({
    container: 'map',
    style: '/style.json',
    /*center: [85.8015, 20.2475],
    zoom: 15,*/
});

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

    fetch('/data/roads.geojson')
    .then(response => response.json())
    .then(data => {
        map.addSource("roads", {
            type: "geojson",
            data: "/data/roads.geojson"
        });
        map.addLayer({
            id: "roads-layer",
            type: "line",
            source: "roads",
            filter: ["==", ["get", "type"], "road"],
            paint: {
                "line-color": "#444444",
                "line-width": 3,
                "line-opacity": 0.9
            }
        });
        map.addLayer({
            id: "paths-layer",
            type: "line",
            source: "roads",
            filter: ["==", ["get", "type"], "path"],
            paint: {
                "line-color": "#777777",
                "line-width": 2,
                "line-dasharray": [2, 2],
                "line-opacity": 0.9
            }
        });
    });
});
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
// 2. EXPLORE / AUTHORITY MODE
// ===============================

const modeButtons = document.querySelectorAll(".mode-button");

modeButtons.forEach(function (button) {
    button.addEventListener("click", function () {

        modeButtons.forEach(function (btn) {
            btn.classList.remove("active");
        });

        button.classList.add("active");

        if (button.textContent.trim() === "Authority") {
            showMessage("Authority mode selected");
        } else {
            showMessage("Explore mode selected");
        }
    });
});


// ===============================
// 3. MAP ZOOM CONTROLS
// ===============================

const mapControls = document.querySelectorAll(".map-control");

let mapZoom = 13;

mapControls[0].addEventListener("click", function () {
    mapZoom++;
    showMessage("Zoom: " + mapZoom);
});

mapControls[1].addEventListener("click", function () {
    mapZoom--;

    if (mapZoom < 1) {
        mapZoom = 1;
    }

    showMessage("Zoom: " + mapZoom);
});


// ===============================
// 4. CURRENT LOCATION BUTTON
// ===============================

const mapLocationButton = mapControls[2];

mapLocationButton.addEventListener("click", function () {

    if (!navigator.geolocation) {
        showMessage("Location is not supported by this browser");
        return;
    }

    navigator.geolocation.getCurrentPosition(
        function (position) {

            const lat = position.coords.latitude;
            const lng = position.coords.longitude;

            showMessage(
                "Location found: " +
                lat.toFixed(4) +
                ", " +
                lng.toFixed(4)
            );

            originInput.value = "Current location";
        },
        function () {
            showMessage("Unable to access your location");
        }
    );
});


// ===============================
// 5. FROM / TO INPUTS
// ===============================

const originInput = document.getElementById("originInput");
const destinationInput = document.getElementById("destinationInput");
const suggestionTitle = document.getElementById("suggestionTitle");
const suggestionText = document.getElementById("suggestionText");
const suggestionTags = document.getElementById("suggestionTags");
const suggestionAction = document.getElementById("suggestionAction");

const fieldActions = document.querySelectorAll(".field-action");


// FROM location button
fieldActions[0].addEventListener("click", function () {

    if (!navigator.geolocation) {
        originInput.value = "Current location";
        return;
    }

    navigator.geolocation.getCurrentPosition(
        function () {
            originInput.value = "Current location";
            showMessage("Current location selected");
        },
        function () {
            originInput.value = "Current location";
            showMessage("Using current location");
        }
    );
});


// Destination search button
fieldActions[1].addEventListener("click", function () {

    const destination = destinationInput.value.trim();

    if (destination === "") {
        showMessage("Enter a destination first");
        destinationInput.focus();
        return;
    }

    updateLocalitySuggestion(destination);
    showMessage("Destination selected: " + destination);
});

destinationInput.addEventListener("input", function () {
    updateLocalitySuggestion(destinationInput.value.trim());
});


// ===============================
// 6. ROUTE PRIORITY
// ===============================

const routeOptions = document.querySelectorAll(".route-option");

let selectedPriority = "Balanced";

routeOptions.forEach(function (option) {

    option.addEventListener("click", function () {

        routeOptions.forEach(function (item) {
            item.classList.remove("selected");
        });

        option.classList.add("selected");

        selectedPriority =
            option.querySelector("strong").textContent;

        showMessage(
            "Route priority: " + selectedPriority
        );
    });
});


// ===============================
// 7. FIND SAFER ROUTE
// ===============================

const findRouteButton =
    document.getElementById("findRouteButton");

findRouteButton.addEventListener("click", function () {

    const destination =
        destinationInput.value.trim();

    if (destination === "") {
        showMessage("Please enter a destination");
        destinationInput.focus();
        return;
    }

    showMessage(
        "Finding " +
        selectedPriority.toLowerCase() +
        " route..."
    );

    setTimeout(function () {

        showRoute();

        updateConditions();

        updateExposureScore();

        updateLocalitySuggestion(destination, true);

        showMessage("Safer route found");

    }, 800);
});


// ===============================
// 8. LOCALITY GREENING SUGGESTIONS
// ===============================

function getLocalitySuggestion(locality, routeCalculated) {

    const place = locality || "this locality";
    const normalizedPlace = place.toLowerCase();

    let recommendation = {
        title: "Create a cooler walking corridor",
        text: "Plant native shade trees along sunny footpaths and around bus stops. Prioritize continuous canopy where people walk during the hottest part of the day.",
        tags: ["Native trees", "Footpaths", "Bus stops"],
        action: "View planting priority"
    };

    if (normalizedPlace.includes("market") || normalizedPlace.includes("bazaar")) {
        recommendation = {
            title: "Cool the market streets",
            text: "Add shade trees at market edges, loading areas and pedestrian queues. Combine tree pits with permeable paving so rainwater can support the new canopy.",
            tags: ["Street trees", "Rainwater", "Pedestrian shade"],
            action: "View market greening idea"
        };
    } else if (normalizedPlace.includes("school") || normalizedPlace.includes("college") || normalizedPlace.includes("campus")) {
        recommendation = {
            title: "Build a campus shade network",
            text: "Plant native trees along the busiest walkways, cycle stands and play areas. This can make daily student routes cooler and more comfortable.",
            tags: ["Campus canopy", "Walkways", "Native species"],
            action: "View campus planting idea"
        };
    } else if (normalizedPlace.includes("hospital") || normalizedPlace.includes("clinic")) {
        recommendation = {
            title: "Protect heat-sensitive visitors",
            text: "Prioritize shaded waiting areas, entrances and walking paths with low-maintenance native trees and seating beneath the canopy.",
            tags: ["Visitor comfort", "Entrances", "Shade trees"],
            action: "View hospital greening idea"
        };
    } else if (normalizedPlace.includes("hostel") || normalizedPlace.includes("residential") || normalizedPlace.includes("colony")) {
        recommendation = {
            title: "Grow a cooler neighbourhood canopy",
            text: "Plant native trees beside internal roads, play spaces and shared parking areas. Start with locations that have little shade during afternoon hours.",
            tags: ["Neighbourhood trees", "Play areas", "Afternoon shade"],
            action: "View neighbourhood planting idea"
        };
    }

    if (routeCalculated) {
        recommendation.text += " This suggestion is based on the destination selected for your route: " + place + ".";
    }

    return recommendation;
}

function updateLocalitySuggestion(locality, routeCalculated) {

    if (!locality) {
        suggestionTitle.textContent = "Greener streets start here.";
        suggestionText.textContent = "Enter a destination to see a practical tree-planting and heat-reduction idea for that locality.";
        suggestionTags.innerHTML = "<span>Choose a locality</span>";
        suggestionAction.textContent = "Enter a destination";
        suggestionAction.disabled = true;
        return;
    }

    const recommendation = getLocalitySuggestion(locality, routeCalculated);

    suggestionTitle.textContent = recommendation.title;
    suggestionText.textContent = recommendation.text;
    suggestionTags.innerHTML = recommendation.tags.map(function (tag) {
        return "<span>" + tag + "</span>";
    }).join("");
    suggestionAction.textContent = recommendation.action;
    suggestionAction.disabled = false;
    suggestionAction.dataset.locality = locality;
}

suggestionAction.addEventListener("click", function () {
    if (!suggestionAction.dataset.locality) {
        return;
    }

    const shadeToggle = layerToggles[2];

    if (!shadeToggle.checked) {
        shadeToggle.checked = true;
        addMapLayer(2);
    }

    showMessage("Shade planting priority highlighted for " + suggestionAction.dataset.locality);
});


// ===============================
// 9. MAP LAYERS
// ===============================

const layerToggles =
    document.querySelectorAll(".toggle");

const layerNames = [
    "Heat exposure",
    "Air quality",
    "Shade availability",
    "Traffic"
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
// 9. SIMULATED MAP LAYERS
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

    if (index === 2) {
        layer.style.background = "#45e58a";
    }

    if (index === 3) {
        layer.style.background = "#e5c85e";
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
// 10. SIMULATED ROUTE
// ===============================

function showRoute() {

    const map = document.getElementById("map");

    let route = document.getElementById(
        "simulatedRoute"
    );

    if (route) {
        route.remove();
    }

    route = document.createElement("div");

    route.id = "simulatedRoute";

    route.style.position = "absolute";
    route.style.left = "28%";
    route.style.top = "25%";
    route.style.width = "45%";
    route.style.height = "45%";
    route.style.border = "4px solid #62e5a0";
    route.style.borderTopColor = "transparent";
    route.style.borderLeftColor = "transparent";
    route.style.borderRadius = "50%";
    route.style.transform = "rotate(-25deg)";
    route.style.boxShadow =
        "0 0 15px rgba(98,229,160,.6)";
    route.style.pointerEvents = "none";
    route.style.zIndex = "5";

    map.appendChild(route);
}


// ===============================
// 11. CURRENT CONDITIONS
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
// 12. EXPOSURE SCORE
// ===============================

function updateExposureScore() {

    const scoreElement =
        document.querySelector(".score-placeholder");

    const exposureText =
        document.querySelector(".exposure-card p");

    const score =
        Math.floor(35 + Math.random() * 40);

    scoreElement.textContent = score;

    exposureText.textContent =
        "Environmental exposure calculated using " +
        selectedPriority.toLowerCase() +
        " route priority.";
}


// ===============================
// 13. MESSAGE / NOTIFICATION
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
