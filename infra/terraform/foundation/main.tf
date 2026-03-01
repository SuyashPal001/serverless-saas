# -------------------------------------------------------
# Locals
# -------------------------------------------------------
locals {
  name_prefix = "${var.project}-${var.environment}"
  module_path = "../modules"
}

# -------------------------------------------------------
# Module: Cognito
# -------------------------------------------------------
module "cognito" {
  source = "${local.module_path}/auth/aws/cognito"

  user_pool_name                  = "${local.name_prefix}-user-pool"
  domain_prefix                   = var.cognito_domain_prefix
  pre_token_generation_lambda_arn = var.pre_token_generation_lambda_arn
  deletion_protection             = false
  mfa_configuration               = "OFF"
  advanced_security_mode          = "OFF"

  password_policy = {
    minimum_length                   = 8
    require_uppercase                = true
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = false
    temporary_password_validity_days = 7
  }

  app_clients = {
    web = {
      name                        = "${local.name_prefix}-web-client"
      access_token_validity_hours = 1
      id_token_validity_hours     = 1
      refresh_token_validity_days = 30
      explicit_auth_flows = [
        "ALLOW_USER_SRP_AUTH",
        "ALLOW_REFRESH_TOKEN_AUTH"
      ]
      allowed_oauth_flows          = ["code"]
      allowed_oauth_scopes         = ["email", "openid", "profile"]
      callback_urls                = ["http://localhost:3000/auth/callback"]
      logout_urls                  = ["http://localhost:3000"]
      supported_identity_providers = ["COGNITO"]
      read_attributes              = ["email", "name", "custom:tenantId", "custom:role", "custom:plan"]
      write_attributes             = ["email", "name"]
      generate_secret              = false
    }
  }

  email_configuration = null
  tags                = {}
}

# -------------------------------------------------------
# Module: SQS — Processing Queue
# -------------------------------------------------------
module "sqs_processing" {
  source = "${local.module_path}/messaging/aws/sqs"

  queue_name                 = var.processing_queue_name
  visibility_timeout_seconds = var.visibility_timeout_seconds
  message_retention_seconds  = var.message_retention_seconds
  fifo                       = false
  tags                       = {}
}

# -------------------------------------------------------
# Module: SQS — Workflow Queue
# -------------------------------------------------------
module "sqs_workflow" {
  source = "${local.module_path}/messaging/aws/sqs"

  queue_name                 = var.workflow_queue_name
  visibility_timeout_seconds = var.visibility_timeout_seconds
  message_retention_seconds  = var.message_retention_seconds
  fifo                       = false
  tags                       = {}
}

# -------------------------------------------------------
# Module: SNS — Events Topic
# -------------------------------------------------------
module "sns_events" {
  source = "${local.module_path}/messaging/aws/sns"

  topic_name = var.events_topic_name
  tags       = {}
}

# -------------------------------------------------------
# Module: EventBridge — Custom Event Bus
# -------------------------------------------------------
module "eventbridge" {
  source = "${local.module_path}/messaging/aws/eventbridge"

  event_bus_name = var.event_bus_name
  tags           = {}
}

# -------------------------------------------------------
# Module: CloudWatch — Log Groups
# -------------------------------------------------------
module "cloudwatch" {
  source = "${local.module_path}/observability/aws/cloudwatch"

  log_groups = {
    api    = "/aws/lambda/${local.name_prefix}-foundation-api"
    worker = "/aws/lambda/${local.name_prefix}-foundation-worker"
    pretoken = "/aws/lambda/${local.name_prefix}-foundation-pretoken"
  }
  retention_in_days = var.log_retention_days
  tags              = {}
}

# -------------------------------------------------------
# Module: API Gateway
# -------------------------------------------------------
module "api_gateway" {
  source = "${local.module_path}/api-gateway/aws/http-api"

  api_name       = var.api_name
  stage_name     = var.api_stage_name
  cors_allow_origins = var.cors_allow_origins

  # JWT authorizer — Cognito
  jwt_issuer   = "https://cognito-idp.${var.region}.amazonaws.com/${module.cognito.user_pool_id}"
  jwt_audience = [module.cognito.app_client_ids["web"]]

  # Route integrations — Lambda ARNs from SAM
  lambda_integrations = {
    "ANY /api/v1/{proxy+}" = var.foundation_api_lambda_arn
  }

  tags = {}
}

# -------------------------------------------------------
# Module: Event Source Mapping — SQS → Worker Lambda
# -------------------------------------------------------
module "esm_processing" {
  source = "${local.module_path}/integration/aws/event-source-mapping"

  event_source_arn = module.sqs_processing.queue_arn
  function_arn     = var.foundation_worker_lambda_arn
  batch_size       = 10
}

# -------------------------------------------------------
# SSM Bridge — Terraform writes, SAM reads
# -------------------------------------------------------
locals {
  ssm_prefix = "/${var.project}/${var.environment}"
}

resource "aws_ssm_parameter" "cognito_user_pool_id" {
  name  = "${local.ssm_prefix}/cognito/user-pool-id"
  type  = "String"
  value = module.cognito.user_pool_id
}

resource "aws_ssm_parameter" "cognito_client_id" {
  name  = "${local.ssm_prefix}/cognito/client-id"
  type  = "String"
  value = module.cognito.app_client_ids["web"]
}

resource "aws_ssm_parameter" "cognito_jwks_uri" {
  name  = "${local.ssm_prefix}/cognito/jwks-uri"
  type  = "String"
  value = module.cognito.jwks_uri
}

resource "aws_ssm_parameter" "sqs_processing_queue_url" {
  name  = "${local.ssm_prefix}/sqs/processing-queue-url"
  type  = "String"
  value = module.sqs_processing.queue_url
}

resource "aws_ssm_parameter" "sqs_workflow_queue_url" {
  name  = "${local.ssm_prefix}/sqs/workflow-queue-url"
  type  = "String"
  value = module.sqs_workflow.queue_url
}

resource "aws_ssm_parameter" "sns_events_topic_arn" {
  name  = "${local.ssm_prefix}/sns/events-topic-arn"
  type  = "String"
  value = module.sns_events.topic_arn
}

resource "aws_ssm_parameter" "eventbridge_bus_name" {
  name  = "${local.ssm_prefix}/eventbridge/bus-name"
  type  = "String"
  value = module.eventbridge.event_bus_name
}

resource "aws_ssm_parameter" "api_gateway_id" {
  name  = "${local.ssm_prefix}/api-gateway/id"
  type  = "String"
  value = module.api_gateway.api_id
}

resource "aws_ssm_parameter" "api_gateway_url" {
  name  = "${local.ssm_prefix}/api-gateway/url"
  type  = "String"
  value = module.api_gateway.api_endpoint
}
