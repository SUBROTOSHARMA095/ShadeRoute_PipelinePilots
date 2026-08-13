const map = new maplibregl.Map({
    container: 'map',
    style: 'https://api.maptiler.com/maps/streets/style.json?key=YOUR_MAPTILER_KEY',
    center: [85.8015, 20.2475],
    zoom: 15,
});

map.on('load', () => {

    fetch('/data/campus.geojson')
        .then(response => response.json())
        .then(data => {

            // We'll add the GeoJSON to the map here

        });

});