// Display-translation for audit events. Stored audit reasons/event types are
// governance history and are NEVER rewritten. This maps them to user-facing
// labels ONLY at render time, so users don't see internal build terminology like
// "Layer 1 deterministic calculation run".

const EVENT_TYPE_LABELS: Record<string, string> = {
  'layer1.calculation_run.created': 'Forecast calculated',
  'layer1.submitted': 'Forecast submitted for review',
  'layer1.approved': 'Forecast approved',
  'layer1.locked': 'Forecast locked',
  'layer1.handoff.created': 'Handoff to budget created',
  'input_source.version_imported': 'Demand source imported',
  'input_source.mapping_versioned': 'Column mapping saved',
  'input_source.custom_dimension_registered': 'Custom dimension registered'
};

// Phrase-level cleanups for stored reason strings that contain build terminology.
const REASON_REPLACEMENTS: [RegExp, string][] = [
  [/Layer 1 deterministic calculation run created/gi, 'Forecast calculated'],
  [/Layer 1 deterministic calculation/gi, 'Forecast calculation'],
  [/\bLayer 1\b/g, 'Forecast'],
  [/deterministic calculation run/gi, 'forecast run']
];

/** User-facing label for an internal audit event type. */
export function displayEventType(eventType: string | null | undefined): string {
  if (!eventType) return 'Activity';
  return EVENT_TYPE_LABELS[eventType] ?? humanise(eventType);
}

/** User-facing version of a stored audit reason (never mutates the stored value). */
export function displayReason(reason: string | null | undefined): string {
  if (!reason) return 'No reason supplied';
  let out = reason;
  for (const [pattern, replacement] of REASON_REPLACEMENTS) out = out.replace(pattern, replacement);
  return out;
}

function humanise(eventType: string): string {
  const last = eventType.split('.').pop() ?? eventType;
  const spaced = last.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
