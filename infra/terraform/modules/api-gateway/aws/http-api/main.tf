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
# -------------------------------------------------------
resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = "$default"
  auto_deploy = true

  access_log_settings {
    destination_arn = var.access_log_group_arn
    format = jsonencode({
      requestId        = "$context.requestId"
      ip               = "$context.identity.sourceIp"
      requestTime      = "$context.requestTime"
      httpMethod       = "$context.httpMethod"
      routeKey         = "$context.routeKey"
      status           = "$context.status"
      protocol         = "$context.protocol"
      responseLength   = "$context.responseLength"
      integrationError = "$context.integrationErrorMessage"
    })
  }

  default_route_settings {
    throttling_burst_limit   = var.throttling.burst_limit
    throttling_rate_limit    = var.throttling.rate_limit
    detailed_metrics_enabled = var.detailed_metrics_enabled
  }

  tags = var.tags
}

# -------------------------------------------------------
# Lambda Integrations
# Only created when lambda_arn is non-empty
# Pass 1: empty ARNs → skipped
# Pass 2: real ARNs → wired
# -------------------------------------------------------
locals {
  active_integrations = {
    for k, v in var.integrations : k => v
    if v.lambda_arn != ""
  }
}

resource "aws_apigatewayv2_integration" "this" {
  for_each = local.active_integrations

  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_uri        = each.value.lambda_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
  timeout_milliseconds   = each.value.timeout_milliseconds
}

# -------------------------------------------------------
# Routes — only created when their integration exists
# -------------------------------------------------------
resource "aws_apigatewayv2_route" "this" {
  for_each = {
    for k, v in var.routes : k => v
    if contains(keys(local.active_integrations), v.integration_key)
  }

  api_id    = aws_apigatewayv2_api.this.id
  route_key = each.value.route_key

  target = "integrations/${aws_apigatewayv2_integration.this[each.value.integration_key].id}"

  authorization_type = each.value.requires_auth ? "JWT" : "NONE"
  authorizer_id      = each.value.requires_auth ? aws_apigatewayv2_authorizer.jwt.id : null
}

# -------------------------------------------------------
# Lambda invoke permissions — only when integration exists
# -------------------------------------------------------
resource "aws_lambda_permission" "this" {
  for_each = local.active_integrations

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
