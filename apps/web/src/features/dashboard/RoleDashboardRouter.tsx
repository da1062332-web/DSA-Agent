import { useEffect, useState } from 'react';
import { Box, CircularProgress, Container } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { useMe } from '../../api/useMe';
import { HomePage } from '../../shell/HomePage';
import { AdminDashboard } from './AdminDashboard';
import { ComplianceDashboard } from './ComplianceDashboard';
import { FinanceDashboard } from './FinanceDashboard';
import { LoanOpsDashboard } from './LoanOpsDashboard';
import { ManagerDashboard } from './ManagerDashboard';
import { RMDashboard } from './RMDashboard';
import { RuleEngineDashboard } from './RuleEngineDashboard';
import { type DashboardRole, resolveUserRoles } from './role-routing';
import { RoleSwitcher } from './RoleSwitcher';
import { SalesExecDashboard } from './SalesExecDashboard';
import { VerifierDashboard } from './VerifierDashboard';

export function RoleDashboardRouter() {
  const me = useMe();
  const [searchParams, setSearchParams] = useSearchParams();

  const availableRoles = resolveUserRoles(me.data);
  const primaryRole = availableRoles[0] ?? 'ROLE-TENANT-ADMIN';

  // Read initial role preference from URL param or localStorage
  const urlRole = searchParams.get('role') as DashboardRole | null;
  const storedRole = (typeof window !== 'undefined' ? localStorage.getItem('qloax_active_dashboard_role') : null) as DashboardRole | null;

  const [activeRole, setActiveRole] = useState<DashboardRole>(() => {
    if (urlRole && availableRoles.includes(urlRole)) return urlRole;
    if (storedRole && availableRoles.includes(storedRole)) return storedRole;
    return primaryRole;
  });

  // Keep activeRole aligned if availableRoles change or load
  useEffect(() => {
    if (availableRoles.length > 0 && !availableRoles.includes(activeRole)) {
      setActiveRole(primaryRole);
    }
  }, [availableRoles, activeRole, primaryRole]);

  const handleRoleChange = (role: DashboardRole) => {
    setActiveRole(role);
    if (typeof window !== 'undefined') {
      localStorage.setItem('qloax_active_dashboard_role', role);
    }
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('role', role);
      return next;
    });
  };

  if (me.isLoading) {
    return (
      <Container maxWidth="lg" sx={{ py: 10, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Container>
    );
  }

  if (me.isError || !me.data) {
    return <HomePage />;
  }

  // Render role-specific workspace with RoleSwitcher banner
  return (
    <Box sx={{ width: '100%' }} data-testid="role-dashboard-container">
      {availableRoles.length > 1 && (
        <Container maxWidth="xl" sx={{ pt: 2, pb: 0 }}>
          <RoleSwitcher
            availableRoles={availableRoles}
            activeRole={activeRole}
            onRoleChange={handleRoleChange}
          />
        </Container>
      )}

      {(() => {
        switch (activeRole) {
          case 'ROLE-SALES-EXEC':
            return <SalesExecDashboard />;
          case 'ROLE-LOAN-OPS':
            return <LoanOpsDashboard />;
          case 'ROLE-DOC-VERIFIER':
            return <VerifierDashboard />;
          case 'ROLE-RM':
            return <RMDashboard />;
          case 'ROLE-BRANCH-MGR':
          case 'ROLE-TEAM-MGR':
            return <ManagerDashboard />;
          case 'ROLE-FINANCE-EXEC':
          case 'ROLE-COMMISSION-APPROVER':
            return <FinanceDashboard />;
          case 'ROLE-COMPLIANCE':
            return <ComplianceDashboard />;
          case 'ROLE-RULE-AUTHOR':
            return <RuleEngineDashboard mode="author" />;
          case 'ROLE-RULE-APPROVER':
            return <RuleEngineDashboard mode="approver" />;
          case 'ROLE-ORG-OWNER':
            return <AdminDashboard role="ROLE-ORG-OWNER" />;
          case 'ROLE-TENANT-ADMIN':
            return <AdminDashboard role="ROLE-TENANT-ADMIN" />;
          default:
            return <HomePage />;
        }
      })()}
    </Box>
  );
}
