// Minimal handwritten Supabase database types for Phase 1.
// Replace with generated Supabase types once the project is connected:
// supabase gen types typescript --project-id <id> > types/database.ts

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      organisations: { Row: Record<string, unknown>; Insert: Record<string, unknown>; Update: Record<string, unknown> };
      profiles: { Row: Record<string, unknown>; Insert: Record<string, unknown>; Update: Record<string, unknown> };
      organisation_memberships: { Row: Record<string, unknown>; Insert: Record<string, unknown>; Update: Record<string, unknown> };
      roles: { Row: Record<string, unknown>; Insert: Record<string, unknown>; Update: Record<string, unknown> };
      user_roles: { Row: Record<string, unknown>; Insert: Record<string, unknown>; Update: Record<string, unknown> };
      plans: { Row: Record<string, unknown>; Insert: Record<string, unknown>; Update: Record<string, unknown> };
      fiscal_years: { Row: Record<string, unknown>; Insert: Record<string, unknown>; Update: Record<string, unknown> };
      planning_periods: { Row: Record<string, unknown>; Insert: Record<string, unknown>; Update: Record<string, unknown> };
      audit_events: { Row: Record<string, unknown>; Insert: Record<string, unknown>; Update: Record<string, unknown> };
    };
  };
}
