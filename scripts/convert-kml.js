const fs = require("fs");
const { DOMParser } = require("@xmldom/xmldom");
const tj = require("@tmcw/togeojson");

const kml = fs.readFileSync("./public/data/campus.kml", "utf8");

const dom = new DOMParser().parseFromString(kml, "text/xml");

const geojson = tj.kml(dom);

fs.writeFileSync(
    "./public/data/campus.geojson",
    JSON.stringify(geojson, null, 2)
);

console.log("KML converted to GeoJSON");