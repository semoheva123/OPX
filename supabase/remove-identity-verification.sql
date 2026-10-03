begin;

update public.users
set metadata = coalesce(metadata, '{}'::jsonb) - array[
  'kycStatus', 'kycFullName', 'kycDocumentType', 'kycDocumentNumber',
  'kycDocumentUrl', 'kycCountry', 'kycSubmittedAt', 'kycReviewedAt',
  'kycReviewedBy', 'kycNotes', 'kycReason',
  'kyc_status', 'kyc_full_name', 'kyc_document_type', 'kyc_document_number',
  'kyc_document_url', 'kyc_country', 'kyc_submitted_at', 'kyc_reviewed_at',
  'kyc_reviewed_by', 'kyc_notes', 'kyc_reason'
];

alter table public.users
  drop column if exists kyc_status,
  drop column if exists kyc_full_name,
  drop column if exists kyc_document_type,
  drop column if exists kyc_document_number,
  drop column if exists kyc_document_url,
  drop column if exists kyc_country,
  drop column if exists kyc_submitted_at,
  drop column if exists kyc_reviewed_at,
  drop column if exists kyc_reviewed_by,
  drop column if exists kyc_notes,
  drop column if exists kyc_reason;

commit;