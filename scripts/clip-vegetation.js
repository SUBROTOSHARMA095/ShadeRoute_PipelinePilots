const fs = require("fs");
const turf = require("@turf/turf");

const campus = JSON.parse(
    fs.readFileSync("./public/data/campus.geojson", "utf8")
);

const vegetation = JSON.parse(
    fs.readFileSync("./public/data/vegetation.geojson", "utf8")
);

// Find the ITER campus polygon
const campusFeature = campus.features.find(
    feature => feature.properties?.name === "SOA ITER CAMPUS 1"
);

if (!campusFeature) {
    throw new Error("ITER campus polygon not found.");
}

const clippedFeatures = [];

for (const vegetationFeature of vegetation.features) {
    try {
        const clipped = turf.intersect(
            turf.featureCollection([
                campusFeature,
                vegetationFeature
            ])
        );

        if (clipped) {
            clipped.properties = {
                ...vegetationFeature.properties
            };

            clippedFeatures.push(clipped);
        }
    } catch (error) {
        console.warn(
            "Could not clip:",
            vegetationFeature.properties?.name
        );
    }
}

const output = {
    type: "FeatureCollection",
    features: clippedFeatures
};

fs.writeFileSync(
    "./public/data/vegetation.geojson",
    JSON.stringify(output, null, 2)
);

console.log(
    `Clipped ${clippedFeatures.length} vegetation features.`
);