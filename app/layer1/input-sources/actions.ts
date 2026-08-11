'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUserContext } from '../../../lib/auth/session';
import {
  importInputSourceVersion,
  createFieldMappingVersion,
  registerCustomDimension,
  getInputSourceVersionStatus
} from '../../../lib/repositories/input-sources';
import {
  parseTable,
  detectHeaders,
  normaliseAhtUnit,
  hashMapping,
  type MappingSpec,
  type CanonicalField,
  type DateFormat
} from '../../../lib/intake/intake-engine';

function revalidateInputs(sourceId?: string) {
  revalidatePath('/layer1/input-sources');
  if (sourceId) revalidatePath(`/layer1/input-sources/${sourceId}`);
}

function autoMapping(headers: string[], defaultAhtUnit: string | null, dateFormat: DateFormat): MappingSpec {
  const fieldByHeader: Record<string, CanonicalField> = {};
  for (const s of detectHeaders(headers)) {
    if (s.suggested) fieldByHeader[s.header] = s.suggested;
  }
  return { fieldByHeader, defaultAhtUnit: normaliseAhtUnit(defaultAhtUnit), dateFormat };
}

export async function importPastedSourceAction(formData: FormData) {
  const context = await requireUserContext();
  const planId = String(formData.get('plan_id') ?? '').trim();
  const sourceName = String(formData.get('source_name') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();
  const defaultAhtUnit = String(formData.get('default_aht_unit') ?? '').trim() || null;
  const dateFormat = (String(formData.get('date_format') ?? 'iso').trim() as DateFormat);
  const weekStartDay = String(formData.get('week_start_day') ?? 'monday').trim() === 'sunday' ? 'sunday' : 'monday';
  const pasted = String(formData.get('pasted_data') ?? '');

  if (!planId) throw new Error('Select a plan');
  if (!sourceName) throw new Error('Enter a source name');

  const { headers, rows, method } = parseTable(pasted);
  if (rows.length === 0) throw new Error('No rows detected in the pasted data');

  // Auto-suggested mapping seeds the draft; the user confirms/edits it on the
  // mapping screen before acceptance. No mapping is accepted here.
  const mapping = autoMapping(headers, defaultAhtUnit, dateFormat);

  await importInputSourceVersion(context, {
    planId,
    sourceName,
    description,
    importMethod: method,
    rawPayload: pasted,
    headers,
    mapping,
    rawRows: rows,
    dateFormat,
    weekStartDay,
    reason: 'Draft input source imported via Operational Demand Data'
  });

  revalidateInputs();
}

/**
 * Accept a user-defined canonical-field mapping. Roles come from the mapping grid
 * (one role per header). Required-field completeness is enforced in the repository
 * before the RPC accepts. There is no hard-coded empty-mapping path.
 */
export async function acceptMappingAction(formData: FormData) {
  const context = await requireUserContext();
  const versionId = String(formData.get('version_id') ?? '').trim();
  const sourceId = String(formData.get('source_id') ?? '').trim();
  const defaultAhtUnit = (String(formData.get('default_aht_unit') ?? '').trim() || null) as 'seconds' | 'minutes' | 'hours' | null;
  const dateFormat = (String(formData.get('date_format') ?? 'iso').trim() as 'iso' | 'dd_mm_yyyy' | 'mm_dd_yyyy');
  const previewedHash = String(formData.get('candidate_hash') ?? '').trim();
  if (!versionId) throw new Error('Missing version');

  const roleByHeader = collectRoles(formData);
  if (Object.keys(roleByHeader).length === 0) {
    throw new Error('Map the required fields before accepting');
  }

  // Graceful guard: an accepted source version is frozen; the DB rejects any new
  // mapping version against it. Detect that here and redirect back to the source
  // (which shows the read-only accepted mapping) instead of letting the DB error
  // surface as a "Module unavailable" boundary. The UI already hides the action;
  // this defends the direct-POST path too.
  const versionStatus = await getInputSourceVersionStatus(context, versionId).catch(() => null);
  if (versionStatus === 'accepted') {
    revalidateInputs(sourceId);
    redirect(`/layer1/input-sources/${sourceId}`);
  }

  // Guard: the mapping being accepted MUST equal the candidate the user previewed.
  // The preview and the grid were both built from the candidate whose hash is
  // previewedHash; recomputing it from the submitted roles catches any drift.
  const submittedHash = hashMapping({ roleByHeader: roleByHeader as never, defaultAhtUnit, dateFormat });
  if (previewedHash && submittedHash !== previewedHash) {
    throw new Error('The mapping changed since the preview was generated. Reload and review the preview before accepting.');
  }

  await createFieldMappingVersion(context, {
    versionId,
    roleByHeader,
    defaultAhtUnit,
    dateFormat,
    accept: true,
    reason: 'User-defined canonical mapping accepted; canonical grain set'
  });

  revalidateInputs(sourceId);
}

/** Save a draft mapping without accepting; never supersedes the accepted mapping. */
export async function saveDraftMappingAction(formData: FormData) {
  const context = await requireUserContext();
  const versionId = String(formData.get('version_id') ?? '').trim();
  const sourceId = String(formData.get('source_id') ?? '').trim();
  const defaultAhtUnit = (String(formData.get('default_aht_unit') ?? '').trim() || null) as 'seconds' | 'minutes' | 'hours' | null;
  const dateFormat = (String(formData.get('date_format') ?? 'iso').trim() as 'iso' | 'dd_mm_yyyy' | 'mm_dd_yyyy');
  if (!versionId) throw new Error('Missing version');

  const roleByHeader = collectRoles(formData);

  // Graceful guard (same as accept): don't attempt a write against a frozen
  // accepted version; redirect back to the read-only view instead of crashing.
  const versionStatus = await getInputSourceVersionStatus(context, versionId).catch(() => null);
  if (versionStatus === 'accepted') {
    revalidateInputs(sourceId);
    redirect(`/layer1/input-sources/${sourceId}`);
  }

  await createFieldMappingVersion(context, {
    versionId,
    roleByHeader,
    defaultAhtUnit,
    dateFormat,
    accept: false,
    reason: 'Draft mapping saved'
  });

  revalidateInputs(sourceId);
}

/** Collect header -> role assignments submitted from the mapping grid. */
function collectRoles(formData: FormData): Record<string, string> {
  const roleByHeader: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('role_')) continue;
    const header = key.slice('role_'.length);
    roleByHeader[header] = String(value);
  }
  return roleByHeader;
}

export async function registerDimensionAction(formData: FormData) {
  const context = await requireUserContext();
  const planId = String(formData.get('plan_id') ?? '').trim();
  const dimensionKey = String(formData.get('dimension_key') ?? '').trim();
  const displayName = String(formData.get('display_name') ?? '').trim();
  const promotionStatus = String(formData.get('promotion_status') ?? 'retained') === 'reportable' ? 'reportable' : 'retained';
  if (!planId || !dimensionKey || !displayName) throw new Error('Plan, key and display name are required');

  await registerCustomDimension(context, { planId, dimensionKey, displayName, promotionStatus });
  revalidateInputs();
}
