-- =====================================================================
-- Migration 014 — WP-2 Flexible Input Foundation (draft-only, additive)
-- =====================================================================
-- Adds the planner-facing flexible-input intake foundation from Consolidated
-- Build Plan v4.1.2. STRICTLY DRAFT-ONLY: nothing here can change an official
-- calculation, forecast, baseline, reforecast, actuals, variance, waterfall, or
-- Planning Advisor result. No routing, no mapping-to-knowledge-group, no vendor,
-- no routed assumptions, no forecast adapter — those are WP-3+.
--
-- Design (house patterns):
--   * Every table is organisation-scoped, RLS-enabled, with a *_select_member
--     policy (public.is_org_member), explicit GRANT SELECT TO authenticated
--     (carries forward the migration-013 lesson so PostgREST exposes the table),
--     and INSERT/UPDATE/DELETE revoked from anon/authenticated.
--   * All writes happen only through SECURITY DEFINER service-role RPCs that
--     check org role and write an in-transaction audit event.
--   * Raw rows and source/mapping versions are IMMUTABLE: a new import or mapping
--     change creates a new version; an immutability trigger blocks UPDATE/DELETE
--     of accepted versions.
--   * Existing migrations 001–013 are untouched.
-- =====================================================================

-- ---------------------------------------------------------------------
-- input_sources — the logical source (advances a pointer to its current version)
-- ---------------------------------------------------------------------
CREATE TABLE public.input_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL,
  source_inventory_id uuid,
  source_name text NOT NULL,
  description text,
  -- Draft-only lifecycle. 'archived' retires a logical source; nothing here is
  -- ever 'approved into an official calculation' in WP-2.
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'archived')),
  current_version_id uuid,  -- FK added after versions table exists
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, plan_id, source_name),
  UNIQUE (organisation_id, id),
  -- Composite same-org FKs make a cross-tenant relationship structurally
  -- impossible: plan_id and source_inventory_id must belong to the SAME org.
  CONSTRAINT input_sources_plan_same_org_fk FOREIGN KEY (organisation_id, plan_id)
    REFERENCES public.plans(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT input_sources_source_inventory_same_org_fk FOREIGN KEY (organisation_id, source_inventory_id)
    REFERENCES public.source_inventory(organisation_id, id)
);

-- ---------------------------------------------------------------------
-- input_source_versions — IMMUTABLE snapshot of one raw import revision
-- ---------------------------------------------------------------------
CREATE TABLE public.input_source_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  input_source_id uuid NOT NULL,
  version_number integer NOT NULL,
  -- The original pasted/uploaded payload, retained verbatim.
  raw_payload text NOT NULL,
  import_method text NOT NULL CHECK (import_method IN ('paste', 'csv', 'tsv', 'manual')),
  -- Detected headers and the declared AHT unit at import.
  detected_headers jsonb NOT NULL DEFAULT '[]'::jsonb,
  declared_aht_unit text CHECK (declared_aht_unit IS NULL OR declared_aht_unit IN ('seconds', 'minutes', 'hours')),
  -- Explicit, non-guessed date handling for parsed rows in this version.
  date_format text NOT NULL DEFAULT 'iso' CHECK (date_format IN ('iso', 'dd_mm_yyyy', 'mm_dd_yyyy')),
  week_start_day text NOT NULL DEFAULT 'monday' CHECK (week_start_day IN ('monday', 'sunday')),
  row_count integer NOT NULL DEFAULT 0,
  -- Date coverage of the extract (for missing-week vs zero-volume detection).
  coverage_week_start date,
  coverage_week_end date,
  -- Lifecycle of the *version*: 'draft' (still mappable) -> 'accepted' (locked
  -- for draft use, immutable) -> 'superseded'; 'voided' retires a draft. Never
  -- reaches any official path.
  version_status text NOT NULL DEFAULT 'draft' CHECK (version_status IN ('draft', 'accepted', 'superseded', 'voided')),
  -- The canonical grain decided at acceptance (shown in UI before acceptance).
  canonical_grain jsonb,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, input_source_id, version_number),
  UNIQUE (organisation_id, id),
  -- Same-org FK to the logical source. RESTRICT: governed version history is
  -- never cascade-deleted when a source is archived.
  CONSTRAINT input_source_versions_source_same_org_fk FOREIGN KEY (organisation_id, input_source_id)
    REFERENCES public.input_sources(organisation_id, id) ON DELETE RESTRICT
);

ALTER TABLE public.input_sources
  ADD CONSTRAINT input_sources_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES public.input_source_versions(id);

-- ---------------------------------------------------------------------
-- input_source_rows — IMMUTABLE raw rows for a version (retained verbatim)
-- ---------------------------------------------------------------------
CREATE TABLE public.input_source_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  input_source_version_id uuid NOT NULL,
  row_index integer NOT NULL,
  -- Full original row as pasted (every column retained, including unmapped ones).
  raw_values jsonb NOT NULL,
  -- Parsed canonical fields (nullable until/unless mapping resolves them).
  week_commencing date,
  workflow_name text,
  weekly_volume numeric,
  weekly_aht numeric,
  aht_unit text,
  -- Distinguishes an explicitly reported zero-volume week from a missing one:
  -- a present row with weekly_volume = 0 is 'reported_zero'; absence of a row is
  -- simply no row (never silently materialised as zero).
  volume_state text NOT NULL DEFAULT 'reported' CHECK (volume_state IN ('reported', 'reported_zero')),
  -- Row-level validation outcome (draft-only; does not block raw retention).
  validation_status text NOT NULL DEFAULT 'pending' CHECK (validation_status IN ('pending', 'valid', 'invalid')),
  validation_messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, input_source_version_id, row_index),
  UNIQUE (organisation_id, id),
  CONSTRAINT input_source_rows_version_same_org_fk FOREIGN KEY (organisation_id, input_source_version_id)
    REFERENCES public.input_source_versions(organisation_id, id) ON DELETE RESTRICT
);

-- ---------------------------------------------------------------------
-- field_mapping_versions — IMMUTABLE header->meaning mapping for a version
-- ---------------------------------------------------------------------
CREATE TABLE public.field_mapping_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  input_source_version_id uuid NOT NULL,
  mapping_version_number integer NOT NULL,
  -- header -> { role: required|calc_dimension|reporting|custom|ignore, field, notes }
  mappings jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- The approved calculation-driving dimensions selected for the canonical grain.
  calc_driving_dimensions jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Aggregation decision for unapproved optional fields (e.g. aggregate-to-workflow-week).
  aggregation_decision jsonb NOT NULL DEFAULT '{}'::jsonb,
  mapping_status text NOT NULL DEFAULT 'draft' CHECK (mapping_status IN ('draft', 'accepted', 'superseded')),
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, input_source_version_id, mapping_version_number),
  UNIQUE (organisation_id, id),
  CONSTRAINT field_mapping_versions_version_same_org_fk FOREIGN KEY (organisation_id, input_source_version_id)
    REFERENCES public.input_source_versions(organisation_id, id) ON DELETE RESTRICT
);

-- ---------------------------------------------------------------------
-- custom_dimensions — registry of optional fields retained / promoted-to-report
-- (promotion is reporting-only; NEVER changes calculation in WP-2)
-- ---------------------------------------------------------------------
CREATE TABLE public.custom_dimensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL,
  dimension_key text NOT NULL,
  display_name text NOT NULL,
  -- 'retained' = kept as source metadata only; 'reportable' = promoted for
  -- reporting later. Neither has any calculation effect in WP-2.
  promotion_status text NOT NULL DEFAULT 'retained' CHECK (promotion_status IN ('retained', 'reportable')),
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, plan_id, dimension_key),
  UNIQUE (organisation_id, id),
  CONSTRAINT custom_dimensions_plan_same_org_fk FOREIGN KEY (organisation_id, plan_id)
    REFERENCES public.plans(organisation_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_input_source_versions_source ON public.input_source_versions(organisation_id, input_source_id);
CREATE INDEX idx_input_source_rows_version ON public.input_source_rows(organisation_id, input_source_version_id);
CREATE INDEX idx_field_mapping_versions_version ON public.field_mapping_versions(organisation_id, input_source_version_id);

-- ---------------------------------------------------------------------
-- Immutability: an accepted version/mapping, and any raw row, cannot be mutated.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_input_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Input source versions are immutable and cannot be deleted';
  END IF;

  -- Lifecycle transitions are the ONLY permitted status changes:
  --   draft -> accepted | voided ; accepted -> superseded.
  IF NEW.version_status IS DISTINCT FROM OLD.version_status THEN
    IF NOT (
      (OLD.version_status = 'draft' AND NEW.version_status IN ('accepted', 'voided'))
      OR (OLD.version_status = 'accepted' AND NEW.version_status = 'superseded')
    ) THEN
      RAISE EXCEPTION 'Illegal input source version lifecycle transition % -> %', OLD.version_status, NEW.version_status;
    END IF;
  END IF;

  -- All interpretation-affecting fields are frozen once the version leaves draft.
  -- canonical_grain may be stamped exactly once, on the draft->accepted move.
  IF OLD.version_status <> 'draft' THEN
    IF NEW.raw_payload IS DISTINCT FROM OLD.raw_payload
       OR NEW.row_count IS DISTINCT FROM OLD.row_count
       OR NEW.import_method IS DISTINCT FROM OLD.import_method
       OR NEW.detected_headers IS DISTINCT FROM OLD.detected_headers
       OR NEW.declared_aht_unit IS DISTINCT FROM OLD.declared_aht_unit
       OR NEW.date_format IS DISTINCT FROM OLD.date_format
       OR NEW.week_start_day IS DISTINCT FROM OLD.week_start_day
       OR NEW.coverage_week_start IS DISTINCT FROM OLD.coverage_week_start
       OR NEW.coverage_week_end IS DISTINCT FROM OLD.coverage_week_end
       OR NEW.canonical_grain IS DISTINCT FROM OLD.canonical_grain
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.input_source_id IS DISTINCT FROM OLD.input_source_id
       OR NEW.version_number IS DISTINCT FROM OLD.version_number THEN
      RAISE EXCEPTION 'Accepted input source versions are immutable (interpretation fields frozen)';
    END IF;
  ELSE
    -- Even in draft, the raw payload and provenance never change in place.
    IF NEW.raw_payload IS DISTINCT FROM OLD.raw_payload
       OR NEW.import_method IS DISTINCT FROM OLD.import_method
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.input_source_id IS DISTINCT FROM OLD.input_source_id
       OR NEW.version_number IS DISTINCT FROM OLD.version_number THEN
      RAISE EXCEPTION 'Input source raw payload and provenance are immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_input_source_versions_immutable
  BEFORE UPDATE OR DELETE ON public.input_source_versions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_input_version_mutation();

CREATE OR REPLACE FUNCTION public.prevent_input_row_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Raw input source rows are immutable and cannot be deleted';
  END IF;
  -- Raw values AND all parsed/normalised business fields are frozen after
  -- creation. A privileged direct UPDATE must not be able to alter the meaning
  -- of an imported row. (Rows are written once, in the import transaction.)
  IF NEW.raw_values IS DISTINCT FROM OLD.raw_values
     OR NEW.week_commencing IS DISTINCT FROM OLD.week_commencing
     OR NEW.workflow_name IS DISTINCT FROM OLD.workflow_name
     OR NEW.weekly_volume IS DISTINCT FROM OLD.weekly_volume
     OR NEW.weekly_aht IS DISTINCT FROM OLD.weekly_aht
     OR NEW.aht_unit IS DISTINCT FROM OLD.aht_unit
     OR NEW.volume_state IS DISTINCT FROM OLD.volume_state
     OR NEW.validation_status IS DISTINCT FROM OLD.validation_status
     OR NEW.validation_messages IS DISTINCT FROM OLD.validation_messages
     OR NEW.row_index IS DISTINCT FROM OLD.row_index
     OR NEW.input_source_version_id IS DISTINCT FROM OLD.input_source_version_id THEN
    RAISE EXCEPTION 'Raw input source rows are immutable (parsed business fields frozen)';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_input_source_rows_immutable
  BEFORE UPDATE OR DELETE ON public.input_source_rows
  FOR EACH ROW EXECUTE FUNCTION public.prevent_input_row_mutation();

CREATE OR REPLACE FUNCTION public.prevent_mapping_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Field mapping versions are immutable and cannot be deleted';
  END IF;
  -- Lifecycle: draft -> accepted ; accepted -> superseded only.
  IF NEW.mapping_status IS DISTINCT FROM OLD.mapping_status THEN
    IF NOT (
      (OLD.mapping_status = 'draft' AND NEW.mapping_status = 'accepted')
      OR (OLD.mapping_status = 'accepted' AND NEW.mapping_status = 'superseded')
      OR (OLD.mapping_status = 'draft' AND NEW.mapping_status = 'superseded')
    ) THEN
      RAISE EXCEPTION 'Illegal mapping version lifecycle transition % -> %', OLD.mapping_status, NEW.mapping_status;
    END IF;
  END IF;
  -- All mapping content is frozen once accepted (never silently overwritten).
  IF OLD.mapping_status = 'accepted'
     AND (NEW.mappings IS DISTINCT FROM OLD.mappings
       OR NEW.calc_driving_dimensions IS DISTINCT FROM OLD.calc_driving_dimensions
       OR NEW.aggregation_decision IS DISTINCT FROM OLD.aggregation_decision
       OR NEW.mapping_version_number IS DISTINCT FROM OLD.mapping_version_number
       OR NEW.input_source_version_id IS DISTINCT FROM OLD.input_source_version_id) THEN
    RAISE EXCEPTION 'Accepted field mapping versions are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_field_mapping_versions_immutable
  BEFORE UPDATE OR DELETE ON public.field_mapping_versions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_mapping_version_mutation();

-- ---------------------------------------------------------------------
-- RLS: enable + org-scoped select policies
-- ---------------------------------------------------------------------
ALTER TABLE public.input_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.input_source_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.input_source_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_mapping_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_dimensions ENABLE ROW LEVEL SECURITY;

CREATE POLICY input_sources_select_member ON public.input_sources
  FOR SELECT USING (public.is_org_member(organisation_id));
CREATE POLICY input_source_versions_select_member ON public.input_source_versions
  FOR SELECT USING (public.is_org_member(organisation_id));
CREATE POLICY input_source_rows_select_member ON public.input_source_rows
  FOR SELECT USING (public.is_org_member(organisation_id));
CREATE POLICY field_mapping_versions_select_member ON public.field_mapping_versions
  FOR SELECT USING (public.is_org_member(organisation_id));
CREATE POLICY custom_dimensions_select_member ON public.custom_dimensions
  FOR SELECT USING (public.is_org_member(organisation_id));

-- ---------------------------------------------------------------------
-- Grants: authenticated may SELECT (PostgREST visibility — the 013 lesson);
-- writes are revoked from anon/authenticated (writes go via service-role RPCs).
-- ---------------------------------------------------------------------
GRANT SELECT ON TABLE
  public.input_sources, public.input_source_versions, public.input_source_rows,
  public.field_mapping_versions, public.custom_dimensions
TO authenticated;

REVOKE INSERT, UPDATE, DELETE ON
  public.input_sources, public.input_source_versions, public.input_source_rows,
  public.field_mapping_versions, public.custom_dimensions
FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- RPC: import a new immutable source version with its raw rows.
-- Creates the logical source if needed, advances the version pointer, retains
-- every raw row verbatim, and writes an audit event. Draft-only.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_input_source_version(
  target_organisation_id uuid,
  target_actor_user_id uuid,
  target_plan_id uuid,
  source_payload jsonb,    -- { source_name, description, source_inventory_id, import_method, declared_aht_unit, detected_headers, raw_payload, coverage_week_start, coverage_week_end }
  row_payloads jsonb,      -- [ { row_index, raw_values, week_commencing, workflow_name, weekly_volume, weekly_aht, aht_unit, volume_state, validation_status, validation_messages }, ... ]
  import_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source public.input_sources%ROWTYPE;
  v_version public.input_source_versions%ROWTYPE;
  v_next_version integer;
  v_row jsonb;
  v_row_count integer := 0;
BEGIN
  -- In-function service-role guard (defence in depth beyond the EXECUTE grants):
  -- even if grants were accidentally widened later, the function itself rejects
  -- any non-service-role caller.
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service_role required';
  END IF;

  IF NOT public.user_has_any_org_role(target_organisation_id, target_actor_user_id, ARRAY['owner', 'admin', 'finance_admin', 'planner']) THEN
    RAISE EXCEPTION 'Insufficient permission to import input sources';
  END IF;

  -- Tenant integrity: the target plan must belong to the target org. (The
  -- composite same-org FK also enforces this at write time; this gives a clear
  -- error and blocks a guessed cross-org plan UUID up front.)
  IF NOT EXISTS (SELECT 1 FROM public.plans WHERE id = target_plan_id AND organisation_id = target_organisation_id) THEN
    RAISE EXCEPTION 'Plan does not belong to the target organisation';
  END IF;

  -- If a source_inventory link is supplied, it too must belong to the target org.
  IF NULLIF(source_payload->>'source_inventory_id', '') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.source_inventory
       WHERE id = (source_payload->>'source_inventory_id')::uuid
         AND organisation_id = target_organisation_id
     ) THEN
    RAISE EXCEPTION 'Source inventory record does not belong to the target organisation';
  END IF;

  -- Find or create the logical source.
  SELECT * INTO v_source
  FROM public.input_sources
  WHERE organisation_id = target_organisation_id
    AND plan_id = target_plan_id
    AND source_name = (source_payload->>'source_name')
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.input_sources (
      organisation_id, plan_id, source_inventory_id, source_name, description, created_by
    ) VALUES (
      target_organisation_id, target_plan_id,
      NULLIF(source_payload->>'source_inventory_id', '')::uuid,
      source_payload->>'source_name', source_payload->>'description', target_actor_user_id
    ) RETURNING * INTO v_source;
    v_next_version := 1;
  ELSE
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_next_version
    FROM public.input_source_versions
    WHERE organisation_id = target_organisation_id AND input_source_id = v_source.id;
  END IF;

  INSERT INTO public.input_source_versions (
    organisation_id, input_source_id, version_number, raw_payload, import_method,
    detected_headers, declared_aht_unit, date_format, week_start_day,
    coverage_week_start, coverage_week_end, created_by
  ) VALUES (
    target_organisation_id, v_source.id, v_next_version,
    source_payload->>'raw_payload',
    COALESCE(source_payload->>'import_method', 'paste'),
    COALESCE(source_payload->'detected_headers', '[]'::jsonb),
    NULLIF(source_payload->>'declared_aht_unit', ''),
    COALESCE(NULLIF(source_payload->>'date_format', ''), 'iso'),
    COALESCE(NULLIF(source_payload->>'week_start_day', ''), 'monday'),
    NULLIF(source_payload->>'coverage_week_start', '')::date,
    NULLIF(source_payload->>'coverage_week_end', '')::date,
    target_actor_user_id
  ) RETURNING * INTO v_version;

  -- Retain every raw row verbatim.
  FOR v_row IN SELECT * FROM jsonb_array_elements(row_payloads)
  LOOP
    INSERT INTO public.input_source_rows (
      organisation_id, input_source_version_id, row_index, raw_values,
      week_commencing, workflow_name, weekly_volume, weekly_aht, aht_unit,
      volume_state, validation_status, validation_messages
    ) VALUES (
      target_organisation_id, v_version.id,
      (v_row->>'row_index')::integer,
      COALESCE(v_row->'raw_values', '{}'::jsonb),
      NULLIF(v_row->>'week_commencing', '')::date,
      NULLIF(v_row->>'workflow_name', ''),
      NULLIF(v_row->>'weekly_volume', '')::numeric,
      NULLIF(v_row->>'weekly_aht', '')::numeric,
      NULLIF(v_row->>'aht_unit', ''),
      COALESCE(v_row->>'volume_state', 'reported'),
      COALESCE(v_row->>'validation_status', 'pending'),
      COALESCE(v_row->'validation_messages', '[]'::jsonb)
    );
    v_row_count := v_row_count + 1;
  END LOOP;

  UPDATE public.input_source_versions SET row_count = v_row_count WHERE id = v_version.id;
  UPDATE public.input_sources SET current_version_id = v_version.id, updated_at = now() WHERE id = v_source.id;

  INSERT INTO public.audit_events (
    organisation_id, actor_user_id, event_type, entity_type, entity_id, plan_id,
    old_value_json, new_value_json, reason
  ) VALUES (
    target_organisation_id, target_actor_user_id, 'input_source.version_imported',
    'input_source_version', v_version.id, target_plan_id,
    NULL,
    jsonb_build_object('source_name', v_source.source_name, 'version_number', v_next_version, 'row_count', v_row_count, 'import_method', v_version.import_method),
    COALESCE(import_reason, 'Draft input source version imported')
  );

  RETURN jsonb_build_object('input_source_id', v_source.id, 'version_id', v_version.id, 'version_number', v_next_version, 'row_count', v_row_count);
END;
$$;

-- ---------------------------------------------------------------------
-- RPC: create/accept a field mapping version (immutable once accepted) and stamp
-- the canonical grain on the source version. Draft-only.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_field_mapping_version(
  target_organisation_id uuid,
  target_actor_user_id uuid,
  target_version_id uuid,
  mapping_payload jsonb,   -- { mappings, calc_driving_dimensions, aggregation_decision, accept (bool), canonical_grain }
  mapping_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_version public.input_source_versions%ROWTYPE;
  v_mapping public.field_mapping_versions%ROWTYPE;
  v_next integer;
  v_accept boolean := COALESCE((mapping_payload->>'accept')::boolean, false);
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service_role required';
  END IF;

  IF NOT public.user_has_any_org_role(target_organisation_id, target_actor_user_id, ARRAY['owner', 'admin', 'finance_admin', 'planner']) THEN
    RAISE EXCEPTION 'Insufficient permission to map input sources';
  END IF;

  SELECT * INTO v_version
  FROM public.input_source_versions
  WHERE organisation_id = target_organisation_id AND id = target_version_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Input source version not found for organisation';
  END IF;

  SELECT COALESCE(MAX(mapping_version_number), 0) + 1 INTO v_next
  FROM public.field_mapping_versions
  WHERE organisation_id = target_organisation_id AND input_source_version_id = target_version_id;

  -- Supersession happens ONLY when the new mapping is accepted. Saving a draft
  -- must never disturb the current accepted mapping/interpretation.
  IF v_accept THEN
    UPDATE public.field_mapping_versions
      SET mapping_status = 'superseded'
    WHERE organisation_id = target_organisation_id
      AND input_source_version_id = target_version_id
      AND mapping_status = 'accepted';
  END IF;

  INSERT INTO public.field_mapping_versions (
    organisation_id, input_source_version_id, mapping_version_number, mappings,
    calc_driving_dimensions, aggregation_decision, mapping_status, created_by
  ) VALUES (
    target_organisation_id, target_version_id, v_next,
    COALESCE(mapping_payload->'mappings', '{}'::jsonb),
    COALESCE(mapping_payload->'calc_driving_dimensions', '[]'::jsonb),
    COALESCE(mapping_payload->'aggregation_decision', '{}'::jsonb),
    CASE WHEN v_accept THEN 'accepted' ELSE 'draft' END,
    target_actor_user_id
  ) RETURNING * INTO v_mapping;

  -- On acceptance, stamp the canonical grain onto the version and mark it
  -- accepted (only from draft; an already-accepted version keeps its state).
  IF v_accept THEN
    UPDATE public.input_source_versions
      SET canonical_grain = COALESCE(mapping_payload->'canonical_grain', '[]'::jsonb),
          version_status = CASE WHEN version_status = 'draft' THEN 'accepted' ELSE version_status END
    WHERE id = target_version_id;
  END IF;

  INSERT INTO public.audit_events (
    organisation_id, actor_user_id, event_type, entity_type, entity_id, plan_id,
    old_value_json, new_value_json, reason
  ) VALUES (
    target_organisation_id, target_actor_user_id, 'input_source.mapping_versioned',
    'field_mapping_version', v_mapping.id, NULL,
    NULL,
    jsonb_build_object('input_source_version_id', target_version_id, 'mapping_version_number', v_next, 'accepted', v_accept),
    COALESCE(mapping_reason, 'Draft field mapping version created')
  );

  RETURN jsonb_build_object('mapping_version_id', v_mapping.id, 'mapping_version_number', v_next, 'accepted', v_accept);
END;
$$;

-- ---------------------------------------------------------------------
-- RPC: register / promote a custom dimension (reporting-only; no calc effect).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_custom_dimension(
  target_organisation_id uuid,
  target_actor_user_id uuid,
  target_plan_id uuid,
  dimension_payload jsonb,  -- { dimension_key, display_name, promotion_status }
  register_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dim public.custom_dimensions%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service_role required';
  END IF;

  IF NOT public.user_has_any_org_role(target_organisation_id, target_actor_user_id, ARRAY['owner', 'admin', 'finance_admin', 'planner']) THEN
    RAISE EXCEPTION 'Insufficient permission to register custom dimensions';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.plans WHERE id = target_plan_id AND organisation_id = target_organisation_id) THEN
    RAISE EXCEPTION 'Plan does not belong to the target organisation';
  END IF;

  INSERT INTO public.custom_dimensions (
    organisation_id, plan_id, dimension_key, display_name, promotion_status, created_by
  ) VALUES (
    target_organisation_id, target_plan_id,
    dimension_payload->>'dimension_key', dimension_payload->>'display_name',
    COALESCE(dimension_payload->>'promotion_status', 'retained'),
    target_actor_user_id
  )
  ON CONFLICT (organisation_id, plan_id, dimension_key)
  DO UPDATE SET display_name = EXCLUDED.display_name, promotion_status = EXCLUDED.promotion_status
  RETURNING * INTO v_dim;

  INSERT INTO public.audit_events (
    organisation_id, actor_user_id, event_type, entity_type, entity_id, plan_id,
    old_value_json, new_value_json, reason
  ) VALUES (
    target_organisation_id, target_actor_user_id, 'input_source.custom_dimension_registered',
    'custom_dimension', v_dim.id, target_plan_id,
    NULL,
    jsonb_build_object('dimension_key', v_dim.dimension_key, 'promotion_status', v_dim.promotion_status),
    COALESCE(register_reason, 'Custom dimension registered (reporting-only)')
  );

  RETURN to_jsonb(v_dim);
END;
$$;

-- Service-role-only execution.
-- Service-role-only execution. PostgreSQL grants EXECUTE to PUBLIC by default on
-- new functions, and that implicit grant is NOT removed by revoking from anon or
-- authenticated alone — so we revoke from PUBLIC first, then from the explicit
-- anon/authenticated roles, and finally grant EXECUTE to service_role only.
REVOKE ALL ON FUNCTION public.import_input_source_version(uuid, uuid, uuid, jsonb, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_field_mapping_version(uuid, uuid, uuid, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_custom_dimension(uuid, uuid, uuid, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.import_input_source_version(uuid, uuid, uuid, jsonb, jsonb, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.create_field_mapping_version(uuid, uuid, uuid, jsonb, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.register_custom_dimension(uuid, uuid, uuid, jsonb, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_input_source_version(uuid, uuid, uuid, jsonb, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_field_mapping_version(uuid, uuid, uuid, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.register_custom_dimension(uuid, uuid, uuid, jsonb, text) TO service_role;

NOTIFY pgrst, 'reload schema';
