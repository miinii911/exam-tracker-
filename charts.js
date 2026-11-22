(function (global) {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  const PALETTE = [
    '#3b82f6',
    '#10b981',
    '#f59e0b',
    '#8b5cf6',
    '#ef4444',
    '#06b6d4',
    '#ec4899',
    '#84cc16',
  ];

  function createSvgEl(tag, attrs = {}) {
    const el = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
    return el;
  }

  function formatNumber(val) {
    return Number.isInteger(val) ? String(val) : val.toFixed(1);
  }

  function renderLineChart(container, legendEl, options) {
    const {
      xLabels = [],
      xSubLabels = [],
      series = [],
      referenceLines = [],
      yUnit = '점',
      fixedMax = null,
      emptyMessage = '표시할 성적 데이터가 없습니다.',
    } = options;

    container.innerHTML = '';
    if (legendEl) legendEl.innerHTML = '';

    const hasAnyPoint = series.some((s) => s.points && s.points.length > 0);
    if (!hasAnyPoint || xLabels.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'chart-empty';
      empty.innerHTML = `<strong>데이터가 아직 없습니다</strong><span class="small muted">${emptyMessage}</span>`;
      container.appendChild(empty);
      return;
    }

    const hiddenSeries = new Set();

    function draw() {
      container.innerHTML = '';
      const visibleSeries = series.filter((s) => !hiddenSeries.has(s.id));

      const width = Math.max(container.clientWidth || 640, 360);
      const height = 290;
      const pad = { top: 20, right: 24, bottom: 48, left: 48 };
      const plotW = width - pad.left - pad.right;
      const plotH = height - pad.top - pad.bottom;

      const allVals = [];
      visibleSeries.forEach((s) => {
        s.points.forEach((p) => {
          if (typeof p.value === 'number' && !Number.isNaN(p.value)) {
            allVals.push(p.value);
          }
        });
      });
      referenceLines.forEach((r) => {
        if (typeof r.value === 'number' && !Number.isNaN(r.value)) {
          allVals.push(r.value);
        }
      });

      let minY = 0;
      let maxY = fixedMax || 100;
      if (allVals.length > 0) {
        const rawMin = Math.min(...allVals);
        const rawMax = Math.max(...allVals);
        if (fixedMax && rawMax <= fixedMax) {
          minY = Math.max(0, Math.floor((rawMin - 10) / 10) * 10);
          maxY = fixedMax;
          if (maxY - minY < 20) minY = Math.max(0, maxY - 20);
        } else {
          minY = Math.max(0, Math.floor((rawMin - 10) / 10) * 10);
          maxY = Math.ceil((rawMax + 10) / 10) * 10;
          if (maxY === minY) maxY = minY + 20;
        }
      }

      const xCount = xLabels.length;
      const getX = (idx) => {
        if (xCount === 1) return pad.left + plotW / 2;
        return pad.left + (idx / (xCount - 1)) * plotW;
      };
      const getY = (val) => {
        const ratio = (val - minY) / (maxY - minY || 1);
        return pad.top + plotH - ratio * plotH;
      };

      const svg = createSvgEl('svg', {
        viewBox: `0 0 ${width} ${height}`,
        width: '100%',
        height: height,
        role: 'img',
        'aria-label': '성적 추이 꺾은선 그래프',
      });

      // Y Gridlines & labels
      const tickCount = 5;
      for (let i = 0; i <= tickCount; i++) {
        const val = minY + ((maxY - minY) * i) / tickCount;
        const y = getY(val);
        svg.appendChild(
          createSvgEl('line', {
            x1: pad.left,
            y1: y,
            x2: width - pad.right,
            y2: y,
            stroke: 'var(--grid-line)',
            'stroke-width': 1,
          })
        );
        const label = createSvgEl('text', {
          x: pad.left - 8,
          y: y + 4,
          'text-anchor': 'end',
          fill: 'var(--text-muted)',
          'font-size': 11,
        });
        label.textContent = formatNumber(Math.round(val * 10) / 10);
        svg.appendChild(label);
      }

      // X axis labels
      const maxLabels = Math.max(2, Math.floor(plotW / 84));
      const step = Math.ceil(xCount / maxLabels);
      xLabels.forEach((lbl, idx) => {
        if (idx % step !== 0 && idx !== xCount - 1) return;
        const x = getX(idx);
        const textEl = createSvgEl('text', {
          x,
          y: height - 22,
          'text-anchor': 'middle',
          fill: 'var(--text-muted)',
          'font-size': 11,
        });
        textEl.textContent = lbl.length > 12 ? lbl.slice(0, 11) + '…' : lbl;
        svg.appendChild(textEl);

        if (xSubLabels[idx]) {
          const subEl = createSvgEl('text', {
            x,
            y: height - 8,
            'text-anchor': 'middle',
            fill: 'var(--text-muted)',
            'font-size': 10,
          });
          const s = xSubLabels[idx];
          subEl.textContent = s.length > 10 ? s.slice(0, 9) + '…' : s;
          svg.appendChild(subEl);
        }
      });

      // Tooltip element
      const tooltip = document.createElement('div');
      tooltip.className = 'svg-tooltip hidden';
      container.appendChild(tooltip);

      // Hover vertical guide
      const guide = createSvgEl('line', {
        x1: 0,
        y1: pad.top,
        x2: 0,
        y2: pad.top + plotH,
        stroke: 'var(--border-strong)',
        'stroke-dasharray': '4 3',
        'stroke-width': 1,
        visibility: 'hidden',
      });
      svg.appendChild(guide);

      // Reference target/cut lines
      referenceLines.forEach((ref) => {
        if (typeof ref.value !== 'number' || Number.isNaN(ref.value)) return;
        const ry = getY(ref.value);
        const refColor = ref.color || 'var(--amber)';
        svg.appendChild(
          createSvgEl('line', {
            x1: pad.left,
            y1: ry,
            x2: width - pad.right,
            y2: ry,
            stroke: refColor,
            'stroke-dasharray': '6 4',
            'stroke-width': 1.6,
            opacity: 0.9,
          })
        );
        const refLabel = createSvgEl('text', {
          x: width - pad.right - 4,
          y: Math.max(pad.top + 11, ry - 5),
          'text-anchor': 'end',
          fill: refColor,
          'font-size': 11,
          'font-weight': 700,
        });
        refLabel.textContent = `${ref.label} (${formatNumber(ref.value)}${yUnit})`;
        svg.appendChild(refLabel);
      });

      // Series lines & points
      visibleSeries.forEach((s) => {
        const sorted = [...s.points].sort((a, b) => a.xIndex - b.xIndex);
        if (sorted.length > 1) {
          const pathData = sorted
            .map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${getX(pt.xIndex).toFixed(1)} ${getY(pt.value).toFixed(1)}`)
            .join(' ');
          svg.appendChild(
            createSvgEl('path', {
              d: pathData,
              fill: 'none',
              stroke: s.color,
              'stroke-width': 2.5,
              'stroke-linecap': 'round',
              'stroke-linejoin': 'round',
            })
          );
        }

        sorted.forEach((pt) => {
          const cx = getX(pt.xIndex);
          const cy = getY(pt.value);
          const dot = createSvgEl('circle', {
            cx,
            cy,
            r: 4.5,
            fill: 'var(--bg-surface)',
            stroke: s.color,
            'stroke-width': 2.5,
            style: 'cursor: pointer; transition: r 0.12s ease;',
          });

          dot.addEventListener('mouseenter', (e) => {
            dot.setAttribute('r', '6.5');
            guide.setAttribute('x1', cx);
            guide.setAttribute('x2', cx);
            guide.setAttribute('visibility', 'visible');

            const metaLine = pt.meta ? `<br/><span style="opacity:0.85">${escapeHtml(pt.meta)}</span>` : '';
            tooltip.innerHTML = `<strong>${escapeHtml(s.label)}</strong>: ${formatNumber(pt.value)}${yUnit}<br/><span>${escapeHtml(pt.xLabel)}${pt.subLabel ? ' · ' + escapeHtml(pt.subLabel) : ''}</span>${metaLine}`;
            tooltip.classList.remove('hidden');

            const rect = container.getBoundingClientRect();
            const relX = e.clientX - rect.left;
            const relY = e.clientY - rect.top;
            const left = Math.min(Math.max(8, relX + 12), Math.max(8, rect.width - 210));
            const top = Math.max(8, relY - 56);
            tooltip.style.left = `${left}px`;
            tooltip.style.top = `${top}px`;
          });

          dot.addEventListener('mouseleave', () => {
            dot.setAttribute('r', '4.5');
            guide.setAttribute('visibility', 'hidden');
            tooltip.classList.add('hidden');
          });

          svg.appendChild(dot);
        });
      });

      container.appendChild(svg);
    }

    draw();

    if (legendEl) {
      series.forEach((s) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'legend-item';
        item.style.background = 'none';
        item.style.border = 'none';
        item.style.padding = '2px 4px';
        item.innerHTML = `<span class="legend-swatch" style="background:${s.color}"></span><span>${escapeHtml(s.label)}</span>`;
        item.addEventListener('click', () => {
          if (hiddenSeries.has(s.id)) {
            hiddenSeries.delete(s.id);
            item.classList.remove('muted-series');
          } else if (series.length - hiddenSeries.size > 1) {
            hiddenSeries.add(s.id);
            item.classList.add('muted-series');
          }
          draw();
        });
        legendEl.appendChild(item);
      });
    }
  }

  function polarToCartesian(cx, cy, r, angleDeg) {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad),
    };
  }

  function describeArc(cx, cy, rOuter, rInner, startAngle, endAngle) {
    const p1 = polarToCartesian(cx, cy, rOuter, endAngle);
    const p2 = polarToCartesian(cx, cy, rOuter, startAngle);
    const p3 = polarToCartesian(cx, cy, rInner, startAngle);
    const p4 = polarToCartesian(cx, cy, rInner, endAngle);
    const largeArc = endAngle - startAngle <= 180 ? '0' : '1';
    return [
      'M', p1.x, p1.y,
      'A', rOuter, rOuter, 0, largeArc, 0, p2.x, p2.y,
      'L', p3.x, p3.y,
      'A', rInner, rInner, 0, largeArc, 1, p4.x, p4.y,
      'Z',
    ].join(' ');
  }

  function renderDoughnutChart(container, legendEl, items, selectedKey, onSelect) {
    container.innerHTML = '';
    legendEl.innerHTML = '';

    const total = items.reduce((acc, it) => acc + it.count, 0);
    if (total === 0) {
      container.innerHTML = '<div class="chart-empty" style="min-height:190px;width:100%"><span class="small muted">오답 데이터가 없습니다</span></div>';
      return;
    }

    const size = 220;
    const cx = size / 2;
    const cy = size / 2;
    const rOuter = 94;
    const rInner = 56;

    const svg = createSvgEl('svg', {
      viewBox: `0 0 ${size} ${size}`,
      width: size,
      height: size,
      role: 'img',
      'aria-label': '문제 유형별 오답 비율 도넛 차트',
    });

    const tooltip = document.createElement('div');
    tooltip.className = 'svg-tooltip hidden';
    container.appendChild(tooltip);

    let currentAngle = 0;

    items.forEach((item, idx) => {
      const color = item.color || PALETTE[idx % PALETTE.length];
      const sliceAngle = (item.count / total) * 360;
      const isSelected = selectedKey === item.key;

      let shape;
      if (items.length === 1 || sliceAngle >= 359.9) {
        // Full ring for single category
        const outerCircle = createSvgEl('circle', {
          cx,
          cy,
          r: (rOuter + rInner) / 2,
          fill: 'none',
          stroke: color,
          'stroke-width': rOuter - rInner,
          style: 'cursor:pointer;',
        });
        shape = outerCircle;
      } else {
        const d = describeArc(
          cx,
          cy,
          isSelected ? rOuter + 5 : rOuter,
          rInner,
          currentAngle,
          currentAngle + sliceAngle - 1.2
        );
        shape = createSvgEl('path', {
          d,
          fill: color,
          opacity: selectedKey && !isSelected ? 0.45 : 1,
          style: 'cursor:pointer; transition: opacity 0.15s ease;',
        });
      }

      shape.addEventListener('click', () => onSelect(item.key));
      shape.addEventListener('mouseenter', (e) => {
        const pct = ((item.count / total) * 100).toFixed(1);
        tooltip.innerHTML = `<strong>${escapeHtml(item.label)}</strong><br/>${item.count}건 (${pct}%)`;
        tooltip.classList.remove('hidden');
        const rect = container.getBoundingClientRect();
        tooltip.style.left = `${Math.max(4, e.clientX - rect.left + 10)}px`;
        tooltip.style.top = `${Math.max(4, e.clientY - rect.top - 38)}px`;
      });
      shape.addEventListener('mouseleave', () => {
        tooltip.classList.add('hidden');
      });

      svg.appendChild(shape);
      currentAngle += sliceAngle;

      // Legend Row
      const pct = ((item.count / total) * 100).toFixed(1);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `donut-legend-row${isSelected ? ' selected' : ''}`;
      row.innerHTML = `
        <span class="donut-legend-left">
          <span class="legend-swatch" style="background:${color}"></span>
          <span>${escapeHtml(item.label)}</span>
        </span>
        <span class="muted small">${item.count}건 (${pct}%)</span>
      `;
      row.addEventListener('click', () => onSelect(item.key));
      legendEl.appendChild(row);
    });

    // Center label
    const centerTop = createSvgEl('text', {
      x: cx,
      y: cy - 3,
      'text-anchor': 'middle',
      fill: 'var(--text-primary)',
      'font-size': 22,
      'font-weight': 800,
    });
    centerTop.textContent = `${total}건`;
    svg.appendChild(centerTop);

    const centerSub = createSvgEl('text', {
      x: cx,
      y: cy + 16,
      'text-anchor': 'middle',
      fill: 'var(--text-muted)',
      'font-size': 11,
      'font-weight': 600,
    });
    centerSub.textContent = selectedKey ? selectedKey : '전체 유형';
    svg.appendChild(centerSub);

    container.appendChild(svg);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  global.ExamCharts = {
    PALETTE,
    renderLineChart,
    renderDoughnutChart,
    escapeHtml,
  };
})(window);
