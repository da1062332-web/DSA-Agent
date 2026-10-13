export interface Role {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  isTemplate: boolean;
  version: number;
  permissions: string[];
}

export interface Permission {
  code: string;
  description: string;
  introducedIn: string;
}

export interface CreateRoleInput {
  code: string;
  name: string;
  permissions: string[];
}

export interface UpdateRoleInput {
  name?: string;
  permissions?: string[];
}

export interface UserRoleAssignment {
  id: string;
  userId: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  scopeType: 'OWN' | 'TEAM' | 'BRANCH' | 'TENANT';
  scopeBranchIds: string[];
  createdAt: string;
}

export interface UserEffectiveGrants {
  userId: string;
  grants: Array<{
    code: string;
    scope: 'OWN' | 'TEAM' | 'BRANCH' | 'TENANT';
    branchIds: string[];
  }>;
}
