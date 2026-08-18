const fs = require("fs");

const campus = JSON.parse(
    fs.readFileSync("./public/data/campus.geojson", "utf8")
);

const campusFeature = campus.features.find(
    feature => feature.properties?.name === "SOA ITER CAMPUS 1"
);

if (!campusFeature) {
    throw new Error("SOA ITER CAMPUS 1 not found.");
}

const output = {
    type: "FeatureCollection",
    features: [campusFeature]
};

fs.writeFileSync(
    "./public/data/campus_boundary.geojson",
    JSON.stringify(output, null, 2)
);

console.log("Created campus_boundary.geojson");