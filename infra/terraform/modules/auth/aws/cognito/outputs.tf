output "user_pool_id" {
  description = "Cognito user pool ID."
  value       = aws_cognito_user_pool.this.id
}

output "user_pool_arn" {
  description = "Cognito user pool ARN."
  value       = aws_cognito_user_pool.this.arn
}

output "user_pool_endpoint" {
  description = "Cognito user pool endpoint (used as JWT issuer URL)."
  value       = aws_cognito_user_pool.this.endpoint
}

output "jwks_uri" {
  description = "JWKS URI for JWT signature verification. Used by API Gateway JWT authorizer."
  value       = "https://${aws_cognito_user_pool.this.endpoint}/.well-known/jwks.json"
}

output "hosted_ui_domain" {
  description = "Cognito hosted UI domain URL."
  value       = "https://${aws_cognito_user_pool_domain.this.domain}.auth.${data.aws_region.current.name}.amazoncognito.com"
}

output "app_client_ids" {
  description = "Map of logical name → app client ID."
  value       = { for k, v in aws_cognito_user_pool_client.this : k => v.id }
}

output "app_client_secrets" {
  description = "Map of logical name → app client secret (only for clients with generate_secret = true)."
  value       = { for k, v in aws_cognito_user_pool_client.this : k => v.client_secret if v.client_secret != "" }
  sensitive   = true
}
