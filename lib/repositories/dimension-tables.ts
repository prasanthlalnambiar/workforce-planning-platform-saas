export const dimensionTables = ['regions', 'locations', 'channels', 'work_types', 'workforce_groups'] as const;
export type DimensionTable = (typeof dimensionTables)[number];

export function isDimensionTable(value: string): value is DimensionTable {
  return dimensionTables.includes(value as DimensionTable);
}
