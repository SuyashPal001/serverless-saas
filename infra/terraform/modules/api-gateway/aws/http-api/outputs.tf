output "api_id" {
  description = "HTTP API ID."
  value       = aws_apigatewayv2_api.this.id
}

output "api_arn" {
  description = "HTTP API ARN."
  value       = aws_apigatewayv2_api.this.arn
}

output "api_endpoint" {
  description = "Default API endpoint URL (without custom domain)."
  value       = aws_apigatewayv2_api.this.api_endpoint
}

output "execution_arn" {
  description = "API Gateway execution ARN — used for Lambda invoke permission source_arn."
  value       = aws_apigatewayv2_api.this.execution_arn
}

output "stage_id" {
  description = "Default stage ID."
  value       = aws_apigatewayv2_stage.default.id
}

output "invoke_url" {
  description = "Full invoke URL for the default stage."
  value       = aws_apigatewayv2_stage.default.invoke_url
}

output "authorizer_id" {
  description = "JWT authorizer ID — used for wiring additional routes."
  value       = aws_apigatewayv2_authorizer.jwt.id
}

output "custom_domain_target" {
  description = "Custom domain target DNS name — point your CNAME here."
  value       = var.custom_domain != null ? aws_apigatewayv2_domain_name.this[0].domain_name_configuration[0].target_domain_name : null
}
