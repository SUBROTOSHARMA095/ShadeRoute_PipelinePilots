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
                    'fill-opacity': 0.2
                }
            });

            map.addLayer({
                id: 'campus-outline',
                type: 'line',
                source: 'campus-data',
                paint: {
                    'line-color': '#2f80ed',
                    'line-width': 3
                }
            });
            const bounds = new maplibregl.LngLatBounds();
            data.features.forEach(feature => {

                feature.geometry.coordinates[0].forEach(coordinate => {
                    bounds.extend(coordinate);
                });
            });
            map.fitBounds(bounds, {
                padding: 50
            });
        });
});