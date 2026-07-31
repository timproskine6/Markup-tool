import { SYMBOLS_BY_ID } from './symbols.js';

// Live legend: the count is literally a groupBy/count of a placed-symbols
// array, recomputed every time it changes. Callers decide which slice of
// symbols to pass in (one page's worth, or the whole project's).
export function computeLegend(symbols) {
  const counts = new Map();
  for (const s of symbols) {
    counts.set(s.defId, (counts.get(s.defId) || 0) + 1);
  }
  const rows = [...counts.entries()]
    .map(([defId, count]) => ({ defId, def: SYMBOLS_BY_ID[defId], count }))
    .filter((r) => r.def)
    .sort((a, b) => a.def.name.localeCompare(b.def.name));
  const total = symbols.length;
  return { rows, total };
}

export class LegendPanel {
  constructor(container) {
    this.container = container;
  }

  // pageSymbols: symbols on the currently-viewed page only.
  // allSymbols: every symbol in the project, across every page.
  // pageInfo: { current, total } page numbers — omit/pass total<=1 for a
  // single-page project, which collapses back to the original one-table view.
  render(pageSymbols, allSymbols, pageInfo) {
    this.container.innerHTML = '';
    const multiPage = !!(pageInfo && pageInfo.total > 1);

    this._renderSection(multiPage ? `This Page (${pageInfo.current}/${pageInfo.total})` : 'Legend', pageSymbols);

    if (multiPage) {
      const divider = document.createElement('div');
      divider.className = 'legend-divider';
      this.container.appendChild(divider);
      this._renderSection('All Pages', allSymbols);
    }
  }

  _renderSection(title, symbols) {
    const { rows, total } = computeLegend(symbols);

    const header = document.createElement('div');
    header.className = 'legend-header';
    header.innerHTML = `<span>${title}</span><span class="legend-total">${total} placed</span>`;
    this.container.appendChild(header);

    if (rows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'legend-empty';
      empty.textContent = 'No symbols placed yet.';
      this.container.appendChild(empty);
      return;
    }

    const table = document.createElement('table');
    table.className = 'legend-table';
    const tbody = document.createElement('tbody');
    for (const row of rows) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="legend-icon">${row.def.svg}</td>
        <td class="legend-name">${row.def.name}<span class="legend-abbr">${row.def.abbr}</span></td>
        <td class="legend-count">${row.count}</td>
      `;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    this.container.appendChild(table);
  }
}
