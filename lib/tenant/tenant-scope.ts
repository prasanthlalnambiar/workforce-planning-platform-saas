export interface TenantScopedRecord {
  organisation_id: string;
}

export function assertTenantMatch(record: TenantScopedRecord, organisationId: string): void {
  if (record.organisation_id !== organisationId) {
    throw new Error('Tenant access denied');
  }
}

export function filterTenantRows<T extends TenantScopedRecord>(rows: T[], organisationId: string): T[] {
  return rows.filter((row) => row.organisation_id === organisationId);
}
