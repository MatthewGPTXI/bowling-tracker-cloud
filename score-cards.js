(() => {
  'use strict';
  const APP_URL = 'https://matthewgptxi.github.io/bowling-tracker-cloud/';
  const PAGE_SIZE = 24;
  // Fixed destination, precomputed with QR error correction M and a four-module
  // quiet zone. Draw locally: no QR service, fonts, image fetches, or dependencies.
  const QR = [
    "00000000000000000000000000000000000000000",
    "00000000000000000000000000000000000000000",
    "00000000000000000000000000000000000000000",
    "00000000000000000000000000000000000000000",
    "00001111111000011000111111010011111110000",
    "00001000001000100001110001101010000010000",
    "00001011101011100011000111101010111010000",
    "00001011101011010000001100111010111010000",
    "00001011101010101111101101110010111010000",
    "00001000001011101110010001100010000010000",
    "00001111111010101010101010101011111110000",
    "00000000000010000010100011111000000000000",
    "00001011111001110100010000111011111000000",
    "00000000110110011100111101110011011110000",
    "00000001101001101111010010001110101100000",
    "00000001010000001100111001000100111110000",
    "00001111111100111010100100001101110110000",
    "00001001000110101101011111010111011110000",
    "00001111011100111001101010100110110100000",
    "00000110000111001011000011111110011000000",
    "00001001111000001101010000100101100010000",
    "00001001110100001110000110010011011010000",
    "00001011111101110001001001101101101100000",
    "00001101000111101100000001100001111010000",
    "00000001111000001011001110101101110000000",
    "00001000010001100001100111010110010010000",
    "00001000001111100110000010100111101100000",
    "00001011000001011000101111101100111100000",
    "00001000101011010100010110101111100100000",
    "00000000000010011000111111111000101010000",
    "00001111111001101011110000011010101100000",
    "00001000001010001111111011111000111110000",
    "00001011101011000001100000101111110110000",
    "00001011101011101101011111011100100110000",
    "00001011101011100001101001001011011000000",
    "00001000001000100001001011000000111000000",
    "00001111111011100001110110111011000100000",
    "00000000000000000000000000000000000000000",
    "00000000000000000000000000000000000000000",
    "00000000000000000000000000000000000000000",
    "00000000000000000000000000000000000000000"
  ];
  const colors = {bg: '#0b1724', panel: '#152638', line: '#294053', text: '#f1f7fa', muted: '#a8bdcb', mint: '#79e7c4'};
  const number = value => value == null ? '—' : value.toLocaleString('en-US');
  const decimal = value => value == null ? '—' : value.toFixed(1);
  const percent = value => value == null ? '—' : `${value.toFixed(1)}%`;
  const pages = card => Math.max(1, Math.ceil(card.scores.length / PAGE_SIZE));
  const filename = (card, page = 0) => `bowling-tracker-${card.kind}-${card.date}${pages(card) > 1 ? `-${page + 1}` : ''}.png`;

  function notes(card) {
    const lines = [];
    if (card.noTapOnly) lines.push('No-tap session · excluded from overall stats');
    else if (card.noTapCount) lines.push(card.kind === 'session'
      ? 'Totals & rates use standard games · no-tap scores labeled'
      : `${card.noTapCount} no-tap game${card.noTapCount === 1 ? '' : 's'} excluded`);
    if (card.frameCount < card.count) lines.push(card.frameCount
      ? `Frame stats: ${card.frameCount} of ${card.count} games · score-only games excluded`
      : 'Frame stats not recorded');
    return lines;
  }

  function describe(card, page = 0) {
    const scores = card.scores.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    return `${card.name}. ${card.kind === 'session' ? card.sessionType + ' session' : 'Overall stats, all time'}. ${card.dateLabel}. `
      + (scores.length ? scores.map(game => `Game ${game.number}: ${game.score}${game.noTap ? ' (no-tap)' : ''}`).join(', ') + '. ' : '')
      + `${card.kind === 'session' ? 'Series total' : 'Total pins'}: ${card.total}. Average: ${decimal(card.average)}. `
      + `Strike percentage: ${percent(card.strikePct)}. Closed frame percentage: ${percent(card.closedFramePct)}. `
      + (card.kind === 'overall' ? `High game: ${number(card.highGame)}. Best 3-game series: ${number(card.highSeries)}. ` : '')
      + notes(card).join('. ') + `. Bowling Tracker. QR code: ${APP_URL}`;
  }

  function render(card, canvas, page = 0) {
    const session = card.kind === 'session';
    const scores = card.scores.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const columns = scores.length > 6 ? 4 : 3;
    const rows = Math.ceil(scores.length / columns);
    const scoreHeight = rows ? rows * 150 - 16 : 0;
    const metricY = session ? 498 + scoreHeight + 32 : 492;
    const noteLines = notes(card);
    const footerY = metricY + (session ? 176 : 342) + Math.max(1, noteLines.length) * 34 + 44;
    canvas.width = 1080;
    canvas.height = footerY + 264;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Image rendering is unavailable.');
    const box = (x, y, width, height, fill, radius = 22) => {
      ctx.fillStyle = fill;
      ctx.beginPath(); ctx.roundRect(x, y, width, height, radius); ctx.fill();
    };
    const text = (value, x, y, size = 30, color = colors.text, weight = 500, max = 952) => {
      value = String(value);
      ctx.fillStyle = color;
      ctx.font = `${weight >= 600 ? 700 : 400} ${size}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, "DejaVu Sans", sans-serif`;
      while (ctx.measureText(value).width > max && size > 26) {
        size -= 2; ctx.font = `${weight >= 600 ? 700 : 400} ${size}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, "DejaVu Sans", sans-serif`;
      }
      if (ctx.measureText(value).width > max) {
        const chars = Array.from(value);
        while (chars.length && ctx.measureText(chars.join('') + '…').width > max) chars.pop();
        value = chars.join('') + '…';
      }
      ctx.fillText(value, x, y);
    };
    const metric = (label, value, x, y, width = 306) => {
      box(x, y, width, 144, colors.panel);
      text(label, x + 24, y + 43, 27, colors.muted, 500, width - 48);
      text(value, x + 24, y + 111, 54, colors.text, 700, width - 48);
    };
    ctx.fillStyle = colors.bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const glow = ctx.createLinearGradient(0, 0, 1080, 650);
    glow.addColorStop(0, '#173c42'); glow.addColorStop(1, colors.bg);
    ctx.fillStyle = glow; ctx.fillRect(0, 0, 1080, canvas.height);
    // A quiet bowling-ball motif, drawn behind the header.
    ctx.strokeStyle = '#32555f'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(956, 125, 200, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(956, 125, 155, 0, Math.PI * 2); ctx.stroke();
    for (const [x, y] of [[914, 104], [960, 84], [964, 136]]) {
      ctx.fillStyle = '#32555f'; ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fill();
    }
    box(64, 62, 48, 5, colors.mint, 2);
    text(session ? (card.noTapOnly ? 'NO-TAP SESSION' : 'SESSION SCORE CARD') : 'OVERALL STATS · ALL TIME', 130, 77, 27, colors.mint, 700);
    text(card.name, 64, 163, 58, colors.text, 750, 790);
    text(session ? `${card.dateLabel} · ${card.sessionType}` : card.dateLabel, 64, 219, 30, colors.muted);
    text(session ? (card.noTapOnly ? 'NO-TAP SERIES TOTAL' : card.noTapCount ? 'STANDARD SERIES TOTAL' : 'SERIES TOTAL') : 'AVERAGE', 64, 300, 28, colors.mint, 650);
    text(session ? number(card.total) : decimal(card.average), 58, 433, 138, colors.text, 750, 690);
    text(`${number(card.count)} game${card.count === 1 ? '' : 's'}${session ? '' : ` · ${number(card.sessions)} session${card.sessions === 1 ? '' : 's'}`}`, 726, 411, 29, colors.muted, 500, 290);

    if (session) {
      const width = (952 - (columns - 1) * 16) / columns;
      scores.forEach((game, i) => {
        const x = 64 + (i % columns) * (width + 16), y = 498 + Math.floor(i / columns) * 150;
        box(x, y, width, 134, colors.panel);
        text(game.noTap ? `G${game.number} · NO-TAP` : `GAME ${game.number}`, x + 22, y + 38, 25, colors.muted, 550, width - 44);
        text(game.score, x + 22, y + 107, 62, game.noTap ? colors.muted : colors.mint, 750, width - 44);
      });
      metric('Average', decimal(card.average), 64, metricY);
      metric('Strike %', percent(card.strikePct), 387, metricY);
      metric('Closed frame %', percent(card.closedFramePct), 710, metricY);
    } else {
      metric('High game', number(card.highGame), 64, metricY, 468);
      metric('Best 3-game series', number(card.highSeries), 548, metricY, 468);
      metric('Total pins', number(card.total), 64, metricY + 164);
      metric('Strike %', percent(card.strikePct), 387, metricY + 164);
      metric('Closed frame %', percent(card.closedFramePct), 710, metricY + 164);
    }
    const noteY = metricY + (session ? 192 : 356);
    noteLines.forEach((line, i) => text(line, 64, noteY + i * 34, 26, colors.muted));
    if (pages(card) > 1) text(`Games ${scores[0].number}–${scores.at(-1).number} of ${card.scores.length} · Full-session totals on every card`, 64, footerY - 14, 26, colors.muted);
    ctx.fillStyle = colors.line; ctx.fillRect(64, footerY, 952, 1);
    text('BOWLING TRACKER', 64, footerY + 80, 30, colors.text, 700);
    text('Log your games. See your progress.', 64, footerY + 125, 27, colors.muted);
    text(session ? 'Scan to track your next game →' : `As of ${card.asOf} · Scan to start →`, 64, footerY + 183, 25, colors.mint);
    const step = 5, side = QR.length * step, qrX = 1016 - side, qrY = footerY + 30;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(qrX, qrY, side, side);
    ctx.fillStyle = '#0b1724';
    QR.forEach((row, y) => Array.from(row).forEach((cell, x) => {
      if (cell === '1') ctx.fillRect(qrX + x * step, qrY + y * step, step, step);
    }));
    return canvas;
  }

  const api = {APP_URL, PAGE_SIZE, pages, filename, describe, render};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  window.BowlingScoreCards = api;
  const $ = id => document.getElementById(id);
  const dialog = $('scoreCardDialog');
  let snapshot = null, scope = '', page = 0, generation = 0, blob = null, objectUrl = '', busy = false;
  const currentScope = () => {
    const info = window.BowlingApp.getLocalScopeInfo();
    return `${info.kind}:${info.uid}:${info.dbName}`;
  };
  const valid = () => snapshot && dialog.open && scope === currentScope() && window.BowlingApp.ready;
  const canCopy = () => !!(navigator.clipboard?.write && window.ClipboardItem);
  const file = () => new File([blob], filename(snapshot, page), {type: 'image/png'});
  function canShare() {
    try { return !!(blob && navigator.share && navigator.canShare?.({files: [file()]})); }
    catch (_) { return false; }
  }
  function clearImage() {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = ''; blob = null;
    $('scoreCardImage').hidden = true;
    $('scoreCardImage').removeAttribute('src');
    $('saveScoreCard').hidden = true;
    $('saveScoreCard').removeAttribute('href');
    $('shareScoreCard').hidden = true;
    $('copyScoreCard').disabled = true;
  }
  function close() {
    generation++; snapshot = null; busy = false; clearImage();
    if (dialog.open) dialog.close();
  }
  function buttons() {
    $('copyScoreCard').disabled = busy || !blob || !canCopy();
    $('shareScoreCard').disabled = busy || !blob;
    $('scoreCardPrevious').disabled = busy || page === 0;
    $('scoreCardNext').disabled = busy || page >= pages(snapshot) - 1;
  }
  async function generate() {
    const token = ++generation;
    clearImage(); busy = true; buttons();
    $('scoreCardPages').hidden = pages(snapshot) < 2;
    $('scoreCardPageLabel').textContent = `Card ${page + 1} of ${pages(snapshot)}`;
    $('scoreCardStatus').textContent = 'Creating image…';
    try {
      const canvas = render(snapshot, document.createElement('canvas'), page);
      const result = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG unavailable')), 'image/png'));
      canvas.width = canvas.height = 0;
      if (token !== generation || !valid()) return;
      blob = result; objectUrl = URL.createObjectURL(blob);
      $('scoreCardImage').src = objectUrl;
      $('scoreCardImage').alt = describe(snapshot, page);
      $('scoreCardImage').hidden = false;
      $('saveScoreCard').href = objectUrl;
      $('saveScoreCard').download = filename(snapshot, page);
      $('saveScoreCard').hidden = false;
      $('shareScoreCard').hidden = !canShare();
      $('scoreCardStatus').textContent = canCopy() ? '' : 'Image copying isn’t available here. Save the image or use Share.';
    } catch (_) {
      if (token === generation && valid()) $('scoreCardStatus').textContent = 'Couldn’t create the image. Close this card and try again.';
    } finally {
      if (token === generation && valid()) { busy = false; buttons(); }
    }
  }
  function open(key = null) {
    const card = window.BowlingApp.getScoreCardData(key);
    if (!card) return;
    snapshot = card; scope = currentScope(); page = 0;
    $('scoreCardHeading').textContent = card.kind === 'session' ? 'Session score card' : 'Overall stats card';
    $('scoreCardScope').textContent = card.kind === 'session'
      ? 'Full session · includes all saved game scores.'
      : 'All time · standard games · includes every date, ball, and alley.';
    dialog.showModal();
    generate();
  }
  $('closeScoreCard').addEventListener('click', close);
  dialog.addEventListener('close', () => { if (!dialog.open) close(); });
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  $('shareOverallStats').addEventListener('click', () => open());
  $('sessionsList').addEventListener('click', event => {
    const button = event.target.closest('.share-session');
    if (button) open(button.dataset.key);
  });
  $('scoreCardPrevious').addEventListener('click', () => { if (!busy && valid() && page > 0) { page--; generate(); } });
  $('scoreCardNext').addEventListener('click', () => { if (!busy && valid() && page < pages(snapshot) - 1) { page++; generate(); } });
  $('saveScoreCard').addEventListener('click', event => {
    if (!valid() || !blob) { event.preventDefault(); close(); return; }
    $('scoreCardStatus').textContent = 'If the image opens in a new view, touch and hold it to save.';
  });
  $('copyScoreCard').addEventListener('click', async () => {
    if (busy || !valid() || !blob || !canCopy()) return;
    const token = generation;
    busy = true; buttons();
    try {
      // Invoke directly in the click handler: Safari requires user activation.
      await navigator.clipboard.write([new window.ClipboardItem({'image/png': blob})]);
      if (token === generation && valid()) $('scoreCardStatus').textContent = 'Image copied. Paste it into your chat.';
    } catch (_) {
      if (token === generation && valid()) $('scoreCardStatus').textContent = 'Copy was blocked. Try Save image or Share instead.';
    } finally { if (token === generation && valid()) { busy = false; buttons(); } }
  });
  $('shareScoreCard').addEventListener('click', async () => {
    if (busy || !valid() || !blob || !canShare()) return;
    const token = generation;
    busy = true; buttons();
    try {
      await navigator.share({files: [file()], title: snapshot.kind === 'session' ? 'My bowling session' : 'My bowling stats'});
      if (token === generation && valid()) $('scoreCardStatus').textContent = '';
    } catch (error) {
      if (token === generation && valid()) $('scoreCardStatus').textContent = error.name === 'AbortError' ? '' : 'Sharing isn’t available here. Try Save image or Copy image.';
    } finally { if (token === generation && valid()) { busy = false; buttons(); } }
  });
  function refresh() {
    const app = window.BowlingApp;
    $('shareOverallStats').disabled = !app?.ready || !app.getGames().some(game => game.noTap !== true);
    if (snapshot && !valid()) close();
  }
  for (const event of ['bowling:ready', 'bowling:rendered']) window.addEventListener(event, refresh);
  window.addEventListener('bowling:local-account-changed', () => { close(); refresh(); });
  refresh();
})();
