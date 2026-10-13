// apps/web/src/features/verification/VerificationCreateDialog.tsx — owner: Developer 2
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
} from '@mui/material';
import { useState } from 'react';
import { createVerification } from './api';
import type { CreateVerificationInput, VerificationPriority, VerificationType } from './types';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function VerificationCreateDialog({ open, onClose, onSuccess }: Props) {
  const [applicationId, setApplicationId] = useState('');
  const [verificationType, setVerificationType] = useState<VerificationType>('DOCUMENT_REVIEW');
  const [branchId, setBranchId] = useState('br_mumbai');
  const [priority, setPriority] = useState<VerificationPriority>('MEDIUM');
  const [findingsSummary, setFindingsSummary] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!applicationId.trim()) {
      setError('Application ID is required');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const payload: CreateVerificationInput = {
        applicationId: applicationId.trim(),
        verificationType,
        branchId,
        priority,
        findingsSummary: findingsSummary.trim() || undefined,
      };

      await createVerification(payload);
      onSuccess();
      onClose();
    } catch (err) {
      setError((err as Error).message || 'Failed to initiate verification');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} disablePortal onClose={loading ? undefined : onClose} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit}>
        <DialogTitle>Initiate Verification Case</DialogTitle>
        <DialogContent dividers>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField
              label="Loan Application ID"
              placeholder="e.g. app_01J..."
              value={applicationId}
              onChange={(e) => setApplicationId(e.target.value)}
              required
              fullWidth
              size="small"
              data-testid="verification.create.applicationId"
            />

            <FormControl fullWidth size="small">
              <InputLabel id="verification-type-label">Verification Type</InputLabel>
              <Select
                labelId="verification-type-label"
                value={verificationType}
                label="Verification Type"
                onChange={(e) => setVerificationType(e.target.value as VerificationType)}
                data-testid="verification.create.type"
              >
                <MenuItem value="DOCUMENT_REVIEW">Document Review</MenuItem>
                <MenuItem value="IDENTITY_KYC">Identity & KYC Verification</MenuItem>
                <MenuItem value="RESIDENCE_FI">Residence Field Investigation</MenuItem>
                <MenuItem value="OFFICE_FI">Office Field Investigation</MenuItem>
                <MenuItem value="EMPLOYMENT">Employment Verification</MenuItem>
                <MenuItem value="BANK_STATEMENT">Bank Statement Analysis</MenuItem>
              </Select>
            </FormControl>

            <FormControl fullWidth size="small">
              <InputLabel id="verification-branch-label">Branch</InputLabel>
              <Select
                labelId="verification-branch-label"
                value={branchId}
                label="Branch"
                onChange={(e) => setBranchId(e.target.value)}
                data-testid="verification.create.branch"
              >
                <MenuItem value="br_mumbai">Mumbai Central (MUM01)</MenuItem>
                <MenuItem value="br_pune">Pune Camp (PUN01)</MenuItem>
              </Select>
            </FormControl>

            <FormControl fullWidth size="small">
              <InputLabel id="verification-priority-label">Priority</InputLabel>
              <Select
                labelId="verification-priority-label"
                value={priority}
                label="Priority"
                onChange={(e) => setPriority(e.target.value as VerificationPriority)}
                data-testid="verification.create.priority"
              >
                <MenuItem value="HIGH">High</MenuItem>
                <MenuItem value="MEDIUM">Medium</MenuItem>
                <MenuItem value="LOW">Low</MenuItem>
              </Select>
            </FormControl>

            <TextField
              label="Initial Instructions / Scope Summary"
              placeholder="Enter notes or specific checks needed for the verifier..."
              value={findingsSummary}
              onChange={(e) => setFindingsSummary(e.target.value)}
              multiline
              rows={3}
              fullWidth
              size="small"
              data-testid="verification.create.findingsSummary"
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={onClose} disabled={loading} color="inherit">
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={loading}
            startIcon={loading ? <CircularProgress size={16} /> : undefined}
            data-testid="verification.create.submit"
          >
            Create Verification
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
