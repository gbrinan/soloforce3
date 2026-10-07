// 기본 핀은 28x38 캔버스. 선택 시 1.35배 확대되므로 캔버스도 그만큼(38x52) 키우고
// 핀을 캔버스 중앙 하단에 재배치해야 상/하단이 잘리지 않는다. (scaledSize 고정 클립 회피)
export const PIN_W = 28;
export const PIN_H = 38;
export const PIN_SEL_W = 38;
export const PIN_SEL_H = 52;

function pinSvg(color: string, selected: boolean): string {
  const w = selected ? PIN_SEL_W : PIN_W;
  const h = selected ? PIN_SEL_H : PIN_H;
  // 선택 시: 캔버스를 키운 뒤 핀을 중앙(x축) 정렬 + 1.35배 확대. tip(하단 꼭짓점)이 캔버스 바닥에 오도록.
  const gTransform = selected
    ? ` transform="translate(${(w - PIN_W * 1.35) / 2}, ${h - PIN_H * 1.35}) scale(1.35)"`
    : '';
  // 아이콘 없이 배경색만 채운 핀 (요구사항: 마커 안 아이콘 제거)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="filter:drop-shadow(0 2px 4px rgba(0,0,0,0.4));overflow:visible"><g${gTransform}><path d="M14 1C8.477 1 4 5.477 4 11c0 7.727 10 26 10 26s10-18.273 10-26C24 5.477 19.523 1 14 1z" fill="${color}" stroke="white" stroke-width="2.5"/></g></svg>`;
}

function ensurePulseStyles(): void {
  if (document.getElementById('pin-pulse-styles')) return;
  const s = document.createElement('style');
  s.id = 'pin-pulse-styles';
  s.textContent = '@keyframes pin-pulse{0%{transform:scale(1);opacity:0.5;}100%{transform:scale(3.5);opacity:0;}}';
  document.head.appendChild(s);
}

export function createPinElement(color = '#6366F1', icon?: string): HTMLDivElement {
  ensurePulseStyles();
  const wrap = document.createElement('div');
  wrap.style.cssText = 'width:28px;height:38px;position:relative;cursor:pointer;overflow:visible;';
  wrap.dataset.color = color;
  wrap.dataset.icon = icon ?? '';
  const svgDiv = document.createElement('div');
  svgDiv.className = 'pin-svg';
  svgDiv.style.cssText = 'width:28px;height:38px;';
  svgDiv.innerHTML = pinSvg(color, false);
  wrap.appendChild(svgDiv);
  return wrap;
}

export function setPinSelected(el: HTMLElement, selected: boolean): void {
  const color = el.dataset.color ?? '#6366F1';
  const svgDiv = el.querySelector('.pin-svg');
  if (svgDiv) svgDiv.innerHTML = pinSvg(color, selected);
  const ring = el.querySelector<HTMLElement>('.pin-pulse-ring');
  if (selected && !ring) {
    const r = document.createElement('div');
    r.className = 'pin-pulse-ring';
    r.style.cssText = `position:absolute;left:14px;top:11px;width:14px;height:14px;margin-left:-7px;margin-top:-7px;border-radius:50%;background:${color};transform-origin:center;animation:pin-pulse 1.3s ease-out infinite;pointer-events:none;`;
    el.appendChild(r);
  } else if (!selected && ring) {
    ring.remove();
  }
}

export function pinIconUrl(color = '#6366F1', selected = false): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(pinSvg(color, selected))}`;
}
