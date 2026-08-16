const fs = require("fs");
const path = require("path");
const { DOMParser } = require("@xmldom/xmldom");
const tj = require("@tmcw/togeojson");

// Offset used for campus / vegetation data
const OFFSET_LON = -0.000029;
const OFFSET_LAT = -0.000018;

// Get filename from command line
const filename = process.argv[2];

if (!filename) {
    console.error("Please provide a KML filename.");
    console.log("Example: node scripts/convert-kml.js campus.kml");
    process.exit(1);
}

const inputPath = path.join("./public/data", filename);

// Change .kml → .geojson
const outputFilename =
    path.basename(filename, ".kml") + ".geojson";

const outputPath =
    path.join("./public/data", outputFilename);

// Read KML
const kml = fs.readFileSync(inputPath, "utf8");

// Parse KML
const dom =
    new DOMParser().parseFromString(kml, "text/xml");

// Convert KML → GeoJSON
const geojson = tj.kml(dom);


// ============================================
// DETECT ROAD / PATH DATA
// ============================================

const isRoadData =
    geojson.features.some(feature => {
        const name = feature.properties?.name;

        if (!name) return false;

        const lowerName = name.toLowerCase();

        return (
            lowerName.startsWith("road ") ||
            lowerName.startsWith("path ")
        );
    });


// ============================================
// COORDINATE SHIFT FUNCTION
// ============================================

function shiftCoordinates(coordinates) {

    if (typeof coordinates[0] === "number") {

        coordinates[0] += OFFSET_LON;
        coordinates[1] += OFFSET_LAT;

        return coordinates;
    }

    return coordinates.map(shiftCoordinates);
}


// ============================================
// PROCESS FEATURES
// ============================================

let roadCount = 0;
let pathCount = 0;

geojson.features.forEach(feature => {

    if (!feature.geometry) return;

    const name = feature.properties?.name || "";

    const lowerName = name.toLowerCase();


    // ========================================
    // ROAD / PATH
    // ========================================

    if (isRoadData) {

        if (lowerName.startsWith("road ")) {

            roadCount++;

            feature.properties = {
                id: `R${String(roadCount).padStart(3, "0")}`,
                type: "road",
                name: name,
                access: ["walk", "vehicle"]
            };

        }

        else if (lowerName.startsWith("path ")) {

            pathCount++;

            feature.properties = {
                id: `P${String(pathCount).padStart(3, "0")}`,
                type: "path",
                name: name,
                access: ["walk"]
            };

        }

        // IMPORTANT:
        // No coordinate shifting for roads/paths.

    }


    // ========================================
    // CAMPUS / VEGETATION
    // ========================================

    else {

        feature.geometry.coordinates =
            shiftCoordinates(
                feature.geometry.coordinates
            );

    }

});


// ============================================
// WRITE GEOJSON
// ============================================

fs.writeFileSync(
    outputPath,
    JSON.stringify(geojson, null, 2)
);

console.log(
    `${filename} converted to ${outputFilename}`
);

if (isRoadData) {

    console.log(
        `Roads: ${roadCount}`
    );

    console.log(
        `Paths: ${pathCount}`
    );

    console.log(
        "Road/path coordinates were NOT shifted."
    );
}