/* Shared ball-usage data and the compact optional editor. */
(() => {
  'use strict';
  const clean = value => String(value || '').trim().replace(/\s+/g, ' ');
  const key = value => clean(value).toLowerCase();
  const limit = 10;

  function list(game) {
    const rows = Array.isArray(game?.balls) ? game.balls : clean(game?.ball) ? [{name: game.ball}] : [];
    return rows.map(row => ({name: clean(row?.name), frames: row?.frames ?? null}));
  }

  function error(rows) {
    if (!Array.isArray(rows) || rows.length > limit) return 'Record up to 10 balls per game.';
    const names = new Set();
    let frames = 0;
    for (const row of rows) {
      if (!row || typeof row.name !== 'string' || !clean(row.name)) return 'Enter a ball name for each frame count.';
      if (clean(row.name).length > 100) return 'Ball names must be 100 characters or fewer.';
      if (names.has(key(row.name))) return 'Use one row per ball; combine its frames in that row.';
      names.add(key(row.name));
      if (row.frames !== null && row.frames !== undefined) {
        if (!Number.isInteger(row.frames) || row.frames < 1 || row.frames > 10) return 'Frames per ball must be a whole number from 1 to 10, or blank.';
        frames += row.frames;
      }
    }
    return frames > 10 ? 'Ball frame counts cannot total more than 10 for one game.' : '';
  }

  function summary(game) {
    return list(game).map(row => row.name + (row.frames == null ? '' : ` · ${row.frames} frame${row.frames === 1 ? '' : 's'}`)).join(' / ') || 'No ball recorded';
  }

  function comparable(game) {
    return list(game).map(row => ({name: key(row.name), frames: row.frames})).sort((a, b) => a.name.localeCompare(b.name));
  }

  function draft(input) {
    if (!input) return [];
    if (input.bowlingBallEditor) return input.bowlingBallEditor.draft();
    const saved = input.bowlingBallDraft || [{name: '', frames: ''}];
    return saved.map((row, i) => ({name: i === 0 ? input.value : row.name, frames: row.frames ?? ''}));
  }

  function set(input, rows = []) {
    if (input.bowlingBallEditor) { input.bowlingBallEditor.set(rows); return; }
    input.bowlingBallDraft = (rows.length ? rows : [{name: '', frames: ''}]).map(row => ({name: row.name || '', frames: row.frames ?? ''}));
    input.value = input.bowlingBallDraft[0].name;
  }

  function fromDraft(rows, canonical = clean) {
    return rows.filter(row => clean(row.name) || String(row.frames ?? '').trim() !== '')
      .map(row => ({name: canonical(row.name), frames: String(row.frames ?? '').trim() === '' ? null : Number(row.frames)}));
  }

  function attach(input, host, firstRow, doc, onChange) {
    if (input.bowlingBallEditor) return input.bowlingBallEditor;
    const initial = draft(input);
    const create = (tag, className, text) => {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const frameField = () => {
      const label = create('label', 'ball-frame-field', 'Frames');
      const field = create('input');
      field.type = 'number'; field.min = '1'; field.max = '10'; field.step = '1'; field.inputMode = 'numeric';
      field.placeholder = 'Optional';
      label.appendChild(field);
      field.addEventListener('input', changed);
      return {label, field};
    };
    const removeButton = () => {
      const button = create('button', 'text-btn danger-text ball-remove', 'Remove');
      button.type = 'button';
      return button;
    };
    const firstFrame = frameField();
    const firstRemove = removeButton();
    firstRow.appendChild(firstFrame.label); firstRow.appendChild(firstRemove);
    const extraRows = create('div', 'ball-extra-rows'); host.appendChild(extraRows);
    const add = create('button', 'text-btn ball-add', 'More balls / frames');
    add.type = 'button'; host.appendChild(add);
    const help = create('p', 'field-help', 'Frames are optional. Count each frame once (10 total), not bonus shots. Leave counts blank if you used two balls in the same frame.');
    host.appendChild(help);
    const total = create('p', 'ball-frame-total'); total.setAttribute('role', 'status'); host.appendChild(total);
    let extras = [], expanded = false;
    const raw = () => [{name: input.value, frames: firstFrame.field.validity?.badInput ? 'invalid' : firstFrame.field.value},
      ...extras.map(row => ({name: row.name.value, frames: row.frame.validity?.badInput ? 'invalid' : row.frame.value}))];
    function refresh() {
      firstFrame.label.hidden = firstRemove.hidden = help.hidden = total.hidden = !expanded;
      add.textContent = expanded ? '+ Add ball' : 'More balls / frames';
      add.disabled = extras.length + 1 >= limit;
      const rows = fromDraft(raw());
      const warning = error(rows);
      total.textContent = warning || `${rows.reduce((sum, row) => sum + (row.frames || 0), 0)} / 10 frames recorded`;
      total.classList.toggle('error', !!warning);
      firstRemove.setAttribute('aria-label', 'Remove ball 1');
      extras.forEach((row, i) => row.remove.setAttribute('aria-label', `Remove ball ${i + 2}`));
    }
    function changed() { refresh(); onChange(); }
    function append(values = {}) {
      const row = create('div', 'ball-usage-row');
      const label = create('label', 'ball-name-field', 'Ball');
      const name = create('input'); name.type = 'text'; name.maxLength = 100; name.setAttribute('list', 'ballOptions');
      name.placeholder = 'Choose or type a ball'; name.value = values.name || '';
      label.appendChild(name); row.appendChild(label);
      const frame = frameField(); frame.field.value = String(values.frames ?? ''); row.appendChild(frame.label);
      const remove = removeButton(); row.appendChild(remove);
      const entry = {row, name, frame: frame.field, remove}; extras.push(entry); extraRows.appendChild(row);
      name.addEventListener('input', changed);
      remove.addEventListener('click', () => {
        const position = extras.indexOf(entry); extras.splice(position, 1); row.remove(); changed();
        (extras[position]?.name || extras[position - 1]?.name || input).focus();
      });
      return entry;
    }
    input.addEventListener('input', changed);
    firstRemove.addEventListener('click', () => {
      const next = extras.shift();
      input.value = next?.name.value || ''; firstFrame.field.value = next?.frame.value || '';
      if (next) next.row.remove();
      changed(); input.focus();
    });
    add.addEventListener('click', () => {
      if (extras.length + 1 >= limit) return;
      expanded = true;
      // First reveal the counter; adding another ball is one more explicit tap.
      const entry = add.textContent === 'More balls / frames' ? null : append();
      changed(); (entry?.name || firstFrame.field).focus();
    });
    const controller = {
      draft: raw,
      set(rows) {
        extras.forEach(row => row.row.remove()); extras = [];
        input.value = rows[0]?.name || ''; firstFrame.field.value = String(rows[0]?.frames ?? '');
        rows.slice(1).forEach(append);
        expanded = rows.length > 1 || rows.some(row => String(row.frames ?? '') !== '');
        refresh();
      }
    };
    input.bowlingBallEditor = controller;
    controller.set(initial);
    return controller;
  }

  const api = {clean, key, list, error, summary, comparable, draft, set, fromDraft, attach};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else window.BowlingBalls = api;
})();
