// New application (owner: Dev 3; DSA Notion MODULE 16, API-APP-001). Opens a draft for an existing customer, without going
// through a lead. Needs application.create; the API applies the branch scope and re-checks every field. On success the new draft
// opens.
import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BranchSelect, CustomerSelect } from '../../shell/selectors';
import { AppButton } from '../../ui';
import { useCommand } from '../admin/api';
import { ErrorAlert } from '../admin/components';
import type { Application } from './ApplicationsPage';
import { PRODUCT_CATEGORIES, newApplicationProblem } from './rules';

const APPLICANT_TYPES = [
  ['SALARIED', 'Salaried'],
  ['SELF_EMPLOYED_PROFESSIONAL', 'Self-employed professional'],
  ['SELF_EMPLOYED_BUSINESS', 'Self-employed business'],
  ['NON_INDIVIDUAL', 'Non-individual'],
] as const;

interface CreateBody {
  customerId: string;
  branchId: string;
  productCategory: (typeof PRODUCT_CATEGORIES)[number];
  requestedAmount: { amount: string; currency: 'INR' };
  applicantType: (typeof APPLICANT_TYPES)[number][0];
  tenureMonths?: number;
}

export function NewApplicationDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [category, setCategory] = useState<(typeof PRODUCT_CATEGORIES)[number]>('PL');
  const [amount, setAmount] = useState('');
  const [tenure, setTenure] = useState('');
  const [applicantType, setApplicantType] = useState<(typeof APPLICANT_TYPES)[number][0]>('SALARIED');
  const create = useCommand<CreateBody, Application>(
    () => ({ path: '/v1/applications', method: 'POST' }),
    [['/v1/applications']],
    'Application opened.',
  );
  const problem = newApplicationProblem({ customerId, branchId, amount, tenure });

  return (
    <Dialog open={open} onClose={create.isPending ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>New application</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Opens a draft for an existing customer. Choose the product and its version on the application page.
        </Typography>
        <ErrorAlert error={create.error} />
        <Stack spacing={2} sx={{ mt: 1 }}>
          <CustomerSelect
            value={customerId}
            onChange={setCustomerId}
            required
            data-testid="applications.new-customer"
          />
          <BranchSelect
            value={branchId}
            onChange={setBranchId}
            required
            data-testid="applications.new-branch"
          />
          <TextField
            select
            size="small"
            label="Product category"
            value={category}
            onChange={(e) => setCategory(e.target.value as (typeof PRODUCT_CATEGORIES)[number])}
          >
            {PRODUCT_CATEGORIES.map((c) => (
              <MenuItem key={c} value={c}>
                {c}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label="Requested amount (INR)"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            helperText="Decimal, for example 300000.00"
            inputProps={{ 'data-testid': 'applications.new-amount' }}
          />
          <TextField
            size="small"
            type="number"
            label="Tenure in months (optional)"
            value={tenure}
            onChange={(e) => setTenure(e.target.value)}
          />
          <TextField
            select
            size="small"
            label="Applicant type"
            value={applicantType}
            onChange={(e) => setApplicantType(e.target.value as (typeof APPLICANT_TYPES)[number][0])}
          >
            {APPLICANT_TYPES.map(([value, label]) => (
              <MenuItem key={value} value={value}>
                {label}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <AppButton variant="ghost" onClick={onClose} disabled={create.isPending}>
          Cancel
        </AppButton>
        <AppButton
          variant="primary"
          loading={create.isPending}
          disabled={problem !== null}
          dataTestId="applications.new-submit"
          onClick={() =>
            create.mutate(
              {
                customerId: customerId!,
                branchId: branchId!,
                productCategory: category,
                requestedAmount: { amount: amount.trim(), currency: 'INR' },
                applicantType,
                ...(tenure ? { tenureMonths: Number(tenure) } : {}),
              },
              {
                onSuccess: (created) => {
                  onClose();
                  navigate(`/applications/${created.id}`);
                },
              },
            )
          }
        >
          Open application
        </AppButton>
      </DialogActions>
    </Dialog>
  );
}
