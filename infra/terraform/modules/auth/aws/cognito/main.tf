# -------------------------------------------------------
# Data sources
# -------------------------------------------------------
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# -------------------------------------------------------
# User Pool
# -------------------------------------------------------
resource "aws_cognito_user_pool" "this" {
  name = var.user_pool_name

  # Username config — email as primary identifier
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  username_configuration {
    case_sensitive = false
  }

  # Password policy
  password_policy {
    minimum_length                   = var.password_policy.minimum_length
    require_uppercase                = var.password_policy.require_uppercase
    require_lowercase                = var.password_policy.require_lowercase
    require_numbers                  = var.password_policy.require_numbers
    require_symbols                  = var.password_policy.require_symbols
    temporary_password_validity_days = var.password_policy.temporary_password_validity_days
  }

  # MFA — optional by default, can be enforced per tenant via app clients
  mfa_configuration = var.mfa_configuration

  dynamic "software_token_mfa_configuration" {
    for_each = var.mfa_configuration != "OFF" ? [1] : []
    content {
      enabled = true
    }
  }

  # Account recovery
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email_first"
      priority = 1
    }
  }

  # Schema — custom attributes for tenant context
  # These are stamped into the JWT by the Pre Token Generation Lambda
  schema {
    name                = "tenantId"
    attribute_data_type = "String"
    mutable             = true
    string_attribute_constraints {
      min_length = 0
      max_length = 36
    }
  }

  schema {
    name                = "role"
    attribute_data_type = "String"
    mutable             = true
    string_attribute_constraints {
      min_length = 0
      max_length = 50
    }
  }

  schema {
    name                = "plan"
    attribute_data_type = "String"
    mutable             = true
    string_attribute_constraints {
      min_length = 0
      max_length = 20
    }
  }

  # Email configuration
  dynamic "email_configuration" {
    for_each = var.email_configuration != null ? [var.email_configuration] : []
    content {
      email_sending_account  = email_configuration.value.email_sending_account
      source_arn             = email_configuration.value.source_arn
      from_email_address     = email_configuration.value.from_email_address
      reply_to_email_address = email_configuration.value.reply_to_email_address
    }
  }

  # Lambda triggers
  lambda_config {
    pre_token_generation_config {
      lambda_arn     = var.pre_token_generation_lambda_arn
      lambda_version = "V2_0"
    }
  }

  # User pool add-ons
  user_pool_add_ons {
    advanced_security_mode = var.advanced_security_mode
  }

  # Deletion protection
  deletion_protection = var.deletion_protection ? "ACTIVE" : "INACTIVE"

  tags = var.tags
}

# -------------------------------------------------------
# User Pool Domain
# Needed for hosted UI and OAuth flows
# -------------------------------------------------------
resource "aws_cognito_user_pool_domain" "this" {
  domain       = var.domain_prefix
  user_pool_id = aws_cognito_user_pool.this.id
}

# -------------------------------------------------------
# App Clients
# One per use case — web, mobile, machine-to-machine
# -------------------------------------------------------
resource "aws_cognito_user_pool_client" "this" {
  for_each = var.app_clients

  name         = each.value.name
  user_pool_id = aws_cognito_user_pool.this.id

  # Token validity
  access_token_validity  = each.value.access_token_validity_hours
  id_token_validity      = each.value.id_token_validity_hours
  refresh_token_validity = each.value.refresh_token_validity_days

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  # Auth flows
  explicit_auth_flows = each.value.explicit_auth_flows

  # OAuth config
  allowed_oauth_flows                  = each.value.allowed_oauth_flows
  allowed_oauth_flows_user_pool_client = length(each.value.allowed_oauth_flows) > 0
  allowed_oauth_scopes                 = each.value.allowed_oauth_scopes
  callback_urls                        = each.value.callback_urls
  logout_urls                          = each.value.logout_urls
  supported_identity_providers         = each.value.supported_identity_providers

  # Security
  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true

  # Read/write attributes
  read_attributes  = each.value.read_attributes
  write_attributes = each.value.write_attributes

  generate_secret = each.value.generate_secret
}

# -------------------------------------------------------
# Lambda trigger permission
# Allows Cognito to invoke Pre Token Generation Lambda
# -------------------------------------------------------
resource "aws_lambda_permission" "pre_token_generation" {
  statement_id  = "AllowCognitoInvokePreTokenGeneration"
  action        = "lambda:InvokeFunction"
  function_name = var.pre_token_generation_lambda_arn
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.this.arn
}
