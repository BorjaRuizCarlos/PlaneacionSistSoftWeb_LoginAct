// pokeapi.js — Pokédex powered by PokeAPI
// Fetches data from https://pokeapi.co/api/v2 and renders Pokémon cards.

(() => {
  'use strict';

  // Config and global state
  const API_BASE = 'https://pokeapi.co/api/v2';
  const PAGE_LIMIT = 24;       // Pokémon loaded per page
  const CONCURRENCY = 12;      // Max parallel detail requests

  // DOM references
  const els = {
    results:    document.getElementById('results'),
    tplCard:    document.getElementById('pokemon-card-template'),
    tplSkel:    document.getElementById('pokemon-card-skeleton'),
    form:       document.getElementById('controlsForm'),
    q:          document.getElementById('q'),
    typeFilter: document.getElementById('typeFilter'),
    sortBy:     document.getElementById('sortBy'),
    btnMore:    document.getElementById('loadMore'),
  };

  // UI state
  const state = {
    mode: 'list',       // 'list' | 'type' | 'search'
    offset: 0,
    limit: PAGE_LIMIT,
    hasMore: true,
    currentQ: '',
    currentType: '',
    currentSort: 'id-asc',
    typeCatalog: [],
    typeCursor: 0,
  };

  // In-memory cache to avoid repeated requests
  const cache = new Map();

  // Init
  bindUI();
  init();

  async function init() {
    try {
      await loadTypesIntoSelect();  // Populate the type filter dropdown
      await runQueryFromControls();   // Load first page by default
    } catch (err) {
      showError('Could not initialize. Check your internet connection.');
      console.error(err);
    }
  }

  // Bind UI events
  function bindUI() {
    // Submit search/filter form
    els.form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      runQueryFromControls();
    });

    // "Load more" button for pagination
    els.btnMore.addEventListener('click', () => loadMorePage());

    // Re-run query when sort order changes
    els.sortBy.addEventListener('change', () => {
      runQueryFromControls();
    });
  }

  // Read form controls and determine query mode (list, type, or search)
  async function runQueryFromControls() {
    state.currentQ    = (els.q.value || '').trim().toLowerCase();
    state.currentType = (els.typeFilter.value || '').trim().toLowerCase();
    state.currentSort = els.sortBy.value || 'id-asc';

    // Determine mode based on active filters
    if (state.currentQ) {
      state.mode = 'search';
    } else if (state.currentType) {
      state.mode = 'type';
    } else {
      state.mode = 'list';
    }

    // Reset pagination and reload
    state.offset = 0;
    state.typeCatalog = [];
    state.typeCursor = 0;
    state.hasMore = true;
    clearGrid();
    await loadMorePage(true);
  }

  // Load one page of Pokémon based on the current mode
  async function loadMorePage(isFirstPage = false) {
    try {
      setBusy(true);
      // Show skeleton placeholders on first load
      if (isFirstPage) {
        renderSkeletons(state.mode === 'search' ? 1 : state.limit);
      }

      let batch = [];

      if (state.mode === 'list') {
        batch = await fetchListPage(state.offset, state.limit);
        state.offset += state.limit;
        state.hasMore = batch.length === state.limit;

      } else if (state.mode === 'type') {
        // Fetch full catalog for this type on first request, then paginate locally
        if (state.typeCatalog.length === 0) {
          state.typeCatalog = await fetchTypeCatalog(state.currentType);
          state.typeCursor = 0;
        }
        const slice = state.typeCatalog.slice(state.typeCursor, state.typeCursor + state.limit);
        state.typeCursor += slice.length;
        state.hasMore = state.typeCursor < state.typeCatalog.length;
        batch = await fetchManyDetails(slice.map(x => x.name));

      } else if (state.mode === 'search') {
        // Search by name or ID; validate type filter if active
        const poke = await fetchDetailSafely(state.currentQ);
        if (poke && state.currentType) {
          const hasType = poke.types.some(t => t.type.name === state.currentType);
          if (!hasType) {
            batch = [];
            showInfo(`"${state.currentQ}" is not of type "${state.currentType}".`);
          } else {
            batch = [poke];
          }
        } else {
          batch = poke ? [poke] : [];
        }
        state.hasMore = false;
      }

      clearSkeletons();

      // Handle empty results
      if (batch.length === 0) {
        if (isFirstPage) renderEmptyState();
        updateLoadMoreVisibility();
        return;
      }

      // Sort and render the batch
      batch = sortPokemons(batch, state.currentSort);
      renderCards(batch);
      updateLoadMoreVisibility();

    } catch (err) {
      clearSkeletons();
      showError('Error loading data from PokeAPI.');
      console.error(err);
    } finally {
      setBusy(false);
    }
  }

  // API calls

  // Fetch a page of Pokémon from /pokemon and get their details
  async function fetchListPage(offset, limit) {
    const url = `${API_BASE}/pokemon?limit=${limit}&offset=${offset}`;
    const list = await fetchJSON(url);
    const names = (list.results || []).map(x => x.name);
    return fetchManyDetails(names);
  }

  // Fetch all Pokémon belonging to a specific type
  async function fetchTypeCatalog(typeName) {
    const url = `${API_BASE}/type/${encodeURIComponent(typeName)}`;
    const data = await fetchJSON(url);
    return (data.pokemon || []).map(p => ({
      name: p.pokemon.name,
      url: p.pokemon.url,
    }));
  }

  // Fetch detail for a single Pokémon by name or ID (returns null if not found)
  async function fetchDetailSafely(nameOrId) {
    const key = String(nameOrId).toLowerCase().trim();
    if (cache.has(key)) return cache.get(key);
    try {
      const data = await fetchJSON(`${API_BASE}/pokemon/${encodeURIComponent(key)}`);
      cache.set(key, data);
      cache.set(String(data.id), data);
      cache.set(data.name.toLowerCase(), data);
      return data;
    } catch {
      return null;
    }
  }

  // Fetch details for multiple Pokémon with a concurrency-limited pool
  async function fetchManyDetails(names) {
    const queue = [...names];
    const results = [];
    let active = 0;

    return new Promise((resolve) => {
      const next = () => {
        if (queue.length === 0 && active === 0) {
          resolve(results);
          return;
        }
        while (active < CONCURRENCY && queue.length > 0) {
          const name = queue.shift();
          active++;
          (async () => {
            try {
              const d = await fetchDetailSafely(name);
              if (d) results.push(d);
            } catch (err) {
              console.warn('Detail fetch error:', name, err);
            } finally {
              active--;
              next();
            }
          })();
        }
      };
      next();
    });
  }

  // Load all Pokémon types from the API and populate the filter dropdown
  async function loadTypesIntoSelect() {
    const url = `${API_BASE}/type`;
    const data = await fetchJSON(url);
    const EXCLUDE = new Set(['unknown', 'shadow']);
    let types = (data.results || [])
      .map(t => t.name.toLowerCase())
      .filter(t => !EXCLUDE.has(t))
      .sort((a, b) => a.localeCompare(b));

    const frag = document.createDocumentFragment();
    for (const t of types) {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = capitalize(t);
      frag.appendChild(opt);
    }
    els.typeFilter.appendChild(frag);
  }

  // Generic JSON fetcher with basic error handling
  async function fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
    return res.json();
  }

  // Render helpers

  // Append an array of Pokémon as cards to the grid
  function renderCards(pokemons) {
    const frag = document.createDocumentFragment();
    for (const p of pokemons) {
      frag.appendChild(buildCard(p));
    }
    els.results.appendChild(frag);
  }

  // Build a single Pokémon card from the <template> and API detail data
  function buildCard(detail) {
    const node = els.tplCard.content.cloneNode(true);
    const $ = (sel) => node.querySelector(sel);

    // Official artwork image (fallback chain)
    const imgUrl =
      detail?.sprites?.other?.['official-artwork']?.front_default ||
      detail?.sprites?.other?.dream_world?.front_default ||
      detail?.sprites?.front_default ||
      'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

    const img = $('.poke-card-img');
    img.src = imgUrl;
    img.alt = `Image of ${capitalize(detail.name)}`;

    // Name + ID
    $('.pokemon-name').textContent = capitalize(detail.name);
    $('.pokemon-id').textContent = `#${String(detail.id).padStart(4, '0')}`;

    // Type chips
    const typesWrap = $('.types');
    for (const t of detail.types) {
      const chip = document.createElement('span');
      chip.className = `type-chip type-chip--${t.type.name}`;
      chip.textContent = t.type.name;
      typesWrap.appendChild(chip);
    }

    // Abilities
    const ulAb = $('.ability-list');
    for (const ab of detail.abilities) {
      const li = document.createElement('li');
      li.textContent = ab.ability.name;
      ulAb.appendChild(li);
    }

    // Base stats (hp, attack, defense, special-attack, special-defense, speed)
    const ulStats = $('.stats-list');
    const ORDER = ['hp', 'attack', 'defense', 'special-attack', 'special-defense', 'speed'];
    const map = Object.fromEntries(detail.stats.map(s => [s.stat.name, s.base_stat]));
    for (const key of ORDER) {
      const li = document.createElement('li');
      const label = key.replace('-', ' ');
      li.innerHTML = `<span>${label}</span><strong>${map[key] ?? '—'}</strong>`;
      ulStats.appendChild(li);
    }

    return node;
  }

  // Show skeleton placeholder cards while data loads
  function renderSkeletons(n) {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < n; i++) {
      frag.appendChild(els.tplSkel.content.cloneNode(true));
    }
    els.results.appendChild(frag);
  }

  // Remove all skeleton placeholders
  function clearSkeletons() {
    els.results.querySelectorAll('.skeleton').forEach(el => el.remove());
  }

  // Show a "no results" message
  function renderEmptyState() {
    const wrap = document.createElement('div');
    wrap.style.padding = '2rem';
    wrap.style.gridColumn = '1 / -1';
    wrap.innerHTML = `
      <p style="text-align:center; color:#9aa3c7; font-size:1rem;">
        No results found. Try another name/ID, change the type, or clear your filters.
      </p>`;
    els.results.appendChild(wrap);
  }

  // Show or hide the "Load more" button
  function updateLoadMoreVisibility() {
    els.btnMore.hidden = !state.hasMore;
  }

  // Clear the entire card grid
  function clearGrid() {
    els.results.innerHTML = '';
  }

  // Set aria-busy attribute for accessibility
  function setBusy(isBusy) {
    els.results.setAttribute('aria-busy', String(!!isBusy));
  }

  // Toast notifications
  function showError(msg) { toast(msg, 'error'); }
  function showInfo(msg)  { toast(msg, 'info'); }

  // Display a temporary toast message above the grid
  function toast(msg, kind = 'info') {
    const el = document.createElement('div');
    el.className = `toast-msg toast-${kind}`;
    el.textContent = msg;
    els.results.parentElement.insertBefore(el, els.results);
    setTimeout(() => el.remove(), 3500);
  }

  // Utility functions

  // Sort Pokémon array by the selected criteria
  function sortPokemons(arr, sortBy) {
    const out = [...arr];
    switch (sortBy) {
      case 'id-asc':    out.sort((a, b) => a.id - b.id); break;
      case 'id-desc':   out.sort((a, b) => b.id - a.id); break;
      case 'name-asc':  out.sort((a, b) => a.name.localeCompare(b.name)); break;
      case 'name-desc': out.sort((a, b) => b.name.localeCompare(a.name)); break;
    }
    return out;
  }

  // Capitalize the first letter of a string
  function capitalize(s) {
    return (s || '').charAt(0).toUpperCase() + (s || '').slice(1);
  }

})();
