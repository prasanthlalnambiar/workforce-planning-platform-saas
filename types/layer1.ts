export type Layer1ApprovalStatus = 'draft' | 'proposed' | 'approved' | 'rejected';
export type Layer1RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface Layer1HandoffMinimumFields {
  organisation_id: string;
  fiscal_year_id: string;
  version_id: string;
  approved_by: string;
  approved_at: string;
  source_quality_score: number;
  confidence_score: number;
  assumption_risk_level: Layer1RiskLevel;
}
