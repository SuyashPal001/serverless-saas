variable "buses" {
  description = "Map of custom event buses with their rules and targets."
  type = map(object({
    name = string

    # IAM principals allowed to put events onto this bus (cross-account etc.)
    allowed_principal_arns = optional(list(string), [])

    rules = optional(map(object({
      name                = string
      description         = optional(string, null)
      enabled             = optional(bool, true)

      # Exactly one of these must be set per rule
      event_pattern       = optional(any, null)   # map — will be jsonencoded
      schedule_expression = optional(string, null) # cron() or rate()

      targets = optional(map(object({
        target_id        = string
        arn              = string        # Lambda ARN / SQS ARN / SNS ARN
        role_arn         = optional(string, null)
        message_group_id = optional(string, null) # FIFO SQS only

        input_transformer = optional(object({
          input_paths    = map(string)
          input_template = string
        }), null)
      })), {})
    })), {})
  }))
  default = {}
}

variable "tags" {
  description = "Tags to apply to all resources."
  type        = map(string)
  default     = {}
}
