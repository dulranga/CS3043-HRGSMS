// Matches the 'branch' table schema
export interface Branch {
  branch_id: string;
  name: string;
  city: string;
  address: string | null;
  active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

// Request payload when creating a branch
export interface CreateBranchDTO {
  name: string;
  city: string;
  address?: string;
  active?: boolean;
}

// Request payload when updating a branch
export interface UpdateBranchDTO {
  name?: string;
  city?: string;
  address?: string;
  active?: boolean;
}

// Matches safe user data returned from 'user_account' (excludes password_hash)
export interface SafeUserAccount {
  user_id: string;
  username: string;
  active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
  last_login_at: Date | string | null;
}

// Payload for toggling user status
export interface UpdateUserStatusDTO {
  active: boolean;
}

// Matches audit_log table
export interface AuditLog {
  audit_id: string;
  user_id: string | null;
  entity_name: string;
  entity_id: string;
  action: string;
  before_value: string | null;
  after_value: string | null;
  changed_at: Date | string;
  ip_address: string | null;
  username?: string; // Present when joined with user_account
}

// Matches system_config table (billing policy & global rates)
export interface SystemConfig {
  config_key: string;
  config_value: string;
  effective_from: Date | string;
  updated_by: string | null;
  updated_at: Date | string;
}

// Payload for updating policy values
export interface UpdateConfigDTO {
  config_value: string;
  effective_from?: string;
  updated_by?: string;
}