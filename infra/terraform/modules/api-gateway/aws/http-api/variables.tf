variable "name" {
  description = "Name of the HTTP API."
  type        = string
}

variable "description" {
  description = "Description of the HTTP API."
  type        = string
  default     = null
}

variable "access_log_group_arn" {
  description = "ARN of the CloudWatch log group for API Gateway access logs."
  type        = string
}

variable "detailed_metrics_enabled" {
  description = "Enable detailed CloudWatch metrics per route."
  type        = bool
  default     = false  # enable in prod — adds cost per route metric
}

variable "jwt_authorizer" {
  description = "JWT authorizer configuration. Issuer is the Cognito user pool endpoint. Audience is the app client ID."
  type = object({
    issuer   = string        # https://{user_pool_endpoint}
    audience = list(string)  # [app_client_id]
  })
}

variable "throttling" {
  description = "Default stage throttling limits."
  type = object({
    burst_limit = optional(number, 500)   # max concurrent requests
    rate_limit  = optional(number, 1000)  # requests per second
  })
  default = {}
}

variable "cors" {
  description = "CORS configuration for the API."
  type = object({
    allow_origins     = optional(list(string), ["*"])
    allow_methods     = optional(list(string), ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
    allow_headers     = optional(list(string), ["Authorization", "Content-Type", "X-Tenant-ID"])
    expose_headers    = optional(list(string), [])
    allow_credentials = optional(bool, false)
    max_age           = optional(number, 86400)
  })
  default = {}
}

variable "integrations" {
  description = "Map of Lambda integrations. Key is a logical name referenced by routes."
  type = map(object({
    lambda_arn           = string
    timeout_milliseconds = optional(number, 29000)  # API GW max is 29s
  }))
  default = {}
}

variable "routes" {
  description = "Map of routes to create. Each route references an integration by key."
  type = map(object({
    route_key       = string  # e.g. "ANY /api/v1/{proxy+}"
    integration_key = string  # must match a key in var.integrations
    requires_auth   = optional(bool, true)
  }))
  default = {}
}

variable "custom_domain" {
  description = "Optional custom domain configuration."
  type = object({
    domain_name     = string
    certificate_arn = string
  })
  default = null
}

variable "tags" {
  description = "Tags to apply to all resources."
  type        = map(string)
  default     = {}
}
