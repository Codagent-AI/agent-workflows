(() => {
  const data = JSON.parse(document.querySelector('#page-data').textContent);
  const stored = JSON.parse(document.querySelector('#sent-answers').textContent);
  const panels = document.querySelector('main');
  const contents = document.querySelector('.rail > ol');
  const status = document.querySelector('#send-status');
  const actions = document.querySelector('#send-actions');
  const rows = [];
  const comments = new Map((stored?.screenshotComments ?? []).map(comment => [comment.file, comment.comment]));
  const commands = data.commands ?? [];
  const tierNames = { red: 'High', orange: 'Medium', yellow: 'Low' };
  for (const entry of stored?.commandComments ?? []) comments.set(entry.ref, entry.comment);
  const storedNote = (stored?.answers ?? []).find(entry => entry.item === 'note')?.note;
  if (storedNote) comments.set('#summary', storedNote);
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

  function githubLink(href) {
    if (!data.forgeBase) return false;
    try {
      const target = new URL(href);
      const base = new URL(data.forgeBase);
      if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname + '/')) return false;
      const path = target.pathname.slice(base.pathname.length);
      return path === '/pull/' + data.pullRequest || path.startsWith('/blob/' + data.head + '/') ||
        /^\/commit\/[a-f0-9]{7,64}$/i.test(path);
    } catch { return false; }
  }

  function inline(parent, text) {
    const tokens = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
    let start = 0;
    for (const match of text.matchAll(tokens)) {
      parent.append(text.slice(start, match.index));
      const [, code, bold, label, href] = match;
      if (code) parent.append(node('code', code));
      else if (bold) inline(parent.appendChild(node('strong')), bold);
      else parent.append(githubLink(href) ? link(label, href) : label);
      start = match.index + match[0].length;
    }
    parent.append(text.slice(start));
    return parent;
  }

  const story = text => inline(node('p', '', 'story'), text);

  const listLine = line => /^\s*[-*] /.test(line);
  function prose(text) {
    const block = node('div', '', 'prose');
    for (const paragraph of text.trim().split(/\n\s*\n/).filter(Boolean)) {
      const lines = paragraph.split('\n');
      const heading = /^#{1,6}\s+(.+)$/.exec(lines[0]);
      if (heading) block.append(inline(node('h3'), lines.shift().replace(/^#+\s+/, '')));
      const runs = [];
      for (const line of lines) {
        const last = runs.at(-1);
        if (last && listLine(last[0]) === listLine(line)) last.push(line);
        else runs.push([line]);
      }
      for (const lines of runs) {
        if (!listLine(lines[0])) { block.append(story(lines.join('\n'))); continue; }
        const list = node('ul');
        for (const line of lines) list.append(inline(node('li'), line.replace(/^\s*[-*] /, '')));
        block.append(list);
      }
    }
    return block;
  }

  function section(id, title, inContents = true) {
    const block = node('section');
    block.id = id;
    const heading = node('div', '', 'section-head');
    heading.append(node('h2', title));
    block.append(heading);
    panels.append(block);
    const sectionLink = node('li');
    if (inContents) {
      sectionLink.append(link(title, '#' + id));
      contents.append(sectionLink);
    }
    return { block, sectionLink };
  }

  function renderSummary() {
    const { block } = section('summary', 'Description');
    if (data.recap.length) {
      const recap = node('div', '', 'prose');
      const list = node('ul');
      for (const entry of data.recap) {
        const row = inline(node('li'), entry.note);
        if (entry.href) row.append(' ', link(entry.label, entry.href));
        list.append(row);
      }
      recap.append(node('h3', `Since round ${data.round - 1}`), list);
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
    const sorted = [...data.size].sort((a, b) => b.added - a.added || b.files - a.files);
    for (const values of [...sorted, total]) {
      const row = body.insertRow();
      if (values === total) row.className = 'total';
      row.append(node('td', values.language));
      for (const key of keys) row.append(node('td', String(values[key]), 'c'));
    }
    block.append(wrap);
    block.append(summaryComment());
  }

  function summaryComment() {
    const footer = node('div', '', 'summary-comment');
    const field = node('textarea', '', 'note');
    field.id = 'summary-comment';
    field.setAttribute('aria-label', 'Comment on the summary');
    field.placeholder = 'Comment on the summary, the change size, or anything without its own comment box';
    field.disabled = sent || sending || !data.wait;
    field.value = comments.get('#summary') ?? '';
    let editing = false;
    const edit = button('Comment on the summary', 'comment-btn', () => { editing = true; refresh(); field.focus(); });
    const refresh = () => {
      field.hidden = !field.value && !editing;
      edit.hidden = editing || Boolean(field.value) || !data.wait || sent;
    };
    openComments.add(field);
    field.addEventListener('input', () => { comments.set('#summary', field.value); });
    footer.append(edit, field);
    refresh();
    return footer;
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
    const stage = node('div', '', 'viewer-stage');
    const image = node('img');
    stage.append(image);
    // Fit sizes the screenshot to the stage's width; a taller one scrolls. Zoom scales the fit.
    let zoom = 1;
    const zoomLevel = node('span', '100%', 'viewer-zoom');
    const zoomOut = button('−', '', () => setZoom(zoom / 1.5));
    const zoomIn = button('+', '', () => setZoom(zoom * 1.5));
    const fit = button('Fit', '', () => setZoom(1));
    zoomOut.setAttribute('aria-label', 'Zoom out');
    zoomIn.setAttribute('aria-label', 'Zoom in');
    const zoomGroup = node('div', '', 'viewer-zoom-group');
    zoomGroup.append(zoomOut, zoomLevel, zoomIn, fit);
    bar.append(position, zoomGroup, previous, next, button('Close', '', () => dialog.close()));
    function fitWidth() {
      return Math.max(120, stage.clientWidth - 24);
    }
    function setZoom(value) {
      zoom = Math.min(8, Math.max(0.25, value));
      const width = Math.round(fitWidth() * zoom);
      image.style.width = `${width}px`;
      stage.classList.toggle('zoomed', width > stage.clientWidth - 24);
      zoomLevel.textContent = `${Math.round(zoom * 100)}%`;
    }
    image.addEventListener('load', () => setZoom(1));
    stage.addEventListener('wheel', event => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      setZoom(zoom * Math.exp(-event.deltaY * 0.01));
    }, { passive: false });
    const onResize = () => setZoom(zoom);
    window.addEventListener('resize', onResize);
    const info = node('div', '', 'viewer-info');
    const title = node('h3');
    const detail = node('div');
    const comment = node('textarea', '', 'note');
    comment.setAttribute('aria-label', 'Screenshot comment');
    comment.disabled = sent || sending;
    openComments.add(comment);
    info.append(title, detail, comment);
    function refresh() {
      const current = shots[index];
      zoom = 1;
      image.src = current.href;
      stage.scrollLeft = 0;
      stage.scrollTop = 0;
      image.alt = current.alt;
      title.textContent = current.title;
      detail.replaceChildren(story(current.shows));
      position.textContent = `Acceptance round ${current.round + 1} · ${index + 1} of ${shots.length}`;
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
    dialog.addEventListener('close', () => { window.removeEventListener('resize', onResize); openComments.delete(comment); dialog.remove(); });
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
    // A tall full-page capture shows its top at full width instead of shrinking to a sliver.
    image.addEventListener('load', () => control.classList.toggle('tall', image.naturalHeight > image.naturalWidth * 3));
    control.append(image);
    return control;
  }

  function primaryShot(shot) {
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
    return figure;
  }

  function commandComment(entry, card) {
    const footer = node('div', '', 'cmd-foot');
    const field = node('textarea', '', 'note');
    let editing = false;
    const edit = button('Comment', 'comment-btn', () => {
      editing = true;
      refresh();
      field.focus();
    });
    field.setAttribute('aria-label', 'Command evidence comment');
    field.placeholder = 'Comment on command evidence';
    field.disabled = sent || sending || !data.wait;
    const refresh = () => {
      const current = comments.get(entry.file) ?? '';
      if (field.value !== current) field.value = current;
      field.hidden = !current && !editing;
      edit.hidden = editing || !data.wait || sent;
      footer.hidden = field.hidden && (!card.classList.contains('cmd-row') || edit.hidden);
      card.classList.toggle('has-comment', Boolean(current.trim()));
    };
    if (!commentMarks.has(entry.file)) commentMarks.set(entry.file, []);
    commentMarks.get(entry.file).push(refresh);
    openComments.add(field);
    field.addEventListener('input', () => {
      comments.set(entry.file, field.value);
      for (const update of commentMarks.get(entry.file)) update();
    });
    footer.append(field);
    refresh();
    return { footer, edit };
  }

  function commandEvidence(entry, collapsible = false) {
    const card = node(collapsible ? 'details' : 'figure', '', collapsible ? 'cmd-row' : 'cmd');
    const header = node(collapsible ? 'summary' : 'figcaption', '', collapsible ? '' : 'cmd-head');
    const cap = node(collapsible ? 'span' : 'div', '', 'cap');
    if (!collapsible) cap.append(node('span', `Round ${entry.round + 1}${revisionLabel([entry])}`, 'cmd-meta'));
    cap.append(node('b', entry.title), inline(node(collapsible ? 'span' : 'p'), entry.shows));
    const { footer, edit } = commandComment(entry, card);
    header.append(cap);
    if (collapsible) footer.prepend(edit);
    else header.append(edit);
    const command = node('div', '', 'cmd-line');
    command.append(node('span', '$', 'prompt'), node('code', entry.command));
    card.append(header, command, node('pre', entry.excerpt, 'excerpt'), footer);
    return card;
  }

  function thumbnails(shots) {
    const list = node('ul', '', 'thumbs');
    for (const shot of shots) {
      const thumb = shotButton(shot, 'thumb');
      const mark = node('span', 'Commented', 'thumb-mark');
      markComment(shot, mark);
      thumb.append(node('span', shot.title, 'thumb-label'), mark);
      const entry = node('li');
      entry.append(thumb);
      list.append(entry);
    }
    return list;
  }

  function revisionLabel(entries) {
    const revisions = [...new Set(entries.map(entry => entry.revision?.slice(0, 8)).filter(Boolean))];
    return revisions.length ? ` · ${revisions.join(', ')}` : '';
  }

  function evidenceRound(round) {
    const shots = data.screenshots.filter(shot => shot.round === round);
    const entries = commands.filter(entry => entry.round === round);
    const group = node('div', '', 'round');
    group.append(node('h4', `Acceptance round ${round + 1}${revisionLabel([...entries, ...shots])}`));
    const recap = data.acceptanceRecaps?.[round];
    if (recap) group.append(story(recap));
    if (entries.length) {
      const list = node('ul', '', 'cmds');
      for (const entry of entries) {
        const row = node('li');
        row.append(commandEvidence(entry, true));
        list.append(row);
      }
      group.append(node('h5', `Commands (${entries.length})`), list);
    }
    if (shots.length) group.append(node('h5', `Screenshots (${shots.length})`), thumbnails(shots));
    return group;
  }

  function renderEvidence() {
    let key;
    if (data.keyEvidence.length) {
      key = section('key-evidence', 'Key evidence').block;
      const list = node('div', '', 'key-shots');
      for (const entry of data.keyEvidence) list.append(entry.kind === 'command' ? commandEvidence(entry) : primaryShot(entry));
      key.append(list);
    }
    const rounds = [...new Set([...data.screenshots, ...commands].map(entry => entry.round))].sort((a, b) => b - a);
    if (!rounds.length) return;
    const gallery = node('div', '', 'all-shots');
    gallery.id = 'acceptance-evidence';
    const shotCount = data.screenshots.length;
    const title = `All acceptance evidence (${shotCount} screenshot${shotCount === 1 ? '' : 's'}, ${commands.length} command${commands.length === 1 ? '' : 's'})`;
    gallery.append(node(key ? 'h3' : 'h2', title));
    for (const round of rounds) gallery.append(evidenceRound(round));
    (key ?? panels).append(gallery);
  }

  function readRow(row) {
    return { item: row.item, question: row.question, required: row.required, options: row.options,
      option: row.field.querySelector('input:checked')?.value ?? '', other: row.other.value, note: row.note.value };
  }

  // Send feedback stays clickable. A click with questions unanswered marks each one and names its concern.
  let checked = false;
  function pendingRows() {
    return rows.filter(row => missingAnswers([readRow(row)]) > 0);
  }

  function updateStatus() {
    if (!feedback || sent || sending) return;
    const pending = pendingRows();
    for (const row of rows) {
      const missing = checked && pending.includes(row);
      const other = readRow(row).option === 'other';
      row.field.classList.toggle('missing', missing);
      row.other.classList.toggle('missing', missing && other);
      row.hint.hidden = !missing;
      row.hint.textContent = other ? 'Write your answer, or choose another option.' : 'Choose an answer.';
    }
    status.classList.toggle('error', checked && pending.length > 0);
    status.textContent = '';
    if (!pending.length) return;
    if (!checked) {
      const counts = tierCounts(tier => new Set(pending.filter(row => row.tier === tier).map(row => row.concern)).size);
      status.textContent = `Unanswered questions in ${counts}.`;
      return;
    }
    const concerns = [...new Map(pending.map(row => [row.concern, row.position])).entries()];
    status.append(`Answer the ${pending.length === 1 ? 'question' : 'questions'} in ${concerns.length === 1 ? 'concern' : 'concerns'} `);
    concerns.forEach(([id, position], index) => {
      if (index) status.append(index === concerns.length - 1 ? ' and ' : ', ');
      status.append(link(position, '#' + id));
    });
    status.append(' before sending.');
  }

  function sendFeedback() {
    checked = true;
    updateStatus();
    const first = pendingRows()[0];
    if (!first) { void send('feedback'); return; }
    first.field.scrollIntoView({ behavior: 'smooth', block: 'center' });
    (first.field.querySelector('input:checked') ?? first.field.querySelector('input'))?.focus({ preventScroll: true });
  }

  function questionField(item, question, number, tier, concern, position) {
    const owned = new Set(item.questions.map(entry => entry.source).filter(Boolean));
    const itemCode = question.source ?? item.source.find(source => !owned.has(source) && !item.unlinkedSources?.includes(source)) ?? item.source[0];
    const field = node('fieldset', '', 'q');
    const answer = stored?.answers?.find(value => value.item === itemCode && value.question === number);
    field.disabled = sent || !data.wait;
    const legend = node('legend');
    const eyebrow = node('span', item.questions.length > 1 ? `Question ${number + 1} of ${item.questions.length}` : 'Question', 'q-eyebrow');
    if (tier !== 'yellow') eyebrow.append(node('span', 'Answer required', 'req'));
    legend.append(eyebrow);
    inline(legend, question.prompt);
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
    const hint = node('p', '', 'q-missing');
    hint.hidden = true;
    field.append(other, hint, note);
    rows.push({ field, concern, position, item: itemCode, question: number, required: tier !== 'yellow', tier, other, note, hint, options: question.options });
    field.addEventListener('input', updateStatus);
    return field;
  }

  function tierCounts(count) {
    return Object.entries(tierNames).flatMap(([tier, name]) => {
      const total = count(tier);
      return total ? [`${total} ${name.toLowerCase()} ${total === 1 ? 'concern' : 'concerns'}`] : [];
    }).join(', ');
  }

  function concern(item, tier, number, id) {
    const entry = node('article', '', 'item');
    entry.id = id;
    const body = node('div', '', 'item-body');
    const tags = node('div', '', 'tags');
    tags.append(node('span', tierNames[tier], 'tier ' + tier));
    for (const kind of item.type.split(',')) tags.append(node('span', kind.trim(), 'kind'));
    body.append(tags, inline(node('h3'), item.title));
    if (item.failLine) body.append(node('p', item.failLine, 'fail-line'));
    body.append(prose(item.detail));
    if (item.evidence) body.append(commandEvidence(item.evidence));
    const ask = node('div', '', 'ask');
    item.questions.forEach((question, offset) => ask.append(questionField(item, question, offset, tier, id, number)));
    body.append(ask);
    if (item.links?.length) {
      const links = node('div', '', 'links');
      links.append(node('span', 'On GitHub', 'links-label'));
      for (const source of item.links) links.append(link(source.label, source.href));
      body.append(links);
    }
    entry.append(node('div', number, 'n'), body);
    return entry;
  }

  function renderConcerns() {
    const { block, sectionLink } = section('concerns', 'Concerns');
    const tiers = node('ul', '', 'tiers');
    sectionLink.append(tiers);
    let total = 0;
    for (const [tier, name] of Object.entries(tierNames)) {
      if (!data[tier].length) continue;
      const group = node('div', '', 'tier-group');
      group.id = tier;
      const title = `${name} (${data[tier].length})`;
      const heading = node('h3', '', 'tier-head');
      heading.append(node('span', '', 'dot ' + tier), name, node('span', `(${data[tier].length})`, 'c'));
      group.append(heading);
      const items = node('div', '', tier === 'red' ? 'items' : 'items compact');
      const nested = node('ul');
      const tierEntry = node('li');
      tierEntry.append(link(title, '#' + tier), nested);
      tiers.append(tierEntry);
      for (const [index, item] of data[tier].entries()) {
        const number = String(++total);
        const id = `${tier}-${index + 1}`;
        items.append(concern(item, tier, number, id));
        const toItem = link('', '#' + id);
        toItem.append(node('span', '', 'dot ' + tier), node('span', number, 'n'), inline(node('span'), item.title));
        const itemLink = node('li');
        itemLink.append(toItem);
        nested.append(itemLink);
      }
      group.append(items);
      block.append(group);
    }
    if (!total) block.append(node('p', 'No concerns.', 'empty'));
  }

  function recordText(record) {
    return `${record.action === 'merge' ? 'Merge chosen' : 'Feedback sent'} at ${new Date(record.time).toLocaleString()}.`;
  }

  async function send(action) {
    if (sending || sent) return;
    const answer = collectReview({ action, round: data.round, head: data.head, rows: rows.map(readRow), screenshots: data.screenshots, commands, comments, note: comments.get('#summary') ?? '' });
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
    const counts = tierCounts(tier => tier === 'yellow' ? 0 : data[tier].length);
    if (!counts) { void send('merge'); return; }
    const dialog = node('dialog', '', 'confirm');
    dialog.append(node('h3', 'Merge pull request?'), node('p', `Open concerns: ${counts}. Answers on this page will not be sent.`));
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

  function renderHeader() {
    document.title = data.title;
    document.querySelector('h1').textContent = data.title;
    document.querySelector('#round').append(node('span', 'Review round ' + data.round), node('span', data.repository));
    const meta = document.querySelector('.masthead .meta');
    const entries = [
      ['Pull request', link('#' + data.pullRequest, data.pullRequestUrl)],
      ['Reviewed head', data.head], ['Run', data.run],
    ];
    const logs = Object.entries(data.logs ?? {}).filter(([, href]) => href);
    if (logs.length) entries.push(['Logs', ...logs.flatMap(([kind, href], index) =>
      [...(index ? [' · '] : []), link(kind === 'decisions' ? 'Decisions' : 'Disputes', href)])]);
    for (const [label, ...values] of entries) {
      if (!values[0]) continue;
      const field = node('div');
      const value = node('dd');
      value.append(...values);
      field.append(node('dt', label), value);
      meta.append(field);
    }
    const tiers = Object.keys(tierNames);
    const total = tiers.reduce((sum, tier) => sum + data[tier].length, 0);
    const highest = tiers.find(tier => data[tier].length) ?? '';
    const count = link('', '#concerns');
    count.className = ('concerns-total ' + highest).trim();
    count.append(node('b', String(total)), total === 1 ? ' concern' : ' concerns');
    document.querySelector('.meta-row').append(count);
  }

  renderHeader();
  if (stored) document.body.classList.add('answered');
  renderSummary();
  renderEvidence();
  renderConcerns();
  let mergeButton;
  if (stored) {
    status.textContent = recordText(stored);
    if (stored.note) status.append(story(stored.note));
  } else if (data.wait) {
    feedback = node('button', 'Send feedback', 'send');
    feedback.onclick = sendFeedback;
    actions.append(feedback);
    if (data.merge) {
      mergeButton = node('button', 'Merge', 'merge');
      mergeButton.onclick = confirmMerge;
      actions.append(mergeButton);
    }
    updateStatus();
  }
})();
