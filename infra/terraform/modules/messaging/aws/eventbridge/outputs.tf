output "bus_arns" {
  description = "Map of logical name → event bus ARN."
  value       = { for k, v in aws_cloudwatch_event_bus.this : k => v.arn }
}

output "bus_names" {
  description = "Map of logical name → event bus name."
  value       = { for k, v in aws_cloudwatch_event_bus.this : k => v.name }
}

output "rule_arns" {
  description = "Map of 'bus_key:rule_key' → event rule ARN."
  value       = { for k, v in aws_cloudwatch_event_rule.this : k => v.arn }
}

output "rule_names" {
  description = "Map of 'bus_key:rule_key' → event rule name."
  value       = { for k, v in aws_cloudwatch_event_rule.this : k => v.name }
}
