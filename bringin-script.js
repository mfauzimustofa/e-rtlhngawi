// ==================== GLOBAL STATE ====================
let map;
let markerCluster;
let currentFeatures = [];
let allFeatures = [];
let boundaryLayer;
let polaruangLayer = null;
let protectedForestPolygons = [];
let protectedForestLoaded = false;
let weights = { luas: 30, penghuni: 35, pekerjaan: 35 };
let currentFilter = 'all';
let currentDesaFilter = 'all';
let currentFlyFeature = null;
let pieChartInstance = null;
let barChartInstance = null;
let searchTimeout = null;

// Konfigurasi pusat Bringin
const CENTER = [-7.38, 111.57];
const ZOOM = 13;

// ==================== 5 BASE MAP LAYERS ====================
const baseLayers = {
  "🗺️ Peta Jalan": L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OSM & CartoDB', subdomains: 'abcd', maxZoom: 19
  }),
  "🌍 Google Maps": L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
    attribution: '&copy; Google Maps', maxZoom: 20
  }),
  "🛰️ Google Satelit": L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
    attribution: '&copy; Google Satelit', maxZoom: 20
  }),
  "🏔️ Satelit + Label": L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
    attribution: '&copy; Google Earth', maxZoom: 20
  }),
  "🌙 Peta Gelap": L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OSM & CartoDB', subdomains: 'abcd', maxZoom: 19
  })
};

// ==================== TOAST NOTIFICATIONS ====================
function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  const icon = { success: 'fa-check-circle', error: 'fa-times-circle', info: 'fa-info-circle' }[type] || 'fa-info-circle';
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<i class="fas ${icon}"></i> ${message}`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ==================== LOADING BAR ====================
function setLoadingProgress(pct, status) {
  const bar = document.getElementById('loadingBar');
  const statusEl = document.getElementById('loadingStatus');
  if (bar) bar.style.width = pct + '%';
  if (statusEl && status) statusEl.textContent = status;
}

// ==================== HELPER: JOB SCORE ====================
function getJobScore(pekerjaan) {
  const job = (pekerjaan || '').toUpperCase();
  if (job.includes('PETANI') || job.includes('BURUH') || job.includes('TIDAK BEKERJA') || job.includes('LANSIA')) return 90;
  if (job.includes('WIRAUSAHA') || job.includes('KARYAWAN')) return 50;
  if (job.includes('PENSIUNAN')) return 40;
  return 60;
}

// ==================== PROTECTED FOREST ====================
function isInProtectedForest(lng, lat) {
  if (!protectedForestLoaded) return false;
  const point = [lng, lat];
  for (let poly of protectedForestPolygons) {
    if (isPointInPolygon(point, poly)) return true;
  }
  return false;
}

function isPointInPolygon(point, polygon) {
  const x = point[0], y = point[1];
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const intersect = ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// ==================== PRIORITY CALCULATION ====================
function calculatePriority(feature) {
  const coords = feature.geometry.coordinates;
  const lng = coords[0], lat = coords[1];
  if (isInProtectedForest(lng, lat)) return 0;

  const props = feature.properties;
  const luas = props.luas_rum || 50;
  const jmlPenghuni = props.jml_peng || 1;

  const luasMin = 20, luasMax = 120;
  let luasScore = 0;
  if (luas <= luasMin) luasScore = 100;
  else if (luas >= luasMax) luasScore = 0;
  else luasScore = ((luasMax - luas) / (luasMax - luasMin)) * 100;

  let penghuniScore = Math.min(100, (jmlPenghuni / 10) * 100);
  let kerjaScore = getJobScore(props.pekerjaan);

  const totalW = weights.luas + weights.penghuni + weights.pekerjaan;
  if (totalW === 0) return 0;
  const finalScore = (luasScore * weights.luas + penghuniScore * weights.penghuni + kerjaScore * weights.pekerjaan) / totalW;
  return Math.min(100, Math.max(0, finalScore));
}

function getPriorityCategory(score) {
  if (score === 0) return 'none';
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

function getMarkerColor(category) {
  if (category === 'high') return '#E53E3E';
  if (category === 'medium') return '#DD6B20';
  if (category === 'low') return '#276749';
  return '#9E9E9E';
}

function getCategoryLabel(cat) {
  if (cat === 'high') return 'PRIORITAS TINGGI';
  if (cat === 'medium') return 'PRIORITAS SEDANG';
  if (cat === 'low') return 'PRIORITAS RENDAH';
  return 'TIDAK BERHAK';
}

// ==================== MARKER CREATION ====================
function createCustomIcon(color, category) {
  const pulse = category === 'high'
    ? `<div class="marker-pulse" style="background:${color};opacity:0.2;"></div>`
    : '';
  return L.divIcon({
    html: `<div class="marker-pin">
      ${pulse}
      <div style="
        background:${color};
        width:30px; height:30px;
        border-radius:50%;
        display:flex; align-items:center; justify-content:center;
        border:3px solid white;
        box-shadow:0 3px 10px rgba(0,0,0,0.25), 0 0 0 1px ${color}30;
      "><i class='fas fa-home' style='color:white;font-size:12px;'></i></div>
    </div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    className: 'custom-marker'
  });
}

// ==================== RENDER MAP ====================
function renderMap() {
  if (markerCluster) map.removeLayer(markerCluster);
  markerCluster = L.markerClusterGroup({
    chunkedLoading: true,
    maxClusterRadius: 50,
    iconCreateFunction: function(cluster) {
      const count = cluster.getChildCount();
      return L.divIcon({
        html: `<div style="
          background: white;
          border: 2px solid var(--primary, #1B6CA8);
          color: var(--primary, #1B6CA8);
          width:38px; height:38px;
          border-radius:50%;
          display:flex; align-items:center; justify-content:center;
          font-weight:800; font-size:12px;
          box-shadow:0 2px 10px rgba(0,0,0,0.2);
          font-family:'Plus Jakarta Sans',sans-serif;
        ">${count}</div>`,
        iconSize: [38, 38],
        className: ''
      });
    }
  });

  const desaFilter = document.getElementById('filter-desa')?.value || 'all';

  let visibleCount = 0;
  currentFeatures.forEach(feat => {
    const coords = feat.geometry.coordinates;
    const lng = coords[0], lat = coords[1];
    if (!lat || !lng) return;

    const score = feat.properties._priorityScore;
    const category = getPriorityCategory(score);

    // Apply filter
    if (currentFilter !== 'all' && category !== currentFilter) return;
    if (desaFilter !== 'all' && feat.properties.desa !== desaFilter) return;

    const color = getMarkerColor(category);
    const icon = createCustomIcon(color, category);
    const marker = L.marker([lat, lng], { icon });
    const props = feat.properties;

    const catLabel = getCategoryLabel(category);
    const inForest = (score === 0);

    let popupContent = `
      <div style="font-family:'Plus Jakarta Sans',sans-serif; min-width:200px;">
        <div style="font-weight:800;font-size:0.9rem;color:#0F172A;margin-bottom:4px;">${props.kep_kk || 'Kepala Keluarga'}</div>
        <div style="font-size:0.75rem;color:#64748B;margin-bottom:8px;">
          <i class='fas fa-map-marker-alt' style='color:${color}'></i> ${props.desa || '-'} · ${props.alamat || '-'}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:0.75rem;margin-bottom:8px;">
          <div style="background:#F8FAFC;padding:5px 8px;border-radius:6px;">
            <div style="color:#94A3B8;font-size:0.65rem;">Luas Rumah</div>
            <div style="font-weight:700;color:#0F172A;">${props.luas_rum} m²</div>
          </div>
          <div style="background:#F8FAFC;padding:5px 8px;border-radius:6px;">
            <div style="color:#94A3B8;font-size:0.65rem;">Penghuni</div>
            <div style="font-weight:700;color:#0F172A;">${props.jml_peng} orang</div>
          </div>
        </div>
        ${inForest ? '<div style="background:#FFF5F5;border:1px solid #FC8181;border-radius:6px;padding:6px 8px;font-size:0.72rem;color:#E53E3E;font-weight:600;margin-bottom:8px;">⛔ Kawasan Hutan Lindung – Tidak berhak bantuan</div>' : ''}
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="background:${color}18;color:${color};padding:3px 10px;border-radius:99px;font-size:0.7rem;font-weight:700;">${catLabel}</span>
          <span style="font-family:'Space Mono',monospace;font-weight:700;font-size:0.75rem;color:#334155;">Skor: ${Math.round(score)}</span>
        </div>
        <button onclick="showDetail(${props.FID})" style="
          margin-top:8px;width:100%;background:#1B6CA8;border:none;
          padding:6px;border-radius:8px;color:white;font-weight:700;
          font-size:0.75rem;cursor:pointer;font-family:'Plus Jakarta Sans',sans-serif;
        "><i class='fas fa-search-plus'></i> Lihat Detail Lengkap</button>
      </div>
    `;

    marker.bindPopup(popupContent, { maxWidth: 260 });
    marker.on('click', () => showDetail(props.FID));
    markerCluster.addLayer(marker);
    visibleCount++;
  });

  map.addLayer(markerCluster);
  updateHeaderStats();
  // Hanya update ranking list jika tab 'list' aktif (hemat render)
  const listTab = document.getElementById('tab-content-list');
  if (listTab && listTab.classList.contains('active')) {
    updateRankingList();
  }
}

// ==================== UPDATE HEADER STATS ====================
function updateHeaderStats() {
  const total = currentFeatures.length;
  const high = currentFeatures.filter(f => getPriorityCategory(f.properties._priorityScore) === 'high').length;
  const medium = currentFeatures.filter(f => getPriorityCategory(f.properties._priorityScore) === 'medium').length;
  const low = currentFeatures.filter(f => getPriorityCategory(f.properties._priorityScore) === 'low').length;

  document.getElementById('chip-total').textContent = total;
  document.getElementById('chip-high').textContent = high;
  document.getElementById('chip-medium').textContent = medium;
  document.getElementById('chip-low').textContent = low;
}

// ==================== RANKING LIST ====================
function updateRankingList() {
  const container = document.getElementById('ranking-list');
  const countEl = document.getElementById('ranking-count');
  if (!container) return;

  const sortOrder = document.getElementById('sort-order')?.value || 'desc';
  const sorted = [...currentFeatures].sort((a, b) => {
    return sortOrder === 'desc'
      ? b.properties._priorityScore - a.properties._priorityScore
      : a.properties._priorityScore - b.properties._priorityScore;
  });

  if (countEl) countEl.textContent = sorted.length;

  container.innerHTML = sorted.map((feat, idx) => {
    const score = feat.properties._priorityScore;
    const cat = getPriorityCategory(score);
    const catLabel = cat === 'high' ? 'Tinggi' : cat === 'medium' ? 'Sedang' : cat === 'low' ? 'Rendah' : 'Tidak Berhak';
    return `
      <div class="rank-item ${cat}" onclick="focusFeature(${feat.properties.FID})">
        <div class="rank-num">#${idx + 1}</div>
        <div class="rank-info">
          <div class="rank-name">${feat.properties.kep_kk || 'Kepala Keluarga'}</div>
          <div class="rank-meta">
            <i class="fas fa-map-marker-alt"></i> Desa ${feat.properties.desa || '-'} · ${feat.properties.pekerjaan || '-'}
          </div>
        </div>
        <div class="rank-score-badge ${cat}">${Math.round(score)}</div>
      </div>
    `;
  }).join('');

  if (sorted.length === 0) {
    container.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:0.82rem;"><i class="fas fa-inbox" style="font-size:2rem;display:block;margin-bottom:8px;opacity:0.3;"></i>Tidak ada data</div>';
  }
}

// ==================== CHARTS ====================
function updateCharts() {
  const high = currentFeatures.filter(f => getPriorityCategory(f.properties._priorityScore) === 'high').length;
  const medium = currentFeatures.filter(f => getPriorityCategory(f.properties._priorityScore) === 'medium').length;
  const low = currentFeatures.filter(f => getPriorityCategory(f.properties._priorityScore) === 'low').length;
  const none = currentFeatures.filter(f => getPriorityCategory(f.properties._priorityScore) === 'none').length;

  // PIE CHART
  const pieCtx = document.getElementById('pieChart');
  if (pieCtx) {
    if (pieChartInstance) pieChartInstance.destroy();
    pieChartInstance = new Chart(pieCtx, {
      type: 'doughnut',
      data: {
        labels: ['Prioritas Tinggi', 'Prioritas Sedang', 'Prioritas Rendah', 'Tidak Berhak'],
        datasets: [{
          data: [high, medium, low, none],
          backgroundColor: ['#E53E3E', '#DD6B20', '#276749', '#9E9E9E'],
          borderWidth: 3,
          borderColor: '#FFFFFF',
          hoverBorderWidth: 0,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              font: { family: 'Plus Jakarta Sans', size: 11, weight: '600' },
              padding: 10,
              usePointStyle: true,
              pointStyleWidth: 8,
            }
          },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.label}: ${ctx.raw} KK (${((ctx.raw / currentFeatures.length) * 100).toFixed(1)}%)`
            }
          }
        },
        cutout: '58%',
      }
    });
  }

  // BAR CHART per desa
  const desaMap = {};
  currentFeatures.forEach(f => {
    const desa = f.properties.desa || 'Unknown';
    const cat = getPriorityCategory(f.properties._priorityScore);
    if (!desaMap[desa]) desaMap[desa] = { high: 0, medium: 0, low: 0, none: 0 };
    desaMap[desa][cat]++;
  });

  const desaLabels = Object.keys(desaMap).sort();
  const barCtx = document.getElementById('barChart');
  if (barCtx) {
    if (barChartInstance) barChartInstance.destroy();
    barChartInstance = new Chart(barCtx, {
      type: 'bar',
      data: {
        labels: desaLabels.map(d => d.length > 10 ? d.slice(0, 10) + '…' : d),
        datasets: [
          { label: 'Tinggi', data: desaLabels.map(d => desaMap[d].high), backgroundColor: '#E53E3E', borderRadius: 3 },
          { label: 'Sedang', data: desaLabels.map(d => desaMap[d].medium), backgroundColor: '#DD6B20', borderRadius: 3 },
          { label: 'Rendah', data: desaLabels.map(d => desaMap[d].low), backgroundColor: '#276749', borderRadius: 3 },
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            stacked: true,
            ticks: { font: { family: 'Plus Jakarta Sans', size: 9 }, maxRotation: 45 },
            grid: { display: false }
          },
          y: {
            stacked: true,
            ticks: { font: { family: 'Plus Jakarta Sans', size: 10 } },
            grid: { color: '#F1F5F9' }
          }
        },
        plugins: {
          legend: {
            position: 'top',
            labels: { font: { family: 'Plus Jakarta Sans', size: 10, weight: '600' }, padding: 8, usePointStyle: true }
          }
        }
      }
    });
  }

  // STATS GRID
  const statsGrid = document.getElementById('statsGrid');
  if (statsGrid) {
    const avgScore = currentFeatures.length > 0
      ? (currentFeatures.reduce((s, f) => s + f.properties._priorityScore, 0) / currentFeatures.length).toFixed(1)
      : 0;
    const avgLuas = currentFeatures.length > 0
      ? (currentFeatures.reduce((s, f) => s + (f.properties.luas_rum || 0), 0) / currentFeatures.length).toFixed(0)
      : 0;
    const avgPeng = currentFeatures.length > 0
      ? (currentFeatures.reduce((s, f) => s + (f.properties.jml_peng || 0), 0) / currentFeatures.length).toFixed(1)
      : 0;

    statsGrid.innerHTML = `
      <div class="stat-item">
        <div class="stat-item-num" style="color:var(--danger)">${high}</div>
        <div class="stat-item-label">Prioritas Tinggi</div>
      </div>
      <div class="stat-item">
        <div class="stat-item-num" style="color:var(--warning)">${medium}</div>
        <div class="stat-item-label">Prioritas Sedang</div>
      </div>
      <div class="stat-item">
        <div class="stat-item-num" style="color:var(--success)">${low}</div>
        <div class="stat-item-label">Prioritas Rendah</div>
      </div>
      <div class="stat-item">
        <div class="stat-item-num">${none}</div>
        <div class="stat-item-label">Tidak Berhak</div>
      </div>
      <div class="stat-item">
        <div class="stat-item-num">${avgScore}</div>
        <div class="stat-item-label">Rata-rata Skor</div>
      </div>
      <div class="stat-item">
        <div class="stat-item-num">${avgLuas}m²</div>
        <div class="stat-item-label">Rata-rata Luas</div>
      </div>
      <div class="stat-item">
        <div class="stat-item-num">${avgPeng}</div>
        <div class="stat-item-label">Rata-rata Penghuni</div>
      </div>
      <div class="stat-item">
        <div class="stat-item-num">${desaLabels.length}</div>
        <div class="stat-item-label">Total Desa</div>
      </div>
    `;
  }
}

// ==================== DESA FILTER POPULATION ====================
function populateDesaFilter() {
  const desaSet = new Set(currentFeatures.map(f => f.properties.desa).filter(Boolean));
  const select = document.getElementById('filter-desa');
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="all">Semua Desa</option>';
  [...desaSet].sort().forEach(desa => {
    const opt = document.createElement('option');
    opt.value = desa;
    opt.textContent = desa;
    select.appendChild(opt);
  });
  if (current) select.value = current;
}

// ==================== PROCESS GEOJSON ====================
function processGeoJSON(geojson) {
  if (!geojson || !geojson.features) return [];
  currentFeatures = geojson.features.map((feat, idx) => {
    if (feat.properties.FID === undefined) feat.properties.FID = idx;
    const score = calculatePriority(feat);
    feat.properties._priorityScore = score;
    feat.properties._priorityCat = getPriorityCategory(score);
    return feat;
  });
  allFeatures = [...currentFeatures];
  populateDesaFilter();
  renderMap();
  updateCharts();
}

// ==================== LOAD DATA ====================
async function loadDefaultData() {
  try {
    setLoadingProgress(20, 'Memuat data RTLH...');
    const response = await fetch('bringin_data.json');
    if (!response.ok) throw new Error('File tidak ditemukan');
    const data = await response.json();
    setLoadingProgress(60, 'Memproses data...');
    processGeoJSON(data);
    showToast(`${currentFeatures.length} data RTLH berhasil dimuat`, 'success');
  } catch(e) {
    console.error('Gagal memuat data default:', e);
    processGeoJSON({ type: "FeatureCollection", features: [] });
    showToast('Gagal memuat data RTLH', 'error');
  }
}

async function loadBoundary() {
  try {
    setLoadingProgress(70, 'Memuat batas desa...');
    const response = await fetch('bts_admin_desa.json');
    if (!response.ok) throw new Error('File tidak ditemukan');
    const geojson = await response.json();

    boundaryLayer = L.geoJSON(geojson, {
      style: {
        color: '#2C3E50', weight: 2, opacity: 0.7,
        fillColor: '#3498DB', fillOpacity: 0.05, dashArray: '5, 5'
      },
      onEachFeature: function(feature, layer) {
        const desaName = feature.properties?.NAMOBJ || feature.properties?.DESA || feature.properties?.desa || feature.properties?.nama_desa || 'Desa';
        layer.bindPopup(`<b style="font-family:'Plus Jakarta Sans',sans-serif;">🗺️ Desa ${desaName}</b>`);
        layer.bindTooltip(`Desa ${desaName}`, { permanent: false, direction: 'center', className: 'desa-tooltip' });
      }
    });
    boundaryLayer.addTo(map);
  } catch(err) {
    console.warn('Gagal memuat batas desa:', err);
  }
}

async function loadPolaruang() {
  try {
    setLoadingProgress(85, 'Memuat data polaruang...');
    const response = await fetch('polaruang_bringin.geojson');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const geojson = await response.json();
    if (!geojson.features || geojson.features.length === 0) return;

    const forestFeatures = geojson.features.filter(feature => {
      const namobj = feature.properties?.NAMOBJ || '';
      return namobj.toLowerCase().includes('hutan') && namobj.toLowerCase().includes('lindung');
    });
    if (forestFeatures.length === 0) return;

    protectedForestPolygons = [];
    forestFeatures.forEach(feature => {
      const geom = feature.geometry;
      if (geom.type === 'Polygon') {
        protectedForestPolygons.push(geom.coordinates[0]);
      } else if (geom.type === 'MultiPolygon') {
        geom.coordinates.forEach(poly => protectedForestPolygons.push(poly[0]));
      }
    });
    protectedForestLoaded = true;

    const forestLayer = L.geoJSON(forestFeatures, {
      style: {
        color: '#D32F2F', weight: 2, opacity: 0.8,
        fillColor: '#D32F2F', fillOpacity: 0.12, dashArray: '4, 4'
      },
      onEachFeature: function(feature, layer) {
        layer.bindPopup(`
          <div style="font-family:'Plus Jakarta Sans',sans-serif;">
            <b style="color:#D32F2F;">⛔ Kawasan Hutan Lindung</b><br>
            <small>${feature.properties?.NAMOBJ || '-'}</small><br>
            <small>Dilarang mendirikan bangunan!</small>
          </div>
        `);
      }
    });

    if (polaruangLayer) map.removeLayer(polaruangLayer);
    polaruangLayer = forestLayer;
    polaruangLayer.addTo(map);

    if (currentFeatures.length > 0) {
      currentFeatures = currentFeatures.map(feat => {
        const newScore = calculatePriority(feat);
        feat.properties._priorityScore = newScore;
        feat.properties._priorityCat = getPriorityCategory(newScore);
        return feat;
      });
      renderMap();
      updateCharts();
    }
  } catch(err) {
    console.error('Gagal memuat polaruang:', err);
    protectedForestLoaded = false;
  }
}

// ==================== RECALCULATE ====================
function recalculateAll() {
  if (!currentFeatures.length) return;
  currentFeatures = currentFeatures.map(feat => {
    feat.properties._priorityScore = calculatePriority(feat);
    feat.properties._priorityCat = getPriorityCategory(feat.properties._priorityScore);
    return feat;
  });
  renderMap();
  updateCharts();
  showToast('Prioritas berhasil dihitung ulang', 'success');
}

// ==================== WEIGHT UPDATE ====================
function updateWeights() {
  const luas = parseInt(document.getElementById('weight-luas').value);
  const peng = parseInt(document.getElementById('weight-peng').value);
  const kerja = parseInt(document.getElementById('weight-kerja').value);

  weights.luas = luas;
  weights.penghuni = peng;
  weights.pekerjaan = kerja;

  document.getElementById('weight-luas-val').textContent = luas + '%';
  document.getElementById('weight-peng-val').textContent = peng + '%';
  document.getElementById('weight-kerja-val').textContent = kerja + '%';

  const total = luas + peng + kerja;
  const totalEl = document.getElementById('total-weight');
  const statusEl = document.getElementById('tw-status');
  const fillEl = document.getElementById('totalWeightFill');

  totalEl.textContent = total + '%';
  if (fillEl) {
    fillEl.style.width = Math.min(total, 100) + '%';
    fillEl.classList.toggle('over', total > 100);
  }

  if (total === 100) {
    statusEl.textContent = '✓ Seimbang';
    statusEl.className = 'tw-ok';
    totalEl.style.color = 'var(--success)';
  } else {
    statusEl.textContent = total > 100 ? '⚠ Melebihi 100%' : '⚠ Kurang dari 100%';
    statusEl.className = 'tw-warn';
    totalEl.style.color = 'var(--danger)';
  }

  // Auto-recalculate if weights valid
  if (total === 100) recalculateAll();
}

// ==================== FILTER ====================
function setFilter(btn, val) {
  currentFilter = val;
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  renderMap();
}

function filterMarkersByRank() {
  renderMap();
}

// ==================== SEARCH ====================
function searchKK(query) {
  const clearBtn = document.getElementById('searchClear');
  if (clearBtn) clearBtn.style.display = query ? 'flex' : 'none';
  clearTimeout(searchTimeout);

  // Remove existing dropdown
  const existing = document.getElementById('searchResults');
  if (existing) existing.remove();

  if (!query || query.length < 2) return;

  searchTimeout = setTimeout(() => {
    const results = allFeatures.filter(f =>
      (f.properties.kep_kk || '').toLowerCase().includes(query.toLowerCase()) ||
      (f.properties.desa || '').toLowerCase().includes(query.toLowerCase())
    ).slice(0, 10);

    const dropdown = document.createElement('div');
    dropdown.id = 'searchResults';
    dropdown.className = 'search-results';

    if (results.length === 0) {
      dropdown.innerHTML = '<div class="search-empty"><i class="fas fa-search"></i><br>Tidak ditemukan</div>';
    } else {
      dropdown.innerHTML = results.map(f => {
        const cat = getPriorityCategory(f.properties._priorityScore);
        const color = getMarkerColor(cat);
        return `
          <div class="search-result-item" onclick="focusFeature(${f.properties.FID}); document.getElementById('searchResults').remove(); document.getElementById('searchInput').value='${(f.properties.kep_kk || '').replace(/'/g, "\\'")}'; document.getElementById('searchClear').style.display='flex';">
            <span class="dot" style="background:${color};width:10px;height:10px;border-radius:50%;flex-shrink:0;"></span>
            <div class="search-result-info">
              <div class="search-result-name">${f.properties.kep_kk || '-'}</div>
              <div class="search-result-meta">Desa ${f.properties.desa || '-'} · Skor: ${Math.round(f.properties._priorityScore)}</div>
            </div>
          </div>
        `;
      }).join('');
    }
    document.body.appendChild(dropdown);

    // Position it
    const input = document.getElementById('searchInput');
    const rect = input.getBoundingClientRect();
    dropdown.style.position = 'fixed';
    dropdown.style.top = (rect.bottom + 6) + 'px';
    dropdown.style.left = rect.left + 'px';
    dropdown.style.width = Math.max(260, rect.width) + 'px';

    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', function handler(e) {
        if (!dropdown.contains(e.target) && e.target !== input) {
          dropdown.remove();
          document.removeEventListener('click', handler);
        }
      });
    }, 100);
  }, 250);
}

function clearSearch() {
  const input = document.getElementById('searchInput');
  const clearBtn = document.getElementById('searchClear');
  if (input) input.value = '';
  if (clearBtn) clearBtn.style.display = 'none';
  const results = document.getElementById('searchResults');
  if (results) results.remove();
}

// Focus & fly to feature
function focusFeature(fid) {
  const feature = allFeatures.find(f => f.properties.FID === fid);
  if (!feature) return;
  const coords = feature.geometry.coordinates;
  map.flyTo([coords[1], coords[0]], 15, { duration: 1 });
  setTimeout(() => showDetail(fid), 700);
}

// ==================== DETAIL MODAL ====================
function showDetail(fid) {
  const feature = allFeatures.find(f => f.properties.FID === fid);
  if (!feature) return;
  currentFlyFeature = feature;

  const p = feature.properties;
  const score = p._priorityScore || 0;
  const cat = getPriorityCategory(score);
  const color = getMarkerColor(cat);
  const catLabel = getCategoryLabel(cat);
  const coords = feature.geometry.coordinates;
  const inForest = isInProtectedForest(coords[0], coords[1]);

  // Header
  const header = document.getElementById('modalHeader');
  if (header) {
    header.className = 'modal-header header-' + cat;
  }
  const titleEl = document.getElementById('modalTitle');
  if (titleEl) titleEl.textContent = p.kep_kk || 'Kepala Keluarga';
  const subtitleEl = document.getElementById('modalSubtitle');
  if (subtitleEl) subtitleEl.textContent = `Desa ${p.desa || '-'} · ${p.alamat || '-'}`;

  // Score bar
  const scoreNum = document.getElementById('modalScoreNum');
  const scoreBar = document.getElementById('modalScoreBar');
  const scoreStatus = document.getElementById('modalScoreStatus');
  if (scoreNum) scoreNum.textContent = Math.round(score);
  if (scoreBar) {
    scoreBar.style.width = '0%';
    scoreBar.className = 'score-bar-fill fill-' + cat;
    setTimeout(() => { scoreBar.style.width = score + '%'; }, 100);
  }
  if (scoreStatus) {
    scoreStatus.textContent = catLabel;
    scoreStatus.style.color = color;
  }

  // Body
  const body = document.getElementById('modal-body');
  if (!body) return;

  const forestWarn = inForest ? `
    <div class="forest-warning">
      <i class="fas fa-exclamation-triangle"></i>
      <div>DILARANG: Rumah berada di kawasan hutan lindung. Tidak dapat menerima bantuan RTLH.</div>
    </div>
  ` : '';

  body.innerHTML = `
    ${forestWarn}

    <div class="detail-section">
      <div class="detail-section-title"><i class="fas fa-user"></i> Data Kepala Keluarga</div>
      <div class="detail-grid">
        <div class="detail-item">
          <div class="detail-label">Kepala Keluarga</div>
          <div class="detail-value">${p.kep_kk || '-'}</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Jenis Kelamin</div>
          <div class="detail-value">${p.jen_kel || '-'}</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Umur</div>
          <div class="detail-value mono">${p.umur || '-'} tahun</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Pendidikan</div>
          <div class="detail-value">${p.pend_ter || '-'}</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Pekerjaan</div>
          <div class="detail-value">${p.pekerjaan || '-'}</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Penghasilan</div>
          <div class="detail-value">${p.pengh || '-'}</div>
        </div>
        <div class="detail-item full">
          <div class="detail-label">Alamat</div>
          <div class="detail-value">${p.alamat || '-'}, Desa ${p.desa || '-'}</div>
        </div>
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title"><i class="fas fa-home"></i> Data Bangunan</div>
      <div class="detail-grid">
        <div class="detail-item">
          <div class="detail-label">Luas Bangunan</div>
          <div class="detail-value mono">${p.luas_rum || 0} m²</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Luas Tanah</div>
          <div class="detail-value mono">${p.luas_tan || 0} m²</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Jumlah Penghuni</div>
          <div class="detail-value mono">${p.jml_peng || 0} orang</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Status Kepemilikan</div>
          <div class="detail-value">${p.status_kep || '-'}</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Dinding</div>
          <div class="detail-value">${p.material_d || '-'}<br><small style="color:var(--text-muted)">${p.kondisi_di || ''}</small></div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Atap</div>
          <div class="detail-value">${p.material_a || '-'}<br><small style="color:var(--text-muted)">${p.kondisi_at || ''}</small></div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Lantai</div>
          <div class="detail-value">${p.material_l || '-'}<br><small style="color:var(--text-muted)">${p.kondisi_la || ''}</small></div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Sumber Air</div>
          <div class="detail-value">${p.sumb_air_m || '-'}</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Jamban/Kloset</div>
          <div class="detail-value">${p.km_jamban || '-'} / ${p.jen_kloset || '-'}</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Jarak Sampah</div>
          <div class="detail-value">${p.jarak_samp || '-'}</div>
        </div>
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title"><i class="fas fa-map-pin"></i> Informasi Kawasan</div>
      <div class="detail-grid">
        <div class="detail-item">
          <div class="detail-label">Jenis Kawasan</div>
          <div class="detail-value">${p.jen_kaw || '-'}</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Fungsi Ruang</div>
          <div class="detail-value">${p.fung_ruang || '-'}</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Koordinat</div>
          <div class="detail-value mono" style="font-size:0.72rem;">${coords[1].toFixed(6)}, ${coords[0].toFixed(6)}</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Tanggal Pendataan</div>
          <div class="detail-value">${p.tanggal_pe || '-'}</div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('modal').classList.add('open');
  document.getElementById('modal').style.display = 'flex';
}

function closeModal() {
  const modal = document.getElementById('modal');
  modal.style.display = 'none';
  modal.classList.remove('open');
  currentFlyFeature = null;
}

function checkModalClose(e) {
  if (e.target === document.getElementById('modal')) closeModal();
}

function flyToFeature() {
  if (!currentFlyFeature) return;
  const coords = currentFlyFeature.geometry.coordinates;
  const featureDesa = (currentFlyFeature.properties.desa || '').toUpperCase().trim();
  closeModal();
  setTimeout(() => {
    // Cari polygon batas desa yang sesuai
    let desaBounds = null;
    if (boundaryLayer) {
      boundaryLayer.eachLayer(layer => {
        const namobj = (layer.feature?.properties?.NAMOBJ || '').toUpperCase().trim();
        if (namobj === featureDesa || featureDesa.includes(namobj) || namobj.includes(featureDesa)) {
          try { desaBounds = layer.getBounds(); } catch(e) {}
        }
      });
    }
    if (desaBounds && desaBounds.isValid()) {
      // Tampilkan batas desa dengan padding, lalu highlight titik
      map.flyToBounds(desaBounds, { padding: [40, 40], duration: 1.2, maxZoom: 15 });
      setTimeout(() => {
        // Setelah fit bounds, tambahkan marker highlight
        if (window._highlightMarker) map.removeLayer(window._highlightMarker);
        window._highlightMarker = L.circleMarker([coords[1], coords[0]], {
          radius: 18, color: '#1B6CA8', weight: 3,
          fillColor: '#1B6CA8', fillOpacity: 0.25
        }).addTo(map);
        setTimeout(() => {
          if (window._highlightMarker) {
            map.removeLayer(window._highlightMarker);
            window._highlightMarker = null;
          }
        }, 3000);
      }, 1400);
    } else {
      // Fallback: zoom moderat ke titik (bukan zoom 18 yang terlalu dekat)
      map.flyTo([coords[1], coords[0]], 14, { duration: 1.2 });
    }
  }, 200);
}

// ==================== EXPORT CSV ====================
function exportCSV() {
  if (!currentFeatures.length) return showToast('Tidak ada data untuk diekspor', 'error');

  const headers = [
    'FID','Desa','Kepala Keluarga','Jenis Kelamin','Umur','Alamat',
    'Pekerjaan','Penghasilan','Luas Bangunan (m²)','Luas Tanah (m²)',
    'Jml Penghuni','Dinding','Atap','Lantai','Sumber Air',
    'Skor Prioritas','Kategori','Hutan Lindung','Lat','Long'
  ];

  const rows = currentFeatures.map(f => {
    const p = f.properties;
    const coords = f.geometry.coordinates;
    const inForest = isInProtectedForest(coords[0], coords[1]);
    const cat = getPriorityCategory(p._priorityScore);
    return [
      p.FID, p.desa||'', p.kep_kk||'', p.jen_kel||'', p.umur||'', p.alamat||'',
      p.pekerjaan||'', p.pengh||'',
      p.luas_rum||0, p.luas_tan||0, p.jml_peng||0,
      `${p.material_d||''} (${p.kondisi_di||''})`,
      `${p.material_a||''} (${p.kondisi_at||''})`,
      `${p.material_l||''} (${p.kondisi_la||''})`,
      p.sumb_air_m||'',
      (p._priorityScore||0).toFixed(2), cat,
      inForest ? 'Ya (Dilarang)' : 'Tidak',
      coords[1], coords[0]
    ].map(v => `"${String(v).replace(/"/g, '""')}"`);
  });

  const csvContent = [headers, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `rtlh_bringin_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showToast(`${currentFeatures.length} data berhasil diekspor ke CSV`, 'success');
}

// ==================== MAP CONTROLS ====================
function resetMapView() {
  map.flyTo(CENTER, ZOOM, { duration: 1 });
}

function locateUser() {
  map.locate({ setView: true, maxZoom: 16 });
  map.once('locationfound', () => showToast('Lokasi Anda ditemukan', 'success'));
  map.once('locationerror', () => showToast('Tidak dapat menemukan lokasi Anda', 'error'));
}

// ==================== TAB SWITCHING ====================
function switchTab(tab) {
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-content-' + tab).classList.add('active');
  document.getElementById('tab-' + tab).classList.add('active');
  if (tab === 'chart') {
    setTimeout(updateCharts, 100);
  }
  if (tab === 'list') {
    setTimeout(updateRankingList, 50);
  }
}

// ==================== SIDEBAR TOGGLE ====================
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const isCollapsed = sidebar.classList.toggle('collapsed');
  // Sinkron bottom nav: jika sidebar ditutup, aktifkan tombol 'map'
  if (window.innerWidth <= 640) {
    document.querySelectorAll('.bottom-nav-btn').forEach(b => b.classList.remove('active'));
    if (isCollapsed) {
      const mapBtn = document.getElementById('bnav-map');
      if (mapBtn) mapBtn.classList.add('active');
    } else {
      const filterBtn = document.getElementById('bnav-filter');
      if (filterBtn) filterBtn.classList.add('active');
    }
  }
}

// ==================== OVERLAY CONTROLS ====================
function setupOverlayControls() {
  const overlays = {};
  if (boundaryLayer) overlays["🏘️ Batas Desa"] = boundaryLayer;
  if (polaruangLayer) overlays["⛔ Hutan Lindung"] = polaruangLayer;
  if (Object.keys(overlays).length > 0) {
    if (window.overlayControl) map.removeControl(window.overlayControl);
    window.overlayControl = L.control.layers(baseLayers, overlays, { position: 'topright', collapsed: true });
    window.overlayControl.addTo(map);
  }
}

// ==================== INIT MAP ====================
function initMap() {
  const defaultLayer = baseLayers["🗺️ Peta Jalan"];
  map = L.map('map', {
    zoomControl: false,
    attributionControl: true
  }).setView(CENTER, ZOOM);
  defaultLayer.addTo(map);

  // Attribution
  map.attributionControl.setPrefix('');
}

// ==================== START ====================
document.addEventListener('DOMContentLoaded', async () => {
  initMap();

  // Collapse sidebar by default on mobile
  if (window.innerWidth <= 640) {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.add('collapsed');
  }

  // Slider events
  document.getElementById('weight-luas').addEventListener('input', updateWeights);
  document.getElementById('weight-peng').addEventListener('input', updateWeights);
  document.getElementById('weight-kerja').addEventListener('input', updateWeights);
  updateWeights();

  // ESC to close modal
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });

  // Loading progress simulation
  setLoadingProgress(10, 'Menginisialisasi peta...');

  // Muat data utama + batas desa dulu (cepat), polaruang belakangan (7MB)
  await Promise.all([
    loadDefaultData(),
    loadBoundary(),
  ]);

  setLoadingProgress(100, 'Siap!');
  setupOverlayControls();

  setTimeout(() => {
    const overlay = document.getElementById('loading');
    if (overlay) overlay.classList.add('hide');
    setTimeout(() => { if (overlay) overlay.style.display = 'none'; }, 600);
    // Set bottom nav default ke 'map' di mobile
    if (window.innerWidth <= 640) {
      const mapBtn = document.getElementById('bnav-map');
      if (mapBtn) mapBtn.classList.add('active');
    }
  }, 500);

  // Muat polaruang di background setelah UI tampil
  setTimeout(async () => {
    await loadPolaruang();
    setupOverlayControls();
  }, 800);
});

// ==================== BOTTOM NAV (mobile) ====================
function bottomNavTo(target) {
  document.querySelectorAll('.bottom-nav-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('bnav-' + target);
  if (btn) btn.classList.add('active');

  const sidebar = document.getElementById('sidebar');
  if (target === 'map') {
    // Tutup sidebar, tampilkan peta
    sidebar.classList.add('collapsed');
  } else {
    // Buka sidebar dan switch tab
    sidebar.classList.remove('collapsed');
    switchTab(target);
  }
}
window.bottomNavTo = bottomNavTo;


window.recalculateAll = recalculateAll;
window.filterMarkersByRank = filterMarkersByRank;
window.setFilter = setFilter;
window.exportCSV = exportCSV;
window.resetMapView = resetMapView;
window.locateUser = locateUser;
window.showDetail = showDetail;
window.closeModal = closeModal;
window.checkModalClose = checkModalClose;
window.flyToFeature = flyToFeature;
window.toggleSidebar = toggleSidebar;
window.switchTab = switchTab;
window.searchKK = searchKK;
window.clearSearch = clearSearch;
window.focusFeature = focusFeature;
window.updateRankingList = updateRankingList;
