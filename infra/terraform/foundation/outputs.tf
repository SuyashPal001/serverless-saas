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
  value       = module.sqs_processing.queue_url
}

output "sqs_processing_queue_arn" {
  description = "Processing queue ARN."
  value       = module.sqs_processing.queue_arn
}

output "sqs_workflow_queue_url" {
  description = "Workflow queue URL."
  value       = module.sqs_workflow.queue_url
}

output "sqs_workflow_queue_arn" {
  description = "Workflow queue ARN."
  value       = module.sqs_workflow.queue_arn
}

# -------------------------------------------------------
# SNS
# -------------------------------------------------------
output "sns_events_topic_arn" {
  description = "Events SNS topic ARN."
  value       = module.sns_events.topic_arn
}

# -------------------------------------------------------
# EventBridge
# -------------------------------------------------------
output "eventbridge_bus_name" {
  description = "Custom EventBridge event bus name."
  value       = module.eventbridge.event_bus_name
}

output "eventbridge_bus_arn" {
  description = "Custom EventBridge event bus ARN."
  value       = module.eventbridge.event_bus_arn
}

# -------------------------------------------------------
# SSM Parameter paths (for reference in SAM templates)
# -------------------------------------------------------
output "ssm_prefix" {
  description = "SSM parameter store prefix for this environment."
  value       = "/${var.project}/${var.environment}"
}
