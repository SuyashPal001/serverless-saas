variable "queues" {
  description = "Map of SQS queues to create. Key is a logical name, value is the config."
  type = map(object({
    name                       = string
    fifo                       = optional(bool, false)
    visibility_timeout_seconds = optional(number, 30)
    message_retention_seconds  = optional(number, 345600)  # 4 days
    delay_seconds              = optional(number, 0)
    max_message_size           = optional(number, 262144)  # 256 KB
    receive_wait_time_seconds  = optional(number, 20)      # long polling default
    kms_key_id                 = optional(string, null)
    create_dlq                 = optional(bool, true)
    max_receive_count          = optional(number, 3)
    allowed_sns_topic_arns     = optional(list(string), [])
  }))
  default = {}
}

variable "tags" {
  description = "Tags to apply to all resources."
  type        = map(string)
  default     = {}
}
