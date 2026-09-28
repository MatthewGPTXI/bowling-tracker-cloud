export function createInventoryEditor({document, ids, label, scopeKey, ready, signedIn, get, edit}) {
  const $ = key => document.getElementById(ids[key]);
  let editing = '', signature = '';
  function reset() {
    editing = ''; $('input').value = ''; $('save').textContent = 'Add ' + label; $('cancel').hidden = true;
  }
  async function save(event) {
    event.preventDefault();
    const scope = scopeKey(), renamed = !!editing;
    $('save').disabled = true;
    try {
      await edit($('input').value, editing);
      if (scope !== scopeKey()) return;
      reset();
      $('status').textContent = renamed ? `${label === 'ball' ? 'Ball' : 'Alley'} renamed. Past games keep their original ${label} name.` : `${label === 'ball' ? 'Ball' : 'Alley'} added to your inventory.`;
      $('input').focus();
    } catch (error) { if (scope === scopeKey()) $('status').textContent = error.message; }
    finally { $('save').disabled = !ready(); }
  }
  function render() {
    $('save').disabled = !ready();
    $('sync').textContent = signedIn() ? 'Syncs with your account when online.' : 'Saved on this device. Sign in to sync.';
    const rows = get().filter(row => !row.removed);
    const next = JSON.stringify([scopeKey(), rows]);
    if (signature === next) return;
    signature = next;
    $('empty').hidden = rows.length > 0;
    const list = $('list'); list.replaceChildren();
    for (const row of rows) {
      const item = document.createElement('li');
      const name = document.createElement('strong'); name.textContent = row.name; item.appendChild(name);
      const actions = document.createElement('div'); actions.className = 'inventory-actions'; item.appendChild(actions);
      for (const action of ['Rename', 'Remove']) {
        const button = document.createElement('button'); button.type = 'button';
        button.className = 'text-btn' + (action === 'Remove' ? ' danger-text' : '');
        button.textContent = action; button.dataset.action = action; button.dataset.name = row.name;
        button.setAttribute('aria-label', action + ' ' + row.name); actions.appendChild(button);
      }
      list.appendChild(item);
    }
    if (list.dataset.inventoryWired) return;
    list.dataset.inventoryWired = 'true';
    list.addEventListener('click', async event => {
      const button = event.target.closest('button[data-action]');
      if (!button || !list.contains(button)) return;
      const name = button.dataset.name;
      if (button.dataset.action === 'Rename') {
        editing = name; $('input').value = name; $('save').textContent = 'Save name';
        $('cancel').hidden = false; $('status').textContent = ''; $('input').focus(); return;
      }
      const scope = scopeKey(); button.disabled = true;
      try {
        await edit(name, '', true);
        if (scope !== scopeKey()) return;
        if (editing === name) reset();
        $('status').textContent = `${label === 'ball' ? 'Ball' : 'Alley'} removed from inventory. Past games are unchanged.`;
      } catch (error) { if (scope === scopeKey()) $('status').textContent = error.message; }
      finally { button.disabled = false; }
    });
  }
  return {reset, save, render};
}
