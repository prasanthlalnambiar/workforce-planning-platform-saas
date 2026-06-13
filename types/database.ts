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
      budget_baselines: GenericTable;
      budget_baseline_lines: GenericTable;
      budget_baseline_snapshots: GenericTable;
      forecast_drivers: GenericTable;
      reforecasts: GenericTable;
      reforecast_lines: GenericTable;
      reforecast_driver_impacts: GenericTable;
      reforecast_snapshots: GenericTable;
      actuals_batches: GenericTable;
      actuals_lines: GenericTable;
      variance_reports: GenericTable;
      variance_lines: GenericTable;
      forecast_driver_lines: GenericTable;
      audit_events: {
        Row: AuditEventsRow;
        Insert: AuditEventsInsert;
        Update: AuditEventsUpdate;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_layer1_lock_and_handoff: {
        Args: {
          target_organisation_id: string;
          target_plan_id: string;
          target_calculation_run_id: string;
          target_actor_user_id: string;
          target_fiscal_year_id: string | null;
          approved_snapshot: Json;
          handoff_payload: Json;
          target_checksum: string;
          lock_reason?: string | null;
        };
        Returns: Array<{ version_lock: Json; handoff: Json }>;
      };
      transition_layer1_version_lock_status: {
        Args: {
          target_organisation_id: string;
          target_version_lock_id: string;
          next_status: string;
          transition_reason?: string | null;
        };
        Returns: void;
      };
      transition_layer1_handoff_status_controlled: {
        Args: {
          target_organisation_id: string;
          target_plan_id: string;
          target_handoff_id: string;
          target_actor_user_id: string;
          next_status: string;
          transition_reason?: string | null;
        };
        Returns: Json;
      };
      create_budget_baseline_draft: {
        Args: {
          target_organisation_id: string;
          target_actor_user_id: string;
          baseline_payload: Json;
          line_payloads: Json;
          create_reason?: string | null;
        };
        Returns: Json;
      };
      lock_budget_baseline: {
        Args: {
          target_organisation_id: string;
          target_plan_id: string;
          target_fiscal_year_id: string;
          target_budget_baseline_id: string;
          target_actor_user_id: string;
          snapshot_payload: Json;
          target_checksum: string;
          lock_reason?: string | null;
        };
        Returns: Json;
      };
      create_actuals_batch: {
        Args: { target_organisation_id: string; target_actor_user_id: string; batch_payload: Json; line_payloads: Json; create_reason?: string | null };
        Returns: Json;
      };
      update_actuals_batch_draft: {
        Args: { target_organisation_id: string; target_actor_user_id: string; target_batch_id: string; batch_payload: Json; line_payloads: Json; update_reason?: string | null };
        Returns: Json;
      };
      transition_actuals_batch_status: {
        Args: { target_organisation_id: string; target_actor_user_id: string; target_batch_id: string; next_status: string; transition_reason?: string | null };
        Returns: Json;
      };
      supersede_actuals_batch: {
        Args: { target_organisation_id: string; target_actor_user_id: string; target_batch_id: string; replacement_payload: Json; replacement_lines: Json; supersede_reason?: string | null };
        Returns: Json;
      };
      create_variance_report: {
        Args: { target_organisation_id: string; target_actor_user_id: string; report_payload: Json; line_payloads: Json; create_reason?: string | null };
        Returns: Json;
      };
      recalculate_variance_report: {
        Args: { target_organisation_id: string; target_actor_user_id: string; target_report_id: string; line_payloads: Json; recalculate_reason?: string | null };
        Returns: Json;
      };
      lock_variance_report: {
        Args: { target_organisation_id: string; target_actor_user_id: string; target_report_id: string; lock_checksum: string; lock_reason?: string | null };
        Returns: Json;
      };
      void_variance_report: {
        Args: { target_organisation_id: string; target_actor_user_id: string; target_report_id: string; void_reason?: string | null };
        Returns: Json;
      };
      create_reforecast: {
        Args: { target_organisation_id: string; target_actor_user_id: string; reforecast_payload: Json; line_payloads: Json; impact_payloads: Json; create_reason?: string | null };
        Returns: Json;
      };
      recalculate_reforecast: {
        Args: { target_organisation_id: string; target_actor_user_id: string; target_reforecast_id: string; reforecast_payload: Json; line_payloads: Json; impact_payloads: Json; recalculate_reason?: string | null };
        Returns: Json;
      };
      transition_reforecast_status: {
        Args: { target_organisation_id: string; target_actor_user_id: string; target_reforecast_id: string; next_status: string; transition_reason?: string | null };
        Returns: Json;
      };
      lock_reforecast: {
        Args: { target_organisation_id: string; target_actor_user_id: string; target_reforecast_id: string; snapshot_payload: Json; lock_checksum: string; lock_reason?: string | null };
        Returns: Json;
      };
      create_forecast_driver: {
        Args: { target_organisation_id: string; target_actor_user_id: string; driver_payload: Json; line_payloads: Json; create_reason?: string | null };
        Returns: Json;
      };
      update_forecast_driver_draft: {
        Args: { target_organisation_id: string; target_actor_user_id: string; target_driver_id: string; driver_payload: Json; line_payloads: Json; update_reason?: string | null };
        Returns: Json;
      };
      transition_forecast_driver_status: {
        Args: { target_organisation_id: string; target_actor_user_id: string; target_driver_id: string; next_status: string; transition_reason?: string | null };
        Returns: Json;
      };
      supersede_forecast_driver: {
        Args: { target_organisation_id: string; target_actor_user_id: string; target_driver_id: string; replacement_payload: Json; replacement_lines: Json; supersede_reason?: string | null };
        Returns: Json;
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
