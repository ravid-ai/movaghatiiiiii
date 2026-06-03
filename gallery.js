// CharacterVerse Gallery (lazy-loaded + randomized)

const state = {
  // Full list after decode: [{ code, char, tagSet, searchText }]
  items: [],
  shuffled: [],
  filtered: [],
  cursor: 0,
  batchDesktop: 6,
  batchMobile: 4,
  isLoading: false,
  totalLoaded: 0,
  activeTag: 'all',
  query: '',
  modalItem: null,
  observer: null
};

const CharacterCodec = {
  MAGIC: 'CV1',
  decode(base64String) {
    try {
      const cleaned = (base64String || '').trim();
      const json = decodeURIComponent(escape(atob(cleaned)));
      const data = JSON.parse(json);
      if (data._cv !== this.MAGIC) return { error: 'Invalid character code (wrong format).' };
      if (!data.name || !data.systemPrompt) return { error: 'Invalid character data (missing name/prompt).' };
      delete data._cv;
      return { success: true, character: data };
    } catch (e) {
      return { error: 'Failed to decode: ' + (e?.message || e) };
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  applyGallerySettingsFromLocalStorage();
  loadGallery().catch(err => {
    console.error(err);
    showEmpty('Failed to load gallery.json');
  });
});

async function loadGallery() {
  const resp = await fetch('./gallery.json', { cache: 'no-store' });
  if (!resp.ok) throw new Error('gallery.json not found (HTTP ' + resp.status + ')');
  const data = await resp.json();

  const arr = Array.isArray(data) ? data : (Array.isArray(data?.characters) ? data.characters : []);
  if (!arr.length) { showEmpty('No character codes in gallery.json'); return; }

  // Decode once (for search + categories + modal)
  const decodedItems = [];
  for (const code of arr) {
    const decoded = CharacterCodec.decode(code);
    if (!decoded.success) continue;
    const char = decoded.character;
    const tagSet = new Set((Array.isArray(char.tags) ? char.tags : []).map(t => String(t).trim()).filter(Boolean));
    const searchText = [char.name, char.title, char.description, char.world, ...(Array.isArray(char.tags) ? char.tags : [])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    decodedItems.push({ code, char, tagSet, searchText });
  }

  if (!decodedItems.length) { showEmpty('No valid character codes found'); return; }

  // Randomize without repeats (Fisher-Yates) — keep this as your core algorithm
  state.items = decodedItems;
  state.shuffled = fisherYatesShuffle(decodedItems.slice());

  initFiltersUI();
  applyFiltersAndReset();

  // Lazy-load sentinel
  const sentinel = document.getElementById('gallery-sentinel');
  state.observer = new IntersectionObserver((entries) => {
    const e = entries[0];
    if (e.isIntersecting) renderNextBatch();
  }, { root: null, threshold: 0.1, rootMargin: '240px' });
  state.observer.observe(sentinel);

  window.addEventListener('resize', () => {
    updateSentinelText();
    // batch size changes on resize; no reset needed
  });

  initModalUI();
  updateSentinelText();
}

function fisherYatesShuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getBatchSize() {
  return (window.innerWidth <= 560) ? state.batchMobile : state.batchDesktop;
}

function updateSentinelText() {
  const txt = document.getElementById('sentinel-text');
  if (!txt) return;
  if (state.cursor >= state.filtered.length) txt.textContent = 'That’s everything ✨';
  else txt.textContent = 'Scroll to load more…';
}

function renderNextBatch() {
  if (state.isLoading) return;
  if (state.cursor >= state.filtered.length) { updateSentinelText(); return; }
  state.isLoading = true;

  const batch = getBatchSize();
  const slice = state.filtered.slice(state.cursor, state.cursor + batch);
  state.cursor += slice.length;

  const grid = document.getElementById('gallery-grid');
  slice.forEach((item) => {
    const card = createCard(item);
    grid.appendChild(card);
    state.totalLoaded++;
  });

  // Counts
  document.getElementById('gt-count').textContent = `${state.totalLoaded} loaded`;
  const loadedPill = document.getElementById('gmeta-loaded');
  if (loadedPill) loadedPill.textContent = `${state.totalLoaded} loaded`;
  updateSentinelText();

  // Empty state if nothing rendered
  if (!grid.children.length) showEmpty('No valid character codes found');

  state.isLoading = false;
}

function createCard(item) {
  const { char, code } = item;
  const el = document.createElement('article');
  el.className = 'gcard gcard-click';

  const avatarHtml = char.avatar
    ? `<img src="${escAttr(char.avatar)}" alt="${escAttr(char.name)}" />`
    : `<span>${escHtml(char.emoji || getInitials(char.name))}</span>`;

  const tagsHtml = (Array.isArray(char.tags) && char.tags.length)
    ? `<div class="gcard-tags">${char.tags.slice(0, 6).map(t => `<span class="gtag">${escHtml(t)}</span>`).join('')}</div>`
    : '';

  const richerDesc = buildRicherShortDescription(char);

  el.innerHTML = `
    <div class="gcard-top">
      <div class="gcard-avatar">${avatarHtml}</div>
      <div>
        <div class="gcard-name">${escHtml(char.name)}</div>
        <div class="gcard-title">${escHtml(char.title || '')}</div>
      </div>
    </div>
    <div class="gcard-desc">${escHtml(richerDesc)}</div>
    ${tagsHtml}
    <div class="gcard-actions">
      <button class="gbtn" data-action="copy">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <rect x="9" y="9" width="13" height="13" rx="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
        Copy code
      </button>
      <button class="gbtn primary" data-action="add">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 5v14M5 12h14"></path>
        </svg>
        Add to chat
      </button>
    </div>
  `;

  el.querySelector('[data-action="copy"]').addEventListener('click', async (e) => {
    // prevent opening modal
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(code);
      showToast('success', 'Code copied to clipboard');
    } catch (e) {
      showToast('error', 'Clipboard blocked — copy manually');
    }
  });

  el.querySelector('[data-action="add"]').addEventListener('click', (e) => {
    e.stopPropagation();
    const res = addCharacterToLocalStorage(char);
    if (!res.success) {
      showToast('error', res.error || 'Failed to add character');
      return;
    }
    // Open chat with this character
    localStorage.setItem('cv_last_char', res.id);
    showToast('success', 'Added! Redirecting…');
    setTimeout(() => { location.href = 'index.html'; }, 350);
  });

  // Click anywhere else → open modal with details
  el.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    openModal(item);
  });

  return el;
}

function buildRicherShortDescription(char) {
  const desc = (char.description || '').trim();
  const world = (char.world || '').trim();
  const title = (char.title || '').trim();
  // Aim for “a bit more”, but not a wall of text.
  let out = desc || '';
  if (out.length < 70 && world) out = out ? `${out} — ${world}` : world;
  if (!out && title) out = title;
  if (!out) out = 'A CharacterVerse persona ready to chat.';
  return smartTrim(out, 180);
}

function smartTrim(text, maxLen) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= maxLen) return s;
  const cut = s.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 80 ? cut.slice(0, lastSpace) : cut).trim() + '…';
}

function addCharacterToLocalStorage(char) {
  try {
    const raw = localStorage.getItem('cv_characters');
    const characters = raw ? JSON.parse(raw) : {};

    const newId = `char_${Date.now()}`;

    // Avoid duplicate names
    const existingNames = Object.values(characters).map(c => (c.name || '').toLowerCase());
    let name = (char.name || '').trim() || 'Imported Character';
    if (existingNames.includes(name.toLowerCase())) name = name + ' (Imported)';

    characters[newId] = {
      ...char,
      name,
      id: newId,
      createdAt: Date.now()
    };

    localStorage.setItem('cv_characters', JSON.stringify(characters));
    return { success: true, id: newId };
  } catch (e) {
    console.error(e);
    return { success: false, error: e?.message || String(e) };
  }
}

function showEmpty(msg) {
  const empty = document.getElementById('gallery-empty');
  const sub = empty?.querySelector('.gallery-empty-sub');
  if (sub && msg) sub.textContent = msg;
  document.getElementById('gallery-empty')?.classList.remove('hidden');
  document.getElementById('gallery-sentinel')?.classList.add('hidden');
}

// ===== FILTERS =====
function initFiltersUI() {
  const search = document.getElementById('gallery-search');
  const clear = document.getElementById('gallery-clear');
  const chips = document.getElementById('gallery-chips');

  // Build categories from tags
  const tagCounts = new Map();
  state.items.forEach(it => {
    it.tagSet.forEach(t => tagCounts.set(t, (tagCounts.get(t) || 0) + 1));
  });

  const tagsSorted = Array.from(tagCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t)
    .slice(0, 14); // keep chips tidy

  chips.innerHTML = '';
  chips.appendChild(makeChip('All', 'all'));
  tagsSorted.forEach(t => chips.appendChild(makeChip(t, t)));
  if (tagCounts.size > tagsSorted.length) chips.appendChild(makeChip('More…', '__more__'));

  setActiveChip('all');

  // Search
  const onSearch = debounce(() => {
    state.query = (search.value || '').trim().toLowerCase();
    applyFiltersAndReset();
  }, 120);
  search.addEventListener('input', onSearch);
  clear.addEventListener('click', () => {
    search.value = '';
    state.query = '';
    applyFiltersAndReset();
    search.focus();
  });
}

function makeChip(label, value) {
  const b = document.createElement('button');
  b.className = 'gchip';
  b.type = 'button';
  b.textContent = label;
  b.dataset.value = value;
  b.addEventListener('click', () => {
    if (value === '__more__') {
      showToast('info', 'Tip: use search to find any tag/category');
      return;
    }
    state.activeTag = value;
    setActiveChip(value);
    applyFiltersAndReset();
  });
  return b;
}

function setActiveChip(value) {
  document.querySelectorAll('.gchip').forEach(c => {
    c.classList.toggle('active', c.dataset.value === value);
  });
}

function applyFiltersAndReset() {
  // Keep randomized order (state.shuffled) but filter it
  const tag = state.activeTag;
  const q = state.query;

  state.filtered = state.shuffled.filter(it => {
    const tagOk = (tag === 'all') ? true : it.tagSet.has(tag);
    const qOk = !q ? true : it.searchText.includes(q);
    return tagOk && qOk;
  });

  // Reset rendering
  const grid = document.getElementById('gallery-grid');
  grid.innerHTML = '';
  state.cursor = 0;
  state.totalLoaded = 0;

  // Toggle empty/sentinel
  document.getElementById('gallery-empty')?.classList.add('hidden');
  document.getElementById('gallery-sentinel')?.classList.remove('hidden');

  const matchPill = document.getElementById('gmeta-match');
  if (matchPill) matchPill.textContent = `${state.filtered.length} matched`;
  const loadedPill = document.getElementById('gmeta-loaded');
  if (loadedPill) loadedPill.textContent = `0 loaded`;
  document.getElementById('gt-count').textContent = `0 loaded`;

  if (!state.filtered.length) {
    showEmpty('No characters match your filters. Try another tag or clear search.');
    return;
  }

  renderNextBatch();
  updateSentinelText();
}

function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

// ===== MODAL =====
function initModalUI() {
  const backdrop = document.getElementById('gmodal');
  const closeBtn = document.getElementById('gmodal-close');

  closeBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
}

function openModal(item) {
  state.modalItem = item;
  const { char, code } = item;

  const backdrop = document.getElementById('gmodal');
  const av = document.getElementById('gmodal-avatar');
  const title = document.getElementById('gmodal-title');
  const sub = document.getElementById('gmodal-sub');
  const desc = document.getElementById('gmodal-desc');
  const open = document.getElementById('gmodal-open');
  const tags = document.getElementById('gmodal-tags');
  const copyBtn = document.getElementById('gmodal-copy');
  const addBtn = document.getElementById('gmodal-add');

  const avatarHtml = char.avatar
    ? `<img src="${escAttr(char.avatar)}" alt="${escAttr(char.name)}" />`
    : `<span>${escHtml(char.emoji || getInitials(char.name))}</span>`;
  av.innerHTML = avatarHtml;

  title.textContent = char.name || 'Unnamed';
  sub.textContent = [char.title, char.world].filter(Boolean).join(' • ') || '—';
  desc.textContent = (char.description || buildRicherShortDescription(char)).trim();
  open.textContent = (char.greeting || '').trim() || '—';

  const tlist = (Array.isArray(char.tags) ? char.tags : []).map(t => String(t).trim()).filter(Boolean);
  tags.innerHTML = tlist.length
    ? tlist.map(t => `<span class="gtag">${escHtml(t)}</span>`).join('')
    : `<span class="gtag">no tags</span>`;

  // Wire buttons
  copyBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(code);
      showToast('success', 'Code copied to clipboard');
    } catch {
      showToast('error', 'Clipboard blocked — copy manually');
    }
  };

  addBtn.onclick = () => {
    const res = addCharacterToLocalStorage(char);
    if (!res.success) {
      showToast('error', res.error || 'Failed to add character');
      return;
    }
    localStorage.setItem('cv_last_char', res.id);
    showToast('success', 'Added! Redirecting…');
    setTimeout(() => { location.href = 'index.html'; }, 350);
  };

  backdrop.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  const backdrop = document.getElementById('gmodal');
  if (!backdrop || backdrop.classList.contains('hidden')) return;
  backdrop.classList.add('hidden');
  state.modalItem = null;
  document.body.style.overflow = 'auto';
}

// ===== SETTINGS (match main app look) =====
function applyGallerySettingsFromLocalStorage() {
  try {
    const root = document.getElementById('html-root') || document.documentElement;
    const raw = localStorage.getItem('cv_settings');
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s?.theme) root.setAttribute('data-theme', s.theme);
    if (typeof s?.fontSize === 'number') {
      document.documentElement.style.setProperty('--font-size-base', String(s.fontSize) + 'px');
    }
    // Direction/language hints (optional)
    if (s?.direction && s.direction !== 'auto') {
      root.setAttribute('dir', s.direction);
    }
  } catch (e) {
    console.warn('Settings load failed', e);
  }
}

function getInitials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function escHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escAttr(s) {
  return escHtml(s).replace(/'/g, '&#39;');
}

// Minimal toast (reuses CSS from style.css)
function showToast(type, message) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const t = document.createElement('div');
  t.className = `toast ${type}`;
  const icon = type === 'success' ? '✅' : (type === 'error' ? '❌' : 'ℹ️');
  t.innerHTML = `<span class="toast-icon">${icon}</span><span>${escHtml(message)}</span>`;
  container.appendChild(t);

  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(24px) scale(0.96)'; }, 2600);
  setTimeout(() => { t.remove(); }, 3100);
}
