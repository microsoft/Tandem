export interface RoleHint {
  schemaVersion: 'human-role-hint/v1';
  role: 'designer' | 'agent';
}
export function parseRoleMention(message: string): { roleHint: RoleHint | null; error: string | null };
