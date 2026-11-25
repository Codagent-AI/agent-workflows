(() => {
  const data = JSON.parse(document.querySelector('#page-data').textContent);
  const stored = JSON.parse(document.querySelector('#sent-answers').textContent);
  const panels = document.querySelector('main');
  const contents = document.querySelector('.rail');
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

  function story(text) {
    const paragraph = node('p', '', 'story');
    const codes = /\b(?:CHECK|DECIDE|JOURNEY|INTEG|E2E|HUMAN|ACCEPT|REVIEW|DISPUTE|AT|HT|INT|DP|D|I)-\d+\b|\bR\d+\b/g;
    let start = 0;
    for (const match of text.matchAll(codes)) {
      const ref = data.codes[match[0]];
      if (!ref) continue;
      paragraph.append(text.slice(start, match.index), link(`${match[0]} · ${ref.title}`, ref.href));
      start = match.index + match[0].length;
    }
    paragraph.append(text.slice(start));
    return paragraph;
  }

  function section(id, title) {
    const block = node('section');
    block.id = id;
    block.append(node('h2', title, 'section-head'));
    panels.append(block);
    contents.append(link(title, `#${id}`));
    return block;
  }

  function renderSummary() {
    const block = section('summary', 'Summary');
    block.append(story(data.summary));
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
    if (!data.size) { block.append(node('p', 'Change size unavailable.')); return; }
    const table = node('table', '', 'cloc');
    const header = table.createTHead().insertRow();
    for (const title of ['Language', 'Files', 'Added', 'Modified', 'Removed']) header.append(node('th', title));
    const keys = ['files', 'added', 'modified', 'removed'];
    const total = { language: 'Total' };
    for (const key of keys) total[key] = data.size.reduce((sum, row) => sum + row[key], 0);
    for (const values of [...data.size, total]) {
      const row = table.insertRow();
      row.append(node('th', values.language));
      for (const key of keys) row.insertCell().textContent = String(values[key]);
    }
    block.append(table);
  }

  function showShot(shot) {
    const dialog = node('dialog', '', 'confirm shot-dialog');
    const image = node('img');
    image.src = shot.href;
    image.alt = shot.alt;
    dialog.append(node('h3', shot.title), image, link('Open full size', shot.href));
    if ((!sent && data.wait) || comments.has(shot.file)) {
      const comment = node('textarea', '', 'note');
      comment.setAttribute('aria-label', 'Screenshot comment');
      comment.value = comments.get(shot.file) ?? '';
      comment.disabled = sent || sending;
      openComments.add(comment);
      dialog.addEventListener('close', () => openComments.delete(comment));
      comment.addEventListener('input', () => comments.set(shot.file, comment.value));
      dialog.append(comment);
    }
    const close = node('button', 'Close', 'merge');
    close.onclick = () => dialog.close();
    dialog.append(close);
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
  }

  function shotButton(shot, className) {
    const button = node('button', '', className);
    const image = node('img');
    image.src = shot.href;
    image.alt = shot.alt || shot.title;
    button.append(image);
    button.onclick = () => showShot(shot);
    return button;
  }

  function renderScreenshots() {
    if (data.keyEvidence.length) {
      const key = section('key-evidence', 'Key evidence');
      const list = node('div', '', 'key-shots');
      for (const shot of data.keyEvidence) {
        const figure = node('figure', '', 'shot');
        const caption = node('figcaption');
        caption.append(node('b', shot.title), story(shot.shows));
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
      const thumbs = node('div', '', 'thumbs');
      for (const shot of shots) {
        const button = shotButton(shot, 'thumb');
        button.append(node('span', shot.title));
        thumbs.append(button);
        if (sent && comments.has(shot.file)) thumbs.append(story(comments.get(shot.file)));
      }
      gallery.append(group, thumbs);
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
    const itemCode = item.source[0];
    const field = node('fieldset', '', 'q');
    const answer = stored?.answers?.find(value => value.item === itemCode && value.question === number);
    field.disabled = sent || !data.wait;
    field.append(node('legend', question.prompt));
    const other = node('textarea', '', 'note');
    other.placeholder = 'Your answer';
    other.setAttribute('aria-label', 'Other answer');
    other.value = answer?.other ?? '';
    const selected = stored ? answer?.option : tier === 'yellow' ? question.options[0].id : '';
    other.hidden = selected !== 'other';
    for (const [index, option] of [...question.options, { id: 'other', label: 'Other' }].entries()) {
      const label = node('label', '', 'opt');
      const radio = node('input');
      radio.type = 'radio';
      radio.name = `question-${rows.length}`;
      radio.value = option.id;
      radio.checked = selected === option.id;
      radio.addEventListener('change', () => { other.hidden = option.id !== 'other'; });
      label.append(radio, node('span', option.label, 'opt-label'));
      if (index === 0) label.append(node('span', 'Recommended', 'rec'));
      if (option.detail) label.append(node('span', option.detail, 'opt-desc'));
      field.append(label);
    }
    const note = node('textarea', '', 'note');
    note.placeholder = 'Optional note';
    note.setAttribute('aria-label', 'Optional note');
    note.value = answer?.note ?? '';
    field.append(other, note);
    rows.push({ field, item: itemCode, question: number, required: tier !== 'yellow', other, note });
    field.addEventListener('input', updateStatus);
    return field;
  }

  function renderItems(tier, title) {
    if (!data[tier].length) return;
    const block = section(tier, title);
    for (const [index, item] of data[tier].entries()) {
      const entry = node('article', '', `item ${tier}`);
      entry.id = `${tier}-${index + 1}`;
      entry.append(node('h3', item.type), story(item.title), story(item.detail));
      for (const code of item.source) {
        const ref = data.codes[code];
        if (ref && !item.title.includes(code)) entry.append(link(`${code} · ${ref.title}`, ref.href));
      }
      if (item.href) entry.append(link('Source', item.href));
      for (const journey of item.journeys ?? []) {
        entry.append(story(`${journey.code} · ${journey.title} (${journey.commit})`));
      }
      item.questions.forEach((question, number) => entry.append(questionField(item, question, number, tier)));
      block.append(entry);
      contents.append(link(item.title, `#${entry.id}`));
    }
  }

  function recordText(record) {
    return `${record.action === 'merge' ? 'Merge chosen' : 'Feedback sent'} at ${new Date(record.time).toLocaleString()}.`;
  }

  async function send(action) {
    if (sending || sent) return;
    const answer = { action, round: data.round, head: data.head };
    if (action === 'feedback') {
      answer.answers = rows.map(readRow).map(({ required, ...choice }) => choice);
      answer.screenshotComments = data.screenshots.filter(shot => comments.get(shot.file)?.trim())
        .map(shot => ({ file: shot.file, round: shot.round, comment: comments.get(shot.file) }));
    }
    sending = true;
    for (const row of rows) row.field.disabled = true;
    for (const comment of openComments) comment.disabled = true;
    for (const button of actions.querySelectorAll('button')) button.disabled = true;
    const result = await sendReview({ address: location.href, run: data.run, round: data.round, answer, fetch });
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
    dialog.append(cancel, confirm);
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove());
    dialog.showModal();
  }

  document.title = data.title;
  document.querySelector('h1').textContent = data.title;
  document.querySelector('#round').textContent = `Review round ${data.round} · ${data.head}`;
  document.querySelector('#state').textContent = data.state;
  renderSummary();
  renderScreenshots();
  renderItems('red', 'Red items');
  renderItems('orange', 'Orange items');
  renderItems('yellow', 'Yellow items');
  section('decisions', 'Decision log').append(story(data.decisions || 'No entries.'));
  section('disputes', 'Dispute log').append(story(data.disputes || 'No entries.'));
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
