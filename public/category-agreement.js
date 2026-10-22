function ensureRichAgreementBody(raw) {
  if (!raw) return '';
  let str = String(raw).trim();
  if (str.includes('\\n')) {
    str = str.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n');
  }
  str = str.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  if (str.startsWith('richtext:v1:')) {
    let inner = str.slice(12).trim();
    if (inner.includes('\\n')) inner = inner.replace(/\\n/g, '\n');
    if (/<(p|h[1-6]|ul|ol|table|div)[^>]*>/i.test(inner)) {
      return 'richtext:v1:' + (globalThis.OperationsRichText ? OperationsRichText.sanitize(inner) : inner);
    }
    str = inner;
  }

  if (/<(p|h[1-6]|ul|ol|table|div)[^>]*>/i.test(str)) {
    return 'richtext:v1:' + (globalThis.OperationsRichText ? OperationsRichText.sanitize(str) : str);
  }

  const blocks = str.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  const htmlBlocks = [];

  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) continue;

    const isNumbered = lines.length > 1 && lines.every(l => /^(\d+[\.\)]|[a-z][\.\)])\s+/i.test(l));
    const isBullet = lines.length > 1 && lines.every(l => /^[-*•]\s+/.test(l));

    if (isNumbered) {
      htmlBlocks.push('<ol>' + lines.map(l => '<li>' + esc(l.replace(/^(\d+[\.\)]|[a-z][\.\)])\s+/i, '')) + '</li>').join('') + '</ol>');
      continue;
    }
    if (isBullet) {
      htmlBlocks.push('<ul>' + lines.map(l => '<li>' + esc(l.replace(/^[-*•]\s+/, '')) + '</li>').join('') + '</ul>');
      continue;
    }

    const firstLine = lines[0];
    const isHeading = (/^\d+\.\s+[A-Z]/i.test(firstLine) || /^[A-Z0-9\s&—–\-:]{5,}$/.test(firstLine) || /^Section\s+\d+/i.test(firstLine)) && firstLine.length < 90;

    if (isHeading) {
      htmlBlocks.push('<h3>' + esc(firstLine) + '</h3>');
      if (lines.length > 1) {
        const rest = lines.slice(1);
        const restIsList = rest.every(l => /^([a-z0-9][\.\)]|[-*•])\s+/i.test(l));
        if (restIsList) {
          htmlBlocks.push('<ol>' + rest.map(l => '<li>' + esc(l.replace(/^([a-z0-9][\.\)]|[-*•])\s+/i, '')) + '</li>').join('') + '</ol>');
        } else {
          htmlBlocks.push('<p>' + rest.map(esc).join('<br>') + '</p>');
        }
      }
      continue;
    }

    htmlBlocks.push('<p>' + lines.map(esc).join('<br>') + '</p>');
  }

  const resultHtml = htmlBlocks.length ? htmlBlocks.join('') : '<p>' + esc(str) + '</p>';
  return 'richtext:v1:' + (globalThis.OperationsRichText ? OperationsRichText.sanitize(resultHtml) : resultHtml);
}

const STANDARD_AGREEMENT_CLAUSES = [
  {
    id: 'scope',
    label: '1. Scope of Service Modification',
    description: 'Transition file handling under updated program guidelines',
    html: '<h3>1. Scope of Service Modification</h3><p>This Service Change Agreement &amp; Addendum (&quot;Addendum&quot;) modifies the scope of services previously agreed upon between the Client and Operations. Both parties agree that File #<strong>{{file_id}}</strong> will be transitioned to <strong>{{new_category}} (v{{new_version}})</strong> under the updated program guidelines.</p>'
  },
  {
    id: 'checklist',
    label: '2. Document Checklist & Requirements Update',
    description: 'Archiving old items and applying the new category checklist',
    html: '<h3>2. Modification of Requirements &amp; Document Checklist</h3><p>Upon electronic execution of this Addendum by the Client:</p><ol><li>The existing document checklist will be archived and retained in the file audit history.</li><li>A revised document and information checklist for <strong>{{new_category}}</strong> will take effect immediately.</li><li>Any previously approved items incompatible with the new category will be superseded.</li><li>File progression and document reviews resume once required materials are submitted.</li></ol>'
  },
  {
    id: 'priority',
    label: '3. Priority Handling & Expedited Verification',
    description: 'Priority handling queues for document reviews',
    html: '<h3>3. Priority Handling &amp; Expedited Processing</h3><p>Operations will prioritize processing and verification of uploaded documentation for File #<strong>{{file_id}}</strong> under <strong>{{new_category}}</strong> handling queues upon signature receipt.</p>'
  },
  {
    id: 'fees',
    label: '4. Service Fees & Retainer Scope',
    description: 'Billing adjustment clause for category scope changes',
    html: '<h3>4. Service Fees &amp; Retainer Terms</h3><p>Any adjustments to professional fees, disbursements, or retainer schedules associated with <strong>{{new_category}}</strong> will be itemized in the client billing schedule. Unearned retainer balances under <strong>{{old_category}}</strong> will automatically transfer to the new service scope.</p>'
  },
  {
    id: 'consent',
    label: '5. Client Authorization & Electronic Signature',
    description: 'Client confirmation and legal electronic signature',
    html: '<h3>5. Client Authorization &amp; Consent</h3><p>By providing an electronic signature below, the Client confirms that they have reviewed, understood, and agreed to the updated terms and checklist for <strong>{{new_category}}</strong>, and authorize Operations to proceed accordingly.</p>'
  },
  {
    id: 'continuity',
    label: '6. Continuity of Prior Agreement Terms',
    description: 'Preserves confidentiality and non-superseded original terms',
    html: '<p><em>All other terms, confidentiality obligations, and client responsibilities from the initial service agreement remain in full force and effect without modification.</em></p>'
  }
];

function interpolateAgreementText(templateBody, vars, isPreview = false) {
  if (!templateBody) return '';
  let text = String(templateBody);
  if (text.includes('\\n')) {
    text = text.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n');
  }
  const today = vars.date || new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const wrap = (val, label) => {
    const s = esc(String(val ?? ''));
    if (!isPreview) return s;
    return `<span class="a4-sample-token" title="Auto-filled from ${esc(label)}">${s}</span>`;
  };

  return text
    .replace(/\{\{\s*client_name\s*\}\}/gi, wrap(vars.client_name || 'Ahmed Example', 'Client Name'))
    .replace(/\{\{\s*file_id\s*\}\}/gi, wrap(vars.file_id ? String(vars.file_id) : '1042', 'File #'))
    .replace(/\{\{\s*old_category\s*\}\}/gi, wrap(vars.old_category || 'Initial Consultation', 'Current Category'))
    .replace(/\{\{\s*new_category\s*\}\}/gi, wrap(vars.new_category || 'Express Entry Comprehensive', 'New Category'))
    .replace(/\{\{\s*target_category\s*\}\}/gi, wrap(vars.new_category || 'Express Entry Comprehensive', 'New Category'))
    .replace(/\{\{\s*new_version\s*\}\}/gi, wrap(vars.new_version ? String(vars.new_version) : '2', 'Version'))
    .replace(/\{\{\s*date\s*\}\}/gi, wrap(today, 'Date'))
    .replace(/\{\{\s*portal_url\s*\}\}/gi, wrap(vars.portal_url || location.origin, 'Portal URL'));
}

let cachedCompanyBranding = null;

async function loadCompanyBranding(forceRefresh = false) {
  if (cachedCompanyBranding && !forceRefresh) return cachedCompanyBranding;
  try {
    const res = await api('branding');
    cachedCompanyBranding = {
      companyName: res?.companyName || 'Operations Immigration & Legal Services',
      documentSubtitle: res?.documentSubtitle || 'OFFICIAL ADDENDUM TO SERVICE ENGAGEMENT',
      logoUrl: res?.logoUrl || '',
      hasLogo: Boolean(res?.logoUrl)
    };
  } catch (err) {
    cachedCompanyBranding = {
      companyName: 'Operations Immigration & Legal Services',
      documentSubtitle: 'OFFICIAL ADDENDUM TO SERVICE ENGAGEMENT',
      logoUrl: '',
      hasLogo: false
    };
  }
  globalThis.companyBranding = cachedCompanyBranding;
  return cachedCompanyBranding;
}

function renderMiniLetterheadPreview(brandingData) {
  const cName = (brandingData?.companyName || 'Operations Immigration & Legal Services').trim();
  const cSub = (brandingData?.documentSubtitle || 'OFFICIAL ADDENDUM TO SERVICE ENGAGEMENT').trim();
  const hasLogo = Boolean(brandingData?.logoUrl);

  return `
    <div class="mini-letterhead-content">
      <div class="mini-brand-row">
        ${hasLogo
          ? `<div class="mini-logo-container"><img src="${esc(brandingData.logoUrl)}" class="mini-logo-img" alt="Logo" /></div>`
          : `<div class="mini-emblem">${esc((cName.charAt(0) || '⚖').toUpperCase())}</div>`
        }
        <div class="mini-text-stack">
          <span class="mini-title">${esc(cName.toUpperCase())}</span>
          <span class="mini-subtitle">${esc(cSub.toUpperCase())}</span>
        </div>
      </div>
      <div class="mini-meta-badge">
        <span class="mini-meta-lbl">DOCUMENT REF</span>
        <span class="mini-meta-code">AGR-SAMPLE-REV</span>
        <span class="mini-meta-dt">${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
      </div>
    </div>
  `;
}

function defaultAgreementText(file, targetCategoryName, targetVersion) {
  return 'richtext:v1:<h3>1. Scope of Service Modification</h3><p>This Service Change Agreement &amp; Addendum (&quot;Addendum&quot;) modifies the scope of services previously agreed upon between the Client and Operations. Both parties agree that the client\'s file will be transitioned to the Proposed New Category indicated above.</p><h3>2. Modification of Requirements &amp; Document Checklist</h3><p>Upon execution of this Addendum by the Client:</p><ol><li>The existing document checklist will be archived and retained in the file history.</li><li>A revised document and information checklist for <strong>' + esc(targetCategoryName) + ' (v' + esc(targetVersion) + ')</strong> will take effect immediately.</li><li>Any previously approved items incompatible with the new category will be superseded.</li><li>File progression, reviews, and document collection are temporarily held until this Addendum is executed or cancelled by Operations.</li></ol><h3>3. Client Authorization &amp; Consent</h3><p>By signing below, the Client confirms that they have reviewed and agreed to the terms of this service transition, and authorize Operations to update the service checklist and requirements for this file.</p><p><em>All other terms, conditions, and obligations of the initial service engagement remain in full force and effect.</em></p>';
}

function formatA4DocumentHtml(title, rawBody, meta = {}, options = {}) {
  const mode = options.mode || 'preview';
  const docTitle = (title || 'Service Change Agreement & Addendum').trim();
  const docRef = meta.ref_code || (meta.file_id ? `AGR-${meta.file_id}-REV` : 'AGR-DOC-101');
  const docDate = meta.date || new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const branding = meta.branding || options.branding || globalThis.companyBranding || cachedCompanyBranding || {
    companyName: 'Operations Immigration & Legal Services',
    documentSubtitle: 'OFFICIAL ADDENDUM TO SERVICE ENGAGEMENT',
    logoUrl: '',
    hasLogo: false
  };
  const orgTitle = (branding.companyName || 'Operations Immigration & Legal Services').trim();
  const orgSubtitle = (branding.documentSubtitle || 'OFFICIAL ADDENDUM TO SERVICE ENGAGEMENT').trim();
  const hasCustomLogo = Boolean(branding.logoUrl);

  // 1. Process body into sanitized HTML with placeholders interpolated
  const cleanBody = ensureRichAgreementBody(rawBody);
  let contentHtml = cleanBody.startsWith('richtext:v1:')
    ? (globalThis.OperationsRichText ? OperationsRichText.sanitize(cleanBody.slice(12)) : cleanBody.slice(12))
    : cleanBody;

  const isPreview = options.highlightTokens ?? (mode === 'preview');
  contentHtml = interpolateAgreementText(contentHtml, meta, isPreview);

  // 2. Parse into top-level DOM block elements
  const container = document.createElement('div');
  container.innerHTML = contentHtml;
  let childNodes = Array.from(container.children);
  if (!childNodes.length && container.textContent.trim()) {
    const p = document.createElement('p');
    p.textContent = container.textContent.trim();
    childNodes = [p];
  }

  // 3. Deduplicate redundant title / header block in body text (only if more than 1 block exists)
  if (childNodes.length > 1) {
    const firstTag = childNodes[0].tagName.toUpperCase();
    const firstText = (childNodes[0].textContent || '').trim().toLowerCase();
    const cleanDocTitle = docTitle.toLowerCase();
    if ((firstTag === 'H1' || firstTag === 'H2') && (firstText === cleanDocTitle || firstText.includes('agreement') || firstText.includes('addendum'))) {
      childNodes.shift();
    }
  }
  if (childNodes.length > 1) {
    const text = (childNodes[0].textContent || '').toLowerCase();
    if (text.includes('client name:') && (text.includes('file reference:') || text.includes('category:'))) {
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
              <div><strong>Entity:</strong> ${esc(orgTitle)}</div>
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
      const emblemHtml = hasCustomLogo
        ? `<div class="a4-logo-container"><img src="${esc(branding.logoUrl)}" class="a4-company-logo" alt="${esc(orgTitle)} Logo" /></div>`
        : `<div class="a4-emblem" aria-hidden="true">${esc((orgTitle.charAt(0) || '⚖').toUpperCase())}</div>`;

      pageHeaderHtml = `
        <div class="a4-letterhead">
          <div class="a4-letterhead-brand">
            ${emblemHtml}
            <div class="a4-brand-text">
              <span class="a4-org-title">${esc(orgTitle.toUpperCase())}</span>
              <span class="a4-org-subtitle">${esc(orgSubtitle.toUpperCase())}</span>
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
  await loadCompanyBranding();
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

  const initialBody = ensureRichAgreementBody(interpolateAgreementText(activeTemplate.body, getTemplateVars(firstCat), false));

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
      const interpolated = interpolateAgreementText(selectedTpl.body, getTemplateVars(selectedCat), false);
      if (modalEditor) {
        const cleanHtml = ensureRichAgreementBody(interpolated).replace(/^richtext:v1:/, '');
        modalEditor.commands.setContent(cleanHtml);
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

async function openEditAgreementModal(file, pendingReq, onComplete) {
  await loadCompanyBranding();
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
            guideEditor('Agreement terms & clauses', 'agreementText', ensureRichAgreementBody(pendingReq.agreement_text)) +
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

async function openSignatureModal(file, pendingReq, onComplete) {
  await loadCompanyBranding();
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

async function openViewSignedAgreementModal(req) {
  await loadCompanyBranding();
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
  const [templates, branding] = await Promise.all([
    api('agreement-templates'),
    loadCompanyBranding(true)
  ]);

  if (!selectedAgreementTemplateId || !templates.some(t => String(t.id) === String(selectedAgreementTemplateId))) {
    selectedAgreementTemplateId = (templates.find(t => t.is_default) || templates[0])?.id || null;
  }

  let activeSettingsPreview = null;

  const section = document.createElement('div');
  section.id = 'agreement-templates';
  section.className = 'agreements-settings-wrapper';

  const brandingCardHtml = `
    <section class="card company-branding-card" id="company-branding-section">
      <div class="branding-card-header">
        <div class="branding-header-text">
          <h2>Company branding &amp; agreement letterhead</h2>
          <p class="muted">Upload your organization logo and define legal document headers. These appear at the top of all Category Change Agreements, client review portals, and PDF downloads.</p>
        </div>
        <div class="branding-header-badge">
          <span id="branding-status-pill" class="badge ${branding.hasLogo ? 'accepted' : 'neutral'}">${branding.hasLogo ? 'Custom Logo Active' : 'Default Emblem'}</span>
        </div>
      </div>

      <div class="branding-grid">
        <div class="branding-inputs-col">
          <div class="branding-field-group">
            <label for="branding-company-name"><strong>Company / Organization Legal Name</strong></label>
            <input type="text" id="branding-company-name" value="${esc(branding.companyName || '')}" placeholder="e.g. Operations Immigration &amp; Legal Services" maxlength="200" required />
            <span class="hint">Appears in bold uppercase on the letterhead and in the authorized officer signature block.</span>
          </div>

          <div class="branding-field-group">
            <label for="branding-document-subtitle"><strong>Document Subtitle / Legal Tagline</strong></label>
            <input type="text" id="branding-document-subtitle" value="${esc(branding.documentSubtitle || '')}" placeholder="e.g. OFFICIAL ADDENDUM TO SERVICE ENGAGEMENT" maxlength="200" />
            <span class="hint">Appears directly beneath your company name on the letterhead.</span>
          </div>

          <div class="branding-field-group logo-management-group">
            <label><strong>Company Logo</strong></label>
            <div class="logo-uploader-box">
              <input type="file" id="branding-logo-file-input" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" style="display:none;" />
              <div class="logo-uploader-status-row">
                <div id="branding-logo-thumb-wrapper" class="logo-thumb-wrapper">
                  ${branding.logoUrl
                    ? `<img src="${esc(branding.logoUrl)}" id="branding-thumb-img" alt="Current Company Logo" />`
                    : `<div class="logo-thumb-placeholder" id="branding-thumb-empty"><span class="empty-icon">🏢</span><span>No Logo</span></div>`
                  }
                </div>
                <div class="logo-uploader-controls">
                  <button type="button" id="branding-upload-btn" class="secondary">
                    <span class="upload-icon">📁</span> Upload new logo image
                  </button>
                  <div id="branding-remove-container">
                    ${branding.logoUrl ? `<button type="button" id="branding-remove-btn" class="danger-button small">Remove custom logo</button>` : ''}
                  </div>
                  <span class="hint logo-specs-hint">Supported formats: PNG, JPG, WebP, SVG, GIF (max 4 MB). Recommended transparent PNG or SVG.</span>
                </div>
              </div>
            </div>
          </div>

          <div class="branding-actions-row">
            <button type="button" id="branding-save-info-btn" class="primary">Save Company Branding</button>
            <span id="branding-live-save-indicator" class="branding-indicator" aria-live="polite"></span>
          </div>
        </div>

        <div class="branding-preview-col">
          <div class="branding-preview-card">
            <div class="branding-preview-card-title">
              <span>Letterhead Live Preview</span>
              <span class="preview-mini-pill">A4 Simulation</span>
            </div>
            <div class="branding-mini-letterhead" id="branding-mini-preview">
              ${renderMiniLetterheadPreview(branding)}
            </div>
            <p class="branding-preview-hint">💡 Changes to your company name, subtitle, or logo update both this preview and the multi-page A4 document below in real time.</p>
          </div>
        </div>
      </div>
    </section>
  `;

  const templatesCardHtml = card(
    'Category change agreements',
    `<div class="agreement-builder-intro">
      <div class="intro-icon" aria-hidden="true">💡</div>
      <div class="intro-text">
        <h4>How Category Change Agreements Work</h4>
        <p>When staff initiates a category change on any client file, the file is automatically placed on hold and this agreement is sent to the client. Requirements only change once the client electronically signs.</p>
        <div class="intro-steps">
          <span class="intro-step"><strong>1. Edit terms:</strong> Format clauses directly like Word or Google Docs.</span>
          <span class="intro-step"><strong>2. Insert fields:</strong> Use Smart Buttons (Client Name, File #) to inject live file data.</span>
          <span class="intro-step"><strong>3. Live preview:</strong> Inspect the authentic A4 multi-page document on the right.</span>
        </div>
      </div>
    </div>
    <div class="template-selection">
      <label>Choose agreement template
        <select id="agreement-template-choice" aria-label="Agreement template">
          ${templates.map(t => '<option value="' + t.id + '">' + esc(t.name) + (t.is_default ? ' · Default' : '') + '</option>').join('')}
        </select>
      </label>
      <button id="new-agreement-template">＋ New agreement template</button>
    </div>
    <div id="agreement-template-editor"></div>`
  );

  section.innerHTML = brandingCardHtml + templatesCardHtml;
  content.appendChild(section);

  const headerActions = document.querySelector('#header-actions');
  if (headerActions && !headerActions.querySelector('#jump-agreement-templates')) {
    headerActions.insertAdjacentHTML('beforeend', '<button id="jump-agreement-templates">Agreements &amp; branding</button>');
  }

  // Bind branding controls
  const nameInput = section.querySelector('#branding-company-name');
  const subInput = section.querySelector('#branding-document-subtitle');
  const miniPreview = section.querySelector('#branding-mini-preview');
  const thumbWrapper = section.querySelector('#branding-logo-thumb-wrapper');
  const removeContainer = section.querySelector('#branding-remove-container');
  const statusPill = section.querySelector('#branding-status-pill');
  const uploadBtn = section.querySelector('#branding-upload-btn');
  const fileInput = section.querySelector('#branding-logo-file-input');
  const saveBtn = section.querySelector('#branding-save-info-btn');
  const saveIndicator = section.querySelector('#branding-live-save-indicator');

  function updateMiniPreview() {
    if (miniPreview) {
      miniPreview.innerHTML = renderMiniLetterheadPreview(cachedCompanyBranding);
    }
  }

  function updateBrandingStatusPill() {
    if (statusPill) {
      statusPill.className = `badge ${cachedCompanyBranding.hasLogo ? 'accepted' : 'neutral'}`;
      statusPill.textContent = cachedCompanyBranding.hasLogo ? 'Custom Logo Active' : 'Default Emblem';
    }
  }

  function renderThumb() {
    if (!thumbWrapper) return;
    if (cachedCompanyBranding.logoUrl) {
      thumbWrapper.innerHTML = `<img src="${esc(cachedCompanyBranding.logoUrl)}" id="branding-thumb-img" alt="Current Company Logo" />`;
    } else {
      thumbWrapper.innerHTML = `<div class="logo-thumb-placeholder" id="branding-thumb-empty"><span class="empty-icon">🏢</span><span>No Logo</span></div>`;
    }
  }

  function bindRemoveButton() {
    if (!removeContainer) return;
    if (cachedCompanyBranding.logoUrl) {
      removeContainer.innerHTML = `<button type="button" id="branding-remove-btn" class="danger-button small">Remove custom logo</button>`;
      const removeBtn = removeContainer.querySelector('#branding-remove-btn');
      if (removeBtn) {
        removeBtn.onclick = async () => {
          if (!confirm('Remove custom logo and restore the default emblem on agreements?')) return;
          removeBtn.disabled = true;
          try {
            await api('settings/branding/logo', 'DELETE');
            cachedCompanyBranding.logoUrl = '';
            cachedCompanyBranding.hasLogo = false;
            globalThis.companyBranding = cachedCompanyBranding;

            renderThumb();
            bindRemoveButton();
            updateBrandingStatusPill();
            updateMiniPreview();
            if (activeSettingsPreview) activeSettingsPreview();
            success('Custom logo removed. Default company emblem restored.');
          } catch (err) {
            report(err);
          } finally {
            removeBtn.disabled = false;
          }
        };
      }
    } else {
      removeContainer.innerHTML = '';
    }
  }

  bindRemoveButton();

  if (uploadBtn && fileInput) {
    uploadBtn.onclick = () => fileInput.click();
    fileInput.onchange = async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      if (file.size > 4 * 1024 * 1024) {
        report(new Error('Selected logo exceeds 4MB limit. Please choose a smaller image file.'));
        fileInput.value = '';
        return;
      }
      uploadBtn.disabled = true;
      uploadBtn.innerHTML = '<span class="upload-icon">⏳</span> Uploading logo…';
      try {
        const fd = new FormData();
        fd.append('logo', file);
        const res = await api('settings/branding/logo', 'POST', fd);

        cachedCompanyBranding.logoUrl = res.logoUrl;
        cachedCompanyBranding.hasLogo = true;
        globalThis.companyBranding = cachedCompanyBranding;

        renderThumb();
        bindRemoveButton();
        updateBrandingStatusPill();
        updateMiniPreview();
        if (activeSettingsPreview) activeSettingsPreview();
        success('Company logo uploaded successfully! Letterheads updated.');
      } catch (err) {
        report(err);
      } finally {
        uploadBtn.disabled = false;
        uploadBtn.innerHTML = '<span class="upload-icon">📁</span> Upload new logo image';
        fileInput.value = '';
      }
    };
  }

  const handleTextChange = () => {
    cachedCompanyBranding.companyName = nameInput ? nameInput.value.trim() || 'Operations Immigration & Legal Services' : 'Operations Immigration & Legal Services';
    cachedCompanyBranding.documentSubtitle = subInput ? subInput.value.trim() || 'OFFICIAL ADDENDUM TO SERVICE ENGAGEMENT' : 'OFFICIAL ADDENDUM TO SERVICE ENGAGEMENT';
    globalThis.companyBranding = cachedCompanyBranding;

    updateMiniPreview();
    if (activeSettingsPreview) activeSettingsPreview();
  };

  if (nameInput) nameInput.addEventListener('input', handleTextChange);
  if (subInput) subInput.addEventListener('input', handleTextChange);

  if (saveBtn) {
    saveBtn.onclick = async () => {
      const companyName = nameInput ? nameInput.value.trim() : '';
      const documentSubtitle = subInput ? subInput.value.trim() : '';
      if (!companyName) {
        report(new Error('Company name cannot be blank.'));
        nameInput?.focus();
        return;
      }
      saveBtn.disabled = true;
      if (saveIndicator) saveIndicator.textContent = 'Saving…';
      try {
        const res = await api('settings/branding', 'PUT', { companyName, documentSubtitle });
        cachedCompanyBranding.companyName = res.branding.companyName;
        cachedCompanyBranding.documentSubtitle = res.branding.documentSubtitle;
        globalThis.companyBranding = cachedCompanyBranding;

        updateMiniPreview();
        if (activeSettingsPreview) activeSettingsPreview();
        if (saveIndicator) {
          saveIndicator.textContent = 'Saved!';
          setTimeout(() => { if (saveIndicator) saveIndicator.textContent = ''; }, 3000);
        }
        success('Company branding saved successfully.');
      } catch (err) {
        if (saveIndicator) saveIndicator.textContent = '';
        report(err);
      } finally {
        saveBtn.disabled = false;
      }
    };
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
    const richBody = ensureRichAgreementBody(t.body);

    pane.innerHTML = `
      <div class="agreement-template-grid">
        <div class="agreement-template-form-col">
          ${form('agreement-template-form',
            input('Template name (management label)', 'name', 'text', t.name, 'required maxlength="160"') +
            input('Agreement title (shown on A4 document header)', 'title', 'text', t.title, 'required maxlength="240"') +
            `
            <div class="builder-smart-fields">
              <div class="smart-fields-header">
                <div class="smart-fields-title">
                  <span class="smart-sparkle-icon" aria-hidden="true">✨</span>
                  <strong>Smart Client Fields</strong>
                  <span class="smart-helper-pill">Auto-filled for each client</span>
                </div>
                <span class="smart-fields-hint">Click a button to insert client details at your cursor position:</span>
              </div>
              <div class="smart-fields-buttons">
                <button type="button" class="smart-token-btn" data-agreement-token="client_name" title="Inserts client's legal full name (e.g. Ahmed Example)">
                  <span class="tok-icon">👤</span>
                  <span class="tok-label">Client Name</span>
                  <code class="tok-code">{{client_name}}</code>
                </button>
                <button type="button" class="smart-token-btn" data-agreement-token="file_id" title="Inserts client file reference number (e.g. 1042)">
                  <span class="tok-icon">📁</span>
                  <span class="tok-label">File #</span>
                  <code class="tok-code">{{file_id}}</code>
                </button>
                <button type="button" class="smart-token-btn" data-agreement-token="old_category" title="Inserts current active category (e.g. Initial Consultation)">
                  <span class="tok-icon">🔄</span>
                  <span class="tok-label">Current Category</span>
                  <code class="tok-code">{{old_category}}</code>
                </button>
                <button type="button" class="smart-token-btn" data-agreement-token="new_category" title="Inserts proposed target category (e.g. Express Entry Comprehensive)">
                  <span class="tok-icon">✨</span>
                  <span class="tok-label">New Category</span>
                  <code class="tok-code">{{new_category}}</code>
                </button>
                <button type="button" class="smart-token-btn" data-agreement-token="new_version" title="Inserts category version number (e.g. 2)">
                  <span class="tok-icon">🏷️</span>
                  <span class="tok-label">Version #</span>
                  <code class="tok-code">{{new_version}}</code>
                </button>
                <button type="button" class="smart-token-btn" data-agreement-token="date" title="Inserts current execution date">
                  <span class="tok-icon">📅</span>
                  <span class="tok-label">Today's Date</span>
                  <code class="tok-code">{{date}}</code>
                </button>
              </div>
            </div>

            <div class="builder-clause-helper">
              <div class="clause-helper-row">
                <label for="quick-clause-selector" class="clause-helper-label">
                  <span class="clause-icon" aria-hidden="true">📜</span>
                  <strong>Add standard legal clause:</strong>
                </label>
                <select id="quick-clause-selector" class="clause-select" aria-label="Select pre-made legal clause to insert">
                  <option value="">Choose a pre-approved clause to insert at cursor...</option>
                  ${STANDARD_AGREEMENT_CLAUSES.map(c => `<option value="${c.id}">${esc(c.label)}</option>`).join('')}
                </select>
                <button type="button" id="insert-clause-btn" class="secondary clause-btn">➕ Insert Clause</button>
              </div>
            </div>
            ` +
            guideEditor('Agreement terms & legal clauses', 'body', richBody) +
            `<label class="agreement-default-checkbox"><input type="checkbox" name="isDefault" ${t.is_default ? 'checked' : ''}><span>Set as default template for category changes</span></label>` +
            '<p class="hint">The legal terms authored above will be printed on the official A4 agreement sent to clients when their service category changes.</p>',
            'Save agreement template'
          )}
          <div class="row-actions agreement-template-row-actions">
            <button type="button" id="reset-agreement-template" class="secondary reset-template-btn" title="Reset this template's text back to clean standard clauses">🔄 Reset to standard clauses</button>
            <button type="button" id="delete-agreement-template" class="danger-button">Delete template</button>
          </div>
        </div>
        <div class="agreement-template-preview-col" role="region" aria-label="Agreement template preview">
          <div class="preview-heading">
            <div class="preview-title-wrap">
              <strong>Live Agreement Preview</strong>
              <span class="preview-badge">A4 Page View · Auto-Break</span>
            </div>
            <div class="preview-actions">
              <button type="button" id="fullscreen-a4-preview-btn" class="preview-action-btn" title="Inspect full document in large modal view">👁️ Fullscreen A4</button>
            </div>
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
        { mode: 'preview', highlightTokens: true }
      );
    }

    activeSettingsPreview = updateSettingsPreview;

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

    // Clause inserter handler
    const clauseSelect = pane.querySelector('#quick-clause-selector');
    const insertBtn = pane.querySelector('#insert-clause-btn');
    if (insertBtn && clauseSelect) {
      insertBtn.onclick = () => {
        const clauseId = clauseSelect.value;
        const clause = STANDARD_AGREEMENT_CLAUSES.find(c => c.id === clauseId);
        if (!clause) {
          report(new Error('Please select a clause from the dropdown first.'));
          return;
        }
        if (editor) {
          editor.chain().focus().insertContent(clause.html).run();
          clauseSelect.value = '';
          schedulePreview();
          success(`Inserted "${clause.label}".`);
        }
      };
    }

    // Reset template handler
    const resetBtn = pane.querySelector('#reset-agreement-template');
    if (resetBtn) {
      resetBtn.onclick = () => {
        if (!confirm('Reset this template\'s legal clauses to standard clauses? Your current edits in the editor will be replaced.')) return;
        const defaultRaw = defaultAgreementText(null, '{{new_category}}', '{{new_version}}');
        const cleanDefaultHtml = ensureRichAgreementBody(defaultRaw).replace(/^richtext:v1:/, '');
        if (editor) {
          editor.commands.setContent(cleanDefaultHtml);
          schedulePreview();
          success('Template terms reset to standard clauses.');
        }
      };
    }

    // Fullscreen A4 Preview handler
    const fullscreenBtn = pane.querySelector('#fullscreen-a4-preview-btn');
    if (fullscreenBtn) {
      fullscreenBtn.onclick = () => {
        const currentTitle = titleInput ? titleInput.value.trim() : t.title;
        const currentHtml = editor ? editor.getHTML() : (t.body || '');
        const modalHtml = `
          <div class="agreement-fullscreen-shell">
            <div class="modal-signing-viewport a4-document-viewport" style="max-height: 75vh;">
              ${formatA4DocumentHtml(currentTitle, currentHtml, sampleVars, { mode: 'preview', highlightTokens: true })}
            </div>
            <div class="modal-signing-footer">
              <button type="button" class="print-btn secondary" onclick="window.print()">🖨️ Print / Save PDF</button>
              <button type="button" class="primary" onclick="closeModal()">Done</button>
            </div>
          </div>
        `;
        modal('Full Agreement Preview (A4 Page View)', modalHtml);
      };
    }

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
    const defaultBody = defaultAgreementText(null, '{{new_category}}', '{{new_version}}');
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

