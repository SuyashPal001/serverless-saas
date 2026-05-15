variable "user_pool_name" {
  description = "Name of the Cognito user pool."
  type        = string
}

variable "domain_prefix" {
  description = "Cognito hosted UI domain prefix. Must be globally unique."
  type        = string
}

variable "pre_token_generation_lambda_arn" {
  description = "ARN of the Lambda function invoked before JWT is issued. Leave empty on first apply — wire after SAM deploys the function."
  type        = string
  default     = ""
}

variable "password_policy" {
  description = "Password requirements for the user pool."
  type = object({
    minimum_length                   = optional(number, 12)
    require_uppercase                = optional(bool, true)
    require_lowercase                = optional(bool, true)
    require_numbers                  = optional(bool, true)
    require_symbols                  = optional(bool, true)
    temporary_password_validity_days = optional(number, 7)
  })
  default = {}
}

variable "mfa_configuration" {
  description = "MFA setting: OFF | OPTIONAL | ON."
  type        = string
  default     = "OPTIONAL"

  validation {
    condition     = contains(["OFF", "OPTIONAL", "ON"], var.mfa_configuration)
    error_message = "mfa_configuration must be OFF, OPTIONAL, or ON."
  }
}

variable "advanced_security_mode" {
  description = "Cognito advanced security: OFF | AUDIT | ENFORCED."
  type        = string
  default     = "AUDIT"

  validation {
    condition     = contains(["OFF", "AUDIT", "ENFORCED"], var.advanced_security_mode)
    error_message = "advanced_security_mode must be OFF, AUDIT, or ENFORCED."
  }
}

variable "deletion_protection" {
  description = "Prevent accidental user pool deletion."
  type        = bool
  default     = true
}

variable "email_configuration" {
  description = "SES email configuration. If null, Cognito default email is used (dev only)."
  type = object({
    email_sending_account  = string
    source_arn             = optional(string, null)
    from_email_address     = optional(string, null)
    reply_to_email_address = optional(string, null)
  })
  default = null
}

variable "app_clients" {
  description = "Map of app clients to create against this user pool."
  type = map(object({
    name                        = string
    access_token_validity_hours = optional(number, 1)
    id_token_validity_hours     = optional(number, 1)
    refresh_token_validity_days = optional(number, 30)
    generate_secret             = optional(bool, false)

    explicit_auth_flows = optional(list(string), [
      "ALLOW_USER_SRP_AUTH",
      "ALLOW_REFRESH_TOKEN_AUTH"
    ])

    allowed_oauth_flows          = optional(list(string), ["code"])
    allowed_oauth_scopes         = optional(list(string), ["email", "openid", "profile"])
    callback_urls                = optional(list(string), [])
    logout_urls                  = optional(list(string), [])
    supported_identity_providers = optional(list(string), ["COGNITO"])

    read_attributes  = optional(list(string), ["email", "name", "custom:tenantId", "custom:role", "custom:plan"])
    write_attributes = optional(list(string), ["email", "name"])
  }))
  default = {}
}

variable "tags" {
  description = "Tags to apply to all resources."
  type        = map(string)
  default     = {}
}

variable "identity_providers" {
  description = "Map of identity providers to federate with the user pool."
  type = map(object({
    provider_name     = string
    provider_type     = string
    provider_details  = map(string)
    attribute_mapping = map(string)
  }))
  default = {}
}
