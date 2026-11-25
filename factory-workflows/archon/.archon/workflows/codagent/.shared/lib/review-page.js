(() => {
  const data = JSON.parse(document.querySelector('#page-data').textContent);
  const stored = JSON.parse(document.querySelector('#sent-answers').textContent);
  const panels = document.querySelector('main');
  const contents = document.querySelector('.rail > ol');
  const status = document.querySelector('#send-status');
  const actions = document.querySelector('#send-actions');
  const rows = [];
  const comments = new Map((stored?.screenshotComments ?? []).map(comment => [comment.file, comment.comment]));
  let sending = false;
  const openComments = new Set();
  let sent = Boolean(stored);
  let feedback;

  function node(tag, text = '', className = '') {
    const element = document.createElement(tag);
    element.textContent = text;
    element.className = className;
    return element;
  }

  function link(text, href) {
    const anchor = node('a', text);
    if (href) {
      try {
        const target = new URL(href, location.href);
        if (['https:', 'http:', 'file:'].includes(target.protocol)) anchor.href = href;
      } catch { /* An unusable source has no navigation target. */ }
    }
    return anchor;
  }

  function inline(parent, text, codes = data.codes) {
    const tokens = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)|\b((?:CHECK|DECIDE|JOURNEY|INTEG|E2E|HUMAN|ACCEPT|REVIEW|DISPUTE|AT|HT|INT|DP|D|I)-\d+|R\d+)\b/g;
    let start = 0;
    for (const match of text.matchAll(tokens)) {
      parent.append(text.slice(start, match.index));
      const [, code, bold, label, href, id] = match;
      const ref = Object.hasOwn(codes, id ?? code) ? codes[id ?? code] : undefined;
      if (ref) parent.append(link(`${id ?? code} · ${ref.title}`, ref.href));
      else if (code) parent.append(node('code', code));
      else if (bold) inline(parent.appendChild(node('strong')), bold);
      else if (label) parent.append(link(label, href));
      else parent.append(match[0]);
      start = match.index + match[0].length;
    }
    parent.append(text.slice(start));
    return parent;
  }

  const story = text => inline(node('p', '', 'story'), text);

  function prose(text) {
    const block = node('div', '', 'prose');
    for (const paragraph of text.trim().split(/\n\s*\n/).filter(Boolean)) {
      const lines = paragraph.split('\n');
      const heading = /^#{1,6}\s+(.+)$/.exec(lines[0]);
      if (heading) {
        block.append(inline(node('h3'), heading[1]));
        if (lines.length > 1) block.append(story(lines.slice(1).join('\n')));
      } else if (lines.every(line => /^\s*[-*] /.test(line))) {
        const list = node('ul');
        for (const line of lines) list.append(inline(node('li'), line.replace(/^\s*[-*] /, '')));
        block.append(list);
      } else block.append(story(paragraph));
    }
    return block;
  }

  const toc = new Map();
  function section(id, title) {
    const block = node('section');
    block.id = id;
    const heading = node('div', '', 'section-head');
    heading.append(node('h2', title));
    block.append(heading);
    panels.append(block);
    const sectionLink = node('li');
    sectionLink.append(link(title, `#${id}`));
    contents.append(sectionLink);
    toc.set(id, sectionLink);
    return block;
  }

  function renderSummary() {
    const block = section('summary', 'Summary');
    if (data.recap.length) {
      const recap = node('ul');
      for (const entry of data.recap) {
        const row = node('li');
        row.append(story(entry.note));
        if (entry.href) row.append(link(entry.label, entry.href));
        recap.append(row);
      }
      block.append(recap);
    }
    block.append(prose(data.summary));
    if (!data.size) { block.append(node('p', 'Change size unavailable.')); return; }
    const table = node('table');
    const wrap = node('div', '', 'table-wrap size');
    wrap.append(table);
    const header = table.createTHead().insertRow();
    for (const title of ['Language', 'Files', 'Added', 'Modified', 'Removed']) header.append(node('th', title, title === 'Language' ? '' : 'c'));
    const keys = ['files', 'added', 'modified', 'removed'];
    const total = { language: 'Total', ...sizeTotals(data.size) };
    const body = table.createTBody();
    for (const values of [...data.size, total]) {
      const row = body.insertRow();
      if (values === total) row.className = 'total';
      row.append(node('td', values.language));
      for (const key of keys) row.append(node('td', String(values[key]), 'c'));
    }
    block.append(wrap);
  }

  const commentMarks = new Map();
  function markComment(shot, mark) {
    const update = () => {
      const value = comments.get(shot.file)?.trim();
      mark.hidden = !value;
      if (mark.dataset.showText) mark.textContent = value || '';
    };
    if (!commentMarks.has(shot.file)) commentMarks.set(shot.file, []);
    commentMarks.get(shot.file).push(update);
    update();
  }

  function button(label, className, action) {
    const control = node('button', label, className);
    control.type = 'button';
    control.onclick = action;
    return control;
  }

  function showShot(shot, focusComment = false) {
    const shots = data.screenshots;
    let index = shots.findIndex(candidate => candidate.file === shot.file);
    if (index < 0) return;
    const dialog = node('dialog', '', 'viewer');
    const bar = node('div', '', 'viewer-bar');
    const position = node('p', '', 'viewer-pos');
    const previous = button('Previous', '', () => { index -= 1; refresh(); });
    const next = button('Next', '', () => { index += 1; refresh(); });
    bar.append(position, previous, next, button('Close', '', () => dialog.close()));
    const stage = node('div', '', 'viewer-stage');
    const image = node('img');
    stage.append(image);
    const info = node('div', '', 'viewer-info');
    const title = node('h3');
    const detail = node('div');
    const fullSize = link('Open full size', shot.href);
    const comment = node('textarea', '', 'note');
    comment.setAttribute('aria-label', 'Screenshot comment');
    comment.disabled = sent || sending;
    openComments.add(comment);
    info.append(title, detail, fullSize, comment);
    function refresh() {
      const current = shots[index];
      image.src = current.href;
      image.alt = current.alt;
      fullSize.href = current.href;
      title.textContent = current.title;
      detail.replaceChildren(story(current.shows));
      position.textContent = `Acceptance round ${current.round} · ${index + 1} of ${shots.length}`;
      previous.disabled = index === 0;
      next.disabled = index === shots.length - 1;
      comment.value = comments.get(current.file) ?? '';
      comment.hidden = !(data.wait && !sent) && !comment.value;
    }
    comment.addEventListener('input', () => {
      const current = shots[index];
      comments.set(current.file, comment.value);
      for (const update of commentMarks.get(current.file) ?? []) update();
    });
    dialog.append(bar, stage, info);
    dialog.addEventListener('close', () => { openComments.delete(comment); dialog.remove(); });
    document.body.append(dialog);
    refresh();
    dialog.showModal();
    if (focusComment) comment.focus();
  }

  function shotButton(shot, className) {
    const control = button('', className, () => showShot(shot));
    const image = node('img');
    image.src = shot.href;
    image.alt = shot.alt || shot.title;
    control.setAttribute('aria-label', `Enlarge ${shot.title}`);
    control.append(image);
    return control;
  }

  function renderScreenshots() {
    if (data.keyEvidence.length) {
      const key = section('key-evidence', 'Key evidence');
      const list = node('div', '', 'key-shots');
      for (const shot of data.keyEvidence) {
        const figure = node('figure', '', 'shot');
        const caption = node('figcaption');
        const cap = node('div', '', 'cap');
        cap.append(node('b', shot.title), story(shot.shows));
        caption.append(cap);
        if (data.wait && !sent) caption.append(button('Comment', 'comment-btn', () => showShot(shot, true)));
        const note = node('p', '', 'shot-note');
        note.dataset.showText = 'true';
        markComment(shot, note);
        caption.append(note);
        figure.append(shotButton(shot, 'shot-open'), caption);
        list.append(figure);
      }
      key.append(list);
    }
    if (!data.screenshots.length) return;
    const gallery = section('screenshots', 'Acceptance screenshots');
    const groups = Map.groupBy(data.screenshots, shot => shot.round);
    for (const [round, shots] of groups) {
      const group = node('div', '', 'round');
      group.append(node('h4', `Acceptance round ${round}`));
      const thumbs = node('ul', '', 'thumbs');
      for (const shot of shots) {
        const thumb = shotButton(shot, 'thumb');
        const mark = node('span', 'Commented', 'thumb-mark');
        markComment(shot, mark);
        thumb.append(node('span', shot.title, 'thumb-label'), mark);
        const entry = node('li');
        entry.append(thumb);
        thumbs.append(entry);
      }
      group.append(thumbs);
      gallery.append(group);
    }
  }

  function readRow(row) {
    return { item: row.item, question: row.question, required: row.required,
      option: row.field.querySelector('input:checked')?.value ?? '', other: row.other.value, note: row.note.value };
  }

  function updateStatus() {
    if (!feedback || sent || sending) return;
    const missing = missingAnswers(rows.map(readRow));
    feedback.disabled = missing > 0;
    status.textContent = missing ? `${missing} unanswered ${missing === 1 ? 'question' : 'questions'} left.` : '';
  }

  function questionField(item, question, number, tier) {
    const itemCode = question.source ?? item.source[0];
    const field = node('fieldset', '', 'q');
    const answer = stored?.answers?.find(value => value.item === itemCode && value.question === number);
    field.disabled = sent || !data.wait;
    const legend = node('legend');
    const eyebrow = node('span', item.questions.length > 1 ? `Question ${number + 1} of ${item.questions.length}` : 'Question', 'q-eyebrow');
    if (tier !== 'yellow') eyebrow.append(node('span', 'Answer required', 'req'));
    legend.append(eyebrow);
    inline(legend, question.source ? `${question.source} · ${question.prompt}` : question.prompt);
    field.append(legend);
    const opts = node('div', '', 'opts');
    const other = node('textarea', '', 'note');
    other.placeholder = 'Your answer';
    other.setAttribute('aria-label', 'Other answer');
    other.value = answer?.other ?? '';
    const selected = initialChoice(tier, question.options[0].id, Boolean(stored), answer?.option);
    other.hidden = selected !== 'other';
    for (const [index, option] of [...question.options, { id: 'other', label: 'Other' }].entries()) {
      const label = node('label', '', 'opt');
      const radio = node('input');
      radio.type = 'radio';
      radio.name = `question-${rows.length}`;
      radio.value = option.id;
      radio.checked = selected === option.id;
      radio.addEventListener('change', () => { other.hidden = option.id !== 'other'; });
      const text = node('span', '', 'opt-text');
      const optionLabel = inline(node('span', '', 'opt-label'), option.label);
      if (index === 0) optionLabel.append(node('span', 'Recommended', 'rec'));
      text.append(optionLabel);
      if (option.detail) text.append(inline(node('span', '', 'opt-desc'), option.detail));
      label.append(radio, text);
      opts.append(label);
    }
    field.append(opts);
    const note = node('textarea', '', 'note');
    note.placeholder = 'Optional note';
    note.setAttribute('aria-label', 'Optional note');
    note.value = answer?.note ?? '';
    field.append(other, note);
    rows.push({ field, item: itemCode, question: number, required: tier !== 'yellow', other, note });
    field.addEventListener('input', updateStatus);
    return field;
  }

  let itemNumber = 0;
  function renderItems(tier, title) {
    if (!data[tier].length) return;
    const block = section(tier, title);
    const items = node('div', '', tier === 'red' ? 'items' : 'items compact');
    const nested = node('ul');
    toc.get(tier).append(nested);
    for (const [index, item] of data[tier].entries()) {
      const entry = node('article', '', 'item');
      entry.id = `${tier}-${index + 1}`;
      const number = String(++itemNumber);
      const body = node('div', '', 'item-body');
      const tierName = tier[0].toUpperCase() + tier.slice(1);
      const tags = node('div', '', 'tags');
      tags.append(node('span', tierName, `tier ${tier}`));
      for (const kind of item.type.split(',')) tags.append(node('span', kind.trim(), 'kind'));
      body.append(tags, inline(node('h3'), item.title), prose(item.detail));
      const sources = node('div', '', 'src');
      for (const code of item.source) {
        const ref = data.codes[code];
        if (ref && !item.title.includes(code)) sources.append(link(`${code} · ${ref.title}`, ref.href));
      }
      if (item.href) sources.append(link('Source', item.href));
      body.append(sources);
      for (const journey of item.journeys ?? []) body.append(story(`${journey.code} (${journey.commit})`));
      const ask = node('div', '', 'ask');
      item.questions.forEach((question, offset) => ask.append(questionField(item, question, offset, tier)));
      body.append(ask);
      entry.append(node('div', number, 'n'), body);
      items.append(entry);
      const toItem = link('', `#${entry.id}`);
      toItem.append(node('span', '', `dot ${tier}`), node('span', number, 'n'), node('span', data.codes[item.title]?.title ?? item.title));
      const itemLink = node('li');
      itemLink.append(toItem);
      nested.append(itemLink);
    }
    block.append(items);
  }

  function renderLog(id, title, text) {
    const block = section(id, title);
    for (const part of text.trim().split(/(?=^## )/m).filter(Boolean)) {
      const [first, ...lines] = part.split('\n');
      const heading = /^## (?:(\S+): )?(.+)$/.exec(first);
      if (!heading) { block.append(prose(part)); continue; }
      const article = node('article', '', 'decision');
      const header = node('header');
      const ref = data.codes[heading[1]];
      const caption = node('span', '', 'did');
      if (ref) caption.append(link(heading[1], ref.href));
      else caption.textContent = heading[1] ?? '';
      header.append(caption, inline(node('h3'), heading[2]));
      article.append(header);
      const fields = node('dl', '', 'fields');
      const free = [];
      for (const line of lines) {
        const field = /^(?:- )?(?:\*\*)?([^:*]+):(?:\*\*)? (.+)$/.exec(line);
        if (field) fields.append(node('dt', field[1]), inline(node('dd'), field[2]));
        else if (line.trim()) free.push(line);
      }
      if (fields.children.length) article.append(fields);
      if (free.length) article.append(prose(free.join('\n')));
      block.append(article);
    }
  }

  function recordText(record) {
    return `${record.action === 'merge' ? 'Merge chosen' : 'Feedback sent'} at ${new Date(record.time).toLocaleString()}.`;
  }

  async function send(action) {
    if (sending || sent) return;
    const answer = collectReview({ action, round: data.round, head: data.head, rows: rows.map(readRow), screenshots: data.screenshots, comments });
    sending = true;
    for (const row of rows) row.field.disabled = true;
    for (const comment of openComments) comment.disabled = true;
    for (const button of actions.querySelectorAll('button')) button.disabled = true;
    const result = await sendReview({ address: location.href, run: data.run, round: data.round, answer, fetch: (url, options) => window.fetch(url, options) });
    sending = false;
    if (result.kind === 'sent') {
      sent = true;
      status.textContent = `${recordText({ ...answer, time: Date.now() })} ${result.message}`;
      if (action === 'merge') status.textContent += ' Page answers were not sent.';
      return;
    }
    for (const row of rows) row.field.disabled = false;
    for (const comment of openComments) comment.disabled = false;
    updateStatus();
    if (mergeButton) mergeButton.disabled = false;
    status.textContent = result.kind === 'stale' ? 'The run is not waiting for this page.' : 'Cannot send from here.';
    if (result.kind === 'copy') {
      const copy = node('textarea', '', 'note');
      copy.readOnly = true;
      copy.setAttribute('aria-label', 'Copy answer and Archon command');
      copy.value = `${result.text}\n\n${result.command}`;
      status.append(copy);
    }
  }

  function confirmMerge() {
    const count = data.red.length + data.orange.length;
    if (!count) { void send('merge'); return; }
    const dialog = node('dialog', '', 'confirm');
    dialog.append(node('h3', 'Merge pull request?'), node('p', `${count} red or orange ${count === 1 ? 'item is' : 'items are'} open. Answers on this page will not be sent.`));
    const cancel = node('button', 'Cancel', 'merge');
    const confirm = node('button', 'Merge', 'send');
    cancel.onclick = () => dialog.close();
    confirm.onclick = () => { dialog.close(); void send('merge'); };
    const controls = node('div', '', 'confirm-actions');
    controls.append(cancel, confirm);
    dialog.append(controls);
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove());
    dialog.showModal();
  }

  document.title = data.title;
  document.querySelector('h1').textContent = data.title;
  document.querySelector('#round').append(node('span', `Review round ${data.round}`), node('span', data.repository));
  const meta = document.querySelector('.masthead .meta');
  for (const [label, value] of [['Pull request', `#${data.pullRequest}`], ['Reviewed head', data.head], ['Run', data.run]]) {
    if (!value) continue;
    const field = node('div');
    field.append(node('dt', label), node('dd', value));
    meta.append(field);
  }
  if (stored) document.body.classList.add('answered');
  document.querySelector('#state').textContent = data.state;
  renderSummary();
  renderScreenshots();
  renderItems('red', 'Red items');
  renderItems('orange', 'Orange items');
  renderItems('yellow', 'Yellow items');
  renderLog('decisions', 'Decision log', data.decisions || 'No entries.');
  renderLog('disputes', 'Dispute log', data.disputes || 'No entries.');
  let mergeButton;
  if (stored) {
    status.textContent = recordText(stored);
    if (stored.note) status.append(story(stored.note));
  } else if (data.wait) {
    feedback = node('button', 'Send feedback', 'send');
    feedback.onclick = () => { void send('feedback'); };
    actions.append(feedback);
    if (data.merge) {
      mergeButton = node('button', 'Merge', 'merge');
      mergeButton.onclick = confirmMerge;
      actions.append(mergeButton);
    }
    updateStatus();
  }
})();
