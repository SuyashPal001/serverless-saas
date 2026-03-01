variable "sqs_mappings" {
  description = "Map of SQS → Lambda event source mappings."
  type = map(object({
    queue_arn  = string
    lambda_arn = string

    batch_size              = optional(number, 10)
    batching_window_seconds = optional(number, 0)
    maximum_concurrency     = optional(number, 10)

    # Optional message filtering — only invoke Lambda for matching messages
    # Each filter is a map that will be jsonencoded as an EventBridge filter pattern
    # Example: { body = { eventType = ["invoice.failed"] } }
    filters = optional(list(any), [])
  }))
  default = {}
}

variable "dlq_alert_mappings" {
  description = "Optional map of DLQ → Lambda alert pipes via EventBridge Pipes."
  type = map(object({
    name      = string
    dlq_arn   = string
    lambda_arn = string
    role_arn  = string
  }))
  default = {}
}

# Accepts a list of resource ARNs to depend on before creating mappings.
# Used to ensure IAM role policies are attached before the mapping is created.
variable "mapping_dependencies" {
  description = "Resources that must exist before event source mappings are created (e.g. IAM policy attachments)."
  type        = any
  default     = []
}

variable "tags" {
  description = "Tags to apply to all resources."
  type        = map(string)
  default     = {}
}
