// Minimal handwritten Supabase database types for Phase 1.1.
// Replace with generated Supabase types once the project is connected:
// supabase gen types typescript --project-id <id> > types/database.ts

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type GenericRow = Record<string, unknown>;
type GenericInsert = Record<string, unknown>;
type GenericUpdate = Record<string, unknown>;

type GenericTable = {
  Row: GenericRow;
  Insert: GenericInsert;
  Update: GenericUpdate;
  Relationships: [];
};

type AuditEventsRow = {
  id: string;
  organisation_id: string;
  actor_user_id: string | null;
  event_type: string;
  entity_type: string;
  entity_id: string | null;
  plan_id: string | null;
  fiscal_year_id: string | null;
  planning_period_id: string | null;
  old_value_json: unknown | null;
  new_value_json: unknown | null;
  reason: string | null;
  ip_address: string | null;
  user_agent: string | null;
  request_id: string | null;
  created_at: string;
};

type AuditEventsInsert = Omit<AuditEventsRow, 'id' | 'created_at'> & {
  id?: string;
  created_at?: string;
};

type AuditEventsUpdate = Partial<AuditEventsInsert>;

export interface Database {
  public: {
    Tables: {
      organisations: GenericTable;
      profiles: GenericTable;
      organisation_memberships: GenericTable;
      roles: GenericTable;
      user_roles: GenericTable;
      plans: GenericTable;
      fiscal_years: GenericTable;
      planning_periods: GenericTable;
      regions: GenericTable;
      locations: GenericTable;
      channels: GenericTable;
      work_types: GenericTable;
      workforce_groups: GenericTable;
      planning_briefs: GenericTable;
      source_inventory: GenericTable;
      demand_inputs: GenericTable;
      capacity_assumptions: GenericTable;
      cost_assumptions: GenericTable;
      scenario_definitions: GenericTable;
      calculation_runs: GenericTable;
      layer1_version_locks: GenericTable;
      layer1_handoff_objects: GenericTable;
      audit_events: {
        Row: AuditEventsRow;
        Insert: AuditEventsInsert;
        Update: AuditEventsUpdate;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      transition_layer1_version_lock_status: {
        Args: {
          target_organisation_id: string;
          target_version_lock_id: string;
          next_status: string;
          transition_reason?: string | null;
        };
        Returns: void;
      };
      transition_layer1_handoff_status: {
        Args: {
          target_organisation_id: string;
          target_handoff_id: string;
          next_status: string;
        };
        Returns: void;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
