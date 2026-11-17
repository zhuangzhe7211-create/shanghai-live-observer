export const shortName = name => name.replace(/新区$|区$/u, '');

export async function loadMap() {
  const result = await fetch(new URL('./assets/shanghai.json', import.meta.url));
  if (!result.ok) throw new Error('底图未加载');
  return (await result.json()).features;
}

function project(width, height) {
  const bounds = [120.83, 30.67, 122.24, 31.90];
  const scale = Math.min((width - 26) / ((bounds[2] - bounds[0]) * .856), (height - 58) / (bounds[3] - bounds[1]));
  return ([longitude, latitude]) => [
    width / 2 + (longitude - (bounds[0] + bounds[2]) / 2) * scale * .856,
    height / 2 + 12 + ((bounds[1] + bounds[3]) / 2 - latitude) * scale,
  ];
}

function polygons(feature) {
  return feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
}

function inRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let first = 0, last = ring.length - 1; first < ring.length; last = first++) {
    const [a, b] = ring[first];
    const [c, d] = ring[last];
    if ((b > y) !== (d > y) && x < (c - a) * (y - b) / (d - b) + a) inside = !inside;
  }
  return inside;
}

export function findDistrict(features, point) {
  return features.find(feature => polygons(feature).some(
    ([outline, ...holes]) => inRing(point, outline) && !holes.some(hole => inRing(point, hole))
  ));
}

export function drawMap(canvas, features, counts, selected) {
  const { width, height } = canvas.getBoundingClientRect();
  if (!width || !height) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext('2d');
  context.scale(ratio, ratio);
  context.fillStyle = '#dcece8';
  context.fillRect(0, 0, width, height);
  context.lineWidth = 1;
  context.strokeStyle = '#d0e3dd';
  for (let x = 0; x < width; x += 52) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  for (let y = 0; y < height; y += 52) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }

  const toScreen = project(width, height);
  for (const feature of features) {
    const name = shortName(feature.properties.name);
    const count = counts[name] || 0;
    context.beginPath();
    for (const polygon of polygons(feature)) {
      for (const ring of polygon) {
        ring.forEach((coordinate, index) => {
          const [x, y] = toScreen(coordinate);
          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        });
        context.closePath();
      }
    }
    context.fillStyle = count >= 16 ? '#69a58a' : count >= 8 ? '#a4cbb0' : count ? '#c8dfcb' : '#eef1e3';
    if (selected === name) context.fillStyle = '#4c9a7d';
    context.fill('evenodd');
    context.lineWidth = selected === name ? 2 : 1.25;
    context.strokeStyle = selected === name ? '#1a6b5c' : '#fbfdf6';
    context.stroke();
  }

  const core = new Set(['黄浦', '虹口', '长宁', '徐汇', '静安', '普陀', '杨浦']);
  const targets = [];
  for (const feature of features) {
    const name = shortName(feature.properties.name);
    const featured = core.has(selected) ? selected : '黄浦';
    if (core.has(name) && name !== featured) continue;
    const [x, y] = toScreen(feature.properties.centroid || feature.properties.center);
    const count = counts[name] || 0;
    const radius = width < 550 ? 10 : 13;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    if (count || name === selected) {
      context.beginPath();
      context.arc(x, y - 4, radius, 0, Math.PI * 2);
      context.strokeStyle = '#ffffff';
      context.lineWidth = 2;
      context.fillStyle = name === selected ? '#10473f' : '#25644f';
      context.fill();
      context.stroke();
      context.fillStyle = '#fff';
      context.font = '700 11px system-ui, sans-serif';
      context.fillText(count, x, y - 3);
    }
    context.font = '650 12px Microsoft YaHei, sans-serif';
    context.lineWidth = 3;
    context.strokeStyle = '#edf5ed';
    context.fillStyle = '#284740';
    const baseline = count || name === selected ? y + radius + 6 : y;
    context.strokeText(name, x, baseline);
    context.fillText(name, x, baseline);
    targets.push({ name, x, y: y - 4 });
  }
  return { toScreen, targets };
}

export function clickedDistrict(features, map, x, y) {
  if (!map) return;
  const hit = map.targets.find(point => Math.hypot(point.x - x, point.y - y) < 13);
  if (hit) return hit.name;
  const origin = map.toScreen([0, 0]);
  const unit = map.toScreen([1, 1]);
  const feature = findDistrict(features, [
    (x - origin[0]) / (unit[0] - origin[0]),
    (y - origin[1]) / (unit[1] - origin[1]),
  ]);
  return feature && shortName(feature.properties.name);
}
