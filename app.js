import { categories, districts, demoRecords, policy, cases, scenarios } from './content.js?v=scenes';
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
const caseLink = $('map-case-link');
const exportButton = $('export-counts');
const dialog = $('upload-dialog');
const form = $('report-form');
const reportChoices = $('report-categories');
const photoField = $('photo');
const preview = $('photo-preview');
const originalPreview = $('original-preview');
const sampleGrid = document.createElement('canvas');
const confirmed = $('photo-confirmed');
const occurred = $('occurred');
const send = $('send');
const editorStatus = $('photo-status');
let features = [];
let selectedDistrict = null;
let mapFrame;
let counts = {};
let renderSequence = 0;

const localMode = 'livestream-map-mode';
source.value = sessionStorage.getItem(localMode) === 'local' ? 'local' : 'demo';

for (const name of categories) {
  for (const select of [category, caseCategory]) select.add(new Option(name, name));
  const label = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.name = 'categories';
  input.value = name;
  label.append(input, name);
  reportChoices.append(label);
}
for (const district of districts) {
  districtPicker.add(new Option(district === '浦东' ? '浦东新区' : district + '区', district));
}

function renderArticles(container, items, openId) {
  container.replaceChildren();
  for (const entry of items) {
    const detail = document.createElement('details');
    if (openId && entry.id === openId) detail.open = true;
    const summary = document.createElement('summary');
    const heading = document.createElement('span');
    const title = document.createElement('strong');
    title.className = 'article-title';
    title.textContent = entry.title;
    const tag = document.createElement('small');
    tag.className = 'article-tag';
    tag.textContent = entry.tag;
    heading.append(title, tag);
    summary.append(heading);
    detail.append(summary);
    const fields = entry.focus ?
      [['发生了什么', entry.text], ['关注什么', entry.focus], ['处理结果', entry.result]] :
      [['', entry.text]];
    for (const [label, value] of fields) {
      if (!value) continue;
      const paragraph = document.createElement('p');
      if (label) {
        const name = document.createElement('strong');
        name.textContent = label;
        paragraph.append(name, '　');
      }
      paragraph.append(value);
      detail.append(paragraph);
    }
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
    detail.append(attribution);
    container.append(detail);
  }
  if (!items.length) {
    const message = document.createElement('p');
    message.className = 'empty-state';
    message.textContent = '没有匹配的条目，请换一个关键词或筛选条件。';
    container.append(message);
  }
}

const scope = $('policy-kind');
const topic = $('policy-topic');
function showPolicy() {
  renderArticles($('policy-list'), policy.filter(entry =>
    (!scope.value || entry.scope === scope.value) && (!topic.value || entry.topic === topic.value)
  ));
}
scope.addEventListener('change', showPolicy);
topic.addEventListener('change', showPolicy);

const caseQuery = $('case-query');
function showCases(openId) {
  const query = caseQuery.value.trim().toLocaleLowerCase();
  renderArticles($('case-list'), cases.filter(entry =>
    (!caseCategory.value || entry.categories.includes(caseCategory.value)) &&
    [entry.title, entry.tag, entry.text, entry.focus, entry.result, ...entry.categories]
      .some(value => value?.toLocaleLowerCase().includes(query))
  ), openId);
}
caseCategory.addEventListener('change', showCases);
caseQuery.addEventListener('input', showCases);

const scenarioPicker = $('scenario-picker');
let activeScenario = scenarios[0];
function showScenario(scenario) {
  activeScenario = scenario;
  [...scenarioPicker.children].forEach((button, index) => {
    button.setAttribute('aria-pressed', String(scenarios[index] === scenario));
  });
  $('scenario-heading').textContent = scenario.heading;
  $('scenario-route').textContent = scenario.route;
  $('scenario-action').textContent = scenario.action;
  $('scenario-details').textContent = scenario.details;
  $('scenario-policy').href = '#policy?topic=' + scenario.topic;
  $('scenario-case').href = '#cases?case=' + scenario.caseId;
}
for (const scenario of scenarios) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = scenario.label;
  button.setAttribute('aria-controls', 'scenario-panel');
  button.addEventListener('click', () => showScenario(scenario));
  scenarioPicker.append(button);
}
showScenario(activeScenario);
$('scenario-report').addEventListener('click', () => openUpload(activeScenario.categories));

function showSection() {
  const [requested, query] = location.hash.slice(1).split('?');
  const params = new URLSearchParams(query);
  const page = ['map', 'policy', 'cases'].includes(requested) ? requested : 'map';
  for (const section of document.querySelectorAll('.view')) section.hidden = section.id !== page;
  for (const link of document.querySelectorAll('[data-tab]')) {
    if (link.dataset.tab === page) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (page === 'policy') {
    const requestedTopic = params.get('topic');
    topic.value = policy.some(entry => entry.topic === requestedTopic) ? requestedTopic : '';
    scope.value = '';
    showPolicy();
  }
  if (page === 'cases') {
    const filter = params.get('type');
    caseCategory.value = categories.includes(filter) ? filter : '';
    caseQuery.value = '';
    showCases(params.get('case'));
    $('case-list').querySelector('details[open] summary')?.focus({ preventScroll: true });
  }
  if (requested === 'map-overview') $('map-overview').scrollIntoView();
  else window.scrollTo({ top: 0 });
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

exportButton.addEventListener('click', () => {
  const now = Date.now();
  const range = Number(days.value);
  const start = shanghaiTime(now - (range - 1) * 86_400_000).slice(0, 10);
  const end = shanghaiTime(now).slice(0, 10);
  const kind = category.value || '全部问题';
  const label = source.selectedOptions[0].textContent;
  const selected = selectedDistrict ? [selectedDistrict] : districts;
  const rows = [['行政区', '数据来源', '开始日期', '截止日期', '问题类型', '记录数']];
  for (const name of selected) rows.push([name, label, start, end, kind, counts[name] || 0]);
  const csv = rows.map(row => row.map(value => '"' + String(value).replaceAll('"', '""') + '"').join(',')).join('\r\n');
  const fileURL = URL.createObjectURL(new Blob(['\uFEFF', csv, '\r\n'], { type: 'text/csv;charset=utf-8' }));
  const download = document.createElement('a');
  download.href = fileURL;
  download.download = '上海直播观察-区域统计-' + end + '.csv';
  document.body.append(download);
  download.click();
  download.remove();
  setTimeout(() => URL.revokeObjectURL(fileURL), 1000);
});

async function refreshCounts() {
  const key = ++renderSequence;
  exportButton.disabled = true;
  const related = cases.some(entry => entry.categories.includes(category.value)) ? category.value : '';
  caseLink.href = related ? '#cases?type=' + encodeURIComponent(related) : '#cases';
  caseLink.querySelector('span').textContent = related ? '查看' + related + '案例' : '国内案例';
  caseLink.querySelector('small').textContent = related ? '按地图上的问题类型查找。' : '按场景查找案例，了解争议和处理结果。';
  $('report-receipt').hidden = source.value === 'demo' || !$('receipt-types').childElementCount;
  for (const button of $('receipt-types').children) {
    button.setAttribute('aria-pressed', String(button.value === category.value));
  }
  if (source.value === 'demo') {
    const range = days.value === '7' ? 1 : 0;
    const kind = categories.indexOf(category.value);
    counts = Object.fromEntries(Object.entries(demoRecords).map(([name, periods]) => {
      const breakdown = periods[range];
      return [name, kind < 0 ? breakdown.reduce((sum, count) => sum + count, 0) : breakdown[kind]];
    }));
    $('data-note').textContent = '模拟记录，用于体验地图和筛选。';
    showCounts();
    exportButton.disabled = false;
    return;
  }
  if (trialMode) {
    const start = new Date(shanghaiTime().slice(0, 10) + 'T00:00:00+08:00').getTime()
      - (Number(days.value) - 1) * 86_400_000;
    counts = Object.fromEntries(districts.map(name => [name, 0]));
    for (const record of JSON.parse(sessionStorage.getItem(trialStorageKey) || '[]')) {
      if (Date.parse(record.occurred) >= start &&
          (!category.value || (record.categories ?? [record.category]).includes(category.value))) {
        counts[record.district] += 1;
      }
    }
    $('data-note').textContent = '当前浏览器的试用记录。';
    showCounts();
    exportButton.disabled = false;
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
    exportButton.disabled = false;
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
const districtExpander = $('expand-districts');
districtExpander.addEventListener('click', () => {
  const expanded = $('district-panel').classList.toggle('show-all');
  districtExpander.setAttribute('aria-expanded', String(expanded));
  districtExpander.textContent = expanded ? '收起区域列表' : '展开全部 16 区';
});
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
let maskMode = '';
let loadingPhoto = false;
let saving = false;
let reviewingOriginal = false;
let worker;
let toastTimer;

function updateSendButton() {
  send.disabled = saving || loadingPhoto || reviewingOriginal;
}

function compareOriginal(active) {
  reviewingOriginal = active;
  if (active) {
    setMaskMode('');
    originalPreview.width = preview.width;
    originalPreview.height = preview.height;
    originalPreview.getContext('2d').drawImage(bitmap, 0, 0, originalPreview.width, originalPreview.height);
  } else {
    originalPreview.width = 0;
    originalPreview.height = 0;
  }
  originalPreview.hidden = !active;
  preview.hidden = active;
  $('mask-actions').hidden = active;
  confirmed.disabled = active;
  $('preview-label').textContent = active ? '原图对照 · 仅当前设备可见' : '打码预览';
  $('compare-photo').textContent = active ? '返回打码图' : '对照原图';
  $('compare-photo').setAttribute('aria-pressed', String(active));
  updateSendButton();
}

$('compare-photo').addEventListener('click', () => {
  if (bitmap) compareOriginal(!reviewingOriginal);
});

function zoomPhoto(active) {
  const frame = $('preview-frame');
  frame.classList.toggle('zoomed', active);
  frame.tabIndex = active ? 0 : -1;
  frame.scrollTo(0, 0);
  $('zoom-photo').setAttribute('aria-pressed', String(active));
  $('zoom-photo').textContent = active ? '还原大小' : '放大预览';
  $('zoom-hint').hidden = !active;
}
$('zoom-photo').addEventListener('click', event => {
  setMaskMode('');
  zoomPhoto(event.currentTarget.getAttribute('aria-pressed') === 'false');
});

function shanghaiTime(timestamp = Date.now()) {
  return new Date(timestamp + 8 * 3600_000).toISOString().slice(0, 16);
}
function openUpload(suggestedCategories = []) {
  if (!timeEdited) occurred.value = shanghaiTime();
  if (!reportChoices.querySelector(':checked')) {
    for (const input of reportChoices.querySelectorAll('input')) {
      input.checked = suggestedCategories.includes(input.value);
    }
  }
  dialog.showModal();
}
for (const button of document.querySelectorAll('[data-upload]')) button.addEventListener('click', () => openUpload());
$('close-upload').addEventListener('click', () => { if (!saving) dialog.close(); });
dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
dialog.addEventListener('close', () => compareOriginal(false));
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

function setMaskMode(mode) {
  maskMode = mode;
  $('start-mask').setAttribute('aria-pressed', String(mode === 'draw'));
  $('remove-mask').setAttribute('aria-pressed', String(mode === 'remove'));
  preview.classList.toggle('drawing', mode === 'draw');
  preview.classList.toggle('erasing', mode === 'remove');
}

function paintMask(context, box) {
  const x = Math.max(0, Math.floor(box.left));
  const y = Math.max(0, Math.floor(box.top));
  const width = Math.min(preview.width, Math.ceil(box.right)) - x;
  const height = Math.min(preview.height, Math.ceil(box.bottom)) - y;
  if (width < 1 || height < 1) return;
  if (box.solid) {
    context.fillStyle = '#182322';
    context.fillRect(x, y, width, height);
    return;
  }

  // Sample only the covered head, with at most four cells on either axis.
  const scale = 4 / Math.max(width, height);
  sampleGrid.width = Math.max(1, Math.round(width * scale));
  sampleGrid.height = Math.max(1, Math.round(height * scale));
  const sample = sampleGrid.getContext('2d');
  sample.imageSmoothingQuality = 'high';
  const sourceX = bitmap.width / preview.width;
  const sourceY = bitmap.height / preview.height;
  sample.drawImage(bitmap, x * sourceX, y * sourceY, width * sourceX, height * sourceY,
    0, 0, sampleGrid.width, sampleGrid.height);
  context.imageSmoothingEnabled = false;
  context.drawImage(sampleGrid, x, y, width, height);
  context.imageSmoothingEnabled = true;
}

function drawPreview() {
  if (!bitmap) return;
  const ctx = preview.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, preview.width, preview.height);
  for (const box of boxes) paintMask(ctx, box);
  if (draftBox) {
    ctx.fillStyle = '#214e3f6b';
    ctx.strokeStyle = '#eaf6ed';
    const { left, top, right, bottom } = draftBox;
    ctx.fillRect(left, top, right - left, bottom - top);
    ctx.strokeRect(left, top, right - left, bottom - top);
  }
  $('undo-mask').disabled = !boxes.length;
  $('remove-mask').disabled = !boxes.length;
  if (!boxes.length && maskMode === 'remove') setMaskMode('');
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
      $('skip-detection').hidden = true;
      updateSendButton();
      if (data.boxes) {
        boxes.unshift(...data.boxes);
        editorStatus.textContent = data.boxes.length ?
          '已给 ' + data.boxes.length + ' 处头部区域打码，请检查背影和远处的人头。' :
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
      $('skip-detection').hidden = true;
      loadingPhoto = false;
      updateSendButton();
      editorStatus.textContent = '自动打码暂不可用，可以手动框选后继续。';
    };
  }
  $('skip-detection').hidden = false;
  editorStatus.textContent = '首次加载自动打码可能较慢，也可以立即手动框选。';
  worker.postMessage({ key, bitmap: sample }, [sample]);
}

function clearPhoto() {
  photoVersion += 1;
  bitmap?.close();
  bitmap = undefined;
  boxes = [];
  dragStart = draftBox = undefined;
  loadingPhoto = false;
  updateSendButton();
  confirmed.checked = false;
  editorStatus.textContent = '';
  $('photo-editor').hidden = true;
  $('skip-detection').hidden = true;
  compareOriginal(false);
  zoomPhoto(false);
  setMaskMode('');
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
  updateSendButton();
  try {
    await detectPhoto(file, key);
  } catch {
    if (key !== photoVersion) return;
    loadingPhoto = false;
    updateSendButton();
    $('skip-detection').hidden = true;
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

$('skip-detection').addEventListener('click', () => {
  photoVersion += 1;
  worker?.terminate();
  worker = undefined;
  loadingPhoto = false;
  updateSendButton();
  confirmed.checked = false;
  $('skip-detection').hidden = true;
  setMaskMode('draw');
  editorStatus.textContent = '在照片上拖动，框住需要遮挡的位置。';
});

$('start-mask').addEventListener('click', () => {
  setMaskMode(maskMode === 'draw' ? '' : 'draw');
  if (maskMode === 'draw') editorStatus.textContent = '在照片上拖动，只框住需要遮挡的位置。';
});
$('remove-mask').addEventListener('click', () => {
  setMaskMode(maskMode === 'remove' ? '' : 'remove');
  if (maskMode === 'remove') editorStatus.textContent = '点一下误遮挡的区域将其移除，再检查照片中的人头。';
});
$('cover-all').addEventListener('click', () => {
  boxes.push({ left: 0, top: 0, right: preview.width, bottom: preview.height, solid: true });
  confirmed.checked = false;
  drawPreview();
});
$('undo-mask').addEventListener('click', () => {
  boxes.pop();
  confirmed.checked = false;
  drawPreview();
});
preview.addEventListener('pointerdown', event => {
  if (!maskMode || !bitmap || saving || !event.isPrimary) return;
  const [x, y] = point(event);
  if (maskMode === 'remove') {
    const index = boxes.findLastIndex(box => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom);
    if (index < 0) return;
    boxes.splice(index, 1);
    confirmed.checked = false;
    editorStatus.textContent = '已移除一处遮挡，请确认预览中保留的内容。';
    setMaskMode('');
    drawPreview();
    return;
  }
  preview.setPointerCapture(event.pointerId);
  dragStart = [x, y];
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
  if (saving || loadingPhoto || reviewingOriginal) return;
  if (!bitmap || !confirmed.checked) {
    $('form-message').textContent = '请添加照片并检查打码预览。';
    return;
  }
  const types = new FormData(form).getAll('categories');
  if (!types.length) {
    $('form-message').textContent = '请至少选一种问题类型。';
    reportChoices.querySelector('input').focus();
    return;
  }
  saving = true;
  updateSendButton();
  $('form-message').textContent = '';
  try {
    draftBox = undefined;
    drawPreview();
    const data = {
      id: reportId,
      district: districtPicker.value,
      place: $('place').value,
      categories: types,
      description: $('description').value,
      occurred: timeEdited ? occurred.value + ':00+08:00' : null,
      confirmed: true,
    };
    if (trialMode) {
      const records = JSON.parse(sessionStorage.getItem(trialStorageKey) || '[]');
      records.push({ district: data.district, categories: types, occurred: data.occurred || new Date().toISOString() });
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
    $('receipt-title').textContent = '刚提交一条记录 · ' + (data.district === '浦东' ? '浦东新区' : data.district + '区');
    const receipt = $('receipt-types');
    receipt.replaceChildren();
    for (const type of types) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.value = type;
      button.textContent = type;
      button.addEventListener('click', () => {
        selectedDistrict = data.district;
        category.value = category.value === type ? '' : type;
        refreshCounts();
      });
      receipt.append(button);
    }
    selectedDistrict = data.district;
    source.value = 'local';
    sessionStorage.setItem(localMode, 'local');
    category.value = '';
    days.value = '30';
    location.hash = 'map-overview';
    await refreshCounts();
    $('map-overview').scrollIntoView();
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
    updateSendButton();
  }
});
