let isDark = document.documentElement.getAttribute("data-theme") === "dark";

const map = L.map("map", { zoomControl: false, attributionControl: false }).setView([44.55, 34.1], 9);

const tileLayer = L.tileLayer(
  isDark
    ? "https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
  { maxZoom: 19 }
).addTo(map);
L.control.zoom({ position: "topright" }).addTo(map);

const filtersRoot = document.getElementById("filters");
const importInput = document.getElementById("import-file");
const statusText = document.getElementById("status-text");
const toolsPanel = document.getElementById("gis-tools");
const toggleToolsBtn = document.getElementById("toggle-tools-btn");
const themeToggleBtn = document.getElementById("theme-toggle");
const themeIcon = themeToggleBtn?.querySelector("i");

const categoryConfig = {
  all: { label: "Все места", icon: "ph-map-trifold", color: "var(--text-main)", iconColor: "var(--text-inverse)" },
  mountains: { label: "Горы", icon: "ph-mountains", color: "#f59e0b" },
  water: { label: "Водоемы", icon: "ph-waves", color: "#0ea5e9" },
  forest: { label: "Леса", icon: "ph-tree-evergreen", color: "#10b981" },
  other: { label: "Другое", icon: "ph-map-pin", color: "#64748b" },
};

if (themeIcon) {
  themeIcon.className = isDark ? "ph-bold ph-sun" : "ph-bold ph-moon";
}

const categoryLayers = new Map();
let currentCategory = "all";
let loadedFeatures = [];
let routingControl = null;
let importedRoutesGroup = L.featureGroup().addTo(map);
let activeRouteGeoJSON = null;

function setStatus(message, isError = false) {
  if (!statusText) return;
  statusText.innerHTML = message;
  statusText.style.color = isError ? "#e11d48" : "inherit";
}

function createCustomMarker(category) {
  const config = categoryConfig[category] || categoryConfig.other;
  return L.divIcon({
    className: "clear-default-icon",
    html: `<div class="custom-marker"><div class="marker-pulse" style="background-color: ${config.color}"></div><div class="marker-pin" style="background-color: ${config.color}; color: ${config.iconColor || "white"}"><i class="ph-bold ${config.icon}"></i></div></div>`,
    iconSize: [40, 40], iconAnchor: [20, 20], popupAnchor: [0, -22]
  });
}

function popupHtml(properties) {
  const { id, name, category, fullDescription, image, difficulty = "Не указано" } = properties;
  const catLabel = categoryConfig[category]?.label || category;
  return `
    <article class="popup-card">
      <div class="popup-image-wrap">
        <img class="popup-image" src="${image}" alt="${name}" />
        <div class="popup-image-overlay"></div>
      </div>
      <div class="popup-body">
        <h3>${name}</h3>
        <div class="popup-meta">
            <span><i class="ph-fill ph-tag"></i> ${catLabel}</span>
            <span><i class="ph-fill ph-barbell"></i> ${difficulty}</span>
        </div>
        <p class="popup-desc">${fullDescription}</p>
        <button class="route-btn" type="button" data-feature-id="${id}">
          <i class="ph-bold ph-navigation-arrow"></i> Построить маршрут
        </button>
      </div>
    </article>
  `;
}

function bindPopupRouteAction(marker, feature) {
  marker.on("popupopen", (event) => {
    const isMobile = window.innerWidth <= 768;
    const currentZoom = map.getZoom() > 12 ? map.getZoom() : 13;
    const projectedPoint = map.project(marker.getLatLng(), currentZoom);
    projectedPoint.y -= isMobile ? 50 : 180; 
    map.flyTo(map.unproject(projectedPoint, currentZoom), currentZoom, { duration: 0.8, easeLinearity: 0.25 });

    const button = event.popup.getElement()?.querySelector(".route-btn");
    if (!button) return;

    button.addEventListener("click", () => {
      buildRouteTo(feature);
      marker.closePopup();
      if (isMobile) toolsPanel.classList.add("collapsed");
    }, { once: true });
  });
}

function addFeatureToLayers(feature) {
  const category = feature.properties?.category || "other";
  if (!categoryLayers.has(category)) categoryLayers.set(category, L.layerGroup());
  const [lng, lat] = feature.geometry.coordinates;

  const marker = L.marker([lat, lng], { icon: createCustomMarker(category) })
    .bindTooltip(feature.properties?.name || "Объект", { direction: "top", offset: [0, -24], className: 'custom-tooltip' })
    .bindPopup(popupHtml(feature.properties || {}), { autoPanPaddingTopLeft: [24, 24], autoPanPaddingBottomRight: [24, window.innerWidth <= 768 ? 200 : 24] });

  bindPopupRouteAction(marker, feature);
  categoryLayers.get(category).addLayer(marker);
}

function renderByCategory(category) {
  const allMarkers = [];
  categoryLayers.forEach((layer) => {
    map.removeLayer(layer);
    if (category === "all" || layer === categoryLayers.get(category)) {
      layer.addTo(map);
      layer.eachLayer((m) => allMarkers.push(m));
    }
  });
  if (allMarkers.length > 0) {
    const group = new L.featureGroup(allMarkers);
    map.flyToBounds(group.getBounds(), { padding: [80, 80], duration: 1.2 });
  }
}

function setActiveButton(nextCategory) {
  const buttons = filtersRoot.querySelectorAll("button[data-category]");
  buttons.forEach((button) => {
    const isActive = button.dataset.category === nextCategory;
    button.classList.toggle("is-active", isActive);
  });
}

function createFilters() {
  const categories = ["all", ...categoryLayers.keys()];
  filtersRoot.innerHTML = "";
  categories.forEach((category) => {
    const button = document.createElement("button");
    button.type = "button"; button.dataset.category = category; button.className = "filter-btn";
    const config = categoryConfig[category] || categoryConfig.other;
    // Используем жирные иконки для фильтров для лучшей читаемости
    button.innerHTML = `<i class="ph-bold ${config.icon}"></i> ${config.label}`;
    button.addEventListener("click", () => {
      currentCategory = category; renderByCategory(currentCategory); setActiveButton(currentCategory);
    });
    filtersRoot.appendChild(button);
  });
  setActiveButton(currentCategory);
}

function refreshMapData(features, nextCategory = "all") {
  loadedFeatures = features;
  currentCategory = nextCategory;
  categoryLayers.clear();
  features.forEach(addFeatureToLayers);
  createFilters();
  renderByCategory(currentCategory);
  setStatus(`<i class="ph-fill ph-check-circle"></i> Загружено объектов: ${loadedFeatures.length}`);
}

function clearPoints() {
  loadedFeatures = [];
  categoryLayers.forEach((layer) => layer.clearLayers());
  createFilters();
  setStatus(`<i class="ph-bold ph-trash"></i> Точки очищены`);
}

function clearRoutes() {
  if (routingControl) {
    map.removeControl(routingControl);
    routingControl = null;
  }
  importedRoutesGroup.clearLayers();
  activeRouteGeoJSON = null;
  setStatus(`<i class="ph-bold ph-trash"></i> Маршрут сброшен`);
}

async function handleImport(file) {
  const name = file.name.toLowerCase();
  let geojson = null;

  try {
    if (name.endsWith(".zip")) {
      const buffer = await file.arrayBuffer();
      geojson = await shp(buffer);
    } else if (name.endsWith(".kml")) {
      const text = await file.text();
      const xml = new DOMParser().parseFromString(text, "text/xml");
      geojson = toGeoJSON.kml(xml);
    } else {
      throw new Error("Формат не поддерживается");
    }

    let features = [];
    if (geojson.type === "FeatureCollection") features = geojson.features || [];
    else if (Array.isArray(geojson)) features = geojson.flatMap((p) => p.features || []);
    else if (geojson.type === "Feature") features = [geojson];

    const newPoints = [];

    features.forEach((f, i) => {
      if (!f.geometry) return;
      if (f.geometry.type === "Point") {
        const p = f.properties || {};
        newPoints.push({
          type: "Feature", geometry: f.geometry,
          properties: {
            id: Number(p.id) || Date.now() + i,
            name: p.name || p.NAME || `Объект ${loadedFeatures.length + newPoints.length + 1}`,
            category: String(p.category || p.type || "other").toLowerCase(),
            fullDescription: p.description || p.fullDescription || "Импортировано из файла.",
            image: p.image || "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=900&q=80",
            difficulty: p.difficulty || "Не указано",
          }
        });
      } else if (f.geometry.type.includes("LineString")) {
        L.geoJSON(f, { style: { color: "#5c67f2", weight: 6, opacity: 0.9 } }).addTo(importedRoutesGroup);
        if (!activeRouteGeoJSON) activeRouteGeoJSON = f;
      }
    });

    if (newPoints.length > 0) {
      refreshMapData([...loadedFeatures, ...newPoints], "all");
    } else {
      setStatus(`<i class="ph-fill ph-check-circle"></i> Загружен маршрут`);
    }
  } catch (err) {
    console.error(err);
    setStatus("Ошибка чтения файла", true);
  }
}

function exportToSHP(featuresCollection, baseName) {
  if (!featuresCollection.features.length) {
    setStatus("Нет данных для экспорта", true); return;
  }
  try {
    shpwrite.download(featuresCollection, { folder: baseName, types: { point: "points", polygon: "polygons", line: "lines" } });
    setStatus(`<i class="ph-bold ph-download-simple"></i> Запущен экспорт SHP`);
  } catch (e) {
    console.error(e); setStatus("Ошибка экспорта SHP", true);
  }
}

function exportToKML(featuresCollection, baseName) {
  if (!featuresCollection.features.length) {
    setStatus("Нет данных для экспорта", true); return;
  }
  try {
    const kmlString = tokml(featuresCollection);
    const blob = new Blob([kmlString], { type: "application/vnd.google-earth.kml+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `${baseName}.kml`;
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    setStatus(`<i class="ph-bold ph-download-simple"></i> Экспорт KML завершен`);
  } catch (e) {
    console.error(e); setStatus("Ошибка экспорта KML", true);
  }
}

document.getElementById("import-btn").addEventListener("click", () => importInput.click());
importInput.addEventListener("change", (e) => {
  if (e.target.files[0]) { setStatus(`<i class="ph-bold ph-spinner-gap" style="animation: spin 1s linear infinite"></i> Чтение...`); handleImport(e.target.files[0]); }
  e.target.value = "";
});

document.getElementById("clear-pts-btn").addEventListener("click", clearPoints);
document.getElementById("export-pts-shp").addEventListener("click", () => exportToSHP({ type: "FeatureCollection", features: loadedFeatures }, "map-points"));
document.getElementById("export-pts-kml").addEventListener("click", () => exportToKML({ type: "FeatureCollection", features: loadedFeatures }, "map-points"));

function getRouteCollection() {
  return activeRouteGeoJSON ? { type: "FeatureCollection", features: [activeRouteGeoJSON] } : { type: "FeatureCollection", features: [] };
}
document.getElementById("export-rt-shp").addEventListener("click", () => exportToSHP(getRouteCollection(), "map-routes"));
document.getElementById("export-rt-kml").addEventListener("click", () => exportToKML(getRouteCollection(), "map-routes"));

themeToggleBtn?.addEventListener("click", () => {
  isDark = !isDark;
  localStorage.setItem("theme", isDark ? "dark" : "light");
  if (isDark) {
    document.documentElement.setAttribute("data-theme", "dark");
    if (themeIcon) themeIcon.className = "ph-bold ph-sun";
    tileLayer.setUrl("https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png");
  } else {
    document.documentElement.removeAttribute("data-theme");
    if (themeIcon) themeIcon.className = "ph-bold ph-moon";
    tileLayer.setUrl("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png");
  }
});

// Идеальная логика панели: свернуть по клику на крестик, развернуть по клику на любую часть свернутой панели
toggleToolsBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  toolsPanel?.classList.add("collapsed");
});

toolsPanel?.addEventListener("click", (e) => {
  if (toolsPanel.classList.contains("collapsed")) {
    toolsPanel.classList.remove("collapsed");
  }
});

function getUserLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject();
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(L.latLng(pos.coords.latitude, pos.coords.longitude)),
      (err) => reject(err), { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

async function buildRouteTo(feature) {
  const [lng, lat] = feature.geometry.coordinates;
  const destination = L.latLng(lat, lng);

  setStatus(`<i class="ph-bold ph-spinner-gap" style="animation: spin 1s linear infinite;"></i> Получаем геопозицию...`);
  let start;
  try { start = await getUserLocation(); }
  catch {
    setStatus("Используем стартовую точку по умолчанию.", true);
    start = L.latLng(44.95, 34.1);
  }

  clearRoutes();

  routingControl = L.Routing.control({
    waypoints: [start, destination],
    routeWhileDragging: false, addWaypoints: false, fitSelectedRoutes: true, showAlternatives: false, language: "ru",
    lineOptions: { styles: [{ color: "#1e293b", opacity: 0.9, weight: 8 }, { color: "#5c67f2", opacity: 1, weight: 4 }] },
    createMarker: () => null
  }).addTo(map);

  const routingContainer = document.querySelector('.leaflet-routing-container');
  if (routingContainer) {
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'cancel-route-btn';
    cancelBtn.innerHTML = '<i class="ph-bold ph-x-circle"></i> Отменить маршрут';
    cancelBtn.onclick = clearRoutes;
    routingContainer.prepend(cancelBtn); 
  }

  routingControl.on("routesfound", function (e) {
    const coords = e.routes[0].coordinates.map((c) => [c.lng, c.lat]);
    activeRouteGeoJSON = {
      type: "Feature",
      properties: { name: `Маршрут до ${feature.properties?.name}` },
      geometry: { type: "LineString", coordinates: coords }
    };
  });

  setStatus(`<i class="ph-bold ph-navigation-arrow"></i> Маршрут построен`);
}

async function init() {
  try {
    const response = await fetch("./data/points.geojson");
    if (!response.ok) throw new Error("Network error");
    const geojson = await response.json();
    refreshMapData(geojson.features || [], currentCategory);
  } catch (error) {
    setStatus("Ошибка загрузки стандартных данных", true);
  }
}

init();