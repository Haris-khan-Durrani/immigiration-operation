function defaultAgreementText(file, targetCategoryName, targetVersion) {
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  return `SERVICE CHANGE AGREEMENT & ADDENDUM

Date: ${today}
Client Name: ${file.client_name}
File Reference: File #${file.id}
Current Service Category: ${file.category_name || 'Current Service'}
Proposed New Service Category: ${targetCategoryName} (v${targetVersion})

1. Scope of Service Modification
This Service Change Agreement & Addendum ("Addendum") modifies the scope of services previously agreed upon between the Client and Operations. Both parties agree that the client's file will be transitioned to the Proposed New Category indicated above.

2. Modification of Requirements & Document Checklist
Upon execution of this Addendum by the Client:
a) The existing document checklist will be archived and retained in the file history.
b) A revised document and information checklist for ${targetCategoryName} will take effect immediately.
c) Any previously approved items incompatible with the new category will be superseded.
d) File progression, reviews, and document collection are temporarily held until this Addendum is executed or cancelled by Operations.

3. Client Authorization & Consent
By signing below, the Client confirms that they have reviewed and agreed to the terms of this service transition, and authorize Operations to update the service checklist and requirements for this file.

All other terms, conditions, and obligations of the initial service engagement remain in full force and effect.`;
}

function initSignaturePad(canvas, onDrawChange) {
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

function openCategoryRequestModal(file, publishedCats, onComplete) {
  if (!publishedCats.length) {
    modal('No categories available', empty('No published categories', 'Publish another service category first before requesting a category change.'));
    return;
  }
  const firstCat = publishedCats[0];
  const initialText = defaultAgreementText(file, firstCat.name, firstCat.version);

  modal('Request Service Category Change', `
    <div class="category-request-form-shell">
      <div class="notice">
        <strong>Conditional Category Change</strong>
        <p>The category will NOT change immediately. The file will be placed on hold and this Service Agreement will be sent to the client. The category changes only once the client signs, or you can cancel this request at any time to resume the current category.</p>
      </div>
      ${form('category-request-form',
        select('Target service category', 'categoryId', publishedCats.map(c => [c.id, `${c.name} (version ${c.version})`])) +
        input('Agreement title', 'agreementTitle', 'text', 'Service Change Agreement & Addendum', 'required maxlength="240"') +
        area('Agreement terms & addendum text', 'agreementText', initialText, 'required rows="10"') +
        '<p class="hint">You can edit these terms now or at any time while the request remains pending client signature.</p>',
        'Send agreement to client'
      )}
    </div>
  `);

  const categorySelect = document.querySelector('#category-request-form [name=categoryId]');
  const agreementTextArea = document.querySelector('#category-request-form [name=agreementText]');
  if (categorySelect && agreementTextArea) {
    categorySelect.onchange = (e) => {
      const selected = publishedCats.find(c => String(c.id) === e.target.value);
      if (selected) {
        agreementTextArea.value = defaultAgreementText(file, selected.name, selected.version);
      }
    };
  }

  bindForm('category-request-form', async v => {
    await api(`cases/${file.id}/category-request`, 'POST', {
      categoryId: Number(v.categoryId),
      agreementTitle: v.agreementTitle,
      agreementText: v.agreementText
    });
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
      ${form('edit-agreement-form',
        input('Agreement title', 'agreementTitle', 'text', pendingReq.agreement_title, 'required maxlength="240"') +
        area('Agreement terms & addendum text', 'agreementText', pendingReq.agreement_text, 'required rows="12"'),
        'Save updated terms'
      )}
    </div>
  `);

  bindForm('edit-agreement-form', async v => {
    await api(`cases/${file.id}/category-request/${pendingReq.id}`, 'PATCH', {
      agreementTitle: v.agreementTitle,
      agreementText: v.agreementText
    });
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
  modal('Review & Sign Service Change Agreement', `
    <div class="agreement-signing-modal">
      <div class="agreement-modal-header">
        <div>
          <h3>${esc(pendingReq.agreement_title)}</h3>
          <p>Target Category: <strong>${esc(pendingReq.target_category_name)}</strong> · File #${file.id}</p>
        </div>
        <span class="badge pending">Pending Signature</span>
      </div>
      
      <div class="agreement-scroll-box" tabindex="0" aria-label="Agreement terms">
        <pre class="agreement-preformatted">${esc(pendingReq.agreement_text)}</pre>
      </div>

      <div class="signature-section">
        <label class="signature-input-label">
          <span>Full Legal Name (Typed Signature)</span>
          <input id="signer-typed-name" type="text" value="${esc(file.client_name)}" required placeholder="Type your legal name" autocomplete="name">
        </label>

        <div class="signature-pad-block">
          <div class="signature-pad-header">
            <span>Drawn Signature</span>
            <button type="button" id="clear-signature-btn" class="link-button">Clear signature</button>
          </div>
          <div class="canvas-wrap">
            <canvas id="signature-canvas" width="600" height="180" aria-label="Draw your signature"></canvas>
            <div class="canvas-hint" id="canvas-hint">Draw your signature here with your finger, stylus, or mouse</div>
          </div>
        </div>

        <label class="agreement-consent-row">
          <input type="checkbox" id="agreement-consent-box">
          <span>I have read, understood, and agree to the terms of this Service Change Agreement and authorize the change in services.</span>
        </label>

        <div class="audit-notice-row">
          <small>🛡️ Electronic signature legally binding. Your typed name, drawn signature, IP address, and timestamp will be securely recorded in the audit trail.</small>
        </div>

        <div class="signature-actions">
          <button type="button" id="close-sign-modal" class="secondary">Close</button>
          <button type="button" id="submit-signature-btn" class="primary" disabled>Sign & Accept Agreement</button>
        </div>
      </div>
    </div>
  `);

  const canvas = document.querySelector('#signature-canvas');
  const typedNameInput = document.querySelector('#signer-typed-name');
  const consentBox = document.querySelector('#agreement-consent-box');
  const submitBtn = document.querySelector('#submit-signature-btn');
  const clearBtn = document.querySelector('#clear-signature-btn');
  const closeBtn = document.querySelector('#close-sign-modal');
  const canvasHint = document.querySelector('#canvas-hint');

  const pad = initSignaturePad(canvas, (hasDrawn) => {
    if (canvasHint) canvasHint.hidden = hasDrawn;
    validate();
  });

  function validate() {
    const hasName = typedNameInput.value.trim().length > 0;
    const hasAgreed = consentBox.checked;
    const hasDrawn = pad.hasDrawn();
    submitBtn.disabled = !(hasName && hasAgreed && hasDrawn);
  }

  typedNameInput.addEventListener('input', validate);
  consentBox.addEventListener('change', validate);
  clearBtn.addEventListener('click', () => {
    pad.clear();
    if (canvasHint) canvasHint.hidden = false;
    validate();
  });
  closeBtn.addEventListener('click', closeModal);

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

function openViewSignedAgreementModal(req) {
  const sig = req.signature_data || {};
  modal(req.agreement_title || 'Service Change Agreement', `
    <div class="agreement-signing-modal">
      <div class="agreement-modal-header">
        <div>
          <h3>${esc(req.agreement_title)}</h3>
          <p>Service: <strong>${esc(req.target_category_name)}</strong> · Status: <span class="badge ${req.status==='SIGNED'?'accepted':req.status==='CANCELLED'?'cancelled':'pending'}">${req.status}</span></p>
        </div>
        <small>${date(req.signed_at || req.created_at)}</small>
      </div>

      <div class="agreement-scroll-box" tabindex="0">
        <pre class="agreement-preformatted">${esc(req.agreement_text)}</pre>
      </div>

      ${req.status === 'SIGNED' ? `
        <div class="signed-evidence-box">
          <h4>Signature Evidence</h4>
          <div class="signature-evidence-grid">
            <div>
              <span class="evidence-label">Signer Legal Name</span>
              <strong>${esc(sig.typedName || 'Client')}</strong>
            </div>
            <div>
              <span class="evidence-label">Signed Timestamp</span>
              <span>${date(sig.signedAt || req.signed_at)}</span>
            </div>
            <div>
              <span class="evidence-label">Signer Email</span>
              <span>${esc(sig.signerEmail || 'Client Account')}</span>
            </div>
            <div>
              <span class="evidence-label">Recorded IP</span>
              <span>${esc(sig.ip || 'Recorded')}</span>
            </div>
          </div>
          ${sig.signatureImage ? `
            <div class="signed-image-container">
              <span class="evidence-label">Drawn Signature</span>
              <img src="${sig.signatureImage}" alt="Signature of ${esc(sig.typedName || '')}" class="signed-signature-image">
            </div>
          ` : ''}
        </div>
      ` : req.status === 'CANCELLED' ? `
        <div class="cancelled-evidence-box">
          <h4>Cancellation Notice</h4>
          <p>Cancelled on ${date(req.cancelled_at)} by ${esc(req.canceller_name || 'Operations')}.</p>
          ${req.cancel_reason ? `<p class="cancel-reason">Reason: ${esc(req.cancel_reason)}</p>` : ''}
        </div>
      ` : ''}

      <div class="form-actions">
        <button type="button" id="close-view-agreement" class="primary">Close</button>
      </div>
    </div>
  `);

  action('#close-view-agreement', closeModal);
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
