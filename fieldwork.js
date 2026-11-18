const spots = ['外滩', '南京路', '淮海中路', '襄阳公园'];
const storageKey = 'livestream-fieldwork-rounds';

export function initFieldwork(shanghaiTime, downloadCsv) {
  const form = document.getElementById('fieldwork-form');
  const spotPicker = document.getElementById('round-spot');
  const started = document.getElementById('round-start');
  const saveButton = document.getElementById('round-save');
  const cancelButton = document.getElementById('round-cancel');
  const exportButton = document.getElementById('round-export');
  const status = document.getElementById('round-status');
  const spotList = document.getElementById('fieldwork-spots');
  const roundList = document.getElementById('round-list');
  let editingId = null;
  let rounds = [];

  spotPicker.add(new Option('选择观察点', ''));
  for (const spot of spots) spotPicker.add(new Option(spot, spot));

  function readRounds() {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    if (!Array.isArray(saved)) throw new Error('Invalid observations');
    return saved;
  }

  function setEditing(id) {
    editingId = id;
    saveButton.textContent = id ? '保存修改' : '保存本次观察';
    cancelButton.hidden = !id;
  }

  function editRound(round) {
    setEditing(round.id);
    for (const field of ['spot', 'start', 'minutes', 'findings']) {
      form.elements.namedItem(field).value = round[field];
    }
    status.textContent = '正在修改 ' + round.spot + ' 的观察。';
    spotPicker.focus();
  }

  function removeRound(round) {
    if (!window.confirm('删除 ' + round.spot + ' ' + round.start.replace('T', ' ') + ' 的观察？')) return;
    if (!saveRounds(saved => saved.filter(entry => entry.id !== round.id))) return;
    if (editingId === round.id) {
      form.reset();
      setEditing(null);
    }
    status.textContent = '已删除这次观察。';
    spotPicker.focus({ preventScroll: true });
  }

  function renderRounds() {
    spotList.replaceChildren();
    for (const spot of spots) {
      const atSpot = rounds.filter(round => round.spot === spot);
      const minutes = atSpot.reduce((total, round) => total + round.minutes, 0);
      const findings = atSpot.reduce((total, round) => total + round.findings, 0);
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      const label = document.createElement('strong');
      label.textContent = spot;
      const summary = document.createElement('span');
      summary.textContent = atSpot.length ? atSpot.length + ' 次观察 · ' + minutes + ' 分钟' : '尚未登记';
      const result = document.createElement('small');
      result.textContent = atSpot.length ? '共发现 ' + findings + ' 次' : '选择此点填写';
      button.append(label, summary, result);
      button.addEventListener('click', () => {
        spotPicker.value = spot;
        spotPicker.focus();
      });
      item.append(button);
      spotList.append(item);
    }

    roundList.replaceChildren();
    for (const round of [...rounds].sort((first, second) => second.start.localeCompare(first.start))) {
      const row = document.createElement('li');
      const details = document.createElement('div');
      const heading = document.createElement('strong');
      heading.textContent = round.spot;
      const text = document.createElement('p');
      const result = round.findings ? '发现 ' + round.findings + ' 次' : '未发现';
      text.textContent = round.start.replace('T', ' ') + ' · ' + round.minutes + ' 分钟 · ' + result;
      details.append(heading, text);
      const actions = document.createElement('div');
      actions.className = 'round-actions';
      for (const [label, action] of [['修改', editRound], ['删除', removeRound]]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'text-button';
        button.textContent = label;
        button.setAttribute('aria-label', label + round.spot + ' ' + round.start.replace('T', ' ') + ' 的观察');
        button.addEventListener('click', () => action(round));
        actions.append(button);
      }
      row.append(details, actions);
      roundList.append(row);
    }
    document.getElementById('round-empty').hidden = rounds.length > 0;
    exportButton.disabled = rounds.length === 0;
  }

  function saveRounds(update) {
    try {
      const next = update(readRounds());
      localStorage.setItem(storageKey, JSON.stringify(next));
      rounds = next;
    } catch {
      status.textContent = '当前浏览器无法保存这一改动。请允许网站存储后重试。';
      return false;
    }
    renderRounds();
    return true;
  }

  function reloadRounds() {
    try {
      rounds = readRounds();
    } catch {
      status.textContent = '当前浏览器无法读取已保存的观察。';
    }
    renderRounds();
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    const data = new FormData(form);
    const spot = data.get('spot');
    const start = data.get('start');
    if (!spots.includes(spot) || start > shanghaiTime()) {
      status.textContent = '请选择观察点，并填写已经开始的时间。';
      return;
    }
    const minutes = Number(data.get('minutes'));
    const findings = Number(data.get('findings'));
    const round = { id: editingId || crypto.randomUUID(), spot, start, minutes, findings };
    if (!saveRounds(saved => [...saved.filter(entry => entry.id !== round.id), round])) return;
    status.textContent = editingId ? '观察已更新。' : '已保存 ' + spot + ' 的观察。';
    form.reset();
    spotPicker.value = spot;
    setEditing(null);
  });

  cancelButton.addEventListener('click', () => {
    setEditing(null);
    form.reset();
    status.textContent = '已取消修改。';
    spotPicker.focus();
  });

  exportButton.addEventListener('click', () => {
    const rows = [['记录编号', '观察点', '开始时间（北京时间）', '观察时长（分钟）', '发现现象（次）']];
    for (const round of rounds) {
      rows.push([round.id, round.spot, round.start.replace('T', ' '), round.minutes, round.findings]);
    }
    downloadCsv(rows, '上海直播观察-实地观察表-' + shanghaiTime().slice(0, 10) + '.csv');
  });

  started.addEventListener('focus', () => { started.max = shanghaiTime(); });
  window.addEventListener('storage', event => {
    if (event.key === storageKey || event.key === null) reloadRounds();
  });
  reloadRounds();
}
