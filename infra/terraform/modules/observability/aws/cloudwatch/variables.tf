variable "log_groups" {
  description = "Map of log groups to create. Key is a logical name, value is the config."
  type = map(object({
    name              = string
    retention_in_days = number
    kms_key_id        = optional(string, null)
  }))
  default = {}
}

variable "metric_alarms" {
  description = "Map of CloudWatch metric alarms to create."
  type = map(object({
    alarm_name          = string
    alarm_description   = string
    comparison_operator = string
    evaluation_periods  = number
    metric_name         = string
    namespace           = string
    period              = number
    statistic           = string
    threshold           = number
    treat_missing_data  = optional(string, "notBreaching")
    dimensions          = optional(map(string), {})
    alarm_actions       = optional(list(string), [])
    ok_actions          = optional(list(string), [])
  }))
  default = {}
}

variable "tags" {
  description = "Tags to apply to all resources."
  type        = map(string)
  default     = {}
}
