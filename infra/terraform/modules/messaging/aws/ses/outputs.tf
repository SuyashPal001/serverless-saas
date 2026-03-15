output "domain_identity_arn" {
  description = "ARN of the SES domain identity."
  value       = aws_ses_domain_identity.this.arn
}

output "verification_token" {
  description = "TXT record value for domain verification — add to Route 53 as _amazonses.<domain>."
  value       = aws_ses_domain_identity.this.verification_token
}

output "dkim_tokens" {
  description = "List of 3 DKIM tokens — create CNAME records in Route 53 for each."
  value       = aws_ses_domain_dkim.this.dkim_tokens
}

output "mail_from_domain" {
  description = "MAIL FROM domain for bounce handling."
  value       = aws_ses_domain_mail_from.this.mail_from_domain
}
