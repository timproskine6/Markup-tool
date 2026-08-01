import * as prefs from './symbolPrefs.js';

export class Palette {
  constructor(container, { onArm } = {}) {
    this.container = container;
    this.onArm = onArm || (() => {});
    this.armedId = null;
    this.query = '';
    this.organizing = false;
    this._addingCategory = false;
    this._render();
  }

  setArmed(defId) {
    this.armedId = defId;
    this._render();
  }

  // Called from outside (the long-press Favorite button in main.js) after a
  // favorite is toggled from the canvas, so the star and Favorites section
  // here update immediately instead of waiting for the next unrelated
  // re-render. A full _render() isn't needed since search/organize state
  // haven't changed, just which symbols are favorited.
  refresh() {
    this._renderList();
  }

  _render() {
    this.container.innerHTML = '';

    const searchWrap = document.createElement('div');
    searchWrap.className = 'palette-search';
    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = 'Search symbols…';
    input.value = this.query;
    input.addEventListener('input', () => {
      this.query = input.value;
      this._renderList();
    });
    searchWrap.appendChild(input);

    const organizeBtn = document.createElement('button');
    organizeBtn.type = 'button';
    organizeBtn.id = 'palette-organize-btn';
    organizeBtn.className = 'palette-organize-btn' + (this.organizing ? ' active' : '');
    organizeBtn.title = this.organizing ? 'Done organizing categories' : 'Organize categories';
    organizeBtn.textContent = this.organizing ? 'Done' : 'Organize';
    organizeBtn.addEventListener('click', () => {
      this.organizing = !this.organizing;
      if (!this.organizing) this._addingCategory = false;
      this._render();
    });
    searchWrap.appendChild(organizeBtn);

    this.container.appendChild(searchWrap);

    const listWrap = document.createElement('div');
    listWrap.className = 'palette-list';
    this.container.appendChild(listWrap);
    this._listWrap = listWrap;

    this._renderList();
  }

  _renderList() {
    this._listWrap.innerHTML = '';
    const groups = prefs.getGroupedSymbols(this.query, { includeEmpty: this.organizing, includeHidden: this.organizing });

    // While actively searching, a collapsed section still shows any of its
    // matches -- collapsing something should never make it unfindable, it
    // should just stay out of the way during ordinary browsing.
    const isSearching = !!this.query.trim();

    for (const group of groups) {
      const collapsed = !isSearching && prefs.isCollapsed(group.id);

      const section = document.createElement('div');
      section.className = 'palette-section'
        + (group.isFavorites ? ' palette-section-favorites' : '')
        + (collapsed ? ' palette-section-collapsed' : '');
      section.dataset.categoryId = group.id;

      const heading = document.createElement('div');
      heading.className = 'palette-section-heading';

      const toggleCollapse = () => {
        prefs.toggleCollapsed(group.id);
        this._renderList();
      };

      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'palette-section-toggle';
      toggleBtn.textContent = collapsed ? '▸' : '▾';
      toggleBtn.title = collapsed ? 'Expand' : 'Collapse';
      toggleBtn.setAttribute('aria-expanded', String(!collapsed));
      toggleBtn.addEventListener('click', toggleCollapse);
      heading.appendChild(toggleBtn);

      if (this.organizing && !group.isFavorites) {
        // The category editor (rename/move/delete) owns this row's clicks
        // while organizing, so the label itself isn't also a toggle target
        // here -- the chevron button above still works.
        heading.appendChild(this._buildCategoryEditor(group));
      } else {
        const label = document.createElement('span');
        label.className = 'palette-section-label';
        label.textContent = (group.isFavorites ? '★ ' : '') + group.label;
        label.addEventListener('click', toggleCollapse); // bigger, easier tap target than just the chevron
        heading.appendChild(label);
      }

      if (!this.organizing) {
        const count = document.createElement('span');
        count.className = 'palette-section-count';
        count.textContent = String(group.items.length);
        heading.appendChild(count);
      }

      section.appendChild(heading);

      if (!collapsed) {
        const grid = document.createElement('div');
        grid.className = 'palette-grid';
        for (const sym of group.items) {
          grid.appendChild(this._buildItem(sym, group));
        }
        section.appendChild(grid);
      }
      this._listWrap.appendChild(section);
    }

    if (this.organizing) this._listWrap.appendChild(this._buildAddCategoryRow());

    if (this._listWrap.children.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'palette-empty';
      empty.textContent = 'No symbols match your search.';
      this._listWrap.appendChild(empty);
    }
  }

  _buildCategoryEditor(group) {
    const wrap = document.createElement('div');
    wrap.className = 'palette-category-editor';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'palette-category-name-input';
    nameInput.value = group.label;
    nameInput.addEventListener('change', () => {
      prefs.renameCategory(group.id, nameInput.value);
      this._renderList();
    });
    wrap.appendChild(nameInput);

    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'palette-category-btn';
    upBtn.textContent = '↑';
    upBtn.title = 'Move category up';
    upBtn.addEventListener('click', () => {
      prefs.moveCategory(group.id, -1);
      this._renderList();
    });
    wrap.appendChild(upBtn);

    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.className = 'palette-category-btn';
    downBtn.textContent = '↓';
    downBtn.title = 'Move category down';
    downBtn.addEventListener('click', () => {
      prefs.moveCategory(group.id, 1);
      this._renderList();
    });
    wrap.appendChild(downBtn);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'palette-category-btn palette-category-btn-danger';
    delBtn.textContent = '✕';
    delBtn.title = 'Delete category';
    delBtn.disabled = !prefs.canDeleteCategory(group.id);
    delBtn.addEventListener('click', () => {
      if (!confirm(`Delete "${group.label}"? Its symbols move to Uncategorized.`)) return;
      prefs.deleteCategory(group.id);
      this._renderList();
    });
    wrap.appendChild(delBtn);

    return wrap;
  }

  _buildAddCategoryRow() {
    if (this._addingCategory) {
      const form = document.createElement('div');
      form.className = 'palette-add-category-form';
      const input = document.createElement('input');
      input.type = 'text';
      input.id = 'palette-add-category-input';
      input.placeholder = 'Category name';
      input.className = 'palette-add-category-input';
      form.appendChild(input);

      const commit = () => {
        if (input.value.trim()) prefs.addCategory(input.value.trim());
        this._addingCategory = false;
        this._renderList();
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') commit();
      });

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.id = 'palette-add-category-confirm';
      addBtn.className = 'palette-category-btn palette-category-btn-confirm';
      addBtn.textContent = 'Add';
      addBtn.addEventListener('click', commit);
      form.appendChild(addBtn);

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'palette-category-btn';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => {
        this._addingCategory = false;
        this._renderList();
      });
      form.appendChild(cancelBtn);

      setTimeout(() => input.focus(), 0);
      return form;
    }

    const addRow = document.createElement('button');
    addRow.type = 'button';
    addRow.id = 'palette-add-category-btn';
    addRow.className = 'palette-add-category-btn';
    addRow.textContent = '+ New category';
    addRow.addEventListener('click', () => {
      this._addingCategory = true;
      this._renderList();
    });
    return addRow;
  }

  _buildItem(sym, group) {
    const item = document.createElement('div');
    item.className = 'palette-item' + (this.armedId === sym.id ? ' armed' : '') + (sym.isHidden ? ' palette-item-hidden' : '');
    item.dataset.symbolId = sym.id;

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'palette-item-main';
    main.title = sym.name;
    main.innerHTML = `
      <span class="palette-item-icon">${sym.svg}</span>
      <span class="palette-item-label">${sym.name}</span>
      <span class="palette-item-abbr">${sym.abbr}</span>
    `;
    main.addEventListener('click', () => {
      if (this.organizing) return; // organize mode taps categorize, not arm
      const next = this.armedId === sym.id ? null : sym.id;
      this.armedId = next;
      this.onArm(next);
      this._render();
    });
    item.appendChild(main);

    const favorited = prefs.isFavorite(sym.id);
    const star = document.createElement('button');
    star.type = 'button';
    star.className = 'palette-item-star' + (favorited ? ' active' : '');
    star.textContent = favorited ? '★' : '☆';
    star.title = favorited ? 'Remove from Favorites' : 'Add to Favorites';
    star.addEventListener('click', () => {
      prefs.toggleFavorite(sym.id);
      this._renderList();
    });
    item.appendChild(star);

    if (this.organizing) {
      // Removing is a soft-delete (see hideSymbol in symbolPrefs.js) --
      // deliberately no confirm() here, unlike delete-category, since it's
      // trivially reversible right from this same screen via Restore.
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'palette-item-remove-btn' + (sym.isHidden ? ' palette-item-remove-btn-restore' : '');
      removeBtn.textContent = sym.isHidden ? 'Restore' : 'Remove';
      removeBtn.title = sym.isHidden ? 'Add this symbol back to the palette' : 'Remove this symbol from the palette (you can restore it later)';
      removeBtn.addEventListener('click', () => {
        if (sym.isHidden) prefs.unhideSymbol(sym.id);
        else prefs.hideSymbol(sym.id);
        this._renderList();
      });
      item.appendChild(removeBtn);

      const currentCat = group.isFavorites ? prefs.getSymbolCategory(sym.id) : group.id;
      const select = document.createElement('select');
      select.className = 'palette-item-category-select';
      for (const cat of prefs.getCategories()) {
        const opt = document.createElement('option');
        opt.value = cat.id;
        opt.textContent = cat.label;
        if (cat.id === currentCat) opt.selected = true;
        select.appendChild(opt);
      }
      select.addEventListener('change', () => {
        prefs.setSymbolCategory(sym.id, select.value);
        this._renderList();
      });
      item.appendChild(select);
    }

    return item;
  }
}
