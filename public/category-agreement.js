function interpolateAgreementText(templateBody, vars) {
  if (!templateBody) return '';
  let text = String(templateBody);
  if (text.includes('\\n') && !text.includes('\n')) {
    text = text.replace(/\\n/g, '\n');
  }
  const today = vars.date || new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  return text
    .replace(/\{\{\s*client_name\s*\}\}/gi, vars.client_name || '')
    .replace(/\{\{\s*file_id\s*\}\}/gi, vars.file_id ? String(vars.file_id) : '')
    .replace(/\{\{\s*old_category\s*\}\}/gi, vars.old_category || 'Current Service')
    .replace(/\{\{\s*new_category\s*\}\}/gi, vars.new_category || '')
    .replace(/\{\{\s*target_category\s*\}\}/gi, vars.new_category || '')
    .replace(/\{\{\s*new_version\s*\}\}/gi, vars.new_version ? String(vars.new_version) : '1')
    .replace(/\{\{\s*date\s*\}\}/gi, today)
    .replace(/\{\{\s*portal_url\s*\}\}/gi, vars.portal_url || location.origin);
}

function defaultAgreementText(file, targetCategoryName, targetVersion) {
  return 'richtext:v1:<h3>1. Scope of Service Modification</h3><p>This Service Change Agreement &amp; Addendum (&quot;Addendum&quot;) modifies the scope of services previously agreed upon between the Client and Operations. Both parties agree that the client\'s file will be transitioned to the Proposed New Category indicated above.</p><h3>2. Modification of Requirements &amp; Document Checklist</h3><p>Upon execution of this Addendum by the Client:</p><ol><li>The existing document checklist will be archived and retained in the file history.</li><li>A revised document and information checklist for <strong>' + esc(targetCategoryName) + ' (v' + esc(targetVersion) + ')</strong> will take effect immediately.</li><li>Any previously approved items incompatible with the new category will be superseded.</li><li>File progression, reviews, and document collection are temporarily held until this Addendum is executed or cancelled by Operations.</li></ol><h3>3. Client Authorization &amp; Consent</h3><p>By signing below, the Client confirms that they have reviewed and agreed to the terms of this service transition, and authorize Operations to update the service checklist and requirements for this file.</p><p><em>All other terms, conditions, and obligations of the initial service engagement remain in full force and effect.</em></p>';
}

function formatA4DocumentHtml(title, rawBody, meta = {}, options = {}) {
  const mode = options.mode || 'preview';
  const docTitle = (title || 'Service Change Agreement & Addendum').trim();
  const docRef = meta.ref_code || (meta.file_id ? `AGR-${meta.file_id}-REV` : 'AGR-DOC-101');
  const docDate = meta.date || new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // 1. Process body into sanitized HTML with placeholders interpolated
  let contentHtml = '';
  const rawString = String(rawBody || '');
  if (rawString.startsWith('richtext:v1:')) {
    contentHtml = globalThis.OperationsRichText ? OperationsRichText.sanitize(rawString.slice(12)) : esc(rawString.slice(12));
  } else if (/<[a-z][\s\S]*>/i.test(rawString)) {
    contentHtml = globalThis.OperationsRichText ? OperationsRichText.sanitize(rawString) : rawString;
  } else {
    let normalized = rawString;
    if (normalized.includes('\\n') && !normalized.includes('\n')) {
      normalized = normalized.replace(/\\n/g, '\n');
    }
    contentHtml = guideMarkup(normalized);
  }

  contentHtml = interpolateAgreementText(contentHtml, meta);

  // 2. Parse into top-level DOM block elements
  const container = document.createElement('div');
  container.innerHTML = contentHtml;
  let childNodes = Array.from(container.children);
  if (!childNodes.length && container.textContent.trim()) {
    const p = document.createElement('p');
    p.textContent = container.textContent.trim();
    childNodes = [p];
  }

  // 3. Deduplicate redundant title / header block in body text
  if (childNodes.length > 0) {
    const firstTag = childNodes[0].tagName.toUpperCase();
    const firstText = (childNodes[0].textContent || '').trim().toLowerCase();
    const cleanDocTitle = docTitle.toLowerCase();
    if ((firstTag === 'H1' || firstTag === 'H2') && (firstText === cleanDocTitle || firstText.includes('agreement') || firstText.includes('addendum'))) {
      childNodes.shift();
    }
  }
  if (childNodes.length > 0) {
    const text = (childNodes[0].textContent || '').toLowerCase();
    if (text.includes('client name:') && text.includes('file reference:')) {
      childNodes.shift();
    }
  }

  // 4. Auto-break block height calculation
  function estimateBlockHeight(el) {
    const tag = el.tagName.toLowerCase();
    const textLen = (el.textContent || '').trim().length;
    if (tag === 'h1') return 58;
    if (tag === 'h2') return 50;
    if (tag === 'h3') return 42;
    if (tag === 'h4') return 36;
    if (tag === 'table' || el.classList.contains('guide-table-wrap')) {
      const rows = el.querySelectorAll('tr').length || 3;
      return rows * 36 + 44;
    }
    if (tag === 'ol' || tag === 'ul') {
      const items = el.querySelectorAll('li');
      let total = 20;
      items.forEach(li => {
        const len = (li.textContent || '').trim().length;
        total += Math.max(1, Math.ceil(len / 65)) * 22 + 8;
      });
      return Math.max(total, 40);
    }
    if (tag === 'blockquote') {
      return Math.max(1, Math.ceil(textLen / 65)) * 22 + 36;
    }
    const lines = Math.max(1, Math.ceil(textLen / 72));
    return lines * 23 + 14;
  }

  const PAGE1_BUDGET = 560;
  const PAGE_N_BUDGET = 800;
  const SIG_HEIGHT = 240;

  const pages = [[]];
  let curPage = 0;
  let curBudget = PAGE1_BUDGET;
  let curHeight = 0;

  for (const node of childNodes) {
    const h = estimateBlockHeight(node);
    if (curHeight + h > curBudget && pages[curPage].length > 0) {
      curPage++;
      pages[curPage] = [];
      curBudget = PAGE_N_BUDGET;
      curHeight = 0;
    }
    pages[curPage].push(node.outerHTML);
    curHeight += h;
  }

  if (!pages[0].length) {
    pages[0].push('<p class="a4-clause-empty"><em>No additional terms specified. Default engagement conditions apply.</em></p>');
  }

  let sigPage = curPage;
  if (curHeight + SIG_HEIGHT > curBudget && pages[curPage].length > 0) {
    sigPage = curPage + 1;
    pages[sigPage] = [];
  }

  const totalPages = pages.length;

  // 5. Signature section generator
  function renderSignatureSection() {
    let clientBoxHtml = '';
    const sigData = options.signatureData || {};

    if (mode === 'preview') {
      clientBoxHtml = `
        <div class="a4-sig-box client-side preview">
          <span class="a4-sig-label">Client / Applicant Signature</span>
          <div class="a4-sig-placeholder-pad">
            <span class="a4-pad-badge">Option B Digital Signature Pad</span>
            <p class="a4-pad-hint">Client draws signature electronically via touchscreen, stylus, or mouse</p>
            <div class="a4-sig-line dashed"></div>
          </div>
          <div class="a4-sig-details">
            <div><strong>Signer:</strong> ${esc(meta.client_name || 'Ahmed Example')}</div>
            <div><strong>Recorded on execution:</strong> Drawn signature &amp; timestamp</div>
          </div>
        </div>
      `;
    } else if (mode === 'sign') {
      clientBoxHtml = `
        <div class="a4-sig-box client-side interactive">
          <span class="a4-sig-label">Client / Applicant Electronic Signature</span>
          <div class="a4-interactive-canvas-wrap">
            <div class="canvas-header-row">
              <span>Sign with finger, mouse, or stylus:</span>
              <button type="button" id="clear-signature-btn" class="link-button">Clear</button>
            </div>
            <canvas id="signature-canvas" width="560" height="140" aria-label="Draw your signature"></canvas>
            <div class="canvas-hint" id="canvas-hint">Draw your legal signature inside this box</div>
          </div>
          <div class="a4-signer-name-field">
            <label>Full Legal Name (Typed Signature)
              <input id="signer-typed-name" type="text" value="${esc(meta.client_name || '')}" required placeholder="Type your legal name" autocomplete="name">
            </label>
          </div>
          <label class="a4-consent-checkbox">
            <input type="checkbox" id="agreement-consent-box">
            <span>I have read, understood, and agree to the terms of this Service Change Agreement and authorize the change in services.</span>
          </label>
          <div class="a4-audit-pill">
            🛡️ Electronic signature legally binding. Your typed name, drawn signature, IP address, and timestamp will be securely recorded in the audit trail.
          </div>
        </div>
      `;
    } else { // mode === 'view'
      if (options.status === 'SIGNED') {
        clientBoxHtml = `
          <div class="a4-sig-box client-side executed">
            <span class="a4-sig-label">Client / Applicant Signature</span>
            <div class="a4-signed-image-wrap">
              ${sigData.signatureImage ? `<img src="${sigData.signatureImage}" alt="Signature of ${esc(sigData.typedName || '')}" class="a4-executed-sig-img">` : '<div class="a4-no-img-sig">Signed Electronically</div>'}
              <div class="a4-stamp-verified">
                <span class="a4-stamp-icon">✓</span>
                <div class="a4-stamp-text">
                  <strong>VERIFIED &amp; EXECUTED</strong>
                  <small>SECURE AUDIT RECORD</small>
                </div>
              </div>
            </div>
            <div class="a4-sig-line"></div>
            <div class="a4-sig-details executed-details">
              <div><strong>Signer Legal Name:</strong> ${esc(sigData.typedName || meta.client_name || 'Client')}</div>
              <div><strong>Signed At:</strong> ${date(sigData.signedAt || meta.signed_at)}</div>
              <div><strong>Signer Account:</strong> ${esc(sigData.signerEmail || 'Client Account')}</div>
              <div><strong>Recorded IP:</strong> ${esc(sigData.ip || 'Securely Recorded')}</div>
            </div>
          </div>
        `;
      } else if (options.status === 'CANCELLED') {
        clientBoxHtml = `
          <div class="a4-sig-box client-side cancelled">
            <span class="a4-sig-label">Status Notice</span>
            <div class="a4-stamp-cancelled">
              <span class="a4-stamp-icon">✕</span>
              <div class="a4-stamp-text">
                <strong>CANCELLED / VOID</strong>
                <small>${date(options.cancelledAt)}</small>
              </div>
            </div>
            <div class="a4-sig-line"></div>
            <div class="a4-sig-details">
              <div><strong>Cancelled by:</strong> ${esc(options.cancellerName || 'Operations')}</div>
              ${options.cancelReason ? `<div><strong>Reason:</strong> ${esc(options.cancelReason)}</div>` : ''}
            </div>
          </div>
        `;
      } else {
        clientBoxHtml = `
          <div class="a4-sig-box client-side pending">
            <span class="a4-sig-label">Client Signature</span>
            <div class="a4-stamp-pending">
              <span class="a4-stamp-icon">⏳</span>
              <div class="a4-stamp-text">
                <strong>AWAITING SIGNATURE</strong>
                <small>PENDING CLIENT REVIEW</small>
              </div>
            </div>
            <div class="a4-sig-line dashed"></div>
            <div class="a4-sig-details">
              <div><strong>Signer:</strong> ${esc(meta.client_name || 'Client')}</div>
              <div><strong>Status:</strong> Held pending client authorization</div>
            </div>
          </div>
        `;
      }
    }

    return `
      <div class="a4-execution-section">
        <div class="a4-execution-header">
          <h3>Execution &amp; Electronic Signatures</h3>
          <p>In witness whereof, the parties acknowledge and agree to the amendment of services specified in this Addendum.</p>
        </div>
        <div class="a4-sig-columns">
          <div class="a4-sig-box operations-side">
            <span class="a4-sig-label">Authorized Operations Officer</span>
            <div class="a4-officer-signature">
              <span class="a4-sig-pen-font">Operations Executive</span>
            </div>
            <div class="a4-sig-line"></div>
            <div class="a4-sig-details">
              <div><strong>Representative:</strong> Operations Department</div>
              <div><strong>Status:</strong> Authorized &amp; Issued</div>
              <div><strong>Date:</strong> ${esc(docDate)}</div>
            </div>
          </div>
          ${clientBoxHtml}
        </div>
      </div>
    `;
  }

  // 6. Build A4 Page Sheets
  let sheetsHtml = '';
  for (let p = 0; p < totalPages; p++) {
    const pageNum = p + 1;
    let pageHeaderHtml = '';

    if (p === 0) {
      pageHeaderHtml = `
        <div class="a4-letterhead">
          <div class="a4-letterhead-brand">
            <div class="a4-emblem" aria-hidden="true">⚖️</div>
            <div class="a4-brand-text">
              <span class="a4-org-title">OPERATIONS IMMIGRATION &amp; LEGAL SERVICES</span>
              <span class="a4-org-subtitle">OFFICIAL ADDENDUM TO SERVICE ENGAGEMENT</span>
            </div>
          </div>
          <div class="a4-doc-meta-badge">
            <span class="a4-meta-badge-label">DOCUMENT REF</span>
            <span class="a4-meta-badge-val">${esc(docRef)}</span>
            <span class="a4-meta-badge-date">${esc(docDate)}</span>
          </div>
        </div>

        <div class="a4-doc-title-block">
          <h1 class="a4-doc-title">${esc(docTitle)}</h1>
          <div class="a4-title-rule"></div>
        </div>

        <div class="a4-meta-summary">
          <div class="a4-meta-cell">
            <span class="a4-cell-label">Client Legal Name</span>
            <strong class="a4-cell-value">${esc(meta.client_name || 'Client')}</strong>
          </div>
          <div class="a4-meta-cell">
            <span class="a4-cell-label">File Reference</span>
            <strong class="a4-cell-value">#${esc(meta.file_id || '—')}</strong>
          </div>
          <div class="a4-meta-cell">
            <span class="a4-cell-label">Current Service Category</span>
            <span class="a4-cell-value">${esc(meta.old_category || 'Current Service')}</span>
          </div>
          <div class="a4-meta-cell highlight">
            <span class="a4-cell-label">Amended Target Category</span>
            <strong class="a4-cell-value">${esc(meta.new_category || 'New Category')}${meta.new_version ? ' (v' + esc(meta.new_version) + ')' : ''}</strong>
          </div>
        </div>
      `;
    } else {
      pageHeaderHtml = `
        <div class="a4-running-header">
          <span class="a4-running-title">${esc(docTitle)}</span>
          <span class="a4-running-ref">File #${esc(meta.file_id || '—')} · ${esc(docDate)}</span>
          <span class="a4-running-page-badge">Page ${pageNum} of ${totalPages}</span>
        </div>
      `;
    }

    const pageContentHtml = `
      <div class="a4-page-content">
        ${pages[p].join('')}
      </div>
    `;

    const pageSigHtml = (p === sigPage) ? renderSignatureSection() : '';

    const pageFooterHtml = `
      <div class="a4-page-footer">
        <span class="a4-footer-legal">Official Record · Document Ref: ${esc(docRef)} · Subject to General Engagement Terms</span>
        <span class="a4-footer-counter">Page ${pageNum} of ${totalPages}</span>
      </div>
    `;

    sheetsHtml += `
      <div class="a4-page-sheet" data-page="${pageNum}" data-total-pages="${totalPages}">
        <div class="a4-page-upper">
          ${pageHeaderHtml}
          ${pageContentHtml}
        </div>
        <div class="a4-page-lower">
          ${pageSigHtml}
          ${pageFooterHtml}
        </div>
      </div>
    `;

    if (p < totalPages - 1) {
      sheetsHtml += `
        <div class="a4-page-break-gap" role="separator" aria-label="Page break">
          <span class="a4-break-line"></span>
          <span class="a4-break-label">PAGE BREAK · PAGE ${pageNum + 1} OF ${totalPages}</span>
          <span class="a4-break-line"></span>
        </div>
      `;
    }
  }

  return `
    <div class="a4-document-container">
      ${sheetsHtml}
    </div>
  `;
}

function initSignaturePad(canvas, onDrawChange) {
  if (!canvas) return { clear() {}, hasDrawn() { return false; }, toDataURL() { return ''; } };
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  let drawing = false;
  let hasDrawn = false;
  let lastX = 0;
  let lastY = 0;

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if (e.touches && e.touches.length > 0) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }

  function start(e) {
    if (e.cancelable && e.type.startsWith('touch')) e.preventDefault();
    drawing = true;
    const pos = getPos(e);
    lastX = pos.x;
    lastY = pos.y;
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
  }

  function move(e) {
    if (!drawing) return;
    if (e.cancelable && e.type.startsWith('touch')) e.preventDefault();
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastX = pos.x;
    lastY = pos.y;
    if (!hasDrawn) {
      hasDrawn = true;
      onDrawChange(true);
    }
  }

  function stop() {
    if (drawing) {
      drawing = false;
      ctx.closePath();
    }
  }

  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  canvas.addEventListener('mouseup', stop);
  canvas.addEventListener('mouseleave', stop);

  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', stop);

  return {
    clear() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      hasDrawn = false;
      onDrawChange(false);
    },
    hasDrawn() {
      return hasDrawn;
    },
    toDataURL() {
      return canvas.toDataURL('image/png');
    }
  };
}

async function openCategoryRequestModal(file, publishedCats, onComplete) {
  if (!publishedCats.length) {
    modal('No categories available', empty('No published categories', 'Publish another service category first before requesting a category change.'));
    return;
  }
  let templates = [];
  try {
    templates = await api('agreement-templates');
  } catch (err) {
    console.error('Failed to load agreement templates:', err);
  }
  if (!templates || !templates.length) {
    const fallbackText = defaultAgreementText(file, publishedCats[0].name, publishedCats[0].version);
    templates = [{
      id: 1,
      name: 'Standard Service Change Addendum',
      title: 'Service Change Agreement & Addendum',
      body: fallbackText,
      is_default: true
    }];
  }

  const firstCat = publishedCats[0];
  let activeTemplate = templates.find(t => t.is_default) || templates[0];

  function getTemplateVars(targetCat) {
    return {
      client_name: file.client_name,
      file_id: file.id,
      old_category: file.category_name || 'Current Service',
      new_category: targetCat.name,
      new_version: targetCat.version,
      date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      ref_code: `AGR-${file.id}-REQ`
    };
  }

  const initialBody = interpolateAgreementText(activeTemplate.body, getTemplateVars(firstCat));

  modal('Request Service Category Change', `
    <div class="category-request-form-shell">
      <div class="notice">
        <strong>Conditional Category Change</strong>
        <p>The category will NOT change immediately. The file will be placed on hold and this Service Agreement will be sent to the client. The category changes only once the client signs, or you can cancel this request at any time to resume the current category.</p>
      </div>
      <div class="category-modal-layout">
        <div class="category-modal-form-col">
          ${form('category-request-form',
            select('Target service category', 'categoryId', publishedCats.map(c => [c.id, `${c.name} (version ${c.version})`])) +
            select('Choose agreement template', 'templateId', templates.map(t => [t.id, `${t.name}${t.is_default ? ' · Default' : ''}`]), activeTemplate.id) +
            input('Agreement title', 'agreementTitle', 'text', activeTemplate.title, 'required maxlength="240"') +
            guideEditor('Agreement terms & addendum clauses', 'agreementText', initialBody) +
            '<p class="hint">You can review and edit these terms using the rich text tools before sending them to the client for signature.</p>',
            'Send agreement to client'
          )}
        </div>
        <div class="category-modal-preview-col">
          <div class="modal-preview-card">
            <div class="modal-preview-header">
              <strong>Live Agreement Preview</strong>
              <span class="preview-badge">Client A4 View</span>
            </div>
            <div id="category-modal-a4-viewport" class="a4-document-viewport modal-preview-body"></div>
          </div>
        </div>
      </div>
    </div>
  `);

  bindGuideEditors();
  const categorySelect = document.querySelector('#category-request-form [name=categoryId]');
  const templateSelect = document.querySelector('#category-request-form [name=templateId]');
  const titleInput = document.querySelector('#category-request-form [name=agreementTitle]');
  const formSurface = document.querySelector('#category-request-form [data-rich-surface]');
  const modalEditor = [...activeGuideEditors].find(e => formSurface && formSurface.contains(e.view.dom));
  const previewViewport = document.querySelector('#category-modal-a4-viewport');

  function updateModalPreview() {
    if (!previewViewport) return;
    const selectedCat = publishedCats.find(c => String(c.id) === (categorySelect ? categorySelect.value : '')) || publishedCats[0];
    const vars = getTemplateVars(selectedCat);
    const titleVal = titleInput ? titleInput.value.trim() : activeTemplate.title;
    const bodyVal = modalEditor ? modalEditor.getHTML() : initialBody;
    previewViewport.innerHTML = formatA4DocumentHtml(titleVal, bodyVal, vars, { mode: 'preview' });
  }

  let timer = null;
  const scheduleUpdate = () => {
    clearTimeout(timer);
    timer = setTimeout(updateModalPreview, 60);
  };

  if (modalEditor) modalEditor.on('update', scheduleUpdate);
  if (titleInput) titleInput.addEventListener('input', scheduleUpdate);

  if (categorySelect && templateSelect) {
    const handleTemplateOrCatChange = () => {
      const selectedCat = publishedCats.find(c => String(c.id) === categorySelect.value) || publishedCats[0];
      const selectedTpl = templates.find(t => String(t.id) === templateSelect.value) || templates[0];
      activeTemplate = selectedTpl;
      if (titleInput) titleInput.value = selectedTpl.title;
      const interpolated = interpolateAgreementText(selectedTpl.body, getTemplateVars(selectedCat));
      if (modalEditor) {
        modalEditor.commands.setContent(guideMarkup(interpolated));
      }
      updateModalPreview();
    };

    categorySelect.onchange = handleTemplateOrCatChange;
    templateSelect.onchange = handleTemplateOrCatChange;
  }

  updateModalPreview();

  bindForm('category-request-form', async v => {
    const finalBody = modalEditor && !modalEditor.isEmpty
      ? (OperationsRichText.prefix + OperationsRichText.sanitize(modalEditor.getHTML()))
      : v.agreementText;
    await api(`cases/${file.id}/category-request`, 'POST', {
      categoryId: Number(v.categoryId),
      agreementTitle: v.agreementTitle,
      agreementText: finalBody
    });
    destroyGuideEditors();
    closeModal();
    if (onComplete) await onComplete();
    success('Service change agreement sent. File is on hold awaiting client signature.');
  });
}

function openEditAgreementModal(file, pendingReq, onComplete) {
  modal('Edit Service Change Agreement', `
    <div class="category-request-form-shell">
      <div class="notice">
        <strong>Edit Pending Agreement</strong>
        <p>Modify the terms of the agreement before the client signs. Changes will be visible to the client immediately in their portal.</p>
      </div>
      <div class="category-modal-layout">
        <div class="category-modal-form-col">
          ${form('edit-agreement-form',
            input('Agreement title', 'agreementTitle', 'text', pendingReq.agreement_title, 'required maxlength="240"') +
            guideEditor('Agreement terms & clauses', 'agreementText', pendingReq.agreement_text) +
            '<p class="hint">Format text directly using the rich editor. Live A4 preview updates on the right.</p>',
            'Save updated terms'
          )}
        </div>
        <div class="category-modal-preview-col">
          <div class="modal-preview-card">
            <div class="modal-preview-header">
              <strong>Live Agreement Preview</strong>
              <span class="preview-badge">Client A4 View</span>
            </div>
            <div id="edit-modal-a4-viewport" class="a4-document-viewport modal-preview-body"></div>
          </div>
        </div>
      </div>
    </div>
  `);

  bindGuideEditors();
  const titleInput = document.querySelector('#edit-agreement-form [name=agreementTitle]');
  const formSurface = document.querySelector('#edit-agreement-form [data-rich-surface]');
  const modalEditor = [...activeGuideEditors].find(e => formSurface && formSurface.contains(e.view.dom));
  const previewViewport = document.querySelector('#edit-modal-a4-viewport');

  const metaVars = {
    client_name: file.client_name,
    file_id: file.id,
    old_category: file.category_name || 'Current Service',
    new_category: pendingReq.target_category_name,
    new_version: pendingReq.target_category_version,
    date: new Date(pendingReq.created_at || Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    ref_code: `AGR-${file.id}-${pendingReq.id}`
  };

  function updateEditPreview() {
    if (!previewViewport) return;
    const titleVal = titleInput ? titleInput.value.trim() : pendingReq.agreement_title;
    const bodyVal = modalEditor ? modalEditor.getHTML() : pendingReq.agreement_text;
    previewViewport.innerHTML = formatA4DocumentHtml(titleVal, bodyVal, metaVars, { mode: 'preview' });
  }

  let timer = null;
  const scheduleEditPreview = () => {
    clearTimeout(timer);
    timer = setTimeout(updateEditPreview, 60);
  };

  if (modalEditor) modalEditor.on('update', scheduleEditPreview);
  if (titleInput) titleInput.addEventListener('input', scheduleEditPreview);
  updateEditPreview();

  bindForm('edit-agreement-form', async v => {
    const finalBody = modalEditor && !modalEditor.isEmpty
      ? (OperationsRichText.prefix + OperationsRichText.sanitize(modalEditor.getHTML()))
      : v.agreementText;
    await api(`cases/${file.id}/category-request/${pendingReq.id}`, 'PATCH', {
      agreementTitle: v.agreementTitle,
      agreementText: finalBody
    });
    destroyGuideEditors();
    closeModal();
    if (onComplete) await onComplete();
    success('Agreement terms updated successfully.');
  });
}

function openCancelAgreementModal(file, pendingReq, onComplete) {
  modal('Cancel Category Change Request', `
    <div class="category-cancel-shell">
      <p>Are you sure you want to cancel the pending category change to <strong>${esc(pendingReq.target_category_name)}</strong>?</p>
      <p class="hint">The file will unfreeze and continue on its current category (<strong>${esc(file.category_name || 'Current Category')}</strong>). Previous requirements and documents will remain intact.</p>
      ${form('cancel-category-form',
        area('Reason for cancellation (optional)', 'reason', '', 'placeholder="e.g. Client requested to keep current service..." maxlength="500"'),
        'Confirm cancellation'
      )}
    </div>
  `);

  bindForm('cancel-category-form', async v => {
    await api(`cases/${file.id}/category-request/${pendingReq.id}/cancel`, 'POST', {
      reason: v.reason || 'Cancelled by Operations'
    });
    closeModal();
    if (onComplete) await onComplete();
    success('Category change request cancelled. File resumed on original category.');
  });
}

function openSignatureModal(file, pendingReq, onComplete) {
  const metaVars = {
    client_name: file.client_name,
    file_id: file.id,
    old_category: file.category_name || 'Current Service',
    new_category: pendingReq.target_category_name,
    new_version: pendingReq.target_category_version,
    date: new Date(pendingReq.created_at || Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    ref_code: `AGR-${file.id}-${pendingReq.id}`
  };

  modal('Review & Sign Service Change Agreement', `
    <div class="agreement-signing-modal">
      <div class="agreement-modal-header">
        <div>
          <span class="eyebrow">OFFICIAL SERVICE TRANSITION AGREEMENT</span>
          <h3>${esc(pendingReq.agreement_title)}</h3>
          <p>Amended Target: <strong>${esc(pendingReq.target_category_name)}</strong> · File #${file.id}</p>
        </div>
        <div class="header-action-group">
          <button type="button" id="print-signing-doc" class="secondary print-btn" title="Print or save as PDF">🖨️ Print / Save PDF</button>
          <span class="badge pending">Awaiting Signature</span>
        </div>
      </div>
      
      <div class="a4-document-viewport modal-signing-viewport" tabindex="0" aria-label="A4 agreement pages">
        ${formatA4DocumentHtml(
          pendingReq.agreement_title,
          pendingReq.agreement_text,
          metaVars,
          { mode: 'sign' }
        )}
      </div>

      <div class="modal-signing-footer">
        <button type="button" id="close-sign-modal" class="secondary">Close</button>
        <button type="button" id="submit-signature-btn" class="primary pulse-btn" disabled>Sign & Accept Agreement</button>
      </div>
    </div>
  `);

  const canvas = document.querySelector('#signature-canvas');
  const typedNameInput = document.querySelector('#signer-typed-name');
  const consentBox = document.querySelector('#agreement-consent-box');
  const submitBtn = document.querySelector('#submit-signature-btn');
  const clearBtn = document.querySelector('#clear-signature-btn');
  const closeBtn = document.querySelector('#close-sign-modal');
  const printBtn = document.querySelector('#print-signing-doc');
  const canvasHint = document.querySelector('#canvas-hint');

  if (printBtn) printBtn.onclick = () => window.print();

  const pad = initSignaturePad(canvas, (hasDrawn) => {
    if (canvasHint) canvasHint.hidden = hasDrawn;
    validate();
  });

  function validate() {
    const hasName = typedNameInput && typedNameInput.value.trim().length > 0;
    const hasAgreed = consentBox && consentBox.checked;
    const hasDrawn = pad.hasDrawn();
    if (submitBtn) submitBtn.disabled = !(hasName && hasAgreed && hasDrawn);
  }

  if (typedNameInput) typedNameInput.addEventListener('input', validate);
  if (consentBox) consentBox.addEventListener('change', validate);
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      pad.clear();
      if (canvasHint) canvasHint.hidden = false;
      validate();
    });
  }
  if (closeBtn) closeBtn.addEventListener('click', closeModal);

  if (submitBtn) {
    submitBtn.addEventListener('click', async () => {
      if (!consentBox.checked || !typedNameInput.value.trim() || !pad.hasDrawn()) return;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting signature…';
      try {
        await api(`cases/${file.id}/category-request/${pendingReq.id}/sign`, 'POST', {
          typedName: typedNameInput.value.trim(),
          signatureImage: pad.toDataURL(),
          agreed: true
        });
        closeModal();
        if (onComplete) await onComplete();
        success('Service change agreement signed! Document checklist updated to ' + pendingReq.target_category_name + '.');
      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign & Accept Agreement';
        report(err);
      }
    });
  }
}

function openViewSignedAgreementModal(req) {
  const sig = req.signature_data || {};
  const metaVars = {
    client_name: sig.typedName || 'Client',
    file_id: req.case_id,
    new_category: req.target_category_name,
    new_version: req.target_category_version,
    date: new Date(req.created_at || Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    signed_at: req.signed_at,
    ref_code: `AGR-${req.case_id}-${req.id}`
  };

  modal(req.agreement_title || 'Service Change Agreement', `
    <div class="agreement-signing-modal">
      <div class="agreement-modal-header">
        <div>
          <span class="eyebrow">OFFICIAL EXECUTED RECORD</span>
          <h3>${esc(req.agreement_title)}</h3>
          <p>Amended Target: <strong>${esc(req.target_category_name)}</strong> · File #${req.case_id || '—'}</p>
        </div>
        <div class="header-action-group">
          <button type="button" id="print-view-doc" class="secondary print-btn" title="Print or save as PDF">🖨️ Print / Save PDF</button>
          <span class="badge ${req.status==='SIGNED'?'accepted':req.status==='CANCELLED'?'cancelled':'pending'}">${req.status}</span>
        </div>
      </div>

      <div class="a4-document-viewport modal-signing-viewport" tabindex="0" aria-label="A4 agreement pages">
        ${formatA4DocumentHtml(
          req.agreement_title,
          req.agreement_text,
          metaVars,
          {
            mode: 'view',
            status: req.status,
            signatureData: sig,
            cancelledAt: req.cancelled_at,
            cancellerName: req.canceller_name,
            cancelReason: req.cancel_reason
          }
        )}
      </div>

      <div class="modal-signing-footer">
        <button type="button" id="close-view-agreement" class="primary">Close document</button>
      </div>
    </div>
  `);

  action('#close-view-agreement', closeModal);
  const printBtn = document.querySelector('#print-view-doc');
  if (printBtn) printBtn.onclick = () => window.print();
}

function renderCategoryHoldBanner(pendingReq) {
  if (!pendingReq) return '';
  return `
    <section class="category-hold-banner" role="alert" aria-label="Category change pending">
      <div class="hold-banner-indicator">
        <span class="hold-pulse-dot" aria-hidden="true"></span>
        <span class="hold-icon" aria-hidden="true">⏸</span>
      </div>
      <div class="hold-banner-content">
        <div class="hold-banner-badge-row">
          <span class="eyebrow hold-eyebrow">FILE ON HOLD · AWAITING CLIENT SIGNATURE</span>
          <span class="badge pending">Target: ${esc(pendingReq.target_category_name)}</span>
        </div>
        <h3>Category change agreement pending</h3>
        <p>A service change agreement to switch this file to <strong>${esc(pendingReq.target_category_name)}</strong> is awaiting the client’s signature. Submissions, reviews, and status changes are paused until the agreement is signed or cancelled.</p>
      </div>
      <div class="hold-banner-controls">
        <button type="button" id="edit-pending-agreement" class="secondary">Edit agreement terms</button>
        <button type="button" id="cancel-pending-agreement" class="danger">Cancel change request</button>
      </div>
    </section>
  `;
}

function renderClientAgreementBanner(pendingReq) {
  if (!pendingReq) return '';
  return `
    <section class="client-agreement-banner" role="alert" aria-label="Action required: Service change agreement">
      <div class="client-agreement-badge-row">
        <span class="eyebrow client-agreement-eyebrow">ACTION REQUIRED · SIGNATURE NEEDED</span>
        <span class="badge missing">Signature Pending</span>
      </div>
      <div class="client-agreement-body">
        <div class="client-agreement-icon-shell" aria-hidden="true">✍️</div>
        <div class="client-agreement-copy">
          <h2>Service Change Agreement</h2>
          <p>Operations has proposed transitioning your application to <strong>${esc(pendingReq.target_category_name)}</strong>. Please review and electronically sign the updated service agreement so we can update your checklist and proceed with your file.</p>
        </div>
      </div>
      <div class="client-agreement-action-row">
        <button type="button" id="client-review-agreement" class="primary pulse-btn">Review & Sign Agreement →</button>
      </div>
    </section>
  `;
}

function renderAgreementHistory(changeRequests) {
  if (!changeRequests || !changeRequests.length) return '';
  return `
    <div class="card agreement-history-card">
      <div class="card-header">
        <h3>Service Agreements & Addendums</h3>
        <span>${changeRequests.length} ${changeRequests.length === 1 ? 'record' : 'records'}</span>
      </div>
      <div class="agreement-history-list">
        ${changeRequests.map(r => `
          <div class="agreement-history-item ${r.status.toLowerCase()}">
            <div class="agreement-item-info">
              <span class="agreement-item-title">${esc(r.agreement_title)}</span>
              <small>Target: <strong>${esc(r.target_category_name)}</strong> · ${r.status === 'SIGNED' ? 'Signed ' + date(r.signed_at) : r.status === 'CANCELLED' ? 'Cancelled ' + date(r.cancelled_at) : 'Created ' + date(r.created_at)}</small>
            </div>
            <div class="agreement-item-meta">
              <span class="badge ${r.status === 'SIGNED' ? 'accepted' : r.status === 'CANCELLED' ? 'cancelled' : 'pending'}">${r.status === 'SIGNED' ? 'Signed' : r.status === 'CANCELLED' ? 'Cancelled' : 'Pending'}</span>
              <button type="button" class="view-agreement-btn" data-view-agreement="${r.id}">View agreement →</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

let selectedAgreementTemplateId = null;

async function renderAgreementTemplateSettings() {
  const templates = await api('agreement-templates');
  if (!selectedAgreementTemplateId || !templates.some(t => String(t.id) === String(selectedAgreementTemplateId))) {
    selectedAgreementTemplateId = (templates.find(t => t.is_default) || templates[0])?.id || null;
  }

  content.insertAdjacentHTML('beforeend', card(
    'Category change agreements',
    '<p class="muted">Manage agreement templates used when changing a client\'s service category. Multiple templates can be created here with full rich text formatting and authentic A4 multi-page preview. When staff changes a category on any client file, these templates appear and are previewed before sending for client signature.</p>' +
    '<div class="template-selection">' +
      '<label>Choose agreement template' +
        '<select id="agreement-template-choice" aria-label="Agreement template">' +
          templates.map(t => '<option value="' + t.id + '">' + esc(t.name) + (t.is_default ? ' · Default' : '') + '</option>').join('') +
        '</select>' +
      '</label>' +
      '<button id="new-agreement-template">＋ New agreement template</button>' +
    '</div>' +
    '<div id="agreement-template-editor"></div>'
  ));

  const section = content.lastElementChild;
  section.id = 'agreement-templates';
  const headerActions = document.querySelector('#header-actions');
  if (headerActions && !headerActions.querySelector('#jump-agreement-templates')) {
    headerActions.insertAdjacentHTML('beforeend', '<button id="jump-agreement-templates">Category agreements</button>');
  }

  const choice = section.querySelector('#agreement-template-choice');
  if (choice && selectedAgreementTemplateId) {
    choice.value = selectedAgreementTemplateId;
  }

  const draw = () => {
    destroyGuideEditors();
    selectedAgreementTemplateId = choice.value;
    const t = templates.find(item => String(item.id) === String(choice.value)) || templates[0];
    const pane = section.querySelector('#agreement-template-editor');

    pane.innerHTML = `
      <div class="agreement-template-grid">
        <div class="agreement-template-form-col">
          ${form('agreement-template-form',
            input('Template name (management label)', 'name', 'text', t.name, 'required maxlength="160"') +
            input('Agreement title (shown to client)', 'title', 'text', t.title, 'required maxlength="240"') +
            '<div class="template-token-list">' +
              '<strong>Insert placeholder</strong>' +
              ['client_name', 'file_id', 'old_category', 'new_category', 'new_version', 'date'].map(tok =>
                `<button type="button" data-agreement-token="${tok}">{{${tok}}}</button>`
              ).join('') +
            '</div>' +
            guideEditor('Agreement terms & legal clauses', 'body', t.body) +
            `<label class="agreement-default-checkbox"><input type="checkbox" name="isDefault" ${t.is_default ? 'checked' : ''}><span>Set as default template for category changes</span></label>` +
            '<p class="hint">Placeholders like {{client_name}}, {{old_category}}, and {{new_category}} are automatically filled from client and category records upon category change.</p>',
            'Save agreement template'
          )}
          <div class="row-actions">
            <button id="delete-agreement-template" class="danger-button">Delete template</button>
          </div>
        </div>
        <div class="agreement-template-preview-col" role="region" aria-label="Agreement template preview">
          <div class="preview-heading">
            <strong>Live Agreement Preview</strong>
            <span class="preview-badge">A4 Page View · Auto-Break</span>
          </div>
          <div id="settings-a4-preview-viewport" class="a4-document-viewport"></div>
        </div>
      </div>
    `;

    bindGuideEditors();

    const titleInput = pane.querySelector('[name=title]');
    const surface = pane.querySelector('[data-rich-surface]');
    const editor = [...activeGuideEditors].find(e => surface && surface.contains(e.view.dom));
    const previewViewport = pane.querySelector('#settings-a4-preview-viewport');

    const sampleVars = {
      client_name: 'Ahmed Example',
      file_id: '1042',
      old_category: 'Initial Consultation',
      new_category: 'Express Entry Comprehensive',
      new_version: '2',
      date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      ref_code: 'AGR-2026-1042'
    };

    function updateSettingsPreview() {
      if (!previewViewport) return;
      const currentTitle = titleInput ? titleInput.value.trim() : t.title;
      const currentHtml = editor ? editor.getHTML() : (t.body || '');
      previewViewport.innerHTML = formatA4DocumentHtml(
        currentTitle,
        currentHtml,
        sampleVars,
        { mode: 'preview' }
      );
    }

    let previewTimer = null;
    const schedulePreview = () => {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(updateSettingsPreview, 60);
    };

    if (editor) {
      editor.on('update', schedulePreview);
    }
    if (titleInput) {
      titleInput.addEventListener('input', schedulePreview);
    }
    updateSettingsPreview();

    // Placeholder token insertion handler
    let lastFocused = editor;
    if (titleInput) {
      titleInput.addEventListener('focus', () => { lastFocused = titleInput; });
    }
    if (surface) {
      surface.addEventListener('focusin', () => { lastFocused = editor; });
    }

    pane.querySelectorAll('[data-agreement-token]').forEach(btn => {
      btn.onmousedown = e => e.preventDefault();
      btn.onclick = () => {
        const token = '{{' + btn.dataset.agreementToken + '}}';
        if (lastFocused === titleInput) {
          titleInput.setRangeText(token, titleInput.selectionStart, titleInput.selectionEnd, 'end');
          titleInput.focus();
          schedulePreview();
        } else if (editor) {
          editor.chain().focus().insertContent({ type: 'text', text: token }).run();
          schedulePreview();
        }
      };
    });

    bindForm('agreement-template-form', async (v, f) => {
      const isDefault = f.elements.isDefault.checked;
      const bodyContent = editor && !editor.isEmpty
        ? (OperationsRichText.prefix + OperationsRichText.sanitize(editor.getHTML()))
        : v.body;
      await api(`agreement-templates/${t.id}`, 'PATCH', {
        name: v.name,
        title: v.title,
        body: bodyContent,
        isDefault
      });
      t.name = v.name;
      t.title = v.title;
      t.body = bodyContent;
      t.is_default = isDefault;
      if (isDefault) {
        templates.forEach(other => {
          if (other.id !== t.id) other.is_default = false;
        });
      }
      choice.selectedOptions[0].textContent = t.name + (t.is_default ? ' · Default' : '');
      success('Agreement template saved.');
    });

    action('#delete-agreement-template', async () => {
      if (templates.length <= 1) {
        report(new Error('At least one agreement template is required.'));
        return;
      }
      if (!confirm(`Delete template "${t.name}"?`)) return;
      await api(`agreement-templates/${t.id}`, 'DELETE');
      selectedAgreementTemplateId = null;
      selectedSettingsTab = 'agreements';
      await render();
      success('Template deleted.');
    });
  };

  choice.onchange = draw;
  draw();

  action('#new-agreement-template', async () => {
    const defaultBody = 'richtext:v1:<h3>1. Scope of Service Modification</h3><p>This Service Change Agreement &amp; Addendum (&quot;Addendum&quot;) modifies the scope of services previously agreed upon between the Client and Operations. Both parties agree that the client\'s file will be transitioned to <strong>{{new_category}}</strong> (v{{new_version}}).</p><h3>2. Modification of Requirements &amp; Document Checklist</h3><p>Upon execution of this Addendum by the Client:</p><ol><li>The existing document checklist will be archived and retained in the file history.</li><li>A revised document and information checklist for <strong>{{new_category}}</strong> will take effect immediately.</li><li>Any previously approved items incompatible with the new category will be superseded.</li><li>File progression, reviews, and document collection are temporarily held until this Addendum is executed or cancelled by Operations.</li></ol><h3>3. Client Authorization &amp; Consent</h3><p>By signing below, the Client confirms that they have reviewed and agreed to the terms of this service transition, and authorize Operations to update the service checklist and requirements for this file.</p><p><em>All other terms, conditions, and obligations of the initial service engagement remain in full force and effect.</em></p>';
    const created = await api('agreement-templates', 'POST', {
      name: `New Service Agreement ${templates.length + 1}`,
      title: 'Service Change Agreement & Addendum',
      body: defaultBody,
      isDefault: false
    });
    selectedAgreementTemplateId = created.id;
    selectedSettingsTab = 'agreements';
    await render();
    success('Template created. Edit its terms and save.');
  });
}

