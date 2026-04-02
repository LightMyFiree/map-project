// --- Настройка карты и темы ---

/**
 * Проверяем, какая тема сейчас включена (тёмная или светлая).
 */
// Зачем это нужно: Мы проверяем это до того, как карта загрузится, 
// чтобы сразу показать нужный цвет карты и экран не "моргал" белым цветом при темной теме.
let isDark = document.documentElement.getAttribute("data-theme") === "dark";

/**
 * Создаем саму карту.
 */
// Зачем это нужно: Мы отключили стандартные кнопки "плюс" и "минус" (zoomControl), 
// чтобы они не налезли на нашу красивую шапку сверху. Мы добавим их чуть ниже.
const map = L.map("map", { zoomControl: false, attributionControl: false }).setView([44.55, 34.1], 9);

/**
 * Загружаем картинки для карты (их называют "тайлы").
 */
// Зачем это нужно: Карта состоит из множества маленьких квадратных картинок. 
// Мы берем их из сервиса Carto, потому что у них есть красивые готовые стили: и светлый, и темный.
const tileLayer = L.tileLayer(
  isDark
    ? "https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
  { maxZoom: 19 }
).addTo(map);

// Возвращаем кнопки "плюс/минус", но ставим их в правый верхний угол.
L.control.zoom({ position: "topright" }).addTo(map);

// --- Поиск элементов на странице ---
// Здесь мы находим все кнопки и меню из нашего HTML, чтобы потом ими управлять.

const filtersRoot = document.getElementById("filters");
const importInput = document.getElementById("import-file");
const statusText = document.getElementById("status-text");
const toolsPanel = document.getElementById("gis-tools");
const toggleToolsBtn = document.getElementById("toggle-tools-btn");
const themeToggleBtn = document.getElementById("theme-toggle");
const themeIcon = themeToggleBtn?.querySelector("i");

/**
 * Настройки внешнего вида для разных мест на карте.
 */
// Зачем это нужно: Тут мы решаем, какого цвета будет иконка горы или водоема.
// Выносить это сюда очень удобно: если захотим поменять цвет лесов с зеленого на желтый, 
// поменяем только одну строчку здесь, а не будем копаться во всем коде.
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

// --- Переменные для хранения данных ---

/**
 * Здесь мы будем хранить папки с маркерами (точками на карте).
 */
// Зачем это нужно: Это как настоящие папки. В папке "Горы" лежат все маркеры гор. 
// Когда пользователь нажимает кнопку фильтра "Горы", мы просто показываем эту папку и прячем остальные. 
// Это работает мгновенно.
const categoryLayers = new Map();
let currentCategory = "all";
let loadedFeatures = [];
let routingControl = null; // Для хранения построенного маршрута
let importedRoutesGroup = L.featureGroup().addTo(map);
let activeRouteGeoJSON = null;

// --- Управление интерфейсом ---

/**
 * Пишет текст в самом низу экрана (статус-бар).
 */
function setStatus(message, isError = false) {
  if (!statusText) return;
  statusText.innerHTML = message;
  statusText.style.color = isError ? "#e11d48" : "inherit"; // Если ошибка - делаем текст красным
}

/**
 * Рисует красивую иконку (кружок, который пульсирует).
 */
function createCustomMarker(category) {
  const config = categoryConfig[category] || categoryConfig.other;
  return L.divIcon({
    className: "clear-default-icon",
    // Мы собираем иконку из обычного HTML и красим её в цвет категории
    html: `<div class="custom-marker"><div class="marker-pulse" style="background-color: ${config.color}"></div><div class="marker-pin" style="background-color: ${config.color}; color: ${config.iconColor || "white"}"><i class="ph-bold ${config.icon}"></i></div></div>`,
    iconSize: [40, 40], iconAnchor: [20, 20], popupAnchor: [0, -22]
  });
}

/**
 * Собирает карточку (окошко), которая появляется при клике на маркер.
 */
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

// --- Взаимодействие с картой ---

/**
 * Что должно происходить, когда мы открываем карточку места.
 */
function bindPopupRouteAction(marker, feature) {
  marker.on("popupopen", (event) => {
    const isMobile = window.innerWidth <= 768;
    const currentZoom = map.getZoom() > 12 ? map.getZoom() : 13;
    
    // Зачем это нужно: Наша менюшка сверху может закрыть собой всплывающее окошко маркера. 
    // Поэтому мы искусственно сдвигаем "взгляд" камеры чуть ниже маркера, чтобы всё влезло.
    const projectedPoint = map.project(marker.getLatLng(), currentZoom);
    projectedPoint.y -= isMobile ? 80 : 180; 
    map.flyTo(map.unproject(projectedPoint, currentZoom), currentZoom, { duration: 0.8, easeLinearity: 0.25 });

    // Оживляем кнопку "Построить маршрут" внутри карточки
    const button = event.popup.getElement()?.querySelector(".route-btn");
    if (!button) return;

    button.addEventListener("click", () => {
      buildRouteTo(feature);
      marker.closePopup();
      if (isMobile) toolsPanel.classList.add("collapsed"); // На телефонах прячем меню, чтоб не мешало
    }, { once: true });
  });
}

/**
 * Берет информацию о месте и ставит точку на карту.
 */
function addFeatureToLayers(feature) {
  const category = feature.properties?.category || "other";
  
  // Если такой "папки" для маркеров еще нет, создаем ее
  if (!categoryLayers.has(category)) categoryLayers.set(category, L.layerGroup());
  
  // Важно: в данных координаты хранятся как [долгота, широта], а карта требует [широта, долгота]. Меняем местами.
  const [lng, lat] = feature.geometry.coordinates;

  const isMobile = window.innerWidth <= 768;

  const marker = L.marker([lat, lng], { icon: createCustomMarker(category) })
    .bindTooltip(feature.properties?.name || "Объект", { direction: "top", offset: [0, -24], className: 'custom-tooltip' })
    .bindPopup(popupHtml(feature.properties || {}), { 
      autoPanPaddingTopLeft: [24, isMobile ? 110 : 24], 
      autoPanPaddingBottomRight: [24, isMobile ? 80 : 24] 
    });

  bindPopupRouteAction(marker, feature);
  categoryLayers.get(category).addLayer(marker); // Кладем маркер в нужную папку
}

/**
 * Показывает на карте только те места, которые мы выбрали в фильтре.
 */
function renderByCategory(category) {
  const allMarkers = [];
  categoryLayers.forEach((layer) => {
    map.removeLayer(layer); // Сначала прячем вообще всё
    
    // Если выбрали "Все места" или название совпадает с фильтром - показываем
    if (category === "all" || layer === categoryLayers.get(category)) {
      layer.addTo(map);
      layer.eachLayer((m) => allMarkers.push(m));
    }
  });
  
  // Если на карте остались маркеры, плавно передвигаем камеру так, чтобы их все было видно
  if (allMarkers.length > 0) {
    const group = new L.featureGroup(allMarkers);
    map.flyToBounds(group.getBounds(), { padding: [80, 80], duration: 1.2 });
  }
}

// --- Фильтры (Кнопки категорий) ---

/**
 * Делает нажатую кнопку фильтра визуально "активной" (цветной).
 */
function setActiveButton(nextCategory) {
  const buttons = filtersRoot.querySelectorAll("button[data-category]");
  buttons.forEach((button) => {
    const isActive = button.dataset.category === nextCategory;
    button.classList.toggle("is-active", isActive);
  });
}

/**
 * Создает кнопки фильтров на основе того, какие места загружены.
 */
// Зачем это нужно: Мы не пишем кнопки в HTML вручную. Если пользователь загрузит свой файл, 
// в котором будут, например, "Музеи", кнопка для музеев появится сама.
function createFilters() {
  const categories = ["all", ...categoryLayers.keys()];
  filtersRoot.innerHTML = "";
  categories.forEach((category) => {
    const button = document.createElement("button");
    button.type = "button"; button.dataset.category = category; button.className = "filter-btn";
    const config = categoryConfig[category] || categoryConfig.other;
    button.innerHTML = `<i class="ph-bold ${config.icon}"></i> ${config.label}`;
    
    // По клику на кнопку меняем фильтр
    button.addEventListener("click", () => {
      currentCategory = category; renderByCategory(currentCategory); setActiveButton(currentCategory);
    });
    filtersRoot.appendChild(button);
  });
  setActiveButton(currentCategory);
}

// --- Загрузка и удаление данных ---

/**
 * Эта функция полностью обновляет карту. Стирает старое и рисует новое.
 */
function refreshMapData(features, nextCategory = "all") {
  loadedFeatures = features;
  currentCategory = nextCategory;
  categoryLayers.clear();
  features.forEach(addFeatureToLayers);
  createFilters();
  renderByCategory(currentCategory);
  setStatus(`<i class="ph-fill ph-check-circle"></i> Загружено объектов: ${loadedFeatures.length}`);
}

/**
 * Кнопка "Удалить точки".
 */
function clearPoints() {
  loadedFeatures = [];
  categoryLayers.forEach((layer) => layer.clearLayers());
  createFilters();
  setStatus(`<i class="ph-bold ph-trash"></i> Точки очищены`);
}

/**
 * Удаляет нарисованные линии маршрутов, но оставляет сами точки мест.
 */
function clearRoutes() {
  if (routingControl) {
    map.removeControl(routingControl);
    routingControl = null;
  }
  importedRoutesGroup.clearLayers();
  activeRouteGeoJSON = null;
  setStatus(`<i class="ph-bold ph-trash"></i> Маршрут сброшен`);
}

// --- Работа с файлами (Импорт и Экспорт) ---

/**
 * Читает загруженный файл (zip с SHP или kml) и вытаскивает оттуда точки.
 */
async function handleImport(file) {
  const name = file.name.toLowerCase();
  let geojson = null;

  try {
    // В зависимости от того, что загрузили, используем разные инструменты для распаковки
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

    // Собираем все найденные точки в один список
    let features = [];
    if (geojson.type === "FeatureCollection") features = geojson.features || [];
    else if (Array.isArray(geojson)) features = geojson.flatMap((p) => p.features || []);
    else if (geojson.type === "Feature") features = [geojson];

    const newPoints = [];

    // Проходимся по каждой точке и приводим ее к нашему стандарту (чтобы были имя, картинка и т.д.)
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
        // Если это не точка, а линия (маршрут), просто рисуем её на карте
        L.geoJSON(f, { style: { color: "#5c67f2", weight: 6, opacity: 0.9 } }).addTo(importedRoutesGroup);
        if (!activeRouteGeoJSON) activeRouteGeoJSON = f;
      }
    });

    // Если нашли новые точки — добавляем их к старым и обновляем карту
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

/**
 * Сохраняет текущие места в профессиональный формат SHP (скачивается архивом).
 */
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

/**
 * Сохраняет текущие места в формат KML (для Google Earth и навигаторов).
 */
// Зачем это нужно: Мы собираем файл прямо "в памяти" браузера и заставляем браузер его скачать. 
// Так нам не нужен сложный сервер в интернете, всё работает прямо на вашем компьютере.
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

// --- Логика маршрутов ---

/**
 * Готовит нарисованный маршрут к скачиванию.
 */
function getRouteCollection() {
  return activeRouteGeoJSON ? { type: "FeatureCollection", features: [activeRouteGeoJSON] } : { type: "FeatureCollection", features: [] };
}

/**
 * Пытается узнать, где вы находитесь (геолокация телефона/компьютера).
 */
function getUserLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject();
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(L.latLng(pos.coords.latitude, pos.coords.longitude)),
      (err) => reject(err), { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

/**
 * Рисует дорогу от вас до выбранного места.
 */
async function buildRouteTo(feature) {
  const [lng, lat] = feature.geometry.coordinates;
  const destination = L.latLng(lat, lng);

  setStatus(`<i class="ph-bold ph-spinner-gap" style="animation: spin 1s linear infinite;"></i> Получаем геопозицию...`);
  let start;
  try { 
    start = await getUserLocation(); 
  } catch {
    // Если вы не дали разрешение браузеру отслеживать вас, или геолокация сломалась,
    // мы просто ставим начальную точку "по умолчанию", чтобы код не упал с ошибкой.
    setStatus("Используем стартовую точку по умолчанию.", true);
    start = L.latLng(44.95, 34.1);
  }

  clearRoutes(); // Сначала стираем старые маршруты

  // Просим карту проложить дорогу
  routingControl = L.Routing.control({
    waypoints: [start, destination],
    routeWhileDragging: false, addWaypoints: false, fitSelectedRoutes: true, showAlternatives: false, language: "ru",
    lineOptions: { styles: [{ color: "#1e293b", opacity: 0.9, weight: 8 }, { color: "#5c67f2", opacity: 1, weight: 4 }] },
    createMarker: () => null // Прячем страшненькие маркеры по умолчанию
  }).addTo(map);

  // --- Кнопка "Открыть в Яндекс Картах" ---
  
  const routingContainer = document.querySelector('.leaflet-routing-container');
  if (routingContainer) {
    const btnWrapper = document.createElement("div");
    btnWrapper.className = "route-actions-wrapper";

    const yandexBtn = document.createElement("button");
    yandexBtn.className = "yandex-route-btn";
    yandexBtn.innerHTML = '<i class="ph-bold ph-navigation-arrow"></i> Открыть в Яндекс Картах';
    yandexBtn.onclick = () => {
      // Это специальные ссылки: первая пытается открыть само приложение Яндекс.Карт на телефоне
      const appUrl = `yandexmaps://build_route_on_map?lat_to=${destination.lat}&lon_to=${destination.lng}`;
      const webUrl = `https://yandex.ru/maps/?rtext=~${destination.lat},${destination.lng}&rtt=auto`;
      const startTime = Date.now();
      
      window.location.href = appUrl;

      // Если через полсекунды мы всё ещё на этой же странице (приложение не открылось),
      // мы открываем обычный сайт Яндекс.Карт в новой вкладке.
      setTimeout(() => {
        if (Date.now() - startTime < 700) {
          setStatus("Приложение не найдено. Открываем веб-версию...");
          window.open(webUrl, "_blank");
        }
      }, 500);
    };

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'cancel-route-btn';
    cancelBtn.innerHTML = '<i class="ph-bold ph-x-circle"></i> Отменить маршрут';
    cancelBtn.onclick = clearRoutes;

    btnWrapper.appendChild(yandexBtn);
    btnWrapper.appendChild(cancelBtn);
    routingContainer.prepend(btnWrapper);
  }

  // Когда маршрут построился, сохраняем его координаты, чтобы потом можно было его скачать
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

// --- Привязка действий к кнопкам ---
// Здесь мы просто говорим: "когда кликнут по этой кнопке - выполни ту функцию".

document.getElementById("import-btn").addEventListener("click", () => importInput.click());
importInput.addEventListener("change", (e) => {
  if (e.target.files[0]) { 
    setStatus(`<i class="ph-bold ph-spinner-gap" style="animation: spin 1s linear infinite"></i> Чтение...`); 
    handleImport(e.target.files[0]); 
  }
  e.target.value = "";
});

document.getElementById("clear-pts-btn").addEventListener("click", clearPoints);
document.getElementById("export-pts-shp").addEventListener("click", () => exportToSHP({ type: "FeatureCollection", features: loadedFeatures }, "map-points"));
document.getElementById("export-pts-kml").addEventListener("click", () => exportToKML({ type: "FeatureCollection", features: loadedFeatures }, "map-points"));
document.getElementById("export-rt-shp").addEventListener("click", () => exportToSHP(getRouteCollection(), "map-routes"));
document.getElementById("export-rt-kml").addEventListener("click", () => exportToKML(getRouteCollection(), "map-routes"));

themeToggleBtn?.addEventListener("click", () => {
  isDark = !isDark;
  localStorage.setItem("theme", isDark ? "dark" : "light"); // Запоминаем выбор пользователя
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

// Кнопка сворачивания панели инструментов
toggleToolsBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  toolsPanel?.classList.add("collapsed");
});

// Разворачивание панели при клике на нее
toolsPanel?.addEventListener("click", () => {
  if (toolsPanel.classList.contains("collapsed")) {
    toolsPanel.classList.remove("collapsed");
  }
});

// --- Самый старт программы ---

/**
 * Точка входа. Читает стартовый файл точек (который мы положили рядом с сайтом) и рисует их.
 */
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