/**
 * clientSummary.js — Client Summary Form API Routes
 *
 * For completed/signed contracts, allows authorized users to fill,
 * update, and export the official 9-page Client Summary Form.
 *
 * Access Rules:
 *   - SUPER_ADMIN & ADMIN: Can search and fill Client Summaries for ALL completed contracts.
 *   - Selective Staff/Sales: Allowed only if `can_fill_client_summary = 1`.
 */
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const operationsHandoff = require('../services/operationsHandoff');
const { ghlAuthMiddleware } = require('../middleware/ghlAuth');
const { loadAppUser, requireClientSummaryAccess, hasPermission } = require('../middleware/rbac');
const settingsService = require('../services/settingsService');
const ghlService = require('../services/ghlService');
const { logContractAuditAndSync } = require('../services/auditSyncService');

// Apply authentication, user context, and Client Summary permission guard
router.use(ghlAuthMiddleware, loadAppUser, requireClientSummaryAccess);

// ─── GET /api/client-summary/contracts ───────────────────────────────────────
// Search and list completed contracts available for Client Summary
router.get('/contracts', async (req, res) => {
  try {
    const { userId, locationId } = req.ghlUser;
    const { role } = req.appUser;
    const { q, limit = 50, page = 1 } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params = [locationId];

    // Only signed / completed contracts can have a Client Summary
    let whereClause = `WHERE ci.location_id = ? AND (ci.state = 'COMPLETED' OR ci.signed_at IS NOT NULL)`;

    // Restriction check for non-admin users
    const restrictToAssigned = settingsService.get('RESTRICT_CONTACTS_TO_ASSIGNED', 'true') !== 'false';
    const canViewAll = hasPermission(role, 'contract:view:all') || !restrictToAssigned;

    if (!canViewAll) {
      whereClause += ' AND ci.assigned_user_id = ?';
      params.push(userId);
    }

    // Keyword search filter (Client Name, Email, Phone, Contract ID, GHL Contact ID)
    if (q && q.trim()) {
      const searchTerm = `%${q.trim()}%`;
      whereClause += ` AND (
        ci.recipient_name LIKE ? OR
        ci.recipient_email LIKE ? OR
        ci.recipient_phone LIKE ? OR
        ci.id LIKE ? OR
        ci.ghl_contact_id LIKE ?
      )`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    const [contracts] = await db.execute(
      `SELECT ci.id, ci.state, ci.recipient_name, ci.recipient_email, ci.recipient_phone,
              ci.assigned_user_id, ci.assigned_user_name, ci.created_at, ci.signed_at, ci.completed_at,
              ct.name AS template_name, ct.contract_type,
              ccs.status AS summary_status, ccs.completed_by_name, ccs.updated_at AS summary_updated_at
       FROM contract_instances ci
       JOIN contract_templates ct ON ct.id = ci.template_id
       LEFT JOIN contract_client_summaries ccs ON ccs.contract_id = ci.id AND ccs.location_id = ci.location_id
       ${whereClause}
       ORDER BY ci.signed_at DESC, ci.updated_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    res.json({ success: true, contracts });
  } catch (err) {
    console.error('[Client Summary] List contracts error:', err.message);
    res.status(500).json({ error: 'Failed to search completed contracts.' });
  }
});

// ─── GET /api/client-summary/schema ──────────────────────────────────────────
// Get the active custom schema (custom sections and fields) for Client Summary
router.get('/schema', async (req, res) => {
  try {
    const raw = settingsService.get('CLIENT_SUMMARY_CUSTOM_SCHEMA', '{"sections":[],"fields":[]}');
    let schema = { sections: [], fields: [] };
    try {
      schema = typeof raw === 'string' ? JSON.parse(raw) : (raw || { sections: [], fields: [] });
    } catch (_) {
      schema = { sections: [], fields: [] };
    }
    if (!Array.isArray(schema.sections)) schema.sections = [];
    if (!Array.isArray(schema.fields)) schema.fields = [];

    res.json({ success: true, schema });
  } catch (err) {
    console.error('[Client Summary] Get schema error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve Client Summary schema.' });
  }
});

// ─── PUT /api/client-summary/schema ──────────────────────────────────────────
// Update custom schema (sections & fields) for Client Summary (Admins only)
router.put('/schema', async (req, res) => {
  try {
    const { role } = req.appUser;
    const canManage = ['SUPER_ADMIN', 'ADMIN'].includes(role) || hasPermission(role, 'settings:manage');
    if (!canManage) {
      return res.status(403).json({ error: 'Only administrators can update the Client Summary schema.' });
    }

    const { schema } = req.body;
    if (!schema || typeof schema !== 'object') {
      return res.status(400).json({ error: 'Invalid schema payload.' });
    }

    const cleanSections = Array.isArray(schema.sections) ? schema.sections.map((s, idx) => ({
      id: s.id || `sec_custom_${Date.now()}_${idx}`,
      title: String(s.title || '').trim(),
      description: String(s.description || '').trim(),
      order: Number(s.order || idx + 1),
    })).filter(s => s.title) : [];

    const cleanFields = Array.isArray(schema.fields) ? schema.fields.map((f, idx) => ({
      id: f.id || `fld_custom_${Date.now()}_${idx}`,
      key: String(f.key || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'),
      label: String(f.label || '').trim(),
      type: ['text', 'textarea', 'number', 'date', 'dropdown', 'yes_no', 'checkbox'].includes(f.type) ? f.type : 'text',
      section: String(f.section || 'page1').trim(),
      required: Boolean(f.required),
      fullWidth: Boolean(f.fullWidth),
      placeholder: String(f.placeholder || '').trim(),
      options: Array.isArray(f.options) ? f.options.map(o => String(o).trim()).filter(Boolean) : [],
    })).filter(f => f.key && f.label) : [];

    cleanSections.sort((a, b) => a.order - b.order);

    const finalSchema = {
      sections: cleanSections,
      fields: cleanFields,
      updatedAt: new Date().toISOString(),
    };

    await settingsService.set('CLIENT_SUMMARY_CUSTOM_SCHEMA', JSON.stringify(finalSchema));

    res.json({
      success: true,
      message: 'Client Summary custom schema saved successfully.',
      schema: finalSchema,
    });
  } catch (err) {
    console.error('[Client Summary] Update schema error:', err.message);
    res.status(500).json({ error: 'Failed to update Client Summary schema: ' + err.message });
  }
});

// ─── GET /api/client-summary/:contractId ────────────────────────────────────
// Fetch existing client summary or generate prefilled template
router.get('/:contractId', async (req, res) => {
  try {
    const { userId, locationId } = req.ghlUser;
    const { role } = req.appUser;
    const { contractId } = req.params;

    // Verify contract exists and is completed
    const [contractRows] = await db.execute(
      `SELECT ci.*, ct.name AS template_name, ct.contract_type
       FROM contract_instances ci
       JOIN contract_templates ct ON ct.id = ci.template_id
       WHERE ci.id = ? AND ci.location_id = ?`,
      [contractId, locationId]
    );

    if (!contractRows.length) {
      return res.status(404).json({ error: 'Contract not found.' });
    }

    const contract = contractRows[0];
    const isCompleted = contract.state === 'COMPLETED' || contract.signed_at;
    if (!isCompleted) {
      return res.status(400).json({
        error: 'Contract not completed',
        message: 'Client Summary can only be filled once the contract has been signed by the client.',
      });
    }

    // Check assignment permissions if restricted
    const restrictToAssigned = settingsService.get('RESTRICT_CONTACTS_TO_ASSIGNED', 'true') !== 'false';
    const canViewAll = hasPermission(role, 'contract:view:all') || !restrictToAssigned;
    if (!canViewAll && contract.assigned_user_id !== userId) {
      return res.status(403).json({ error: 'You are not assigned to this completed contract.' });
    }

    // Look for existing summary
    const [summaryRows] = await db.execute(
      `SELECT * FROM contract_client_summaries WHERE location_id = ? AND contract_id = ? LIMIT 1`,
      [locationId, contractId]
    );

    if (summaryRows.length) {
      const summaryRow = summaryRows[0];
      let summaryData = {};
      try {
        summaryData = JSON.parse(summaryRow.summary_data_json || '{}');
      } catch (e) {
        summaryData = {};
      }

      return res.json({
        success: true,
        isNew: false,
        status: summaryRow.status,
        completed_by_name: summaryRow.completed_by_name,
        completed_at: summaryRow.completed_at,
        updated_at: summaryRow.updated_at,
        summary: summaryData,
        contract: {
          id: contract.id,
          recipient_name: contract.recipient_name,
          recipient_email: contract.recipient_email,
          recipient_phone: contract.recipient_phone,
          signed_at: contract.signed_at,
          template_name: contract.template_name,
          contract_type: contract.contract_type,
          assigned_user_name: contract.assigned_user_name,
        },
      });
    }

    // Attempt to extract additional fields from contract snapshot or form data
    let intakeData = {};
    try {
      if (contract.form_response_json) {
        intakeData = { ...intakeData, ...JSON.parse(contract.form_response_json) };
      }
      if (contract.form_data_json) {
        intakeData = { ...intakeData, ...JSON.parse(contract.form_data_json) };
      }
      if (contract.snapshot_json) {
        const snap = JSON.parse(contract.snapshot_json);
        if (snap.field_values) {
          intakeData = { ...intakeData, ...snap.field_values };
        }
      }
    } catch (e) {
      // Ignore parse errors on snapshot
    }

    // Format registration date
    let regDate = '';
    try {
      const dt = contract.signed_at ? new Date(contract.signed_at) : new Date(contract.created_at);
      regDate = dt.toISOString().slice(0, 10);
    } catch (_) {
      regDate = new Date().toISOString().slice(0, 10);
    }

    // Pre-fill initial defaults matching the 9-page form
    const initialSummary = {
      // Page 1: General Info
      reg_number: `REF-${contract.id}`,
      reg_date: regDate,
      registered_at: intakeData.registered_at || intakeData.branch || 'Dubai',
      counsellor_name: contract.assigned_user_name || intakeData.counsellor_name || '',
      country_applying_from: intakeData.country_applying_from || intakeData.applying_from || intakeData.residence_country || 'United Arab Emirates',
      country_applying_for: intakeData.country_applying_for || intakeData.destination_country || intakeData.country || '',
      applying_category: intakeData.applying_category || intakeData.visa_category || contract.contract_type || '',
      client_name: contract.recipient_name || intakeData.full_name || intakeData.client_name || '',
      nationality: intakeData.nationality || intakeData.citizen_of || '',
      dob: intakeData.dob || intakeData.date_of_birth || '',
      contact_landline: intakeData.contact_landline || intakeData.landline || '',
      contact_mobile: contract.recipient_phone || intakeData.mobile || intakeData.phone || '',
      email: contract.recipient_email || intakeData.email || '',
      residential_address: intakeData.residential_address || intakeData.address || '',
      expected_submission: intakeData.expected_submission || '8_weeks',

      // Page 2: Immigration Background / History
      q1_applied_countries: [],
      q2_refused_visa: 'no',
      q2_details: { country: '', visa_type: '', refusal_date: '', refusal_reason: '' },
      q3_overstayed: 'no',
      q3_details: { reason: '' },
      q4_deported: 'no',
      q4_details: { country: '', deportation_date: '', port_airport: '', deportation_reason: '' },
      q5_voluntary_depart: 'no',
      q5_details: { departure_date: '', airport_port: '', decision_papers: '', ref_number: '' },
      q6_exclusion_order: 'no',
      q6_details: { date: '', ref_number: '', reason: '' },
      q7_work_permit_ni: 'no',
      q7_details: { ni_number: '' },

      // Page 3: Business Background
      q8_own_business: 'no',
      q8_legal_status: '',
      q9_business_name: intakeData.company_name || intakeData.business_name || '',
      q10_est_date: '',
      q11_partners_shares: [
        { partner: '', shares: '' },
        { partner: '', shares: '' },
        { partner: '', shares: '' },
        { partner: '', shares: '' },
        { partner: '', shares: '' },
        { partner: '', shares: '' },
      ],
      q12_nature_of_business: intakeData.business_nature || '',
      q13_business_docs: {
        company_profile: false,
        ntn_license: false,
        tax_returns: false,
        audit_reports: false,
        business_registration: false,
        business_accreditation: false,
        professional_membership: false,
        premises_documents: false,
        sales_purchase_invoices: false,
        bank_confirmation_letter: false,
        business_bank_statements: false,
        appreciation_letter: false,
        import_export_docs: false,
      },
      q14_other_business_docs: '',

      // Page 4: Business (cont.) & Employment Background
      q15_products_services_desc: '',
      q16_multiple_businesses: '',

      // Employment: Current
      q17_current_employer: intakeData.current_employer || intakeData.employer || '',
      q18_current_designation: intakeData.designation || intakeData.occupation || '',
      q19_current_years: '',
      q20_current_job_desc: '',
      q21_current_expertise: '',

      // Employment: Previous 1
      q22_prev1_employer: '',
      q23_prev1_designation: '',
      q24_prev1_years_worked: '',
      q25_prev1_job_desc: '',
      q26_prev1_expertise: '',

      // Page 5: Previous Employment 2
      q27_prev2_employer: '',
      q28_prev2_designation: '',
      q29_prev2_years_worked: '',
      q30_prev2_job_desc: '',
      q31_prev2_expertise: '',

      // Page 5: Personal / Family Background
      q32_other_nationality: 'no',
      q32_details: { country: '' },
      q33_passport_issue_place: intakeData.passport_issue_place || '',
      q34_address_duration: '',
      q35_criminal_convictions: 'no',
      q35_details: '',
      q36_criminal_charges: 'no',
      q36_details: '',
      q37_spouse_dependents_applying: 'no',
      q37_details: { spouse_name: intakeData.spouse_name || '', dependents_count_names: '' },
      q38_spouse_live_with_you: 'yes',
      q38_details: { address_contact: '' },

      // Page 6: Parents' Details & Medical
      q39_parents_details: {
        father: { given_name: '', family_name: '', dob: '', birth_place: '' },
        mother: { given_name: '', family_name: '', dob: '', birth_place: '' },
      },
      q40_spouse_parents_details: {
        father: { given_name: '', family_name: '', dob: '', birth_place: '' },
        mother: { given_name: '', family_name: '', dob: '', birth_place: '' },
      },
      q41_medical_treatment: 'no',
      q41_details: { pay_for_treatment: 'no', facility_address_contact: '' },

      // Academic Background
      q42_education: {
        phd: { checked: false, institute: '', year: '' },
        masters: { checked: false, institute: '', year: '' },
        post_grad_diploma: { checked: false, institute: '', year: '' },
        bachelors: { checked: false, institute: '', year: '' },
        higher_secondary: { checked: false, institute: '', year: '' },
      },

      // Page 7: Professional Courses, Memberships, Achievements
      q43_prof_courses: ['', '', '', '', '', ''],
      q44_prof_memberships: ['', '', ''],
      q45_other_achievements: ['', ''],

      // Page 8: Financials
      q46_bank_statements: { individual: false, joint: false },
      q46_categories: [],
      q47_investment_funds: {
        own_funds: false,
        third_party_individual: false,
        third_party_company: false,
        agree_endorsing_fee: false,
        agree_visa_ihs_fee: false,
      },
      q48_source_of_funds: '',
      q49_maintenance_funds: {
        applicant: false,
        spouse: false,
        first_child: false,
        additional_child: false,
      },
      q50_english_proficiency: '',

      // Page 9: Course of Action & Signatures
      course_of_action_business_plan: '',
      course_of_action_application: '',
      applicant_signature: {
        signed: false,
        name: contract.recipient_name || '',
        date: regDate,
      },
      counselor_signature: {
        signed: false,
        name: contract.assigned_user_name || req.ghlUser.name || '',
        date: regDate,
      },
    };

    return res.json({
      success: true,
      isNew: true,
      status: 'NOT_STARTED',
      summary: initialSummary,
      contract: {
        id: contract.id,
        recipient_name: contract.recipient_name,
        recipient_email: contract.recipient_email,
        recipient_phone: contract.recipient_phone,
        signed_at: contract.signed_at,
        template_name: contract.template_name,
        contract_type: contract.contract_type,
        assigned_user_name: contract.assigned_user_name,
      },
    });
  } catch (err) {
    console.error('[Client Summary] Fetch error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve client summary.' });
  }
});

// ─── POST /api/client-summary/:contractId ───────────────────────────────────
// Save draft or complete client summary
router.post('/:contractId', async (req, res) => {
  try {
    const { userId, locationId, name = '' } = req.ghlUser;
    const { role } = req.appUser;
    const { contractId } = req.params;
    const { summaryData, status = 'DRAFT' } = req.body;

    if (!summaryData || typeof summaryData !== 'object') {
      return res.status(400).json({ error: 'summaryData is required.' });
    }

    const validStatus = status === 'COMPLETED' ? 'COMPLETED' : 'DRAFT';

    // Verify contract exists and is signed
    const [contractRows] = await db.execute(
      `SELECT ci.*
       FROM contract_instances ci
       WHERE ci.id = ? AND ci.location_id = ?`,
      [contractId, locationId]
    );

    if (!contractRows.length) {
      return res.status(404).json({ error: 'Contract not found.' });
    }

    const contract = contractRows[0];
    const isCompleted = contract.state === 'COMPLETED' || contract.signed_at;
    if (!isCompleted) {
      return res.status(400).json({ error: 'Contract has not been signed by the client yet.' });
    }

    // Role check
    const restrictToAssigned = settingsService.get('RESTRICT_CONTACTS_TO_ASSIGNED', 'true') !== 'false';
    const canViewAll = hasPermission(role, 'contract:view:all') || !restrictToAssigned;
    if (!canViewAll && contract.assigned_user_id !== userId) {
      return res.status(403).json({ error: 'You are not assigned to this contract.' });
    }

    const summaryJson = JSON.stringify(summaryData);
    const completedByName = validStatus === 'COMPLETED' ? (name || userId) : null;
    const completedByUserId = validStatus === 'COMPLETED' ? userId : null;
    const completedAt = validStatus === 'COMPLETED' ? new Date().toISOString() : null;
    // MySQL DATETIME format (strict mode rejects ISO 'T...Z' strings)
    const completedAtDb = completedAt ? completedAt.slice(0, 19).replace('T', ' ') : null;

    // Save the summary and durable Operations event in one MySQL transaction.
    let operationsHandoffQueued = false;
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [lockedContracts] = await connection.execute(
        'SELECT * FROM contract_instances WHERE id=? AND location_id=?' + (db.driver === 'MYSQL' ? ' FOR UPDATE' : ''),
        [contractId, locationId]
      );
      const [previousSummaries] = await connection.execute(
        'SELECT status FROM contract_client_summaries WHERE contract_id=? AND location_id=? LIMIT 1',
        [contractId, locationId]
      );
    await connection.execute(
      `INSERT INTO contract_client_summaries (
        location_id, contract_id, status, summary_data_json,
        completed_by_user_id, completed_by_name, completed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        status = VALUES(status),
        summary_data_json = VALUES(summary_data_json),
        completed_by_user_id = COALESCE(VALUES(completed_by_user_id), completed_by_user_id),
        completed_by_name = COALESCE(VALUES(completed_by_name), completed_by_name),
        completed_at = COALESCE(VALUES(completed_at), completed_at),
        updated_at = NOW()`,
      [
        locationId,
        contractId,
        validStatus,
        summaryJson,
        completedByUserId,
        completedByName,
        completedAtDb,
      ]
    );


      if (validStatus === 'COMPLETED') {
        const result = await operationsHandoff.enqueue(connection, lockedContracts[0], summaryData, completedAt, previousSummaries[0]?.status);
        operationsHandoffQueued = result.queued;
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    // Try delivery immediately after commit; the durable worker retries failures.
    if (operationsHandoffQueued) operationsHandoff.processQueue().catch(error => console.warn('[Operations handoff]', error.message));

    // Audit log & auto-sync client summary event to GHL Conversation InternalComment
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';
    const actionName = validStatus === 'COMPLETED' ? 'CLIENT_SUMMARY_COMPLETED' : 'CLIENT_SUMMARY_SAVED';
    logContractAuditAndSync(contract.id, {
      action: actionName,
      actorType: 'USER',
      actorId: userId,
      actorName: completedByName || name || userId,
      fromState: contract.state,
      toState: contract.state,
      ipAddress: clientIp,
      metadata: { status: validStatus, completedByName: completedByName || name || userId },
      privateToken: req.ghlUser?.privateToken,
    }).catch(err => console.warn('[ClientSummary] Audit sync failed:', err.message));

    res.json({
      success: true,
      status: validStatus,
      completed_by_name: completedByName,
      completed_at: completedAt,
      operations_handoff_queued: operationsHandoffQueued,
      message: validStatus === 'COMPLETED' ? 'Client summary marked as completed.' : 'Client summary draft saved successfully.',
    });
  } catch (err) {
    console.error('[Client Summary] Save error:', err.message);
    res.status(500).json({ error: 'Failed to save client summary.' });
  }
});

// ─── GET /api/client-summary/:contractId/pdf ─────────────────────────────────
// Download standalone Client Summary PDF
router.get('/:contractId/pdf', async (req, res) => {
  try {
    const { locationId } = req.ghlUser;
    const { contractId } = req.params;
    const { generateSummaryPdf } = require('../services/clientSummaryPdfService');

    const [contractRows] = await db.execute(
      `SELECT ci.*, ct.name AS template_name, ct.contract_type
       FROM contract_instances ci
       JOIN contract_templates ct ON ct.id = ci.template_id
       WHERE ci.id = ? AND ci.location_id = ? LIMIT 1`,
      [contractId, locationId]
    );

    if (!contractRows.length) {
      return res.status(404).json({ error: 'Contract not found.' });
    }

    const [summaryRows] = await db.execute(
      `SELECT * FROM contract_client_summaries WHERE location_id = ? AND contract_id = ? LIMIT 1`,
      [locationId, contractId]
    );

    let summaryData = {};
    if (summaryRows.length) {
      try {
        summaryData = JSON.parse(summaryRows[0].summary_data_json || '{}');
      } catch {
        summaryData = {};
      }
    }

    const pdfBuffer = await generateSummaryPdf(contractRows[0], summaryData);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Client_Summary_Contract_${contractId}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('[Client Summary] Download PDF error:', err.message);
    res.status(500).json({ error: 'Failed to generate Client Summary PDF.' });
  }
});

// ─── GET /api/client-summary/:contractId/package-zip ─────────────────────────
// Download compiled Case Package ZIP (Contract PDF, Summary PDF, Attachments, Manifest)
router.get('/:contractId/package-zip', async (req, res) => {
  try {
    const { locationId } = req.ghlUser;
    const { contractId } = req.params;
    const { compileClientPackageZip } = require('../services/clientSummaryZipService');

    const { zipBuffer, zipFilename } = await compileClientPackageZip(contractId, locationId);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);
    res.setHeader('Content-Length', zipBuffer.length);
    res.send(zipBuffer);
  } catch (err) {
    console.error('[Client Summary] Package ZIP error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to compile Case Package ZIP.' });
  }
});

module.exports = router;

