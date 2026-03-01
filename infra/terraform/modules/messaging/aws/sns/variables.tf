variable "topics" {
  description = "Map of SNS topics to create. Key is a logical name, value is the config."
  type = map(object({
    name         = string
    display_name = optional(string, null)
    fifo         = optional(bool, false)
    kms_key_id   = optional(string, null)

    # Who is allowed to publish to this topic
    allowed_eventbridge_bus_arns = optional(list(string), [])
    allowed_lambda_arns          = optional(list(string), [])

    # Subscriptions keyed by a logical name
    subscriptions = optional(map(object({
      protocol             = string       # sqs | lambda | email | https
      endpoint             = string       # queue ARN | lambda ARN | email | URL
      raw_message_delivery = optional(bool, false)
      filter_policy        = optional(map(list(string)), null)
    })), {})
  }))
  default = {}
}

variable "tags" {
  description = "Tags to apply to all resources."
  type        = map(string)
  default     = {}
}
