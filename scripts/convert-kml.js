const fs = require("fs");
const path = require("path");
const { DOMParser } = require("@xmldom/xmldom");
const tj = require("@tmcw/togeojson");

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
const outputFilename = path.basename(filename, ".kml") + ".geojson";
const outputPath = path.join("./public/data", outputFilename);

// Read KML
const kml = fs.readFileSync(inputPath, "utf8");

// Parse KML
const dom = new DOMParser().parseFromString(kml, "text/xml");

// Convert KML → GeoJSON
const geojson = tj.kml(dom);

function shiftCoordinates(coordinates) {
    if (typeof coordinates[0] === "number") {
        coordinates[0] += OFFSET_LON;
        coordinates[1] += OFFSET_LAT;
        return coordinates;
    }

    return coordinates.map(shiftCoordinates);
}

geojson.features.forEach(feature => {
    if (feature.geometry) {
        feature.geometry.coordinates =
            shiftCoordinates(feature.geometry.coordinates);
    }
});

// Write GeoJSON
fs.writeFileSync(
    outputPath,
    JSON.stringify(geojson, null, 2)
);

console.log(`${filename} converted to ${outputFilename}`);