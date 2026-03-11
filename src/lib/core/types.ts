/** A single field-level validation failure — framework-agnostic, no HTTP deps. */
export interface ValidationIssue {
  field: string;
  message: string;
}
