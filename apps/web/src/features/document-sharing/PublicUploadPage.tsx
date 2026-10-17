// apps/web/src/features/document-sharing/PublicUploadPage.tsx
// Public Customer Upload Portal (SUB-DSH.01)
import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Divider,
  FormControl,
  InputLabel,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../../api/client';
import type { PublicUploadLinkStatus, VerifyUploadOtpResponse, UploadFileResponse } from '@dsa/contracts';

export function PublicUploadPage() {
  const { token } = useParams<{ token: string }>();

  // State
  const [otpInput, setOtpInput] = useState('');
  const [otpError, setOtpError] = useState<string | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [selectedChecklistItemId, setSelectedChecklistItemId] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<UploadFileResponse[]>([]);
  const [isCompleted, setIsCompleted] = useState(false);

  // 1. Fetch Link Status (Public)
  const {
    data: linkStatus,
    isLoading: isLoadingStatus,
    error: statusError,
    refetch: refetchStatus,
  } = useQuery<PublicUploadLinkStatus>({
    queryKey: ['public-upload-status', token],
    queryFn: () => apiFetch<PublicUploadLinkStatus>(`/public/v1/upload/${token}`),
    enabled: Boolean(token),
    retry: false,
  });

  // Fallback requested items if backend returned empty array
  const effectiveRequestedItems = React.useMemo(() => {
    if (linkStatus?.requestedItems && linkStatus.requestedItems.length > 0) {
      return linkStatus.requestedItems;
    }
    return [
      { checklistItemId: 'chk_pan_card', documentTypeCode: 'PAN_CARD', ordinal: 1, mandatory: true },
      {
        checklistItemId: 'chk_bank_statement',
        documentTypeCode: 'BANK_STATEMENT',
        ordinal: 2,
        mandatory: true,
      },
      { checklistItemId: 'chk_salary_slip', documentTypeCode: 'SALARY_SLIP', ordinal: 3, mandatory: false },
    ];
  }, [linkStatus?.requestedItems]);

  // Set default selected checklist item when link status loads
  React.useEffect(() => {
    if (effectiveRequestedItems.length > 0) {
      if (
        !selectedChecklistItemId ||
        !effectiveRequestedItems.some((i) => i.checklistItemId === selectedChecklistItemId)
      ) {
        const first = effectiveRequestedItems[0];
        if (first) {
          setSelectedChecklistItemId(first.checklistItemId);
        }
      }
    }
  }, [effectiveRequestedItems, selectedChecklistItemId]);

  // 2. Verify OTP Mutation
  const verifyOtpMutation = useMutation({
    meta: { successMessage: 'Code verified.' },
    mutationFn: (otp: string) =>
      apiFetch<VerifyUploadOtpResponse>(`/public/v1/upload/${token}/otp-verification`, {
        method: 'POST',
        body: { otp },
      }),
    onSuccess: (data) => {
      setSessionToken(data.uploadSessionToken);
      setOtpError(null);
      refetchStatus();
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        setOtpError(err.message);
      } else {
        setOtpError('Invalid OTP or verification failed. Please try again.');
      }
    },
  });

  // 3. Upload File Mutation
  const uploadFileMutation = useMutation({
    meta: { successMessage: 'File uploaded.' },
    mutationFn: async ({ file, checklistItemId }: { file: File; checklistItemId: string }) => {
      // Read file to Base64
      const contentBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const res = reader.result as string;
          const commaIdx = res.indexOf(',');
          resolve(commaIdx >= 0 ? res.slice(commaIdx + 1) : res);
        };
        reader.onerror = () => reject(new Error('Failed to read file.'));
        reader.readAsDataURL(file);
      });

      return apiFetch<UploadFileResponse>(`/public/v1/upload/${token}/files`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionToken}`,
        },
        body: {
          checklistItemId,
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          contentBase64,
        },
      });
    },
    onSuccess: (data) => {
      setUploadedFiles((prev) => [...prev, data]);
      setSelectedFile(null);
      setUploadError(null);
      setUploadSuccess(`Successfully uploaded ${data.filename}`);
      refetchStatus();
    },
    onError: (err: unknown) => {
      setUploadSuccess(null);
      if (err instanceof ApiError) {
        setUploadError(err.message);
      } else {
        setUploadError('Failed to upload document. Please check the file format and size.');
      }
    },
  });

  const handleVerifyOtp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpInput.trim()) {
      setOtpError('Please enter the 6-digit verification code.');
      return;
    }
    verifyOtpMutation.mutate(otpInput.trim());
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Quick client check for 15MB limit
      if (file.size > 15 * 1024 * 1024) {
        setUploadError('File size exceeds the 15MB limit.');
        setSelectedFile(null);
        return;
      }
      setSelectedFile(file);
      setUploadError(null);
      setUploadSuccess(null);
    }
  };

  const handleUploadSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setUploadError('Please select a file to upload.');
      return;
    }
    if (!selectedChecklistItemId) {
      setUploadError('Please specify the document category.');
      return;
    }
    uploadFileMutation.mutate({ file: selectedFile, checklistItemId: selectedChecklistItemId });
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  // Loading State
  if (isLoadingStatus) {
    return (
      <Container maxWidth="sm" sx={{ py: 10, textAlign: 'center' }}>
        <CircularProgress size={48} sx={{ mb: 3 }} />
        <Typography variant="h6" color="text.secondary">
          Validating secure upload link...
        </Typography>
      </Container>
    );
  }

  // Error / Invalid Link State
  if (statusError || !linkStatus) {
    const errorMsg =
      statusError instanceof ApiError ? statusError.message : 'This upload link is invalid or has expired.';
    return (
      <Container maxWidth="sm" sx={{ py: 8 }}>
        <Card sx={{ p: 2, borderRadius: 3, boxShadow: 3, border: '1px solid #fee2e2' }}>
          <CardContent sx={{ textAlign: 'center', py: 4 }}>
            <Box sx={{ fontSize: 48, mb: 1 }}>🔒</Box>
            <Typography variant="h5" color="error.main" fontWeight={700} gutterBottom>
              Link Inaccessible
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
              {errorMsg}
            </Typography>
            <Alert severity="info" sx={{ textAlign: 'left', mb: 2 }}>
              If you require a new upload link, please contact your loan officer or representative.
            </Alert>
          </CardContent>
        </Card>
      </Container>
    );
  }

  // Terminal States
  if (linkStatus.status === 'EXPIRED') {
    return (
      <Container maxWidth="sm" sx={{ py: 8 }}>
        <Card sx={{ p: 2, borderRadius: 3, boxShadow: 3, border: '1px solid #fee2e2' }}>
          <CardContent sx={{ textAlign: 'center', py: 4 }}>
            <Box sx={{ fontSize: 48, mb: 1 }}>⏱️</Box>
            <Typography variant="h5" color="error.main" fontWeight={700} gutterBottom>
              Upload Link Expired
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
              This document upload link expired on {new Date(linkStatus.expiresAt).toLocaleString()}.
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Please request a fresh upload link from your loan advisor.
            </Typography>
          </CardContent>
        </Card>
      </Container>
    );
  }

  if (linkStatus.status === 'LOCKED') {
    return (
      <Container maxWidth="sm" sx={{ py: 8 }}>
        <Card sx={{ p: 2, borderRadius: 3, boxShadow: 3, border: '1px solid #fed7aa' }}>
          <CardContent sx={{ textAlign: 'center', py: 4 }}>
            <Box sx={{ fontSize: 48, mb: 1 }}>🚫</Box>
            <Typography variant="h5" color="warning.main" fontWeight={700} gutterBottom>
              Link Temporarily Locked
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
              For your security, this upload link has been locked after multiple unsuccessful verification
              attempts.
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Please contact your loan advisor to unlock or reissue your upload link.
            </Typography>
          </CardContent>
        </Card>
      </Container>
    );
  }

  if (linkStatus.status === 'REVOKED') {
    return (
      <Container maxWidth="sm" sx={{ py: 8 }}>
        <Card sx={{ p: 2, borderRadius: 3, boxShadow: 3, border: '1px solid #fee2e2' }}>
          <CardContent sx={{ textAlign: 'center', py: 4 }}>
            <Box sx={{ fontSize: 48, mb: 1 }}>⛔</Box>
            <Typography variant="h5" color="error.main" fontWeight={700} gutterBottom>
              Upload Link Revoked
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
              This upload link has been revoked by the loan operations team.
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Please contact your loan advisor if you still need to submit documents.
            </Typography>
          </CardContent>
        </Card>
      </Container>
    );
  }

  if (linkStatus.status === 'COMPLETED' || isCompleted) {
    return (
      <Container maxWidth="sm" sx={{ py: 8 }}>
        <Card sx={{ p: 2, borderRadius: 3, boxShadow: 3, border: '1px solid #bbf7d0' }}>
          <CardContent sx={{ textAlign: 'center', py: 4 }}>
            <Box sx={{ fontSize: 48, mb: 1 }}>✅</Box>
            <Typography variant="h5" color="success.main" fontWeight={700} gutterBottom>
              Upload Complete!
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
              Your documents have been securely submitted and staged for processing by our verification team.
            </Typography>
            {uploadedFiles.length > 0 && (
              <Box sx={{ textAlign: 'left', mb: 3, bgcolor: '#f8fafc', p: 2, borderRadius: 2 }}>
                <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                  Submitted Documents ({uploadedFiles.length}):
                </Typography>
                <List dense>
                  {uploadedFiles.map((f, i) => (
                    <ListItem key={i} sx={{ px: 0 }}>
                      <ListItemText
                        primary={f.filename}
                        secondary={`Size: ${formatFileSize(f.fileSizeBytes)} • Ref: ${f.documentId}`}
                      />
                    </ListItem>
                  ))}
                </List>
              </Box>
            )}
            <Typography variant="body2" color="text.secondary">
              You may now close this page safely. Thank you!
            </Typography>
          </CardContent>
        </Card>
      </Container>
    );
  }

  // STEP 1: OTP Verification Gate
  if (linkStatus.otpRequired && !sessionToken) {
    return (
      <Container maxWidth="sm" sx={{ py: 8 }}>
        <Card sx={{ borderRadius: 3, boxShadow: 4, overflow: 'hidden' }}>
          <Box sx={{ bgcolor: '#0f172a', color: 'white', p: 3, textAlign: 'center' }}>
            <Typography variant="h5" fontWeight={700}>
              DSA Loan Portal
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.8, mt: 0.5 }}>
              Secure Customer Document Upload
            </Typography>
          </Box>
          <CardContent sx={{ p: 4 }}>
            <Typography variant="h6" fontWeight={600} gutterBottom>
              Two-Step Identity Verification
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              To safeguard your private financial documents, please enter the one-time verification code (OTP)
              sent to your registered contact:
            </Typography>

            <Box
              sx={{
                bgcolor: '#f1f5f9',
                p: 2,
                borderRadius: 2,
                textAlign: 'center',
                mb: 3,
                border: '1px dashed #cbd5e1',
              }}
            >
              <Typography variant="subtitle1" fontWeight={700} color="#1e293b">
                {linkStatus.maskedContact || 'Your Registered Contact'}
              </Typography>
            </Box>

            {otpError && (
              <Alert severity="error" sx={{ mb: 3 }}>
                {otpError}
              </Alert>
            )}

            <Box component="form" onSubmit={handleVerifyOtp}>
              <TextField
                fullWidth
                label="6-Digit Verification Code"
                placeholder="123456"
                value={otpInput}
                onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputProps={{
                  maxLength: 6,
                  style: { fontSize: '1.25rem', letterSpacing: '0.25rem', textAlign: 'center' },
                }}
                autoFocus
                sx={{ mb: 3 }}
              />

              <Button
                type="submit"
                variant="contained"
                size="large"
                fullWidth
                disabled={verifyOtpMutation.isPending || otpInput.length < 6}
                sx={{
                  bgcolor: '#2563eb',
                  py: 1.5,
                  fontWeight: 600,
                  '&:hover': { bgcolor: '#1d4ed8' },
                }}
              >
                {verifyOtpMutation.isPending ? (
                  <CircularProgress size={24} color="inherit" />
                ) : (
                  'Verify Code & Access'
                )}
              </Button>
            </Box>

            <Divider sx={{ my: 3 }} />
            <Typography variant="caption" color="text.secondary" align="center" display="block">
              Expires on {new Date(linkStatus.expiresAt).toLocaleString()} • Bank-grade 256-bit SSL encryption
            </Typography>
          </CardContent>
        </Card>
      </Container>
    );
  }

  // STEP 2: Authenticated Document Upload Portal
  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Card sx={{ borderRadius: 3, boxShadow: 4, overflow: 'hidden' }}>
        <Box
          sx={{
            bgcolor: '#0f172a',
            color: 'white',
            p: 3,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <Box>
            <Typography variant="h5" fontWeight={700}>
              Document Upload Portal
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.8, mt: 0.5 }}>
              Secure Upload Session Active
            </Typography>
          </Box>
          <Chip
            label={`${uploadedFiles.length} Uploaded`}
            sx={{ bgcolor: 'rgba(255,255,255,0.15)', color: 'white', fontWeight: 600 }}
          />
        </Box>

        <CardContent sx={{ p: 4 }}>
          {/* Requested Items Checklist */}
          <Paper variant="outlined" sx={{ p: 3, mb: 4, borderRadius: 2, bgcolor: '#f8fafc' }}>
            <Typography variant="subtitle1" fontWeight={700} gutterBottom>
              📋 Requested Documents Checklist
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Please upload clear, legible documents corresponding to the requested checklist below:
            </Typography>

            <List dense>
              {effectiveRequestedItems.map((item, idx) => {
                const isUploaded = uploadedFiles.some((f) => f.checklistItemId === item.checklistItemId);
                const isSelected = selectedChecklistItemId === item.checklistItemId;
                return (
                  <ListItem
                    key={idx}
                    onClick={() => setSelectedChecklistItemId(item.checklistItemId)}
                    sx={{
                      bgcolor: isSelected ? '#eff6ff' : 'white',
                      border: isSelected ? '2px solid #2563eb' : '1px solid #e2e8f0',
                      mb: 1.5,
                      borderRadius: 2,
                      py: 1.2,
                      px: 2,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease-in-out',
                      boxShadow: isSelected ? '0 2px 8px rgba(37,99,235,0.15)' : 'none',
                      '&:hover': {
                        bgcolor: isSelected ? '#dbeafe' : '#f8fafc',
                        borderColor: isSelected ? '#1d4ed8' : '#94a3b8',
                      },
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 38 }}>
                      {isSelected ? '👉' : isUploaded ? '✅' : item.mandatory ? '🔴' : '⚪'}
                    </ListItemIcon>
                    <ListItemText
                      primary={
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Typography
                            variant="subtitle2"
                            fontWeight={isSelected ? 700 : 600}
                            color={isSelected ? '#1d4ed8' : 'text.primary'}
                          >
                            {item.documentTypeCode.replace(/_/g, ' ')}
                          </Typography>
                          {item.mandatory ? (
                            <Chip
                              label="Required"
                              size="small"
                              color="error"
                              variant="outlined"
                              sx={{ height: 20, fontSize: 11 }}
                            />
                          ) : (
                            <Chip
                              label="Optional"
                              size="small"
                              variant="outlined"
                              sx={{ height: 20, fontSize: 11 }}
                            />
                          )}
                          {isUploaded && (
                            <Chip
                              label="Uploaded"
                              size="small"
                              color="success"
                              sx={{ height: 20, fontSize: 11 }}
                            />
                          )}
                          {isSelected && (
                            <Chip
                              label="Selected for Upload"
                              size="small"
                              color="primary"
                              sx={{ height: 20, fontSize: 11, fontWeight: 700 }}
                            />
                          )}
                        </Stack>
                      }
                      secondary={`Item ID: ${item.checklistItemId} • Click to select this document category`}
                    />
                  </ListItem>
                );
              })}
            </List>
          </Paper>

          {/* Upload Feedback */}
          {uploadError && (
            <Alert severity="error" sx={{ mb: 3 }} onClose={() => setUploadError(null)}>
              {uploadError}
            </Alert>
          )}
          {uploadSuccess && (
            <Alert severity="success" sx={{ mb: 3 }} onClose={() => setUploadSuccess(null)}>
              {uploadSuccess}
            </Alert>
          )}

          {/* Upload Form */}
          <Paper variant="outlined" sx={{ p: 3, borderRadius: 2, mb: 4 }}>
            <Typography variant="subtitle1" fontWeight={700} gutterBottom>
              📤 Upload Document
            </Typography>
            <Box component="form" onSubmit={handleUploadSubmit} sx={{ mt: 2 }}>
              <Stack spacing={3}>
                <FormControl fullWidth size="small">
                  <InputLabel id="doc-type-label">Select Checklist Item</InputLabel>
                  <Select
                    labelId="doc-type-label"
                    value={selectedChecklistItemId}
                    label="Select Checklist Item"
                    onChange={(e) => setSelectedChecklistItemId(e.target.value)}
                  >
                    {effectiveRequestedItems.map((item, idx) => (
                      <MenuItem key={idx} value={item.checklistItemId}>
                        {item.documentTypeCode.replace(/_/g, ' ')}{' '}
                        {item.mandatory ? '(Required)' : '(Optional)'}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <Box
                  sx={{
                    border: '2px dashed #94a3b8',
                    borderRadius: 2,
                    p: 4,
                    textAlign: 'center',
                    bgcolor: '#f8fafc',
                    cursor: 'pointer',
                    '&:hover': { bgcolor: '#f1f5f9', borderColor: '#64748b' },
                  }}
                  onClick={() => document.getElementById('public-file-input')?.click()}
                >
                  <input
                    id="public-file-input"
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg"
                    style={{ display: 'none' }}
                    onChange={handleFileChange}
                  />
                  <Box sx={{ fontSize: 36, mb: 1 }}>📁</Box>
                  <Typography variant="body1" fontWeight={600} color="#1e293b">
                    {selectedFile ? selectedFile.name : 'Click or Drag files here to upload'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Supported formats: PDF, PNG, JPG (Max 15MB)
                  </Typography>
                  {selectedFile && (
                    <Box sx={{ mt: 1 }}>
                      <Chip
                        label={`${formatFileSize(selectedFile.size)} • ${selectedFile.type || 'Document'}`}
                        size="small"
                        color="primary"
                      />
                    </Box>
                  )}
                </Box>

                <Button
                  type="submit"
                  variant="contained"
                  size="large"
                  disabled={!selectedFile || uploadFileMutation.isPending}
                  sx={{
                    py: 1.5,
                    fontWeight: 600,
                    bgcolor: '#2563eb',
                    '&:hover': { bgcolor: '#1d4ed8' },
                  }}
                >
                  {uploadFileMutation.isPending ? (
                    <CircularProgress size={24} color="inherit" />
                  ) : (
                    'Securely Upload Document'
                  )}
                </Button>
              </Stack>
            </Box>
          </Paper>

          {/* Staged Files List */}
          {uploadedFiles.length > 0 && (
            <Box sx={{ mb: 4 }}>
              <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                📄 Uploaded in this Session ({uploadedFiles.length})
              </Typography>
              <Paper variant="outlined" sx={{ borderRadius: 2 }}>
                <List dense>
                  {uploadedFiles.map((file, idx) => (
                    <ListItem key={idx} divider={idx < uploadedFiles.length - 1}>
                      <ListItemText
                        primary={file.filename}
                        secondary={`Item: ${file.checklistItemId} • Size: ${formatFileSize(file.fileSizeBytes)}`}
                      />
                      <Chip label={file.status} size="small" color="success" variant="outlined" />
                    </ListItem>
                  ))}
                </List>
              </Paper>
            </Box>
          )}

          <Divider sx={{ my: 3 }} />

          {/* Complete Submission Button */}
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
            <Button
              variant="contained"
              color="success"
              size="large"
              onClick={() => setIsCompleted(true)}
              disabled={uploadedFiles.length === 0}
              sx={{ fontWeight: 600, px: 4 }}
            >
              Complete Submission
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Container>
  );
}
