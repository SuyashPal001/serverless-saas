# -------------------------------------------------------
# HTTP API
# -------------------------------------------------------
resource "aws_apigatewayv2_api" "this" {
  name          = var.name
  protocol_type = "HTTP"
  description   = var.description

  cors_configuration {
    allow_origins     = var.cors.allow_origins
    allow_methods     = var.cors.allow_methods
    allow_headers     = var.cors.allow_headers
    expose_headers    = var.cors.expose_headers
    allow_credentials = var.cors.allow_credentials
    max_age           = var.cors.max_age
  }

  tags = var.tags
}

# -------------------------------------------------------
# JWT Authorizer
# Validates Cognito-issued JWTs at the gateway level
# -------------------------------------------------------
resource "aws_apigatewayv2_authorizer" "jwt" {
  api_id           = aws_apigatewayv2_api.this.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "${var.name}-jwt-authorizer"

  jwt_configuration {
    issuer   = var.jwt_authorizer.issuer
    audience = var.jwt_authorizer.audience
  }
}

# -------------------------------------------------------
# Stage
# Single $default stage with auto-deploy
# -------------------------------------------------------
resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = "$default"
  auto_deploy = true

  access_log_settings {
    destination_arn = var.access_log_group_arn
  }

  default_route_settings {
    throttling_burst_limit = var.throttling.burst_limit
    throttling_rate_limit  = var.throttling.rate_limit
    detailed_metrics_enabled = var.detailed_metrics_enabled
  }

  tags = var.tags
}

# -------------------------------------------------------
# Lambda Integrations
# One integration per Lambda — proxy mode
# -------------------------------------------------------
resource "aws_apigatewayv2_integration" "this" {
  for_each = var.integrations

  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_uri        = each.value.lambda_arn
  integration_method     = "POST"
  payload_format_version = "2.0"   # required for Hono Lambda handler
  timeout_milliseconds   = each.value.timeout_milliseconds
}

# -------------------------------------------------------
# Routes
# Each route maps a method+path to an integration
# Routes without auth use the JWT authorizer by default
# Health check routes are explicitly excluded from auth
# -------------------------------------------------------
resource "aws_apigatewayv2_route" "this" {
  for_each = var.routes

  api_id    = aws_apigatewayv2_api.this.id
  route_key = each.value.route_key  # e.g. "ANY /api/v1/helpdesk/{proxy+}"

  target = "integrations/${aws_apigatewayv2_integration.this[each.value.integration_key].id}"

  authorization_type = each.value.requires_auth ? "JWT" : "NONE"
  authorizer_id      = each.value.requires_auth ? aws_apigatewayv2_authorizer.jwt.id : null
}

# -------------------------------------------------------
# Lambda invoke permissions
# Allows API Gateway to invoke each Lambda
# -------------------------------------------------------
resource "aws_lambda_permission" "this" {
  for_each = var.integrations

  statement_id  = "AllowAPIGatewayInvoke-${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = each.value.lambda_arn
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*"
}

# -------------------------------------------------------
# Custom domain (optional)
# -------------------------------------------------------
resource "aws_apigatewayv2_domain_name" "this" {
  count = var.custom_domain != null ? 1 : 0

  domain_name = var.custom_domain.domain_name

  domain_name_configuration {
    certificate_arn = var.custom_domain.certificate_arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }

  tags = var.tags
}

resource "aws_apigatewayv2_api_mapping" "this" {
  count = var.custom_domain != null ? 1 : 0

  api_id      = aws_apigatewayv2_api.this.id
  domain_name = aws_apigatewayv2_domain_name.this[0].id
  stage       = aws_apigatewayv2_stage.default.id
}
