export interface UserSummary {
  id: string;
  tenantId: string;
  email: string;
  mobileE164: string | null;
  displayName: string;
  userType: 'STAFF';
  status: 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
  availability: 'AVAILABLE' | 'BUSY' | 'OFF_DUTY' | 'ON_LEAVE';
  primaryBranchId: string;
  assignedRoles: string[];
  lockVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface Branch {
  id: string;
  organisationId: string;
  code: string;
  name: string;
  pincode: string | null;
  status: string;
}

export interface Role {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  isTemplate: boolean;
  version: number;
  permissions: string[];
}

export interface CreateUserInput {
  email: string;
  displayName: string;
  mobileE164?: string | null;
  primaryBranchId: string;
  status?: 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
  availability?: 'AVAILABLE' | 'BUSY' | 'OFF_DUTY' | 'ON_LEAVE';
  roleIds?: string[];
}

export interface UpdateUserInput {
  displayName?: string;
  mobileE164?: string | null;
  status?: 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
  availability?: 'AVAILABLE' | 'BUSY' | 'OFF_DUTY' | 'ON_LEAVE';
  primaryBranchId?: string;
}
