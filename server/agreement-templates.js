import {Router} from 'express';
import {db} from './db.js';
import {permit} from './auth.js';
import {fail, json} from './domain.js';
import {transaction} from './workflow.js';
import multer from 'multer';

export const agreementTemplateRoutes = Router();

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 1 }
});

const DEFAULT_BRANDING = {
  companyName: 'Operations Immigration & Legal Services',
  documentSubtitle: 'OFFICIAL ADDENDUM TO SERVICE ENGAGEMENT',
  logoUrl: ''
};

export async function getCompanyBranding() {
  const [rows] = await db.query('SELECT settings FROM application_settings WHERE id=1');
  const settings = json(rows[0]?.settings || {});
  return {
    ...DEFAULT_BRANDING,
    ...(settings.companyBranding || {})
  };
}

// Any authenticated user can read branding for document letterheads
agreementTemplateRoutes.get('/branding', async (req, res) => {
  const branding = await getCompanyBranding();
  res.json({
    companyName: branding.companyName,
    documentSubtitle: branding.documentSubtitle,
    logoUrl: branding.logoUrl || '',
    hasLogo: Boolean(branding.logoUrl)
  });
});

// Management updates company branding texts & optional logo data URL
agreementTemplateRoutes.put('/settings/branding', permit('ADMIN', 'MANAGER'), async (req, res) => {
  const { companyName, documentSubtitle, logoUrl } = req.body;
  if (companyName !== undefined && (typeof companyName !== 'string' || !companyName.trim() || companyName.length > 200)) {
    fail('Enter a valid company name (up to 200 characters).');
  }
  if (documentSubtitle !== undefined && (typeof documentSubtitle !== 'string' || documentSubtitle.length > 200)) {
    fail('Enter a valid document subtitle (up to 200 characters).');
  }

  const current = await getCompanyBranding();
  const updated = {
    companyName: companyName !== undefined ? companyName.trim() : current.companyName,
    documentSubtitle: documentSubtitle !== undefined ? documentSubtitle.trim() : current.documentSubtitle,
    logoUrl: logoUrl !== undefined ? (typeof logoUrl === 'string' ? logoUrl : '') : current.logoUrl,
    updatedAt: new Date().toISOString()
  };

  await transaction(async c => {
    await c.execute(
      "UPDATE application_settings SET settings=JSON_SET(settings, '$.companyBranding', JSON_EXTRACT(?, '$')) WHERE id=1",
      [JSON.stringify(updated)]
    );
    await c.execute(
      'INSERT INTO audit_events (actor, action, details) VALUES (?, ?, ?)',
      [req.user.email, 'COMPANY_BRANDING_UPDATED', JSON.stringify({ companyName: updated.companyName, hasLogo: Boolean(updated.logoUrl) })]
    );
  });

  res.json({ saved: true, branding: updated });
});

// Management uploads company logo file (multipart form data)
agreementTemplateRoutes.post('/settings/branding/logo', permit('ADMIN', 'MANAGER'), (req, res, next) => {
  logoUpload.single('logo')(req, res, err => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') fail('Logo file exceeds 4MB limit.', 400);
      return next(err);
    }
    next();
  });
}, async (req, res) => {
  if (!req.file) fail('Select an image file to upload as company logo.');
  const allowedMimes = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif'];
  if (!allowedMimes.includes(req.file.mimetype)) {
    fail('Please upload a valid image (PNG, JPG, SVG, WebP, or GIF).');
  }

  const base64 = req.file.buffer.toString('base64');
  const dataUrl = `data:${req.file.mimetype};base64,${base64}`;

  const current = await getCompanyBranding();
  const updated = {
    ...current,
    logoUrl: dataUrl,
    hasLogo: true,
    updatedAt: new Date().toISOString()
  };

  await transaction(async c => {
    await c.execute(
      "UPDATE application_settings SET settings=JSON_SET(settings, '$.companyBranding', JSON_EXTRACT(?, '$')) WHERE id=1",
      [JSON.stringify(updated)]
    );
    await c.execute(
      'INSERT INTO audit_events (actor, action, details) VALUES (?, ?, ?)',
      [req.user.email, 'COMPANY_LOGO_UPLOADED', JSON.stringify({ sizeBytes: req.file.size, mime: req.file.mimetype })]
    );
  });

  res.json({ success: true, branding: updated, logoUrl: dataUrl });
});

// Management deletes company logo
agreementTemplateRoutes.delete('/settings/branding/logo', permit('ADMIN', 'MANAGER'), async (req, res) => {
  const current = await getCompanyBranding();
  const updated = {
    ...current,
    logoUrl: '',
    hasLogo: false,
    updatedAt: new Date().toISOString()
  };

  await transaction(async c => {
    await c.execute(
      "UPDATE application_settings SET settings=JSON_SET(settings, '$.companyBranding', JSON_EXTRACT(?, '$')) WHERE id=1",
      [JSON.stringify(updated)]
    );
    await c.execute(
      'INSERT INTO audit_events (actor, action, details) VALUES (?, ?, ?)',
      [req.user.email, 'COMPANY_LOGO_REMOVED', JSON.stringify({})]
    );
  });

  res.json({ success: true, branding: updated });
});

// Staff can read templates (used in Settings and file Category Change modal)
agreementTemplateRoutes.get('/agreement-templates', permit('ADMIN', 'MANAGER', 'AGENT'), async (req, res) => {
  const [rows] = await db.query(
    'SELECT id, name, title, body, is_default, created_by, created_at, updated_at FROM agreement_templates ORDER BY is_default DESC, id ASC'
  );
  res.json(rows.map(r => ({
    id: r.id,
    name: r.name,
    title: r.title,
    body: r.body,
    is_default: Boolean(r.is_default),
    created_by: r.created_by,
    created_at: r.created_at,
    updated_at: r.updated_at
  })));
});

// Management creates new agreement template
agreementTemplateRoutes.post('/agreement-templates', permit('ADMIN', 'MANAGER'), async (req, res) => {
  const {name, title, body, isDefault} = req.body;
  if (typeof name !== 'string' || !name.trim() || name.length > 160) {
    fail('Enter a valid template name (up to 160 characters).');
  }
  if (typeof body !== 'string' || !body.trim() || body.length > 50000) {
    fail('Enter the agreement text / terms (up to 50,000 characters).');
  }
  const cleanTitle = typeof title === 'string' && title.trim() ? title.trim().slice(0, 240) : 'Service Change Agreement & Addendum';
  const makeDefault = Boolean(isDefault);

  const result = await transaction(async c => {
    if (makeDefault) {
      await c.execute('UPDATE agreement_templates SET is_default=FALSE');
    }
    const [r] = await c.execute(
      'INSERT INTO agreement_templates (name, title, body, is_default, created_by) VALUES (?, ?, ?, ?, ?)',
      [name.trim(), cleanTitle, body.trim(), makeDefault ? 1 : 0, req.user.id]
    );
    await c.execute(
      'INSERT INTO audit_events (actor, action, details) VALUES (?, ?, ?)',
      [req.user.email, 'AGREEMENT_TEMPLATE_CREATED', JSON.stringify({templateId: r.insertId, name: name.trim()})]
    );
    return {
      id: r.insertId,
      name: name.trim(),
      title: cleanTitle,
      body: body.trim(),
      is_default: makeDefault
    };
  });

  res.status(201).json(result);
});

// Management updates an existing template
agreementTemplateRoutes.patch('/agreement-templates/:id', permit('ADMIN', 'MANAGER'), async (req, res) => {
  const templateId = Number(req.params.id);
  if (!Number.isSafeInteger(templateId) || templateId < 1) fail('Invalid template ID.');

  const {name, title, body, isDefault} = req.body;
  if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.length > 160)) {
    fail('Enter a valid template name (up to 160 characters).');
  }
  if (body !== undefined && (typeof body !== 'string' || !body.trim() || body.length > 50000)) {
    fail('Enter the agreement text / terms (up to 50,000 characters).');
  }
  if (title !== undefined && (typeof title !== 'string' || !title.trim() || title.length > 240)) {
    fail('Enter a valid agreement title (up to 240 characters).');
  }

  await transaction(async c => {
    const [existing] = await c.execute('SELECT * FROM agreement_templates WHERE id=? FOR UPDATE', [templateId]);
    if (!existing.length) fail('Agreement template not found.', 404);
    const curr = existing[0];

    const newName = name !== undefined ? name.trim() : curr.name;
    const newTitle = title !== undefined ? title.trim() : curr.title;
    const newBody = body !== undefined ? body.trim() : curr.body;
    let newDefault = isDefault !== undefined ? Boolean(isDefault) : Boolean(curr.is_default);

    // If making this one default, clear others
    if (newDefault) {
      await c.execute('UPDATE agreement_templates SET is_default=FALSE WHERE id!=?', [templateId]);
    } else if (Boolean(curr.is_default) && !newDefault) {
      // If unsetting default, ensure at least one template is default
      const [others] = await c.execute('SELECT id FROM agreement_templates WHERE id!=? ORDER BY id ASC LIMIT 1', [templateId]);
      if (others.length) {
        await c.execute('UPDATE agreement_templates SET is_default=TRUE WHERE id=?', [others[0].id]);
      } else {
        newDefault = true; // Can't unset default if it's the only one
      }
    }

    await c.execute(
      'UPDATE agreement_templates SET name=?, title=?, body=?, is_default=? WHERE id=?',
      [newName, newTitle, newBody, newDefault ? 1 : 0, templateId]
    );

    await c.execute(
      'INSERT INTO audit_events (actor, action, details) VALUES (?, ?, ?)',
      [req.user.email, 'AGREEMENT_TEMPLATE_UPDATED', JSON.stringify({templateId, name: newName})]
    );
  });

  res.json({saved: true});
});

// Management deletes a template
agreementTemplateRoutes.delete('/agreement-templates/:id', permit('ADMIN', 'MANAGER'), async (req, res) => {
  const templateId = Number(req.params.id);
  if (!Number.isSafeInteger(templateId) || templateId < 1) fail('Invalid template ID.');

  await transaction(async c => {
    const [all] = await c.execute('SELECT id, name, is_default FROM agreement_templates FOR UPDATE');
    if (all.length <= 1) {
      fail('Cannot delete the only remaining template. At least one agreement template is required.', 400);
    }
    const target = all.find(t => Number(t.id) === templateId);
    if (!target) fail('Agreement template not found.', 404);

    await c.execute('DELETE FROM agreement_templates WHERE id=?', [templateId]);

    // If deleted template was default, designate another template as default
    if (Boolean(target.is_default)) {
      const remaining = all.filter(t => Number(t.id) !== templateId);
      if (remaining.length) {
        await c.execute('UPDATE agreement_templates SET is_default=TRUE WHERE id=?', [remaining[0].id]);
      }
    }

    await c.execute(
      'INSERT INTO audit_events (actor, action, details) VALUES (?, ?, ?)',
      [req.user.email, 'AGREEMENT_TEMPLATE_DELETED', JSON.stringify({templateId, name: target.name})]
    );
  });

  res.json({deleted: true});
});
