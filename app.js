import { categories, districts, policy, cases } from './content.js';
import { clickedDistrict, drawMap, findDistrict, loadMap, shortName } from './map.js';

const $ = id => document.getElementById(id);
const trialMode = document.body.dataset.trial === 'browser';
const trialStorageKey = 'livestream-browser-trial';
const mapCanvas = $('district-map');
const source = $('data-source');
const days = $('days');
const category = $('category');
const districtPicker = $('district');
const caseCategory = $('case-category');
const dialog = $('upload-dialog');
const form = $('report-form');
const photoField = $('photo');
const preview = $('photo-preview');
const confirmed = $('photo-confirmed');
const occurred = $('occurred');
const send = $('send');
const editorStatus = $('photo-status');
let features = [];
let selectedDistrict = null;
let mapFrame;
let counts = {};
let renderSequence = 0;

const demoCounts = { 黄浦: 24, 浦东: 18, 静安: 13, 徐汇: 11, 杨浦: 9, 虹口: 8, 长宁: 6, 闵行: 5, 普陀: 4, 宝山: 3, 嘉定: 3, 松江: 2, 青浦: 2, 奉贤: 1, 金山: 1, 崇明: 1 };
const localMode = 'livestream-map-mode';
source.value = sessionStorage.getItem(localMode) === 'local' ? 'local' : 'demo';

for (const name of categories) {
  for (const select of [category, $('report-category'), caseCategory]) select.add(new Option(name, name));
}
for (const district of districts) {
  districtPicker.add(new Option(district === '浦东' ? '浦东新区' : district + '区', district));
}

function renderArticles(container, items) {
  container.replaceChildren();
  for (const entry of items) {
    const detail = document.createElement('details');
    const summary = document.createElement('summary');
    const tag = document.createElement('small');
    tag.textContent = entry.tag;
    summary.append(entry.title, tag);
    const paragraph = document.createElement('p');
    paragraph.textContent = entry.text;
    const attribution = document.createElement('p');
    attribution.className = 'source';
    if (entry.link) {
      const anchor = document.createElement('a');
      anchor.href = entry.link;
      anchor.rel = 'noreferrer';
      anchor.target = '_blank';
      anchor.textContent = entry.source;
      attribution.append(anchor);
    } else attribution.textContent = entry.source;
    detail.append(summary, paragraph, attribution);
    container.append(detail);
  }
  if (!items.length) {
    const message = document.createElement('p');
    message.textContent = '该类型暂时没有示例，可以切换其他问题。';
    container.append(message);
  }
}

renderArticles($('policy-list'), policy);
renderArticles($('case-list'), cases);
caseCategory.addEventListener('change', () => renderArticles(
  $('case-list'), cases.filter(entry => !caseCategory.value || entry.category === caseCategory.value)
));

function showSection() {
  const requested = location.hash.slice(1);
  const page = ['map', 'policy', 'cases'].includes(requested) ? requested : 'map';
  for (const section of document.querySelectorAll('.view')) section.hidden = section.id !== page;
  for (const link of document.querySelectorAll('[data-tab]')) {
    if (link.dataset.tab === page) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  window.scrollTo({ top: 0 });
  if (page === 'map') paintMap();
}

window.addEventListener('hashchange', showSection);
showSection();

function paintMap() {
  if (features.length) mapFrame = drawMap(mapCanvas, features, counts, selectedDistrict);
}
new ResizeObserver(paintMap).observe(mapCanvas);

function showCounts() {
  $('overview-label').textContent = selectedDistrict ? districtPicker.querySelector(
    'option[value="' + selectedDistrict + '"]'
  ).textContent : '上海全市';
  $('reset-district').hidden = !selectedDistrict;
  $('total').textContent = selectedDistrict ? counts[selectedDistrict] || 0 :
    Object.values(counts).reduce((sum, count) => sum + count, 0);
  const sorted = [...districts].sort((a, b) => (counts[b] || 0) - (counts[a] || 0));
  const maximum = counts[sorted[0]] || 1;
  $('district-list').replaceChildren();
  for (const name of sorted) {
    const row = document.createElement('button');
    row.className = 'district-row';
    row.type = 'button';
    row.setAttribute('aria-pressed', String(selectedDistrict === name));
    row.dataset.district = name;
    const label = document.createElement('span');
    label.textContent = name;
    const track = document.createElement('span');
    track.className = 'bar';
    const bar = document.createElement('i');
    bar.style.width = (100 * (counts[name] || 0) / maximum) + '%';
    track.append(bar);
    const count = document.createElement('strong');
    count.textContent = counts[name] || 0;
    row.append(label, track, count);
    row.addEventListener('click', () => selectDistrict(name, true));
    $('district-list').append(row);
  }
  paintMap();
}

function selectDistrict(name, restoreFocus = false) {
  selectedDistrict = selectedDistrict === name ? null : name;
  showCounts();
  if (restoreFocus) $('district-list').querySelector('[data-district="' + name + '"]')?.focus({ preventScroll: true });
}

async function refreshCounts() {
  const key = ++renderSequence;
  if (source.value === 'demo') {
    const part = (days.value === '7' ? .36 : 1) * (category.value ? .31 : 1);
    counts = Object.fromEntries(Object.entries(demoCounts).map(([name, count]) => [name, Math.round(count * part)]));
    $('data-note').textContent = '演示数据，用于体验网站。';
    showCounts();
    return;
  }
  if (trialMode) {
    const start = new Date(shanghaiTime().slice(0, 10) + 'T00:00:00+08:00').getTime()
      - (Number(days.value) - 1) * 86_400_000;
    counts = Object.fromEntries(districts.map(name => [name, 0]));
    for (const record of JSON.parse(sessionStorage.getItem(trialStorageKey) || '[]')) {
      if (Date.parse(record.occurred) >= start && (!category.value || record.category === category.value)) {
        counts[record.district] += 1;
      }
    }
    $('data-note').textContent = '本次手机试用的提交记录。';
    showCounts();
    return;
  }
  try {
    const query = new URLSearchParams({ days: days.value, category: category.value });
    const result = await fetch('/api/stats?' + query);
    if (!result.ok) throw new Error();
    const data = await result.json();
    if (key !== renderSequence) return;
    counts = data.counts;
    $('data-note').textContent = '本机提交按发生日期汇总。';
    showCounts();
  } catch {
    if (key !== renderSequence) return;
    counts = {};
    $('data-note').textContent = '暂时未能读取本机记录，请切换筛选条件重试。';
    showCounts();
    $('total').textContent = '—';
  }
}
source.addEventListener('change', () => {
  sessionStorage.setItem(localMode, source.value);
  refreshCounts();
});
days.addEventListener('change', refreshCounts);
category.addEventListener('change', refreshCounts);
$('reset-district').addEventListener('click', () => selectDistrict(null));
mapCanvas.addEventListener('click', event => {
  const rect = mapCanvas.getBoundingClientRect();
  const name = clickedDistrict(features, mapFrame, event.clientX - rect.left, event.clientY - rect.top);
  if (name) selectDistrict(name);
});

const mapReady = loadMap().then(data => {
  features = data;
  paintMap();
}).catch(() => { $('map-fallback').hidden = false; });
refreshCounts();

let reportId = crypto.randomUUID();
let timeEdited = false;
let bitmap;
let boxes = [];
let dragStart;
let draftBox;
let photoVersion = 0;
let editing = false;
let loadingPhoto = false;
let saving = false;
let worker;
let toastTimer;

function shanghaiTime() {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 16);
}
function openUpload() {
  if (!timeEdited) occurred.value = shanghaiTime();
  dialog.showModal();
}
for (const button of document.querySelectorAll('[data-upload]')) button.addEventListener('click', openUpload);
$('close-upload').addEventListener('click', () => { if (!saving) dialog.close(); });
dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
occurred.addEventListener('input', () => { timeEdited = Boolean(occurred.value); });

$('locate').addEventListener('click', () => {
  const status = $('location-status');
  const button = $('locate');
  if (!navigator.geolocation) {
    status.textContent = '此浏览器暂不支持定位，请手动选择区和地标。';
    return;
  }
  status.textContent = '正在获取当前位置…';
  button.disabled = true;
  navigator.geolocation.getCurrentPosition(async ({ coords }) => {
    await mapReady;
    button.disabled = false;
    const feature = coords.accuracy < 1200 && findDistrict(features, [coords.longitude, coords.latitude]);
    if (!feature) {
      status.textContent = '当前位置未能对应到上海行政区，请手动选择。';
      return;
    }
    districtPicker.value = shortName(feature.properties.name);
    status.textContent = '已填入' + feature.properties.name + '，请核对并补充附近地标。';
    $('place').focus();
  }, () => {
    button.disabled = false;
    status.textContent = '未能获取定位。请允许浏览器定位，或手动选择区和地标。';
  }, { enableHighAccuracy: true, timeout: 9500, maximumAge: 30_000 });
});

function setDrawing(active) {
  editing = active;
  $('start-mask').setAttribute('aria-pressed', String(active));
  preview.classList.toggle('drawing', active);
}

function drawPreview() {
  if (!bitmap) return;
  const ctx = preview.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, preview.width, preview.height);
  ctx.fillStyle = '#182322';
  for (const { left, top, right, bottom } of boxes) ctx.fillRect(left, top, right - left, bottom - top);
  if (draftBox) {
    ctx.fillStyle = '#18232280';
    const { left, top, right, bottom } = draftBox;
    ctx.fillRect(left, top, right - left, bottom - top);
  }
  $('undo-mask').disabled = !boxes.length;
}

async function detectPhoto(file, key) {
  const image = await createImageBitmap(file);
  if (key !== photoVersion) {
    image.close();
    return;
  }
  const scale = Math.min(1, 1280 / Math.max(image.width, image.height));
  preview.width = Math.max(1, Math.round(image.width * scale));
  preview.height = Math.max(1, Math.round(image.height * scale));
  bitmap = image;
  $('photo-editor').hidden = false;
  drawPreview();
  const sample = await createImageBitmap(preview);
  if (key !== photoVersion) {
    sample.close();
    return;
  }
  if (!worker) {
    worker = new Worker(new URL('./head-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.key !== photoVersion) return;
      loadingPhoto = false;
      send.disabled = false;
      if (data.boxes) {
        boxes.unshift(...data.boxes);
        editorStatus.textContent = data.boxes.length ?
          '已自动遮挡 ' + data.boxes.length + ' 处。请检查背影和远处的人头。' :
          '没有识别到人头。如果照片里有人，请手动框选。';
      } else {
        editorStatus.textContent = '自动打码暂不可用，可以手动框选后继续。';
        console.warn(data.error);
      }
      confirmed.checked = false;
      drawPreview();
    };
    worker.onerror = () => {
      worker.terminate();
      worker = undefined;
      loadingPhoto = false;
      send.disabled = false;
      editorStatus.textContent = '自动打码暂不可用，可以手动框选后继续。';
    };
  }
  worker.postMessage({ key, bitmap: sample }, [sample]);
}

function clearPhoto() {
  photoVersion += 1;
  bitmap?.close();
  bitmap = undefined;
  boxes = [];
  dragStart = draftBox = undefined;
  loadingPhoto = false;
  send.disabled = saving;
  confirmed.checked = false;
  editorStatus.textContent = '';
  $('photo-editor').hidden = true;
  setDrawing(false);
}

photoField.addEventListener('change', async () => {
  clearPhoto();
  const file = photoField.files[0];
  if (!file) return;
  if (file.size > 12_000_000) {
    editorStatus.textContent = '图片大于 12 MB，请换一张照片。';
    return;
  }
  const key = photoVersion;
  editorStatus.textContent = '正在查找照片里的人头…';
  loadingPhoto = true;
  send.disabled = true;
  try {
    await detectPhoto(file, key);
  } catch {
    if (key !== photoVersion) return;
    loadingPhoto = false;
    send.disabled = false;
    editorStatus.textContent = bitmap ?
      '无法自动打码，可以手动框选。' :
      '无法打开这张图片，请改用 JPG 或 PNG。';
  }
});

function point(event) {
  const rect = preview.getBoundingClientRect();
  return [
    Math.max(0, Math.min(preview.width, (event.clientX - rect.left) * preview.width / rect.width)),
    Math.max(0, Math.min(preview.height, (event.clientY - rect.top) * preview.height / rect.height)),
  ];
}

function dragBox(a, b) {
  return { left: Math.min(a[0], b[0]), top: Math.min(a[1], b[1]), right: Math.max(a[0], b[0]), bottom: Math.max(a[1], b[1]) };
}

$('start-mask').addEventListener('click', () => {
  setDrawing(!editing);
  if (editing) editorStatus.textContent = '在照片上拖动，框住需要遮挡的位置。';
});
$('cover-all').addEventListener('click', () => {
  boxes.push({ left: 0, top: 0, right: preview.width, bottom: preview.height });
  confirmed.checked = false;
  drawPreview();
});
$('undo-mask').addEventListener('click', () => {
  boxes.pop();
  confirmed.checked = false;
  drawPreview();
});
preview.addEventListener('pointerdown', event => {
  if (!editing || !bitmap || saving || !event.isPrimary) return;
  preview.setPointerCapture(event.pointerId);
  dragStart = point(event);
});
preview.addEventListener('pointermove', event => {
  if (!dragStart || !event.isPrimary) return;
  draftBox = dragBox(dragStart, point(event));
  drawPreview();
});
preview.addEventListener('pointerup', event => {
  if (!dragStart || !event.isPrimary) return;
  const box = dragBox(dragStart, point(event));
  if (box.right - box.left > 3 && box.bottom - box.top > 3) {
    boxes.push(box);
    confirmed.checked = false;
  }
  dragStart = draftBox = undefined;
  drawPreview();
});
preview.addEventListener('pointercancel', () => {
  dragStart = draftBox = undefined;
  drawPreview();
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (saving || loadingPhoto) return;
  if (!bitmap || !confirmed.checked) {
    $('form-message').textContent = '请添加照片并检查打码预览。';
    return;
  }
  saving = true;
  send.disabled = true;
  $('form-message').textContent = '';
  try {
    draftBox = undefined;
    drawPreview();
    const data = {
      id: reportId,
      district: districtPicker.value,
      place: $('place').value,
      category: $('report-category').value,
      description: $('description').value,
      occurred: timeEdited ? occurred.value + ':00+08:00' : null,
      confirmed: true,
    };
    if (trialMode) {
      const records = JSON.parse(sessionStorage.getItem(trialStorageKey) || '[]');
      records.push({ district: data.district, category: data.category, occurred: data.occurred || new Date().toISOString() });
      sessionStorage.setItem(trialStorageKey, JSON.stringify(records));
    } else {
      data.photo = preview.toDataURL('image/jpeg', .87);
      const response = await fetch('/api/reports', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error((await response.json()).error);
    }
    form.reset();
    clearPhoto();
    timeEdited = false;
    reportId = crypto.randomUUID();
    $('location-status').textContent = '补传旧照片时，可直接填写事发地点。';
    dialog.close();
    selectedDistrict = data.district;
    source.value = 'local';
    sessionStorage.setItem(localMode, 'local');
    category.value = '';
    days.value = '30';
    location.hash = 'map';
    await refreshCounts();
    const toast = $('toast');
    toast.textContent = trialMode ? '试用记录已计入本次地图。' : '记录已保存到本机。观察地图已更新。';
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 5000);
  } catch (error) {
    $('form-message').textContent = error.message === 'Failed to fetch' ? '暂时无法连接，请保留页面后重试。' :
      error.message || '暂时未能提交，请稍后重试。';
  } finally {
    saving = false;
    send.disabled = false;
  }
});
