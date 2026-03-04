variable "roles" {
  description = "Map of IAM roles to create. Key is a logical name, value is the config."
  type = map(object({
    name               = string
    description        = optional(string, "")
    assume_role_policy = string
    policy_arns        = optional(list(string), [])
    inline_policies    = optional(map(string), {})
  }))
  default = {}
}

variable "tags" {
  description = "Tags to apply to all resources."
  type        = map(string)
  default     = {}
}
