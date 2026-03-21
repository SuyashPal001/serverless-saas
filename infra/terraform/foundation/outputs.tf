# -------------------------------------------------------
# Cognito
# -------------------------------------------------------
output "cognito_user_pool_id" {
  description = "Cognito user pool ID."
  value       = module.cognito.user_pool_id
}

output "cognito_user_pool_arn" {
  description = "Cognito user pool ARN."
  value       = module.cognito.user_pool_arn
}

output "cognito_jwks_uri" {
  description = "JWKS URI for JWT verification."
  value       = module.cognito.jwks_uri
}

output "cognito_hosted_ui_domain" {
  description = "Cognito hosted UI domain URL."
  value       = module.cognito.hosted_ui_domain
}

output "cognito_web_client_id" {
  description = "Web app client ID."
  value       = module.cognito.app_client_ids["web"]
}

# -------------------------------------------------------
# API Gateway
# -------------------------------------------------------
output "api_gateway_id" {
  description = "API Gateway ID."
  value       = module.api_gateway.api_id
}

output "api_gateway_endpoint" {
  description = "API Gateway invoke URL."
  value       = module.api_gateway.api_endpoint
}

# -------------------------------------------------------
# SQS
# -------------------------------------------------------
output "sqs_processing_queue_url" {
  description = "Processing queue URL."
  value       = module.sqs.queue_urls["processing"]
}

output "sqs_processing_queue_arn" {
  description = "Processing queue ARN."
  value       = module.sqs.queue_arns["processing"]
}

output "sqs_workflow_queue_url" {
  description = "Workflow queue URL."
  value       = module.sqs.queue_urls["workflow"]
}

output "sqs_workflow_queue_arn" {
  description = "Workflow queue ARN."
  value       = module.sqs.queue_arns["workflow"]
}

# -------------------------------------------------------
# SNS
# -------------------------------------------------------
output "sns_events_topic_arn" {
  description = "Events SNS topic ARN."
  value       = module.sns_events.topic_arns["events"]
}

# -------------------------------------------------------
# EventBridge
# -------------------------------------------------------
output "eventbridge_bus_name" {
  description = "Custom EventBridge event bus name."
  value       = module.eventbridge.bus_names["main"]
}

output "eventbridge_bus_arn" {
  description = "Custom EventBridge event bus ARN."
  value       = module.eventbridge.bus_arns["main"]
}

# -------------------------------------------------------
# SSM Parameter prefix (for reference in SAM templates)
# -------------------------------------------------------
output "ssm_prefix" {
  description = "SSM parameter store prefix for this environment."
  value       = "/${var.project}/${var.environment}"
}

# -------------------------------------------------------
# SES
# -------------------------------------------------------
output "ses_verification_token" {
  description = "TXT record value for SES domain verification."
  value       = module.ses.verification_token
}

output "ses_dkim_tokens" {
  description = "List of 3 DKIM tokens for Route 53 CNAME records."
  value       = module.ses.dkim_tokens
}

output "ses_mail_from_domain" {
  description = "MAIL FROM domain for bounce handling."
  value       = module.ses.mail_from_domain
}

# -------------------------------------------------------
# Storage
# -------------------------------------------------------
output "storage_bucket_name" {
  description = "S3 file storage bucket name."
  value       = aws_s3_bucket.files.bucket
}
